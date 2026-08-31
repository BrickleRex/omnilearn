// Tutor chat: the learner asks their instructor a question without leaving the
// editor. History lives per milestone at <project>/.omnilearn/chat/<id>.json.
//
// The tutor explains — it never hands over the milestone's implementation. That
// rule lives in the prompt (prompts.chatPrompt) because it is the product, not a
// formatting preference; see SPEC.md.

import { Router } from 'express';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ChatMessage, ChatRequest, ChatResponse, Milestone, Project } from '../../shared/types';
import { HttpError, chatDir, ensureDir, readJsonOrDelete } from '../store';
import { findMilestone, loadProject } from '../projects';
import { getLastRun } from '../runner';
import { callClaude, callClaudeStream, isMock } from './llm';
import * as fixtures from './fixtures';
import * as prompts from './prompts';

const HISTORY_CAP = 60;   // messages kept on disk per milestone
const CONTEXT_TURNS = 12; // messages handed to the model as prior conversation

// ---------- persistence ----------

function historyFile(projectId: string, milestoneId: string): string {
  const safe = String(milestoneId ?? '').replace(/[^A-Za-z0-9._-]/g, '-');
  if (!safe || safe === '.' || safe === '..') throw new HttpError(400, 'invalid milestoneId');
  return path.join(chatDir(projectId), `${safe}.json`);
}

function coerceMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    const text = typeof record.text === 'string' ? record.text : '';
    if (!text) continue;
    out.push({
      role: record.role === 'tutor' ? 'tutor' : 'user',
      text,
      at: typeof record.at === 'string' ? record.at : new Date().toISOString(),
    });
  }
  return out;
}

export async function readChat(projectId: string, milestoneId: string): Promise<ChatMessage[]> {
  const file = historyFile(projectId, milestoneId);
  return coerceMessages(await readJsonOrDelete<unknown>(file));
}

/** Atomic (tmp + rename) so a crash mid-write cannot leave a half-written log. */
async function writeChat(projectId: string, milestoneId: string, messages: ChatMessage[]): Promise<void> {
  const file = historyFile(projectId, milestoneId);
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  const body = JSON.stringify(messages.slice(-HISTORY_CAP), null, 2) + '\n';
  try {
    await fsp.writeFile(tmp, body, 'utf8');
    await fsp.rename(tmp, file);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

// ---------- the reply ----------

function buildContext(
  project: Project,
  milestone: Milestone,
  req: ChatRequest,
  history: ChatMessage[],
  message: string,
): prompts.ChatContext {
  const steps = milestone.steps ?? [];
  const lastRun = getLastRun(project.id);
  const currentStep = Number.isFinite(milestone.currentStep)
    ? Math.min(Math.max(0, Math.floor(milestone.currentStep)), Math.max(0, steps.length - 1))
    : 0;
  return {
    projectName: project.name,
    goal: project.goal,
    milestoneTitle: milestone.title,
    concepts: (milestone.concepts ?? []).map((c) => ({ label: c.label, cleared: !!c.cleared })),
    steps,
    currentStep,
    ...(typeof req.path === 'string' && req.path ? { activePath: req.path } : {}),
    ...(typeof req.content === 'string' && req.content ? { activeContent: req.content } : {}),
    ...(lastRun ? { lastRun } : {}),
    history: history.slice(-CONTEXT_TURNS),
    message,
  };
}

export async function askTutor(projectId: string, req: ChatRequest): Promise<ChatResponse> {
  const message = String(req.message ?? '').trim();
  if (!message) throw new HttpError(400, 'body.message is required');

  const project = await loadProject(projectId);
  const milestone = findMilestone(project, String(req.milestoneId ?? ''));
  const history = await readChat(projectId, milestone.id);

  const reply = isMock()
    ? fixtures.mockChat(milestone, message)
    : (
        await callClaude({
          task: 'chat',
          prompt: prompts.chatPrompt(buildContext(project, milestone, req, history, message)),
        })
      ).trim();

  const now = new Date().toISOString();
  // One write, at the end: a failed call leaves no orphan user turn behind.
  await writeChat(projectId, milestone.id, [
    ...history,
    { role: 'user', text: message, at: now },
    { role: 'tutor', text: reply, at: new Date().toISOString() },
  ]);

  return { reply };
}

/**
 * Streaming variant: text deltas are pushed through `onDelta` as they arrive,
 * the full reply is returned, and history is persisted exactly like askTutor.
 * In mock mode the fixture reply streams in three deterministic chunks.
 */
export async function askTutorStream(
  projectId: string,
  req: ChatRequest,
  onDelta: (text: string) => void,
): Promise<ChatResponse> {
  const message = String(req.message ?? '').trim();
  if (!message) throw new HttpError(400, 'body.message is required');

  const project = await loadProject(projectId);
  const milestone = findMilestone(project, String(req.milestoneId ?? ''));
  const history = await readChat(projectId, milestone.id);

  let reply: string;
  if (isMock()) {
    reply = fixtures.mockChat(milestone, message);
    const third = Math.max(1, Math.ceil(reply.length / 3));
    for (let i = 0; i < reply.length; i += third) {
      onDelta(reply.slice(i, i + third));
      await new Promise((r) => setTimeout(r, 40));
    }
  } else {
    reply = (
      await callClaudeStream(
        { task: 'chat', prompt: prompts.chatPrompt(buildContext(project, milestone, req, history, message)) },
        onDelta,
      )
    ).trim();
  }

  const now = new Date().toISOString();
  await writeChat(projectId, milestone.id, [
    ...history,
    { role: 'user', text: message, at: now },
    { role: 'tutor', text: reply, at: new Date().toISOString() },
  ]);
  return { reply };
}

// ---------- routes ----------

export const chatRouter: Router = Router();

chatRouter.get('/projects/:id/chat', async (req, res, next) => {
  try {
    const milestoneId = String(req.query.milestoneId ?? '');
    if (!milestoneId) throw new HttpError(400, 'query param "milestoneId" is required');
    const project = await loadProject(req.params.id);
    findMilestone(project, milestoneId); // 404 for a milestone that does not exist
    res.json(await readChat(project.id, milestoneId));
  } catch (err) {
    next(err);
  }
});

chatRouter.post('/projects/:id/chat', async (req, res, next) => {
  try {
    res.json(await askTutor(req.params.id, (req.body ?? {}) as ChatRequest));
  } catch (err) {
    next(err);
  }
});

// SSE: `data: {"type":"delta","text":...}` per chunk, then `{"type":"done","reply":...}`.
// Errors after headers are sent become an `{"type":"error"}` event, not a 500.
chatRouter.post('/projects/:id/chat/stream', async (req, res) => {
  const send = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  try {
    const { reply } = await askTutorStream(
      req.params.id,
      (req.body ?? {}) as ChatRequest,
      (text) => send({ type: 'delta', text }),
    );
    send({ type: 'done', reply });
  } catch (err) {
    send({ type: 'error', message: err instanceof Error ? err.message : 'chat failed' });
  } finally {
    res.end();
  }
});
