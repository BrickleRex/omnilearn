// Ask: the skill coach, beside the learner while they write. Same shapes as the
// code track's tutor chat; history lives at data/skills/<id>/chat/<moduleId>.json.
//
// The coach explains and points. It never writes the learner's piece — they type
// every line, which is the product, so the rule lives in the prompt.

import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ChatMessage, ChatRequest, ChatResponse } from '../../../shared/types';
import { HttpError, ensureDir, readJsonOrDelete } from '../../store';
import { callClaude, callClaudeStream, isMock } from '../../llm/llm';
import { loadDrafts, skillDir } from '../store';
import { mockChatReply } from '../fixtures';
import { findModule, loadPractice } from './context';
import { ladderText } from './drafts';
import { skillChatPrompt } from './prompts';

const HISTORY_CAP = 60;   // messages kept on disk per module
const CONTEXT_TURNS = 12; // messages handed to the model as prior conversation

function historyFile(id: string, moduleId: string): string {
  const safe = String(moduleId ?? '').replace(/[^A-Za-z0-9._-]/g, '-');
  if (!safe || safe === '.' || safe === '..') throw new HttpError(400, 'invalid milestoneId');
  return path.join(skillDir(id), 'chat', `${safe}.json`);
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

export async function readSkillChat(id: string, moduleId: string): Promise<ChatMessage[]> {
  return coerceMessages(await readJsonOrDelete<unknown>(historyFile(id, moduleId)));
}

/** Atomic (tmp + rename): a crash mid-write cannot leave a half-written log. */
async function writeSkillChat(id: string, moduleId: string, messages: ChatMessage[]): Promise<void> {
  const file = historyFile(id, moduleId);
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

async function prepare(id: string, req: ChatRequest) {
  const message = String(req.message ?? '').trim();
  if (!message) throw new HttpError(400, 'body.message is required');
  const { project, course, claims } = await loadPractice(id);
  const module = findModule(course, String(req.milestoneId ?? ''));
  const history = await readSkillChat(id, module.id);
  const drafts = (await loadDrafts(id)).filter((d) => d.moduleId === module.id);
  const latest = drafts[drafts.length - 1];
  const ladder = latest ? ladderText(latest, module.rubric) : '';
  const prompt = skillChatPrompt({
    skillName: project.name,
    frame: project.frame,
    module,
    claims,
    personas: course.personas,
    metric: course.metric,
    ...(typeof req.content === 'string' && req.content.trim() ? { draft: req.content } : {}),
    ...(ladder ? { ladder } : {}),
    history: history.slice(-CONTEXT_TURNS),
    message,
  });
  return { module, history, message, prompt };
}

async function persist(
  id: string,
  moduleId: string,
  history: ChatMessage[],
  message: string,
  reply: string,
): Promise<void> {
  const now = new Date().toISOString();
  // One write, at the end: a failed call leaves no orphan user turn behind.
  await writeSkillChat(id, moduleId, [
    ...history,
    { role: 'user', text: message, at: now },
    { role: 'tutor', text: reply, at: new Date().toISOString() },
  ]);
}

export async function askSkillCoach(id: string, req: ChatRequest): Promise<ChatResponse> {
  const { module, history, message, prompt } = await prepare(id, req);
  const reply = isMock() ? mockChatReply(message) : (await callClaude({ task: 'chat', prompt })).trim();
  await persist(id, module.id, history, message, reply);
  return { reply };
}

/** Streaming twin: deltas as they arrive, history persisted exactly as above. */
export async function askSkillCoachStream(
  id: string,
  req: ChatRequest,
  onDelta: (text: string) => void,
): Promise<ChatResponse> {
  const { module, history, message, prompt } = await prepare(id, req);
  let reply: string;
  if (isMock()) {
    reply = mockChatReply(message);
    const third = Math.max(1, Math.ceil(reply.length / 3));
    for (let i = 0; i < reply.length; i += third) {
      onDelta(reply.slice(i, i + third));
      await new Promise((r) => setTimeout(r, 40));
    }
  } else {
    reply = (await callClaudeStream({ task: 'chat', prompt }, onDelta)).trim();
  }
  await persist(id, module.id, history, message, reply);
  return { reply };
}
