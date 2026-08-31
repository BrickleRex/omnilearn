// Prompt templates for the six generation tasks.
//
// House voice (hint / nudge text): 1–2 short lines, concrete, explained like to
// a smart 15-year-old who is not being talked down to. No hedging, no "As an
// AI", no praise padding, no emoji.
//
// Every structured prompt states the exact TypeScript shape inline and demands
// ONLY a JSON object back, so `extractJson` always has something to grab.

import type { Concept, Milestone, RunResult, Step } from '../../shared/types';

const VOICE = `VOICE
- Write like you are explaining to a smart 15-year-old who is new to this topic, never condescending.
- Concrete over abstract: name the variable, the shape, the operation.
- No preamble, no praise, no apologies, no "As an AI", no emoji.
- Short lines. Plain words. If a sentence can lose three words, lose them.`;

const ONLY_JSON = 'Respond with ONLY a JSON object matching this exact TypeScript shape';

const SVG_RULES = `FIGURE RULES (when you include figureSvg)
- Inline SVG string, under 2KB, MUST have a viewBox, no <script>, no external refs, no onclick.
- Use currentColor for strokes/text so it works on light and dark themes.
- A figure must show the mechanism (shapes, arrows, a row of bars), never decoration.
- Omit figureSvg entirely rather than inventing a vague picture.`;

function fence(shape: string): string {
  return `${ONLY_JSON}:\n\n${shape.trim()}\n\nNo markdown, no commentary, no code fence around the JSON — just the object.`;
}

function conceptList(concepts: Array<{ id: string; label: string }>): string {
  return concepts.map((c) => `- ${c.id}: ${c.label}`).join('\n');
}

function numberedBuffer(content: string): string {
  const lines = content.split('\n');
  const width = String(lines.length).length;
  return lines.map((l, i) => `${String(i + 1).padStart(width, ' ')}| ${l}`).join('\n');
}

// ---------- plan ----------

export function planPrompt(goal: string): string {
  return `You are the instructor agent for Omnilearn, a local app where a learner rebuilds real code
by typing every line themselves. Turn the learner's goal into a build plan.

LEARNER'S GOAL
${goal}

RULES
- 2 to 5 milestones, ordered so each one is runnable on its own and builds on the last.
- Each milestone has 3 to 6 concepts. A concept id is a slug ("softmax", "weighted-sum").
  A concept LABEL is the idea itself, phrased as a claim, e.g. "softmax turns scores into shares"
  or "a dot product measures how much two vectors agree" — not a topic name like "Softmax".
- entryFile is a relative python path the learner edits for that milestone; milestones may share one.
- starterFiles are MINIMAL runnable stubs, not solutions:
  * the entry file: a module docstring restating the goal, the imports the learner will need,
    and an \`if __name__ == "__main__":\` block that prints something so a first run succeeds.
  * a short README.md (under 15 lines) naming the goal and how to run it.
  * Never write the code the learner is here to write. Stubs only.
- If the goal says "not from scratch" (or names a library to lean on), plan AROUND that library:
  use it for the parts the learner is not trying to learn, and keep the hand-written parts focused.
  If the goal says "from scratch", plan for hand-rolled implementations with only numpy-level helpers.
- language is always "python" for v1.
- slug is lowercase kebab-case, derived from name.

${VOICE}

${fence(`{
  name: string;                    // short project name, 2-4 words
  slug: string;                    // lowercase-kebab-case
  language: "python";
  milestones: Array<{
    id: string;                    // slug
    title: string;                 // <= 6 words
    concepts: Array<{ id: string; label: string }>;
    entryFile: string;             // relative path, e.g. "mhsa.py"
  }>;
  starterFiles: Array<{ path: string; content: string }>;
}`)}`;
}

// ---------- calibration ----------

export function calibrationPrompt(milestone: Milestone): string {
  return `You are probing what a learner already knows, before teaching anything.
Write multiple-choice probes for this milestone.

MILESTONE: ${milestone.title} (id: ${milestone.id})
CONCEPTS
${conceptList(milestone.concepts)}

RULES
- Exactly one question per concept, ${milestone.concepts.length} questions total (3 to 5).
  Cover EVERY concept listed; set conceptId to that concept's id.
- Each question probes understanding, not vocabulary recall. 1-2 lines.
- 3 to 4 options. The LAST option must be exactly "No idea yet" — no shame, it is a real answer.
- answerIndex is the index of the correct option (never the "No idea yet" index).
- Make wrong options plausible-but-wrong, the kind of thing someone half-remembers.
- Question ids are slugs like "q-softmax".

${VOICE}

${fence(`{
  milestoneId: "${milestone.id}";
  questions: Array<{
    id: string;
    conceptId: string;
    question: string;
    options: string[];             // 3-4; LAST is exactly "No idea yet"
    answerIndex: number;
  }>;
}`)}`;
}

// ---------- primer ----------

export function primerPrompt(milestone: Milestone, uncleared: Concept[]): string {
  return `You are teaching just enough for a learner to build this milestone themselves.
They have already shown they know the concepts NOT listed below — do not re-teach those.

MILESTONE: ${milestone.title} (id: ${milestone.id})
ENTRY FILE: ${milestone.entryFile}
CONCEPTS STILL UNCLEARED (teach ONLY these, in this order)
${conceptList(uncleared)}

UNITS
- For each uncleared concept, exactly ONE teaching unit:
  * a "card" — one idea, bodyMd under 120 words, optional small figureSvg; or
  * a "story" — scrollytelling, 3 to 4 beats, each beat under 45 words, each beat MAY carry a figureSvg.
- Use a "story" for the SINGLE most central concept of this milestone (the one the others hang off).
  Every other uncleared concept gets a "card".
- THEN, after all teaching units, exactly one "check" per uncleared concept, in the same concept order.
  A check has 3 options, an answerIndex, and an "explain" of at most 30 words saying why.
  Do NOT add a "No idea yet" option to checks — a check is a real question.
- Unit ids are slugs: "u-softmax", "c-softmax".
- No text walls. If a card needs more than 120 words, the idea is too big — shrink the idea.

${SVG_RULES}

STEPS (the build plan the learner follows in the editor)
- 5 to 9 steps that, followed in order, produce a working ${milestone.title.toLowerCase()}.
- title: at most 6 words, imperative, lowercase ("score every pair").
- detail: ONE sentence naming the concrete operation and the shapes involved.
- Steps describe WHAT to do, never the literal code.

${VOICE}

${fence(`{
  milestoneId: "${milestone.id}";
  units: Array<
    | { kind: "card"; id: string; conceptId: string; title: string; bodyMd: string; figureSvg?: string }
    | { kind: "story"; id: string; conceptId: string; title: string; beats: Array<{ text: string; figureSvg?: string }> }
    | { kind: "check"; id: string; conceptId: string; question: string; options: string[]; answerIndex: number; explain: string }
  >;
  steps: Array<{ title: string; detail: string }>;
}`)}`;
}

// ---------- hint ----------

export function hintPrompt(
  content: string,
  cursorLine: number,
  steps: Step[],
  level: 'step' | 'composite',
  path: string,
): string {
  const stepList = steps.length
    ? steps.map((s, i) => `${i}. ${s.title} — ${s.detail}`).join('\n')
    : '(no build plan available; infer the next move from the code)';
  const levelRule =
    level === 'step'
      ? `LEVEL: "step" — give the NEXT PRECISE MICRO-STEP from exactly where the code is now.
  One small move: the next line's job, the next variable to define, the next shape to fix.`
      : `LEVEL: "composite" — give the NEXT BLOCK-LEVEL MOVE: the whole next chunk of work
  in one breath (three or four micro-steps rolled up), still without writing the code.`;

  return `The learner is stuck in the editor and pressed for a hint. They write every line themselves,
so NEVER give them the finished code — describe the move.

FILE: ${path}   CURSOR ON LINE: ${cursorLine} (1-based)

BUILD PLAN (index: title — detail)
${stepList}

CURRENT BUFFER
\`\`\`python
${numberedBuffer(content)}
\`\`\`

${levelRule}

RULES
- 1 to 2 lines total. No code blocks. At most one short inline expression if it is unavoidable.
- Start from where the code ACTUALLY is, not where the plan assumes it is.
- stepIndex is the index into the BUILD PLAN of the step the learner is currently on.
  If the plan is empty, use 0.

${VOICE}

${fence(`{ hint: string; stepIndex: number }`)}`;
}

// ---------- ghost ----------

export function ghostPrompt(content: string, cursorLine: number, path: string): string {
  return `The learner asked for a "ghost line": one outlined line of code shown at the cursor that they
must TYPE THEMSELVES to fill in. It never gets pasted. So it must be exactly one real line.

FILE: ${path}   CURSOR ON LINE: ${cursorLine} (1-based)

CURRENT BUFFER
\`\`\`python
${numberedBuffer(content)}
\`\`\`

RULES
- Return EXACTLY ONE line of python that belongs at line ${cursorLine}.
- No comment, no explanation, no trailing prose, no markdown fence, no leading/trailing blank lines.
- Match the surrounding indentation and the names already in the buffer.
- If the line before is complete and the next move is a new statement, write that statement.

${fence(`{ code: string }`)}`;
}

// ---------- watch ----------

export function watchPrompt(
  content: string,
  lastRun: RunResult | undefined,
  secondsOnSpot: number,
  cleared: Concept[],
  path: string,
): string {
  const runBlock = lastRun
    ? `exitCode: ${lastRun.exitCode}
stdout:
${lastRun.stdout.slice(-2000) || '(empty)'}
stderr:
${lastRun.stderr.slice(-2000) || '(empty)'}`
    : '(the learner has not run anything yet)';

  return `You are the watcher. You sit quietly behind a learner who is building something hard.

YOUR DEFAULT IS SILENCE. Return posture "quiet" unless one of the two triggers below is clearly met.
Being wrong is allowed. Productive struggle is the whole point of this app — a learner staring at a
broken program for five minutes is LEARNING, not failing, and interrupting that steals the lesson.

NUDGE ONLY IF:
(a) the last run failed with an error that CONTRADICTS a concept the learner has already cleared
    (they demonstrably know this idea, so this is a slip, not a gap — worth one line); or
(b) the learner is clearly rabbit-holing: same ~5-line region for more than 8-10 minutes
    (secondsOnSpot >= 500) WITH churn — edits that keep changing without converging.

Anything else — a fresh error, an empty buffer, a new file, a first failed run, thinking time,
an experiment, a half-written line — is "quiet". When unsure, be quiet.

CONCEPTS THIS LEARNER HAS ALREADY CLEARED
${cleared.length ? conceptList(cleared) : '(none yet — so trigger (a) cannot fire)'}

FILE: ${path}   SECONDS ON THE SAME SPOT: ${secondsOnSpot}

LAST RUN
${runBlock}

CURRENT BUFFER
\`\`\`python
${numberedBuffer(content)}
\`\`\`

IF YOU NUDGE
- note: 1 to 2 kid-simple lines. Name what is wrong and the one thing to look at. Never the fix in code.
- line: the 1-based gutter line to mark — the line the learner should look at.

${VOICE}

${fence(`{
  posture: "quiet" | "nudge";
  note?: string;                   // present if and only if posture is "nudge"
  line?: number;                   // 1-based gutter line, present when nudging
}`)}`;
}
