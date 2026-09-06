// The simulator run: three personas react line by line, the rubric is scored,
// and a metric range comes back. One model call, then hard coercion — a report
// the UI cannot render is worse than a blunt one.

import type { Claim, Course, Frame, Persona, RunReport, SkillModule } from '../../../shared/skills';
import { callClaude, extractJson, isMock } from '../../llm/llm';
import { mockRun } from '../fixtures';
import { runPrompt } from './prompts';

export interface RunCtx {
  frame: Frame;
  module: SkillModule;
  claims: Claim[];
  personas: Persona[];
  metric: Course['metric'];
  body: string;
  model?: string;
}

const clamp01 = (v: unknown, fallback: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
};

const text = (v: unknown, fallback = ''): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || fallback;
};

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Shape whatever came back into a RunReport: every persona in the course order,
 * reactions only on non-empty lines, at most one bail each, every rubric id
 * scored, a sane predicted range.
 */
export function coerceRunReport(raw: unknown, ctx: RunCtx): RunReport {
  const root = rec(raw);
  const lines = ctx.body.split('\n');
  const liveLine = (n: number) => n >= 1 && n <= lines.length && !!lines[n - 1].trim();

  const byPersona = new Map<string, Record<string, unknown>>();
  for (const entry of arr(root.personas)) {
    const p = rec(entry);
    const id = text(p.personaId);
    if (id) byPersona.set(id, p);
  }

  const personas = ctx.personas.map((persona) => {
    const found = byPersona.get(persona.id);
    const seen = new Set<number>();
    let bailed = false;
    const reactions: RunReport['personas'][number]['reactions'] = [];
    for (const entry of arr(found?.reactions)) {
      const r = rec(entry);
      const line = Math.floor(Number(r.line));
      if (!Number.isFinite(line) || !liveLine(line) || seen.has(line)) continue;
      const body = text(r.text);
      if (!body) continue;
      seen.add(line);
      const isBail = r.bailed === true && !bailed;
      if (isBail) bailed = true;
      reactions.push({ line, text: body, ...(isBail ? { bailed: true } : {}) });
    }
    reactions.sort((a, b) => a.line - b.line);
    return { personaId: persona.id, reactions };
  });

  const scoreById = new Map<string, Record<string, unknown>>();
  for (const entry of arr(root.scores)) {
    const s = rec(entry);
    const id = text(s.rubricId);
    if (id) scoreById.set(id, s);
  }
  const scores = ctx.module.rubric.map((item) => {
    const found = scoreById.get(item.id);
    if (!found) return { rubricId: item.id, score: 0.5, note: 'not judged' };
    return {
      rubricId: item.id,
      score: clamp01(found.score, 0.5),
      note: text(found.note, 'not judged'),
    };
  });

  const predicted = rec(root.predicted);
  const median = `${ctx.metric.corpusMedian}${ctx.metric.unit}`;
  let low = Number(predicted.low);
  let high = Number(predicted.high);
  if (!Number.isFinite(low)) low = 0;
  if (!Number.isFinite(high)) high = low;
  low = Math.max(0, low);
  high = Math.max(low, high);

  return {
    at: new Date().toISOString(),
    personas,
    scores,
    predicted: {
      low,
      high,
      unit: text(predicted.unit, ctx.metric.unit),
      note: text(
        predicted.note,
        `A model of the audience, not the audience. Corpus median ${median}.`,
      ),
    },
    biggestLever: text(root.biggestLever, 'Nothing stands out — run it again after your next edit.'),
  };
}

export async function runPanel(ctx: RunCtx): Promise<RunReport> {
  if (isMock()) return mockRun(ctx.body);
  const reply = await callClaude({
    task: 'skill',
    model: ctx.model,
    prompt: runPrompt(ctx),
  });
  return coerceRunReport(extractJson<unknown>(reply), ctx);
}
