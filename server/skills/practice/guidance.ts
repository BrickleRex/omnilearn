// Make-time guidance: the hint, the ghost line, and the calibration grade.
// The ghost is TEXT ONLY — the learner types it. Nothing here writes into a buffer.

import type {
  CalibrationGradeRes, Claim, Exemplar, Frame, GhostRes, HintRes, SkillModule,
} from '../../../shared/skills';
import { callClaude, extractJson, isMock } from '../../llm/llm';
import { mockGhost, mockGrade, mockHint } from '../fixtures';
import { ghostPrompt, gradePrompt, hintPrompt } from './prompts';

/** Hints and ghosts are typed against, so they must land fast or not at all. */
const FAST_MS = 45_000;

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export interface HintCtx {
  frame: Frame;
  module: SkillModule;
  claims: Claim[];
  exemplars: Exemplar[];
  body: string;
  cursorLine: number;
  level: 'step' | 'composite';
  ladder?: string;
  model?: string;
}

export async function makeHint(ctx: HintCtx): Promise<HintRes> {
  if (isMock()) return mockHint(ctx.body, ctx.level);
  const reply = await callClaude({
    task: 'skill',
    model: ctx.model,
    timeoutMs: FAST_MS,
    prompt: hintPrompt(ctx),
  });
  const root = rec(extractJson<unknown>(reply));
  const hint = str(root.hint) || 'Keep going — write the next line and run it.';
  const flagRaw = rec(root.flag);
  const line = Math.floor(Number(flagRaw.line));
  const note = str(flagRaw.note);
  const lines = ctx.body.split('\n');
  const flagOk = Number.isFinite(line) && line >= 1 && line <= lines.length && !!note;
  return { hint, ...(flagOk ? { flag: { line, note } } : {}) };
}

export interface GhostCtx {
  frame: Frame;
  module: SkillModule;
  claims: Claim[];
  exemplars: Exemplar[];
  body: string;
  cursorLine: number;
  model?: string;
}

/** One plain sentence: no fence, no bullet, no wrapping quotes. */
export function cleanGhost(raw: string): string {
  let t = String(raw ?? '')
    .replace(/```[a-zA-Z]*\n?/g, '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? '';
  t = t.replace(/^[-*>]\s+/, '').replace(/^#+\s*/, '');
  for (let i = 0; i < 2; i++) {
    const m = /^(['"“”‘’`])([\s\S]*)\1$/.exec(t) ?? /^["“]([\s\S]*)["”]$/.exec(t);
    if (!m) break;
    t = (m[2] ?? m[1]).trim();
  }
  return t.trim();
}

export async function makeGhost(ctx: GhostCtx): Promise<GhostRes> {
  if (isMock()) return mockGhost(ctx.body);
  const reply = await callClaude({
    task: 'skill',
    model: ctx.model,
    timeoutMs: FAST_MS,
    prompt: ghostPrompt(ctx),
  });
  const root = rec(extractJson<unknown>(reply));
  return { text: cleanGhost(str(root.text)) };
}

export interface GradeCtx {
  frame: Frame;
  modules: SkillModule[];
  claims: Claim[];
  emails: string;
  model?: string;
}

export async function gradeExisting(ctx: GradeCtx): Promise<CalibrationGradeRes> {
  if (isMock()) return mockGrade(ctx.emails);
  const reply = await callClaude({ task: 'skill', model: ctx.model, prompt: gradePrompt(ctx) });
  const root = rec(extractJson<unknown>(reply));
  const known = new Set(ctx.modules.flatMap((m) => m.rubric.map((r) => r.id)));
  const seen = new Set<string>();
  const scores: CalibrationGradeRes['scores'] = [];
  for (const entry of Array.isArray(root.scores) ? root.scores : []) {
    const s = rec(entry);
    const rubricId = str(s.rubricId);
    if (!known.has(rubricId) || seen.has(rubricId)) continue;
    seen.add(rubricId);
    const score = Number(s.score);
    scores.push({
      rubricId,
      score: Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0.5,
      note: str(s.note) || 'not judged',
    });
  }
  return { scores, summary: str(root.summary) || 'Graded. Start with the lowest bar above.' };
}
