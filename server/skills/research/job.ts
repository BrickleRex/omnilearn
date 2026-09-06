// The research job: job.json on disk is the source of truth for progress, an
// in-memory map holds the promise of whatever is currently running, and SSE
// listeners get a snapshot on every change.

import type { ResearchJob, ResearchPhase } from '../../../shared/skills';
import { exists } from '../../store';
import { loadJob, saveJob, skillDir } from '../store';

export const LOG_CAP = 50;

export function emptyJob(): ResearchJob {
  return { phase: 'idle', progress: { anglesKept: 0, anglesDone: 0, sources: 0, claims: 0, modules: 0 }, log: [] };
}

/** Append a line, keeping only the last LOG_CAP. Mutates and returns the job. */
export function pushLog(job: ResearchJob, line: string): ResearchJob {
  job.log = [...job.log, line].slice(-LOG_CAP);
  return job;
}

/** What the client sees before anything has ever been started. */
export function idleJob(): ResearchJob {
  return emptyJob();
}

export async function currentJob(skillId: string): Promise<ResearchJob> {
  return (await loadJob(skillId)) ?? idleJob();
}

/** Write a job snapshot and tell every open stream about it. */
export async function publish(skillId: string, job: ResearchJob): Promise<ResearchJob> {
  await saveJob(skillId, job);
  emit(skillId, job);
  return job;
}

// ---------- listeners ----------

type Listener = (job: ResearchJob) => void;
const listeners = new Map<string, Set<Listener>>();

export function subscribe(skillId: string, fn: Listener): () => void {
  const set = listeners.get(skillId) ?? new Set<Listener>();
  set.add(fn);
  listeners.set(skillId, set);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(skillId);
  };
}

export function emit(skillId: string, job: ResearchJob): void {
  const set = listeners.get(skillId);
  if (!set) return;
  const snapshot = structuredClone(job);
  for (const fn of [...set]) {
    try { fn(snapshot); } catch { /* one bad listener must not stall the job */ }
  }
}

// ---------- running jobs ----------

const running = new Map<string, Promise<void>>();
const stopping = new Set<string>();

export function isRunning(skillId: string): boolean {
  return running.has(skillId);
}

/** Ask a running job to stop at its next checkpoint (delete, or a fresh start). */
export function requestStop(skillId: string): void {
  if (running.has(skillId)) stopping.add(skillId);
}

export class Stopped extends Error {
  constructor() {
    super('research job stopped');
    this.name = 'Stopped';
  }
}

/** The handle a pipeline phase writes progress through. */
export class JobCtl {
  constructor(readonly skillId: string, readonly job: ResearchJob) {}

  stopRequested(): boolean {
    return stopping.has(this.skillId);
  }

  /** Throw out of the pipeline if a stop was asked for. */
  checkpoint(): void {
    if (this.stopRequested()) throw new Stopped();
  }

  async save(): Promise<void> {
    await saveJob(this.skillId, this.job);
    emit(this.skillId, this.job);
  }

  async log(line: string): Promise<void> {
    pushLog(this.job, line);
    await this.save();
  }

  async setPhase(phase: ResearchPhase): Promise<void> {
    this.job.phase = phase;
    await this.save();
  }

  async progress(patch: Partial<ResearchJob['progress']>): Promise<void> {
    Object.assign(this.job.progress, patch);
    await this.save();
  }

  async bump(key: keyof ResearchJob['progress'], by = 1): Promise<void> {
    this.job.progress[key] += by;
    await this.save();
  }
}

/**
 * Start `run` for this skill unless it is already running. Resolves with the
 * job snapshot the client should see right away.
 */
export async function startJob(
  skillId: string,
  seed: ResearchJob,
  run: (ctl: JobCtl) => Promise<void>,
): Promise<ResearchJob> {
  const inflight = running.get(skillId);
  if (inflight) return currentJob(skillId);

  const ctl = new JobCtl(skillId, seed);
  await ctl.save();

  const promise = (async () => {
    try {
      await run(ctl);
      if (ctl.job.phase !== 'failed') {
        ctl.job.phase = 'done';
        ctl.job.finishedAt = new Date().toISOString();
        pushLog(ctl.job, 'done.');
      }
    } catch (err) {
      if (err instanceof Stopped) {
        // The skill is being deleted or restarted; leave job.json where it is.
        return;
      }
      ctl.job.phase = 'failed';
      ctl.job.error = err instanceof Error ? err.message : String(err);
      ctl.job.finishedAt = new Date().toISOString();
      pushLog(ctl.job, `failed: ${ctl.job.error}`);
    } finally {
      running.delete(skillId);
      stopping.delete(skillId);
      // A deleted skill must stay deleted: never let the last save recreate it.
      try { if (await exists(skillDir(skillId))) await ctl.save(); } catch { /* the folder is gone */ }
    }
  })();

  running.set(skillId, promise);
  return structuredClone(ctl.job);
}

/** Test/teardown helper: wait for a running job to settle. */
export async function awaitJob(skillId: string): Promise<void> {
  await running.get(skillId)?.catch(() => undefined);
}
