// Drill grading. Drills never gate and a wrong answer never throws — being
// wrong is cheap, and wrong answers reveal the evidence.

import type { Claim, Course, Drill, DrillAttempt, Persona, SkillModule } from '../../../shared/skills';
import { callClaude, extractJson, isMock } from '../../llm/llm';
import { mockDrillFeedback } from '../fixtures';
import { rewriteGradePrompt, sprintGradePrompt } from './prompts';

export interface FoundDrill { drill: Drill; module: SkillModule }

export function findDrill(course: Course, drillId: string): FoundDrill | undefined {
  for (const module of course.modules) {
    const drill = module.drills.find((d) => d.id === drillId);
    if (drill) return { drill, module };
  }
  return undefined;
}

type Graded = Pick<DrillAttempt, 'correct' | 'feedback' | 'scores'>;

/** Predict-the-winner: one of two documented options actually won. */
export function gradePredict(drill: Extract<Drill, { kind: 'predict' }>, answer: unknown): Graded {
  const picked = Math.floor(Number(answer));
  const correct = picked === drill.winner;
  return { correct, feedback: `${drill.result} ${drill.why}`.trim() };
}

/** Spot-the-mistake: the flaw is revealed either way. */
export function gradeSpot(drill: Extract<Drill, { kind: 'spot' }>, answer: unknown): Graded {
  const picked = Math.floor(Number(answer));
  const segment = Number.isFinite(picked) ? drill.segments[picked] : undefined;
  const correct = !!segment?.flaw;
  const flawed = drill.segments.find((s) => s.flaw);
  const feedback = flawed?.flaw ?? 'Nothing is wrong with this one.';
  return { correct, feedback };
}

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function coerceFeedback(raw: unknown, rubricIds: string[]): Pick<DrillAttempt, 'feedback' | 'scores'> {
  const root = rec(raw);
  const allowed = new Set(rubricIds);
  const seen = new Set<string>();
  const scores: NonNullable<DrillAttempt['scores']> = [];
  for (const entry of Array.isArray(root.scores) ? root.scores : []) {
    const s = rec(entry);
    const rubricId = typeof s.rubricId === 'string' ? s.rubricId : '';
    if (!allowed.has(rubricId) || seen.has(rubricId)) continue;
    seen.add(rubricId);
    const score = Number(s.score);
    scores.push({ rubricId, score: Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0.5 });
  }
  const feedback = typeof root.feedback === 'string' ? root.feedback.trim() : '';
  return { feedback: feedback || 'Logged. Keep going.', scores };
}

export interface GradeDrillCtx {
  drill: Drill;
  module: SkillModule;
  claims: Claim[];
  personas: Persona[];
  answer: unknown;
  model?: string;
}

/** Sprint and rewrite go to the panel; predict and spot are decided on disk. */
export async function gradeDrill(ctx: GradeDrillCtx): Promise<Graded> {
  const { drill, answer } = ctx;
  switch (drill.kind) {
    case 'predict':
      return gradePredict(drill, answer);
    case 'spot':
      return gradeSpot(drill, answer);
    case 'sprint': {
      const lines = (Array.isArray(answer) ? answer : []).map((l) => String(l ?? ''));
      if (isMock()) return mockDrillFeedback('sprint', lines);
      const reply = await callClaude({
        task: 'skill',
        model: ctx.model,
        prompt: sprintGradePrompt({ ...ctx, answer: lines }),
      });
      return coerceFeedback(extractJson<unknown>(reply), drill.rubricIds);
    }
    case 'rewrite': {
      const written = String(answer ?? '');
      if (isMock()) return mockDrillFeedback('rewrite', written);
      const reply = await callClaude({
        task: 'skill',
        model: ctx.model,
        prompt: rewriteGradePrompt({ ...ctx, answer: written }),
      });
      return coerceFeedback(extractJson<unknown>(reply), drill.rubricIds);
    }
  }
}
