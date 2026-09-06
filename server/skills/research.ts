// Skills track, research half: the project list, the frame -> map handoff, the
// resumable research job (+ its SSE stream), the evidence reads, user-pasted
// sources, and the freshness pass.
//
// Everything is JSON under /api/skills. The pipeline itself lives in
// ./research/pipeline.ts; this file is routes, validation and plumbing.

import { Router } from 'express';
import fsp from 'node:fs/promises';
import type {
  AngleMap, CreateSkillRequest, Frame, ResearchJob, SkillProject, SkillSummary, SourceRef,
} from '../../shared/skills';
import { HttpError, ensureDir, writeTextFile } from '../store';
import {
  loadClaims, loadMap, loadSkill, loadSources, saveMap, saveSkill, saveSources, skillDir, skillsDir,
  sourceTextFile, uniqueSkillId,
} from './store';
import { applyMapEdit, guessAngleIds } from './research/angles';
import { awaitJob, currentJob, isRunning, requestStop, subscribe } from './research/job';
import { runCartographer, startRefresh, startResearch } from './research/pipeline';
import { guessSourceKind, normalizeUrl } from './research/enrich';

export const skillsResearchRouter: Router = Router();

const LEVELS = new Set<Frame['level']>(['new', 'some', 'experienced']);
const STREAM_HEARTBEAT_MS = 2_000;
const STREAM_MAX_MS = 30 * 60_000;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function summarize(p: SkillProject): SkillSummary {
  const modules = p.course?.modules ?? [];
  return {
    id: p.id,
    name: p.name,
    phase: p.phase,
    reps: (p.reps?.drills ?? 0) + (p.reps?.runs ?? 0) + (p.reps?.ships ?? 0),
    modulesDone: modules.filter((m) => m.status === 'done').length,
    modulesTotal: modules.length,
  };
}

function coerceFrame(raw: unknown): Frame {
  const f = (raw ?? {}) as Partial<Frame>;
  const outcome = str(f.outcome);
  const context = str(f.context);
  if (!outcome) throw new HttpError(400, 'frame.outcome is required');
  const frame: Frame = {
    outcome: outcome.slice(0, 400),
    context: context.slice(0, 800),
    level: LEVELS.has(f.level as Frame['level']) ? (f.level as Frame['level']) : 'new',
  };
  const existing = str(f.existingWork);
  if (existing) frame.existingWork = existing.slice(0, 8000);
  return frame;
}

// ---------- projects ----------

skillsResearchRouter.get('/skills', async (_req, res, next) => {
  try {
    const dir = skillsDir();
    await ensureDir(dir);
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const out: SkillSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const project = await loadSkill(entry.name).catch(() => null);
      if (project) out.push(summarize(project));
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    res.json(out);
  } catch (err) {
    next(err);
  }
});

skillsResearchRouter.post('/skills', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as CreateSkillRequest;
    const name = str(body.name).slice(0, 80);
    if (!name) throw new HttpError(400, 'name is required');
    const frame = coerceFrame(body.frame);

    const id = await uniqueSkillId(name);
    const project: SkillProject = {
      id,
      name,
      frame,
      phase: 'framing',
      createdAt: new Date().toISOString(),
      reps: { drills: 0, runs: 0, ships: 0 },
    };
    await saveSkill(project);

    // The cartographer runs inside the request: the learner goes straight to the
    // ladder. If it fails the project survives in 'framing' and the research
    // job's cartography phase will pick it up.
    let map: AngleMap;
    try {
      map = await runCartographer(name, frame);
    } catch (err) {
      throw new HttpError(502, `the cartographer could not map this skill: ${(err as Error).message}`);
    }
    await saveMap(id, map);
    project.map = map;
    project.phase = 'mapping';
    await saveSkill(project);
    res.json(project);
  } catch (err) {
    next(err);
  }
});

skillsResearchRouter.get('/skills/:id', async (req, res, next) => {
  try {
    res.json(await loadSkill(req.params.id));
  } catch (err) {
    next(err);
  }
});

skillsResearchRouter.delete('/skills/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const dir = skillDir(id); // validates the id
    const wasRunning = isRunning(id);
    requestStop(id);
    await fsp.rm(dir, { recursive: true, force: true });
    // A phase already in flight can write one more artifact after the rm, so
    // sweep again once it has actually stopped. Never blocks the response.
    if (wasRunning) void awaitJob(id).then(() => fsp.rm(dir, { recursive: true, force: true })).catch(() => undefined);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- the ladder ----------

skillsResearchRouter.put('/skills/:id/map', async (req, res, next) => {
  try {
    const id = req.params.id;
    const project = await loadSkill(id);
    const current = (await loadMap(id)) ?? project.map;
    if (!current) throw new HttpError(409, 'this skill has no map yet — start research to build one');
    const next = applyMapEdit(current, (req.body ?? {}) as AngleMap);
    await saveMap(id, next);
    project.map = next;
    await saveSkill(project);
    res.json(project);
  } catch (err) {
    next(err);
  }
});

// ---------- research job ----------

skillsResearchRouter.post('/skills/:id/research', async (req, res, next) => {
  try {
    const id = req.params.id;
    const project = await loadSkill(id);
    if (isRunning(id)) {
      res.json(await currentJob(id));
      return;
    }
    // Starting research moves the project to 'researching' — unless the learner
    // is already past it (a course exists), in which case a resume must not
    // knock them back to an earlier beat.
    if (!project.course && project.phase !== 'researching') {
      project.phase = 'researching';
      await saveSkill(project);
    }
    res.json(await startResearch(project));
  } catch (err) {
    next(err);
  }
});

skillsResearchRouter.get('/skills/:id/research', async (req, res, next) => {
  try {
    await loadSkill(req.params.id);
    res.json(await currentJob(req.params.id));
  } catch (err) {
    next(err);
  }
});

skillsResearchRouter.get('/skills/:id/research/stream', async (req, res, next) => {
  try {
    const id = req.params.id;
    await loadSkill(id);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let latest: ResearchJob = await currentJob(id);
    let closed = false;
    const send = (job: ResearchJob): void => {
      if (closed) return;
      res.write(`data: ${JSON.stringify(job)}\n\n`);
    };
    const close = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(beat);
      clearTimeout(cap);
      off();
      res.end();
    };

    const off = subscribe(id, (job) => {
      latest = job;
      send(job);
      if (job.phase === 'done' || job.phase === 'failed') close();
    });
    // A snapshot at least every 2s, so a client that missed an event still tracks.
    const beat = setInterval(() => send(latest), STREAM_HEARTBEAT_MS);
    const cap = setTimeout(close, STREAM_MAX_MS);

    req.on('close', close);
    send(latest);
    if (latest.phase === 'done' || latest.phase === 'failed') close();
  } catch (err) {
    next(err);
  }
});

skillsResearchRouter.post('/skills/:id/refresh', async (req, res, next) => {
  try {
    const id = req.params.id;
    const project = await loadSkill(id);
    if (isRunning(id)) {
      res.json(await currentJob(id));
      return;
    }
    res.json(await startRefresh(project));
  } catch (err) {
    next(err);
  }
});

// ---------- evidence ----------

skillsResearchRouter.get('/skills/:id/claims', async (req, res, next) => {
  try {
    await loadSkill(req.params.id);
    res.json(await loadClaims(req.params.id));
  } catch (err) {
    next(err);
  }
});

skillsResearchRouter.get('/skills/:id/sources', async (req, res, next) => {
  try {
    await loadSkill(req.params.id);
    res.json(await loadSources(req.params.id));
  } catch (err) {
    next(err);
  }
});

/** A source the learner pasted in themselves: trusted, always full text. */
skillsResearchRouter.post('/skills/:id/sources', async (req, res, next) => {
  try {
    const id = req.params.id;
    const project = await loadSkill(id);
    const body = (req.body ?? {}) as { url?: unknown; title?: unknown; text?: unknown };
    const text = str(body.text);
    if (!text) throw new HttpError(400, 'text is required');
    const url = str(body.url);
    if (url && !/^https?:\/\//i.test(url)) throw new HttpError(400, 'url must be http(s) if given');
    const title = str(body.title).slice(0, 160) || (url ? normalizeUrl(url) : text.slice(0, 60));

    const sources = await loadSources(id);
    const taken = new Set(sources.map((s) => s.id));
    let n = sources.filter((s) => s.kind === 'user').length + 1;
    while (taken.has(`u${n}`)) n += 1;

    const map = (await loadMap(id)) ?? project.map;
    const source: SourceRef = {
      id: `u${n}`,
      url: url || `omnilearn://pasted/${id}/u${n}`,
      kind: 'user',
      title,
      angleIds: guessAngleIds(map, `${title} ${text}`),
      reputation: 0.9,
      soundness: 0.7,
      hasRealNumbers: /\d+(\.\d+)?\s*%|\b\d{3,}\b/.test(text),
      quote: text.slice(0, 600),
      note: 'Pasted in by the learner.',
      fetched: 'full',
    };
    if (url && guessSourceKind(url) === 'docs') source.note = 'Pasted in by the learner (official docs).';

    await writeTextFile(sourceTextFile(id, source.id), text);
    await saveSources(id, [...sources, source]);
    res.json(source);
  } catch (err) {
    next(err);
  }
});
