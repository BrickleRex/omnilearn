// ---------------------------------------------------------------------------
// Watcher client. Ticks every 20s and *usually decides not to say anything*.
// It is deliberately shy: explore mode, another LLM call in flight, a call less
// than 60s ago, or a buffer that hasn't changed since last time all skip.
// ---------------------------------------------------------------------------
import type { RunResult, WatchResponse } from '../../shared/types';
import { api } from '../api';

export const TICK_MS = 20_000;
export const MIN_GAP_MS = 60_000;
/** cursor must stay inside +/- this many lines to count as "the same spot" */
export const REGION = 3;
/** if no edits for this long, the user isn't circling — they're away */
const ACTIVE_EDIT_WINDOW_MS = 120_000;

export interface WatcherDeps {
  projectId: string;
  milestoneId: string;
  getPath: () => string | null;
  getContent: () => string;
  getLastRun: () => RunResult | null;
  isExplore: () => boolean;
  /** true when a hint/ghost/watch call is already in flight */
  isBusy: () => boolean;
  onNudge: (res: WatchResponse) => void;
  onQuiet?: () => void;
}

export interface Watcher {
  start(): void;
  stop(): void;
  noteCursor(line: number): void;
  noteEdit(): void;
  noteRun(): void;
  /** exposed for tests */
  secondsOnSpot(): number;
  shouldCall(now?: number): boolean;
}

export function createWatcher(deps: WatcherDeps): Watcher {
  let timer: number | null = null;
  let inFlight = false;

  let regionCenter = -1;
  let regionSince = Date.now();
  let lastEditAt = 0;

  let lastCallAt = 0;
  let lastSentContent: string | null = null;
  let lastSentRunAt: string | null = null;

  const secondsOnSpot = () => {
    const now = Date.now();
    if (regionCenter < 0) return 0;
    if (now - lastEditAt > ACTIVE_EDIT_WINDOW_MS) return 0; // edits stopped: not circling
    return Math.round((now - regionSince) / 1000);
  };

  const shouldCall = (now = Date.now()) => {
    if (inFlight) return false;
    if (deps.isExplore()) return false;
    if (deps.isBusy()) return false;
    if (!deps.getPath()) return false;
    if (now - lastCallAt < MIN_GAP_MS) return false;
    const content = deps.getContent();
    const runAt = deps.getLastRun()?.startedAt ?? null;
    if (lastSentContent !== null && content === lastSentContent && runAt === lastSentRunAt) return false;
    return true;
  };

  const tick = async () => {
    if (!shouldCall()) return;
    const path = deps.getPath();
    if (!path) return;

    const content = deps.getContent();
    const lastRun = deps.getLastRun();
    inFlight = true;
    lastCallAt = Date.now();
    lastSentContent = content;
    lastSentRunAt = lastRun?.startedAt ?? null;
    try {
      const res = await api.watch(deps.projectId, {
        milestoneId: deps.milestoneId,
        path,
        content,
        lastRun: lastRun ?? undefined,
        secondsOnSpot: secondsOnSpot(),
        exploreMode: false, // we never call at all while exploring
      });
      if (res.posture === 'nudge' && res.note) deps.onNudge(res);
      else deps.onQuiet?.();
    } catch {
      /* the watcher is allowed to fail in silence */
    } finally {
      inFlight = false;
    }
  };

  return {
    start() {
      if (timer !== null) return;
      timer = window.setInterval(() => { void tick(); }, TICK_MS);
    },
    stop() {
      if (timer !== null) { clearInterval(timer); timer = null; }
    },
    noteCursor(line: number) {
      if (regionCenter < 0 || Math.abs(line - regionCenter) > REGION) {
        regionCenter = line;
        regionSince = Date.now();
      }
    },
    noteEdit() {
      lastEditAt = Date.now();
    },
    noteRun() {
      // a fresh run is new information even if the buffer is unchanged
      lastSentRunAt = null;
    },
    secondsOnSpot,
    shouldCall,
  };
}
