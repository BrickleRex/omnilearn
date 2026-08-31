// Route handlers that glue prompts/fixtures + the CLI + on-disk caching.
//
// Calibration and primer responses are cached under
// <project>/.omnilearn/cache/<milestoneId>.{calibration,primer}.json in both
// mock and real mode, so re-entering a milestone is instant and free.

import { Router } from 'express';
import path from 'node:path';
import type {
  Calibration,
  Idea,
  IdeasRequest,
  IdeasResponse,
  CalibrationResult,
  CalibrationSubmit,
  Concept,
  GhostRequest,
  GhostResponse,
  HintRequest,
  HintResponse,
  Milestone,
  PrimerDoc,
  Project,
  ProjectPlan,
  WatchRequest,
  WatchResponse,
} from '../../shared/types';
import { HttpError, cacheDir, ensureDir, readJsonOrDelete, writeJson } from '../store';
import { findMilestone, loadProject, saveProject } from '../projects';
import { getLastRun } from '../runner';
import { callClaude, extractJson, isMock, tryReserveWatch } from './llm';
import * as fixtures from './fixtures';
import * as prompts from './prompts';

// ---------- cache ----------

function cacheFile(projectId: string, milestoneId: string, kind: 'calibration' | 'primer'): string {
  const safe = String(milestoneId).replace(/[^A-Za-z0-9._-]/g, '-');
  if (!safe || safe === '.' || safe === '..') throw new HttpError(400, 'invalid milestoneId');
  return path.join(cacheDir(projectId), `${safe}.${kind}.json`);
}

async function cached<T>(file: string, produce: () => Promise<T>): Promise<T> {
  const hit = await readJsonOrDelete<T>(file); // deletes the file if it is corrupt
  if (hit) return hit;
  const fresh = await produce();
  await ensureDir(path.dirname(file));
  await writeJson(file, fresh);
  return fresh;
}

// ---------- plan ----------

export async function generatePlan(goal: string): Promise<ProjectPlan> {
  if (isMock()) return fixtures.mockPlan(goal);
  const text = await callClaude({ task: 'plan', prompt: prompts.planPrompt(goal) });
  return extractJson<ProjectPlan>(text);
}

// ---------- ideas ("inspire me") ----------

function coerceIdeas(raw: IdeasResponse): IdeasResponse {
  const list = Array.isArray(raw?.ideas) ? raw.ideas : [];
  const ideas: Idea[] = list
    .filter((i) => i && typeof i.title === 'string' && typeof i.goal === 'string')
    .map((i) => ({
      title: String(i.title).slice(0, 80),
      pitch: typeof i.pitch === 'string' ? i.pitch.slice(0, 200) : '',
      goal: String(i.goal).slice(0, 400),
    }))
    .slice(0, 5);
  if (ideas.length === 0) throw new HttpError(502, 'idea generation came back empty — try again');
  return { ideas };
}

export async function generateIdeas(req: IdeasRequest): Promise<IdeasResponse> {
  const seed = typeof req.seed === 'string' && req.seed.trim() ? req.seed.trim().slice(0, 400) : undefined;
  const avoid = Array.isArray(req.avoid) ? req.avoid.filter((t) => typeof t === 'string').slice(0, 20) : [];
  if (isMock()) return fixtures.mockIdeas({ ...(seed !== undefined ? { seed } : {}), avoid });
  const text = await callClaude({ task: 'ideas', prompt: prompts.ideasPrompt(seed, avoid) });
  return coerceIdeas(extractJson<IdeasResponse>(text));
}

// ---------- calibration ----------

export async function getCalibration(projectId: string, milestone: Milestone): Promise<Calibration> {
  return cached<Calibration>(cacheFile(projectId, milestone.id, 'calibration'), async () => {
    if (isMock()) return fixtures.mockCalibration(milestone);
    const text = await callClaude({
      task: 'calibration',
      prompt: prompts.calibrationPrompt(milestone),
    });
    const doc = extractJson<Calibration>(text);
    return { milestoneId: milestone.id, questions: doc.questions ?? [] };
  });
}

/** Grade locally — the model never sees the learner's answers. */
export async function submitCalibration(
  projectId: string,
  body: CalibrationSubmit,
): Promise<CalibrationResult> {
  const project = await loadProject(projectId);
  const milestone = findMilestone(project, body.milestoneId);
  const calibration = await getCalibration(projectId, milestone);
  const answers = Array.isArray(body.answers) ? body.answers : [];

  const graded = new Map<string, { mastery: number; source: Concept['source'] }>();
  calibration.questions.forEach((q, i) => {
    const answer = answers[i];
    const skipped = answer === -1 || answer === undefined || answer === null;
    const mastery = !skipped && answer === q.answerIndex ? 1 : 0;
    const source: Concept['source'] = skipped ? 'skipped' : 'calibration';
    const prev = graded.get(q.conceptId);
    if (!prev || mastery > prev.mastery) graded.set(q.conceptId, { mastery, source });
  });

  milestone.concepts = milestone.concepts.map((c) => {
    const g = graded.get(c.id);
    if (!g) return c;
    return { ...c, mastery: g.mastery, cleared: g.mastery >= 0.8, source: g.source };
  });

  await saveProject(project);
  return { concepts: milestone.concepts };
}

// ---------- primer ----------

export async function getPrimer(projectId: string, milestoneId: string): Promise<PrimerDoc> {
  const project = await loadProject(projectId);
  const milestone = findMilestone(project, milestoneId);
  const uncleared = milestone.concepts.filter((c) => !c.cleared);

  const doc = await cached<PrimerDoc>(cacheFile(projectId, milestone.id, 'primer'), async () => {
    if (isMock()) return fixtures.mockPrimer(milestone, uncleared);
    const text = await callClaude({
      task: 'primer',
      prompt: prompts.primerPrompt(milestone, uncleared),
    });
    const parsed = extractJson<PrimerDoc>(text);
    return {
      milestoneId: milestone.id,
      units: parsed.units ?? [],
      steps: parsed.steps ?? [],
    };
  });

  // The primer owns the build plan — persist its steps onto the milestone.
  if (doc.steps?.length && JSON.stringify(doc.steps) !== JSON.stringify(milestone.steps)) {
    const fresh = await loadProject(projectId);
    const target = findMilestone(fresh, milestoneId);
    target.steps = doc.steps;
    if (target.currentStep >= doc.steps.length) target.currentStep = 0;
    await saveProject(fresh);
  }
  return doc;
}

// ---------- hint / ghost / watch ----------

export async function getHint(project: Project, req: HintRequest): Promise<HintResponse> {
  if (isMock()) return fixtures.mockHint(req);
  const milestone = findMilestone(project, req.milestoneId);
  const text = await callClaude({
    task: 'hint',
    prompt: prompts.hintPrompt(
      req.content ?? '',
      req.cursorLine ?? 1,
      milestone.steps ?? [],
      req.level === 'composite' ? 'composite' : 'step',
      req.path ?? milestone.entryFile,
    ),
  });
  const parsed = extractJson<HintResponse>(text);
  return {
    hint: String(parsed.hint ?? '').trim(),
    stepIndex: Number.isFinite(parsed.stepIndex) ? Math.max(0, Math.floor(parsed.stepIndex)) : 0,
  };
}

export async function getGhost(project: Project, req: GhostRequest): Promise<GhostResponse> {
  if (isMock()) return fixtures.mockGhost(req);
  const milestone = findMilestone(project, req.milestoneId);
  const text = await callClaude({
    task: 'ghost',
    prompt: prompts.ghostPrompt(req.content ?? '', req.cursorLine ?? 1, req.path ?? milestone.entryFile),
  });
  const parsed = extractJson<GhostResponse>(text);
  // Exactly one line, always.
  const code = String(parsed.code ?? '').split('\n')[0]?.replace(/\s+$/, '') ?? '';
  return { code };
}

export async function getWatch(project: Project, req: WatchRequest): Promise<WatchResponse> {
  // Explore mode is the learner saying "leave me alone" — never reaches the LLM.
  if (req.exploreMode) return { posture: 'quiet' };

  const lastRun = req.lastRun ?? getLastRun(project.id);
  const filled: WatchRequest = { ...req, lastRun };

  if (isMock()) return fixtures.mockWatch(filled);

  // Lowest priority, and at most one call per project per 60s.
  if (!tryReserveWatch(project.id)) return { posture: 'quiet' };

  const milestone = findMilestone(project, req.milestoneId);
  const cleared = milestone.concepts.filter((c) => c.cleared);
  const text = await callClaude({
    task: 'watch',
    prompt: prompts.watchPrompt(
      req.content ?? '',
      lastRun,
      req.secondsOnSpot ?? 0,
      cleared,
      req.path ?? milestone.entryFile,
    ),
  });
  const parsed = extractJson<WatchResponse>(text);
  if (parsed.posture !== 'nudge') return { posture: 'quiet' };
  const note = String(parsed.note ?? '').trim();
  if (!note) return { posture: 'quiet' };
  const lineCount = (req.content ?? '').split('\n').length;
  const line = Number.isFinite(parsed.line)
    ? Math.min(Math.max(1, Math.floor(parsed.line as number)), Math.max(1, lineCount))
    : 1;
  return { posture: 'nudge', note, line };
}

// ---------- routes ----------

export const agentsRouter: Router = Router();

agentsRouter.post('/projects/plan', async (req, res, next) => {
  try {
    const goal = String(((req.body ?? {}) as { goal?: unknown }).goal ?? '').trim();
    if (!goal) throw new HttpError(400, 'body.goal is required');
    res.json(await generatePlan(goal));
  } catch (err) {
    next(err);
  }
});

agentsRouter.post('/projects/ideas', async (req, res, next) => {
  try {
    res.json(await generateIdeas((req.body ?? {}) as IdeasRequest));
  } catch (err) {
    next(err);
  }
});

agentsRouter.post('/projects/:id/calibration', async (req, res, next) => {
  try {
    const milestoneId = String(((req.body ?? {}) as { milestoneId?: unknown }).milestoneId ?? '');
    const project = await loadProject(req.params.id);
    const milestone = findMilestone(project, milestoneId);
    res.json(await getCalibration(project.id, milestone));
  } catch (err) {
    next(err);
  }
});

agentsRouter.post('/projects/:id/calibration/submit', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as CalibrationSubmit;
    if (!body.milestoneId) throw new HttpError(400, 'body.milestoneId is required');
    res.json(await submitCalibration(req.params.id, body));
  } catch (err) {
    next(err);
  }
});

agentsRouter.post('/projects/:id/primer', async (req, res, next) => {
  try {
    const milestoneId = String(((req.body ?? {}) as { milestoneId?: unknown }).milestoneId ?? '');
    if (!milestoneId) throw new HttpError(400, 'body.milestoneId is required');
    res.json(await getPrimer(req.params.id, milestoneId));
  } catch (err) {
    next(err);
  }
});

agentsRouter.post('/projects/:id/hint', async (req, res, next) => {
  try {
    const project = await loadProject(req.params.id);
    res.json(await getHint(project, (req.body ?? {}) as HintRequest));
  } catch (err) {
    next(err);
  }
});

agentsRouter.post('/projects/:id/ghost', async (req, res, next) => {
  try {
    const project = await loadProject(req.params.id);
    res.json(await getGhost(project, (req.body ?? {}) as GhostRequest));
  } catch (err) {
    next(err);
  }
});

agentsRouter.post('/projects/:id/watch', async (req, res, next) => {
  try {
    const project = await loadProject(req.params.id);
    res.json(await getWatch(project, (req.body ?? {}) as WatchRequest));
  } catch (err) {
    next(err);
  }
});
