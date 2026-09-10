// Prompts for the skills-track practice loop: persona panel (run), hint, ghost,
// calibration grading, sprint/rewrite drill grading and the skill tutor chat.
//
// House voice: 1-2 short lines, concrete, explained like to a smart 15-year-old.
// Every structured prompt states the exact TypeScript shape inline and demands
// ONLY a JSON object back, so `extractJson` always has something to grab.

import type {
  Claim, Course, Drill, Exemplar, Frame, Persona, RubricItem, SkillModule, ProbeAnswer,
} from '../../../shared/skills';
import type { ChatMessage } from '../../../shared/types';
import { targetBlock } from '../research/prompts';

const VOICE = `VOICE
- Explain like you are talking to a smart 15-year-old who is new to this, never condescending.
- Concrete over abstract: name the line, the word, the move.
- Short lines. Plain words. No preamble, no praise, no apologies, no emoji.`;

function fence(shape: string): string {
  return `Respond with ONLY a JSON object matching this exact TypeScript shape:

${shape.trim()}

No markdown, no commentary, no code fence around the JSON — just the object.`;
}

const BODY_HEAD = 6000; // characters of a draft any prompt gets to see

/**
 * The long-tail target, when the frame carries one: the panel, the hints and the
 * ghost all speak as these people rather than a generic reader.
 */
function targetLines(frame: Frame): string {
  return frame.target ? `\n${targetBlock(frame.target)}\n` : '';
}

export function numbered(body: string): string {
  const lines = String(body ?? '').slice(0, BODY_HEAD).split('\n');
  const width = String(lines.length).length;
  return lines.map((l, i) => `${String(i + 1).padStart(width, ' ')}| ${l}`).join('\n');
}

function claimText(claims: Claim[], id: string): string {
  return claims.find((c) => c.id === id)?.text ?? '(claim text unavailable)';
}

export function claimBlock(claims: Claim[], ids: string[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    lines.push(`- ${id}: ${claimText(claims, id)}`);
  }
  return lines.length ? lines.join('\n') : '(no claims cited)';
}

export function rubricBlock(rubric: RubricItem[], claims: Claim[]): string {
  if (!rubric.length) return '(no rubric items)';
  return rubric
    .map((r) => {
      const cited = r.claimIds.map((id) => `${id}: ${claimText(claims, id)}`).join(' | ') || 'no claims';
      return `- ${r.id} (weight ${r.weight}) ${r.label}\n    evidence — ${cited}`;
    })
    .join('\n');
}

export function personaBlock(personas: Persona[]): string {
  if (!personas.length) return '(no personas)';
  return personas.map((p) => `- ${p.id} — ${p.name}, ${p.role}: ${p.bio}`).join('\n');
}

export function exemplarBlock(exemplars: Exemplar[]): string {
  if (!exemplars.length) return '(no exemplars)';
  return exemplars
    .map((x) => `- ${x.title}: ${x.why}\n"""\n${x.body.slice(0, 1200)}\n"""`)
    .join('\n');
}

function metricLine(metric: Course['metric']): string {
  return `${metric.name}, measured in ${metric.unit}; the corpus median is ${metric.corpusMedian}${metric.unit}`;
}

// ---------- run (persona panel + scorecard) ----------

export interface RunPromptCtx {
  frame: Frame;
  module: SkillModule;
  claims: Claim[];
  personas: Persona[];
  metric: Course['metric'];
  body: string;
}

export function runPrompt(ctx: RunPromptCtx): string {
  const rubricIds = ctx.module.rubric.map((r) => r.id).join(', ') || '(none)';
  const personaIds = ctx.personas.map((p) => p.id).join(', ') || '(none)';
  return `You are simulating three real readers reacting to a draft line by line, then scoring that
draft against a rubric built from researched claims. You are a MODEL of the audience, never the audience.

WHAT THE LEARNER IS AFTER
outcome: ${ctx.frame.outcome}
context: ${ctx.frame.context}
${targetLines(ctx.frame)}
MODULE: ${ctx.module.title}

RUBRIC — score every one of these ids: ${rubricIds}
${rubricBlock(ctx.module.rubric, ctx.claims)}

THE THREE READERS — use exactly these personaIds: ${personaIds}
${personaBlock(ctx.personas)}

THE AUDIENCE METRIC: ${metricLine(ctx.metric)}

THE DRAFT (line numbers on the left)
${numbered(ctx.body)}

RULES
${ctx.frame.target ? `- These three readers ARE the target above. React as those people: their industry's words, their
  rules, their calendar, their idea of a big deal. Never as a generic reader.
` : ''}- One reaction per NON-EMPTY line, per reader, written in that reader's voice, 1-2 sentences.
  Never react to a blank line. Use the printed line numbers.
- If a reader would stop reading, set bailed: true on the line where they stop. At most ONE
  bailed line per reader, and only when they really would quit there.
- Score every rubric id, 0..1. Each note is ONE line and cites the claim ids it leans on, like "(c1)".
- predicted.low / predicted.high bound ${ctx.metric.name} in ${ctx.metric.unit}; unit is "${ctx.metric.unit}".
  predicted.note must say this is a model of the audience, not the audience, and quote the corpus
  median (${ctx.metric.corpusMedian}${ctx.metric.unit}).
- biggestLever: ONE line naming the single change that would move the number most, citing a claim id.

${VOICE}

${fence(`{
  personas: Array<{ personaId: string; reactions: Array<{ line: number; text: string; bailed?: boolean }> }>;
  scores: Array<{ rubricId: string; score: number; note: string }>;
  predicted: { low: number; high: number; unit: string; note: string };
  biggestLever: string;
}`)}`;
}

// ---------- hint ----------

export interface HintPromptCtx {
  frame: Frame;
  module: SkillModule;
  claims: Claim[];
  exemplars: Exemplar[];
  body: string;
  cursorLine: number;
  level: 'step' | 'composite';
  ladder?: string;
}

export function hintPrompt(ctx: HintPromptCtx): string {
  const ask =
    ctx.level === 'composite'
      ? `Describe the SHAPE of the whole piece — the two to four moves it should make, in order.`
      : `Say the NEXT thing to write or fix, starting from where the draft actually is.`;
  return `The learner is writing this themselves, line by line. You point; they type.

WHAT THEY ARE AFTER
outcome: ${ctx.frame.outcome}
context: ${ctx.frame.context}
${targetLines(ctx.frame)}
MODULE: ${ctx.module.title}

RUBRIC AND ITS EVIDENCE
${rubricBlock(ctx.module.rubric, ctx.claims)}

WHAT GOOD LOOKS LIKE
${exemplarBlock(ctx.exemplars)}
${ctx.ladder ? `\nTHEIR VERSIONS SO FAR\n${ctx.ladder}` : ''}

THEIR DRAFT (cursor is on line ${ctx.cursorLine})
${numbered(ctx.body)}

WHAT TO SAY
- ${ask}
- 1 to 2 lines. No rewritten draft, no paragraph they can paste. Name the move, not the words.
${ctx.frame.target ? '- Point at what works on THIS target, not on readers in general. A general rule gets said as a general rule, then localised to these people.' : ''}

LOOK BACK (the flag field)
- Reread the lines already written. Set flag = { line, note } ONLY when an earlier line is
  clearly wrong for the goal: an opener about the writer instead of the reader, a wall of text
  where the reader skims, or no ask at all.
- Never stylistic, never "you could also". At most ONE flag, the worst one. If in doubt, omit it.

${VOICE}

${fence(`{ hint: string; flag?: { line: number; note: string } }`)}`;
}

// ---------- ghost ----------

export interface GhostPromptCtx {
  frame: Frame;
  module: SkillModule;
  claims: Claim[];
  exemplars: Exemplar[];
  body: string;
  cursorLine: number;
}

export function ghostPrompt(ctx: GhostPromptCtx): string {
  return `The learner asked for a "ghost line": ONE outlined sentence shown at their cursor that they
must TYPE themselves. It is never pasted for them, so it must be exactly one sentence.

WHAT THEY ARE AFTER
outcome: ${ctx.frame.outcome}
context: ${ctx.frame.context}
${targetLines(ctx.frame)}
MODULE: ${ctx.module.title}

RUBRIC AND ITS EVIDENCE
${rubricBlock(ctx.module.rubric, ctx.claims)}

THE REGISTER TO MATCH
${exemplarBlock(ctx.exemplars)}

THEIR DRAFT (cursor is on line ${ctx.cursorLine})
${numbered(ctx.body)}

RULES
- Return EXACTLY ONE sentence that belongs at line ${ctx.cursorLine}, in the register of the exemplars.
- Plain text only: no quotes around it, no markdown, no label, no explanation, no trailing prose.
- It must fit what is already written — same reader, same subject, no repeats.
${ctx.frame.target ? '- Written for the target above: their words, their situation, nothing a generic reader would get.' : ''}

${fence(`{ text: string }`)}`;
}

// ---------- calibration grading ----------

export interface GradePromptCtx {
  frame: Frame;
  modules: SkillModule[];
  claims: Claim[];
  emails: string;
}

export function gradePrompt(ctx: GradePromptCtx): string {
  const rubric = ctx.modules
    .map((m) => `MODULE ${m.title}\n${rubricBlock(m.rubric, ctx.claims)}`)
    .join('\n\n');
  const ids = ctx.modules.flatMap((m) => m.rubric.map((r) => r.id)).join(', ') || '(none)';
  return `The learner pasted work they have already written. Grade it against the rubric so they can
see where they stand before they learn anything. Be honest and kind; this is a starting line, not a verdict.

WHAT THEY ARE AFTER
outcome: ${ctx.frame.outcome}
context: ${ctx.frame.context}
${targetLines(ctx.frame)}
RUBRIC — score every one of these ids: ${ids}
${rubric}

WHAT THEY PASTED
"""
${String(ctx.emails ?? '').slice(0, BODY_HEAD)}
"""

RULES
- One score per rubric id, 0..1, judging what they actually wrote, not what they meant.
- Each note is ONE line: what is there or missing, citing claim ids like "(c1)".
- summary is exactly 2 lines: the one strength, then the one thing to change first.
${ctx.frame.target ? '- Judge it as the target above would read it, not as a general reader would.' : ''}

${VOICE}

${fence(`{ scores: Array<{ rubricId: string; score: number; note: string }>; summary: string }`)}`;
}

// ---------- calibration probes answered in the learner's own words ----------

export interface ProbeGradeCtx { frame: Frame; answers: ProbeAnswer[] }

export function probeGradePrompt(ctx: ProbeGradeCtx): string {
  const items = ctx.answers.map((a, i) => `${i + 1}. unitId: ${a.unitId}
   question: ${a.question}
   correct answer: ${a.options[a.answerIndex] ?? '(unknown)'}
   why: ${a.explain}
   THEIR ANSWER: <<<${a.answer.slice(0, 600)}>>>`).join('\n');
  return `A learner answered calibration questions in their own words instead of picking an option.
Decide how much of each concept they already have. This only decides what we skip teaching.

WHAT THEY ARE AFTER
outcome: ${ctx.frame.outcome}
${targetLines(ctx.frame)}
${items}

RULES
- mastery 1.0 = says the same thing as the correct answer, even in different words or a different example.
- 0.6-0.8 = has the core idea but misses a piece the "why" line names.
- 0.3 = a real attempt that is off. 0 = blank, "no idea", or unrelated.
- Be generous with wording, strict with meaning. A vague answer that could mean anything is 0.3.
- note is ONE kid-simple line: what they got, or the one piece they are missing.

${VOICE}

${fence(`{ results: Array<{ unitId: string; mastery: number; note: string }> }`)}`;
}

// ---------- drill grading (sprint / rewrite) ----------

export interface DrillPromptCtx {
  drill: Drill;
  module: SkillModule;
  claims: Claim[];
  personas: Persona[];
  answer: unknown;
}

export function sprintGradePrompt(ctx: DrillPromptCtx): string {
  const drill = ctx.drill as Extract<Drill, { kind: 'sprint' }>;
  const rubric = ctx.module.rubric.filter((r) => drill.rubricIds.includes(r.id));
  const lines = (Array.isArray(ctx.answer) ? (ctx.answer as unknown[]) : [])
    .map((l) => String(l ?? ''))
    .filter((l) => l.trim());
  return `Grade a timed writing sprint. The learner wrote these under a clock; judge the batch, not the typing.

THE SPRINT: ${drill.prompt}
QUOTA: ${drill.quota} in ${drill.seconds}s

RUBRIC AND ITS EVIDENCE
${rubricBlock(rubric, ctx.claims)}

WHAT THEY WROTE
${lines.length ? lines.map((l, i) => `${i + 1}. ${l}`).join('\n') : '(nothing)'}

RULES
- feedback is exactly 2 lines: how many landed and why, then the one fix for the rest.
- One score per rubric id above, 0..1, across the batch.
- Wrong answers are cheap here. Say what is off, never scold.

${VOICE}

${fence(`{ feedback: string; scores: Array<{ rubricId: string; score: number }> }`)}`;
}

export function rewriteGradePrompt(ctx: DrillPromptCtx): string {
  const drill = ctx.drill as Extract<Drill, { kind: 'rewrite' }>;
  const rubric = ctx.module.rubric.filter((r) => drill.rubricIds.includes(r.id));
  const to = ctx.personas.find((p) => p.id === drill.toPersona);
  const from = ctx.personas.find((p) => p.id === drill.fromPersona);
  return `Judge a rewrite: the learner took a piece written for one reader and aimed it at another.

WRITTEN FOR: ${from ? `${from.name}, ${from.role} — ${from.bio}` : drill.fromPersona}
REWRITTEN FOR: ${to ? `${to.name}, ${to.role} — ${to.bio}` : drill.toPersona}

THE ORIGINAL
"""
${drill.original}
"""

THEIR REWRITE
"""
${String(ctx.answer ?? '').slice(0, BODY_HEAD)}
"""

RUBRIC AND ITS EVIDENCE
${rubricBlock(rubric, ctx.claims)}

RULES
- Judge it as the NEW reader would read it: would they keep reading, and would they answer?
- feedback is exactly 2 lines, in plain words, one of them the single fix.
- One score per rubric id above, 0..1.

${VOICE}

${fence(`{ feedback: string; scores: Array<{ rubricId: string; score: number }> }`)}`;
}

// ---------- chat ----------

export interface SkillChatCtx {
  skillName: string;
  frame: Frame;
  module: SkillModule;
  claims: Claim[];
  personas: Persona[];
  metric: Course['metric'];
  draft?: string;
  ladder?: string;
  history: ChatMessage[];
  message: string;
}

export function skillChatPrompt(ctx: SkillChatCtx): string {
  const moduleClaimIds = [
    ...ctx.module.rubric.flatMap((r) => r.claimIds),
    ...Object.values(ctx.module.unitClaims ?? {}).flat(),
  ];
  const history = ctx.history.length
    ? ctx.history.map((m) => `${m.role === 'user' ? 'LEARNER' : 'YOU'}: ${m.text}`).join('\n')
    : '(this is the first thing they have said)';
  const draft = ctx.draft
    ? `THEIR DRAFT RIGHT NOW\n${numbered(ctx.draft)}`
    : 'THEIR DRAFT RIGHT NOW: (empty)';
  return `You are the learner's coach for "${ctx.skillName}", sitting beside them while they write.

WHAT THEY ARE AFTER
outcome: ${ctx.frame.outcome}
context: ${ctx.frame.context}
they rate themselves: ${ctx.frame.level}
${targetLines(ctx.frame)}
MODULE: ${ctx.module.title}

WHAT THE RESEARCH SAYS (cite these ids when you lean on them)
${claimBlock(ctx.claims, moduleClaimIds)}

WHO THEY ARE WRITING TO
${personaBlock(ctx.personas)}

THE METRIC THAT MATTERS: ${metricLine(ctx.metric)}

${draft}
${ctx.ladder ? `\nTHEIR VERSIONS SO FAR\n${ctx.ladder}` : ''}

CONVERSATION SO FAR
${history}

THE LEARNER JUST ASKED
${ctx.message}

WHAT YOU ARE GREAT AT
- Explaining WHY a move works, with the claim behind it and the reader it works on.
${ctx.frame.target ? '- Answering for THIS target: a general rule gets said as "the general rule is X — for these people it means Y".' : ''}
- Reading their draft and saying plainly what a reader would do with it.
- Turning a vague worry into the one next move.

THE ONE HARD RULE
- NEVER write their piece for them. They type every line — that is the whole point.
- You may quote AT MOST ONE example sentence, and only when nothing else lands the idea.
  Never a whole paragraph, never their draft rewritten.
- If they ask outright, say no in one sentence and give them the move instead.

FORMAT
- 2 to 6 short lines. Plain prose, no JSON, no headings, no bullets unless they help.
${VOICE}`;
}
