// Skills track, practice half: calibration grading, module mastery, the draft
// ladder, the simulator run, hint/ghost, drills, ship, and Ask.
//
// Everything here is JSON under /api/skills/:id. The learner types every line:
// no route ever returns something that gets pasted into their buffer for them.

import { Router } from 'express';
import type {
  CalibrationGrade, Draft, DrillAttempt, DrillSubmit, GhostReq, HintReq, RunReq,
  Shipment, ShipReq, SkillModule,
} from '../../shared/skills';
import type { ChatRequest, Concept } from '../../shared/types';
import { HttpError } from '../store';
import {
  loadAttempts, loadDrafts, loadShips, saveAttempts, saveCourse, saveDrafts, saveShips, saveSkill,
} from './store';
import { findModule, loadPractice, panelModel, raisePhase, reps } from './practice/context';
import { appendVersion, findVersion, ladderText, nextDraftId, newDraft, predictionFor } from './practice/drafts';
import { runPanel } from './practice/run';
import { gradeExisting, makeGhost, makeHint } from './practice/guidance';
import { findDrill, gradeDrill } from './practice/drills';
import {
  appendFlag, flagNote, flaggedClaimIds, nextShipId, outsideRange, realityRate,
} from './practice/ship';
import { askSkillCoach, askSkillCoachStream, readSkillChat } from './practice/chat';

export const skillsPracticeRouter: Router = Router();

// ---------- tiny coercers ----------

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const clamp01 = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
};

const SOURCES = new Set<Concept['source']>(['unseen', 'calibration', 'check', 'skipped']);
const STATUSES = new Set<SkillModule['status']>(['todo', 'current', 'done']);

// ---------- calibration ----------

skillsPracticeRouter.post('/skills/:id/calibration/grade', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as CalibrationGrade;
    const emails = str(body.emails);
    if (!emails) throw new HttpError(400, 'body.emails is required');
    const { project, course, claims } = await loadPractice(req.params.id);
    res.json(
      await gradeExisting({
        frame: project.frame,
        modules: course.modules,
        claims,
        emails,
        model: await panelModel(),
      }),
    );
  } catch (err) {
    next(err);
  }
});

// ---------- module mastery ----------

/** Merge by concept id; mastery clamps to 0..1 and clears itself at 0.8. */
function mergeConcepts(current: Concept[], incoming: unknown): Concept[] {
  if (!Array.isArray(incoming)) return current;
  const out: Concept[] = current.map((c) => ({ ...c }));
  for (const raw of incoming) {
    const patch = rec(raw);
    const id = str(patch.id);
    if (!id) continue;
    const found = out.find((c) => c.id === id);
    const mastery = clamp01(patch.mastery, found?.mastery ?? 0);
    const cleared = typeof patch.cleared === 'boolean' ? patch.cleared : mastery >= 0.8;
    const source = SOURCES.has(patch.source as Concept['source'])
      ? (patch.source as Concept['source'])
      : found?.source ?? 'unseen';
    const label = str(patch.label) || found?.label || id;
    if (found) Object.assign(found, { mastery, cleared, source, label });
    else out.push({ id, label, mastery, cleared, source });
  }
  return out;
}

skillsPracticeRouter.patch('/skills/:id/modules/:mid', async (req, res, next) => {
  try {
    const id = req.params.id;
    const { project, course } = await loadPractice(id);
    const module = findModule(course, req.params.mid);
    const patch = rec(req.body);

    if (Array.isArray(patch.concepts)) {
      module.concepts = mergeConcepts(module.concepts, patch.concepts);
      // Calibration is the thing that first writes mastery, so that is "learning".
      raisePhase(project, 'learning');
    }
    if (STATUSES.has(patch.status as SkillModule['status'])) {
      const status = patch.status as SkillModule['status'];
      module.status = status;
      if (status === 'done') {
        const at = course.modules.indexOf(module);
        const next =
          course.modules.slice(at + 1).find((m) => m.status === 'todo') ??
          course.modules.find((m) => m.status === 'todo');
        if (next) next.status = 'current';
      }
    }

    project.course = course;
    await saveSkill(project);
    await saveCourse(id, course); // project.json and research/course.json stay one truth
    res.json(project);
  } catch (err) {
    next(err);
  }
});

// ---------- drafts ----------

async function mustDraft(id: string, draftId: string): Promise<{ drafts: Draft[]; draft: Draft }> {
  const drafts = await loadDrafts(id);
  const draft = drafts.find((d) => d.id === draftId);
  if (!draft) throw new HttpError(404, `no such draft: ${draftId}`);
  return { drafts, draft };
}

skillsPracticeRouter.get('/skills/:id/drafts', async (req, res, next) => {
  try {
    await loadPractice(req.params.id);
    res.json(await loadDrafts(req.params.id));
  } catch (err) {
    next(err);
  }
});

skillsPracticeRouter.post('/skills/:id/drafts', async (req, res, next) => {
  try {
    const id = req.params.id;
    const { course } = await loadPractice(id);
    const body = rec(req.body);
    const module = findModule(course, str(body.moduleId));
    const drafts = await loadDrafts(id);
    const draft = newDraft(
      nextDraftId(drafts),
      module.id,
      str(body.title) || module.title,
      typeof body.body === 'string' ? body.body : '',
    );
    await saveDrafts(id, [...drafts, draft]);
    res.json(draft);
  } catch (err) {
    next(err);
  }
});

skillsPracticeRouter.put('/skills/:id/drafts/:did', async (req, res, next) => {
  try {
    const id = req.params.id;
    await loadPractice(id);
    const body = rec(req.body);
    if (typeof body.body !== 'string') throw new HttpError(400, 'body.body must be a string');
    const { drafts, draft } = await mustDraft(id, req.params.did);
    const updated = appendVersion(draft, body.body);
    if (updated !== draft) {
      await saveDrafts(id, drafts.map((d) => (d.id === draft.id ? updated : d)));
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ---------- run ----------

skillsPracticeRouter.post('/skills/:id/run', async (req, res, next) => {
  try {
    const id = req.params.id;
    const { project, course, claims } = await loadPractice(id);
    const body = (req.body ?? {}) as RunReq;
    const { drafts, draft } = await mustDraft(id, str(body.draftId));
    const version = findVersion(draft, num(body.version, 0));
    if (!version) throw new HttpError(404, `draft ${draft.id} has no version ${body.version}`);
    const module = findModule(course, draft.moduleId);

    const report = await runPanel({
      frame: project.frame,
      module,
      claims,
      personas: course.personas,
      metric: course.metric,
      body: version.body,
      model: await panelModel(),
    });

    version.run = report;
    await saveDrafts(id, drafts);
    reps(project).runs += 1;
    raisePhase(project, 'making');
    await saveSkill(project);
    res.json(report);
  } catch (err) {
    next(err);
  }
});

// ---------- hint / ghost ----------

/** The ladder is context only; a hint must still work before any draft exists. */
async function ladderFor(id: string, draftId: string, module: SkillModule): Promise<string> {
  const draft = (await loadDrafts(id)).find((d) => d.id === draftId);
  return draft ? ladderText(draft, module.rubric) : '';
}

skillsPracticeRouter.post('/skills/:id/hint', async (req, res, next) => {
  try {
    const id = req.params.id;
    const { project, course, claims } = await loadPractice(id);
    const body = (req.body ?? {}) as HintReq;
    const module = findModule(course, str(body.moduleId));
    const ladder = await ladderFor(id, str(body.draftId), module);
    res.json(
      await makeHint({
        frame: project.frame,
        module,
        claims,
        exemplars: course.exemplars,
        body: typeof body.body === 'string' ? body.body : '',
        cursorLine: Math.max(1, Math.floor(num(body.cursorLine, 1))),
        level: body.level === 'composite' ? 'composite' : 'step',
        ...(ladder ? { ladder } : {}),
        model: await panelModel(),
      }),
    );
  } catch (err) {
    next(err);
  }
});

skillsPracticeRouter.post('/skills/:id/ghost', async (req, res, next) => {
  try {
    const { project, course, claims } = await loadPractice(req.params.id);
    const body = (req.body ?? {}) as GhostReq;
    const module = findModule(course, str(body.moduleId));
    res.json(
      await makeGhost({
        frame: project.frame,
        module,
        claims,
        exemplars: course.exemplars,
        body: typeof body.body === 'string' ? body.body : '',
        cursorLine: Math.max(1, Math.floor(num(body.cursorLine, 1))),
        model: await panelModel(),
      }),
    );
  } catch (err) {
    next(err);
  }
});

// ---------- drills ----------

skillsPracticeRouter.post('/skills/:id/drills/submit', async (req, res, next) => {
  try {
    const id = req.params.id;
    const { project, course, claims } = await loadPractice(id);
    const body = (req.body ?? {}) as DrillSubmit;
    const drillId = str(body.drillId);
    const found = findDrill(course, drillId);
    if (!found) throw new HttpError(404, `no such drill: ${drillId}`);

    const graded = await gradeDrill({
      drill: found.drill,
      module: found.module,
      claims,
      personas: course.personas,
      answer: body.answer,
      model: await panelModel(),
    });
    const attempt: DrillAttempt = {
      drillId,
      at: new Date().toISOString(),
      answer: body.answer,
      ...(graded.correct === undefined ? {} : { correct: graded.correct }),
      feedback: graded.feedback,
      ...(graded.scores?.length ? { scores: graded.scores } : {}),
    };

    await saveAttempts(id, [...(await loadAttempts(id)), attempt]);
    reps(project).drills += 1;
    raisePhase(project, 'practicing');
    await saveSkill(project);
    res.json(attempt);
  } catch (err) {
    next(err);
  }
});

skillsPracticeRouter.get('/skills/:id/drills/attempts', async (req, res, next) => {
  try {
    await loadPractice(req.params.id);
    res.json(await loadAttempts(req.params.id));
  } catch (err) {
    next(err);
  }
});

// ---------- ship ----------

skillsPracticeRouter.post('/skills/:id/ship', async (req, res, next) => {
  try {
    const id = req.params.id;
    const { project, course } = await loadPractice(id);
    const body = (req.body ?? {}) as ShipReq;
    const { draft } = await mustDraft(id, str(body.draftId));
    const n = num(body.version, 0);
    const version = findVersion(draft, n);
    if (!version) throw new HttpError(404, `draft ${draft.id} has no version ${body.version}`);

    const sent = Math.max(0, Math.round(num(body.sent, 0)));
    const replies = Math.max(0, Math.round(num(body.replies, 0)));
    const prediction = predictionFor(draft, n);
    const notes = [
      str(body.notes),
      prediction.ran ? '' : 'This version was never run, so there is no prediction to compare.',
    ].filter(Boolean).join(' ');

    const ships = await loadShips(id);
    const shipment: Shipment = {
      id: nextShipId(ships),
      draftId: draft.id,
      version: version.n,
      at: new Date().toISOString(),
      sent,
      replies,
      ...(body.meetings === undefined ? {} : { meetings: Math.max(0, Math.round(num(body.meetings, 0))) }),
      ...(notes ? { notes } : {}),
      predictedLow: prediction.low,
      predictedHigh: prediction.high,
    };
    await saveShips(id, [...ships, shipment]);

    // Reality outside the predicted range means the claims behind that call
    // need another look — Refresh picks these up.
    const reality = realityRate(sent, replies);
    if (prediction.ran && outsideRange(reality, prediction.low, prediction.high)) {
      const module = course.modules.find((m) => m.id === draft.moduleId);
      if (module) {
        await appendFlag(id, {
          claimIds: flaggedClaimIds(version.run, module),
          shipmentId: shipment.id,
          note: flagNote(reality as number, prediction.low, prediction.high, course.metric.unit),
        });
      }
    }

    reps(project).ships += 1;
    await saveSkill(project);
    res.json(shipment);
  } catch (err) {
    next(err);
  }
});

skillsPracticeRouter.get('/skills/:id/ships', async (req, res, next) => {
  try {
    await loadPractice(req.params.id);
    res.json(await loadShips(req.params.id));
  } catch (err) {
    next(err);
  }
});

// ---------- Ask ----------

skillsPracticeRouter.get('/skills/:id/chat', async (req, res, next) => {
  try {
    const moduleId = String(req.query.milestoneId ?? '');
    if (!moduleId) throw new HttpError(400, 'query param "milestoneId" is required');
    const { course } = await loadPractice(req.params.id);
    findModule(course, moduleId); // 404 for a module that does not exist
    res.json(await readSkillChat(req.params.id, moduleId));
  } catch (err) {
    next(err);
  }
});

skillsPracticeRouter.post('/skills/:id/chat', async (req, res, next) => {
  try {
    res.json(await askSkillCoach(req.params.id, (req.body ?? {}) as ChatRequest));
  } catch (err) {
    next(err);
  }
});

// SSE: `data: {"type":"delta","text":...}` per chunk, then `{"type":"done","reply":...}`.
// Errors after headers are sent become an `{"type":"error"}` event, not a 500.
skillsPracticeRouter.post('/skills/:id/chat/stream', async (req, res) => {
  const send = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  try {
    const { reply } = await askSkillCoachStream(
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
