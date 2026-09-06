// Draft ladders: ids, the version-append rule, and the score deltas the ladder
// shows. All pure — the router does the I/O.

import type { Draft, DraftVersion, RubricItem, RunReport } from '../../../shared/skills';

/** Versions kept per draft; the oldest fall off the bottom, numbers keep climbing. */
export const MAX_VERSIONS = 50;

export function nextId(existing: string[], prefix: string): string {
  const taken = new Set(existing);
  let n = 1;
  for (const id of existing) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (m) n = Math.max(n, Number(m[1]) + 1);
  }
  let id = `${prefix}${n}`;
  while (taken.has(id)) id = `${prefix}${++n}`;
  return id;
}

export const nextDraftId = (drafts: Draft[]): string => nextId(drafts.map((d) => d.id), 'd');

export function newDraft(id: string, moduleId: string, title: string, body = ''): Draft {
  return {
    id,
    moduleId,
    title,
    versions: [{ n: 1, at: new Date().toISOString(), body }],
  };
}

/**
 * A new version only when the text actually changed (trimmed compare) — saving
 * the same words twice must not inflate the ladder. Returns the draft unchanged
 * (same reference) when nothing was appended.
 *
 * One exception: a draft that was created empty and never run has a PLACEHOLDER
 * v1, so the learner's first real text fills it in place. Otherwise every ladder
 * would open with a blank rung.
 */
export function appendVersion(draft: Draft, body: string, at = new Date().toISOString()): Draft {
  const text = String(body ?? '');
  const last = draft.versions[draft.versions.length - 1];
  if (last && last.body.trim() === text.trim()) return draft;
  if (draft.versions.length === 1 && !last.body.trim() && !last.run) {
    return { ...draft, versions: [{ ...last, at, body: text }] };
  }
  const version: DraftVersion = { n: (last?.n ?? 0) + 1, at, body: text };
  const versions = [...draft.versions, version].slice(-MAX_VERSIONS);
  return { ...draft, versions };
}

/**
 * Look up by `n`. The index fallback exists only for old rows written without a
 * number — once the ladder has been capped, index and `n` no longer agree.
 */
export function findVersion(draft: Draft, n: number): DraftVersion | undefined {
  const wanted = Number(n);
  const found = draft.versions.find((v) => v.n === wanted);
  if (found) return found;
  const byIndex = draft.versions[wanted - 1];
  return byIndex && !Number.isFinite(byIndex.n) ? byIndex : undefined;
}

/** What a shipment copies: the run's predicted range, or 0/0 when it never ran. */
export function predictionFor(draft: Draft, n: number): { low: number; high: number; ran: boolean } {
  const run = findVersion(draft, n)?.run;
  if (!run) return { low: 0, high: 0, ran: false };
  return { low: run.predicted.low, high: run.predicted.high, ran: true };
}

/** Rubric-weighted average of a run's scores, 0..1, or null when nothing scored. */
export function overallScore(run: RunReport | undefined, rubric: RubricItem[]): number | null {
  if (!run) return null;
  let sum = 0;
  let weight = 0;
  for (const item of rubric) {
    const score = run.scores.find((s) => s.rubricId === item.id);
    if (!score) continue;
    const w = Number.isFinite(item.weight) && item.weight > 0 ? item.weight : 1;
    sum += Math.min(1, Math.max(0, score.score)) * w;
    weight += w;
  }
  if (!weight) return null;
  return sum / weight;
}

export interface LadderRow { n: number; score: number | null; delta: number | null }

/** v1 → v2 → v3 with the delta against the previous SCORED version. */
export function versionLadder(draft: Draft, rubric: RubricItem[]): LadderRow[] {
  const rows: LadderRow[] = [];
  let previous: number | null = null;
  for (const v of draft.versions) {
    const score = overallScore(v.run, rubric);
    const delta = score !== null && previous !== null ? score - previous : null;
    rows.push({ n: v.n, score, delta });
    if (score !== null) previous = score;
  }
  return rows;
}

/** One line per version for the prompts: "v1 0.42 → v2 0.68 (+0.26)". */
export function ladderText(draft: Draft, rubric: RubricItem[]): string {
  const rows = versionLadder(draft, rubric);
  if (!rows.length) return '';
  return rows
    .map((r) => {
      if (r.score === null) return `v${r.n}: not run yet`;
      const delta = r.delta === null ? '' : ` (${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(2)})`;
      return `v${r.n}: ${r.score.toFixed(2)}${delta}`;
    })
    .join('\n');
}
