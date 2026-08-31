// Deterministic fixtures used when LLM_MOCK=1. The e2e suite asserts on these
// exact strings and behaviours — treat them as a contract, not as sample data.
// No CLI is spawned, no throttle applies, no queue delay is introduced.

import type {
  Calibration,
  CalibrationQuestion,
  Concept,
  GhostRequest,
  GhostResponse,
  HintRequest,
  HintResponse,
  Milestone,
  PrimerDoc,
  PrimerUnit,
  ProjectPlan,
  Step,
  WatchRequest,
  WatchResponse,
} from '../../shared/types';

// ---------- tiny figures (viewBox, currentColor, no scripts) ----------

const SVG_DOT = `<svg viewBox="0 0 120 60" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="3"><path d="M10 50 L70 14"/><path d="M10 50 L96 40"/><circle cx="10" cy="50" r="4" fill="currentColor"/><text x="72" y="12" font-size="11" stroke="none" fill="currentColor">q</text><text x="100" y="42" font-size="11" stroke="none" fill="currentColor">k</text></svg>`;

const SVG_SCALE = `<svg viewBox="0 0 120 60" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="3"><rect x="8" y="8" width="14" height="44"/><rect x="28" y="30" width="14" height="22"/><path d="M52 30 L70 30" stroke-width="2"/><path d="M64 24 L70 30 L64 36" stroke-width="2"/><rect x="80" y="24" width="14" height="28"/><rect x="100" y="34" width="14" height="18"/></svg>`;

const SVG_STORY_1 = `<svg viewBox="0 0 120 60" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="3"><rect x="10" y="20" width="16" height="32"/><rect x="34" y="40" width="16" height="12"/><rect x="58" y="6" width="16" height="46"/><rect x="82" y="34" width="16" height="18"/></svg>`;

const SVG_STORY_2 = `<svg viewBox="0 0 120 60" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="3"><rect x="10" y="34" width="16" height="18"/><rect x="34" y="46" width="16" height="6"/><rect x="58" y="4" width="16" height="48"/><rect x="82" y="42" width="16" height="10"/></svg>`;

const SVG_STORY_3 = `<svg viewBox="0 0 120 60" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="3"><rect x="10" y="8" width="100" height="20"/><path d="M34 8 L34 28 M74 8 L74 28 M92 8 L92 28" stroke-width="2"/><text x="10" y="48" font-size="12" stroke="none" fill="currentColor">sums to 1</text></svg>`;

// ---------- plan ----------

const MHSA_PY = `"""Attention From Scratch.

Build scaled dot-product attention by hand, then stack it into multiple heads.

Run me:  python3 mhsa.py
"""

import numpy as np


if __name__ == "__main__":
    print("omnilearn: ready")
`;

const README_MD = `# Attention From Scratch

Rebuild multi-head self-attention in numpy, one line at a time.

## Run

\`\`\`
python3 mhsa.py
\`\`\`

Milestone 1 is scaled dot-product attention. Milestone 2 adds heads and projections.
`;

export function mockPlan(_goal: string): ProjectPlan {
  return {
    name: 'Attention From Scratch',
    slug: 'attention-from-scratch',
    language: 'python',
    milestones: [
      {
        id: 'sdpa',
        title: 'Scaled dot-product attention',
        entryFile: 'mhsa.py',
        concepts: [
          { id: 'dot-product', label: 'a dot product measures how much two vectors agree' },
          { id: 'scaling', label: 'divide by √dk so softmax stays gentle' },
          { id: 'softmax', label: 'softmax turns scores into shares that sum to 1' },
          { id: 'weighted-sum', label: 'the output is a weighted average of V' },
        ],
      },
      {
        id: 'multihead',
        title: 'Multi-head + projections',
        entryFile: 'mhsa.py',
        concepts: [
          { id: 'heads', label: 'each head looks at the sequence differently' },
          { id: 'projections', label: 'learned matrices reshape Q, K, V' },
        ],
      },
    ],
    starterFiles: [
      { path: 'mhsa.py', content: MHSA_PY },
      { path: 'README.md', content: README_MD },
    ],
  };
}

// ---------- calibration ----------

const SDPA_QUESTIONS: CalibrationQuestion[] = [
  {
    id: 'q-dot-product',
    conceptId: 'dot-product',
    question: 'What does the dot product of two vectors tell you?',
    options: [
      'How much they point the same way',
      'How far apart they sit in the sequence',
      'Their combined length',
      'No idea yet',
    ],
    answerIndex: 0,
  },
  {
    id: 'q-scaling',
    conceptId: 'scaling',
    question: 'Scores get big when dk is large. What does dividing by √dk fix?',
    options: [
      'It rounds the scores to integers',
      'It keeps softmax from spiking onto one token',
      'It shrinks the value vectors',
      'No idea yet',
    ],
    answerIndex: 1,
  },
  {
    id: 'q-softmax',
    conceptId: 'softmax',
    question: 'A row of scores goes through softmax. What comes out?',
    options: [
      'Positive numbers that add up to 1',
      'Only the single biggest score',
      'Numbers spread between -1 and 1',
      'No idea yet',
    ],
    answerIndex: 0,
  },
  {
    id: 'q-weighted-sum',
    conceptId: 'weighted-sum',
    question: 'You have attention weights for one token. How do you get its output vector?',
    options: [
      'Take the V row with the biggest weight',
      'Add every V row together',
      'Blend the V rows using the weights',
      'No idea yet',
    ],
    answerIndex: 2,
  },
];

function genericQuestion(concept: { id: string; label: string }): CalibrationQuestion {
  return {
    id: `q-${concept.id}`,
    conceptId: concept.id,
    question: `Which of these is closest to true: ${concept.label}?`,
    options: [
      `Yes — ${concept.label}`,
      'That describes something else entirely',
      'Only when the input is one-dimensional',
      'No idea yet',
    ],
    answerIndex: 0,
  };
}

export function mockCalibration(milestone: Milestone): Calibration {
  if (milestone.id === 'sdpa') {
    return { milestoneId: milestone.id, questions: SDPA_QUESTIONS.map((q) => ({ ...q })) };
  }
  return { milestoneId: milestone.id, questions: milestone.concepts.map(genericQuestion) };
}

// ---------- primer ----------

const MOCK_STEPS: Step[] = [
  {
    title: 'shape your inputs',
    detail: 'Make q, k and v numpy arrays of shape (seq_len, dk) so each token is one row.',
  },
  {
    title: 'score every pair',
    detail: 'Multiply q by k transposed so entry (i, j) scores how much token i wants token j.',
  },
  {
    title: 'scale the scores',
    detail: 'Divide the whole score matrix by the square root of dk to keep the numbers gentle.',
  },
  {
    title: 'softmax each row',
    detail: 'Subtract each row max, exponentiate, then divide by the row sum so every row adds to 1.',
  },
  {
    title: 'blend the values',
    detail: 'Multiply the weight matrix by v so each token output is a weighted average of the value rows.',
  },
  {
    title: 'sanity-check shapes',
    detail: 'Print the output shape and confirm every attention row still sums to one before moving on.',
  },
];

const STORY_UNITS: Record<string, PrimerUnit> = {
  softmax: {
    kind: 'story',
    id: 'u-softmax',
    conceptId: 'softmax',
    title: 'From raw scores to shares',
    beats: [
      {
        text: 'A row of scores is just numbers. Some big, some negative. Nothing in there says how much attention each token deserves yet.',
        figureSvg: SVG_STORY_1,
      },
      {
        text: 'Exponentiate every score. Negatives become small positives, big scores become much bigger. Everything is positive now, and the gaps got sharper.',
        figureSvg: SVG_STORY_2,
      },
      {
        text: 'Divide each one by the row total. The row now sums to 1, so every score has become a share of this token’s attention.',
        figureSvg: SVG_STORY_3,
      },
    ],
  },
};

const CARD_BODIES: Record<string, { title: string; bodyMd: string; figureSvg?: string }> = {
  'dot-product': {
    title: 'Agreement, as one number',
    bodyMd:
      'A dot product multiplies two vectors element by element and adds up the results.\n\nIf the two vectors lean the same way, the products are mostly positive and the total is big. If they lean opposite ways, the total goes negative. If they are unrelated, it lands near zero.\n\nThat is the whole trick behind attention: `q @ k.T` is one dot product per pair of tokens, so the matrix you get back is a table of "how much does token i agree with token j".',
    figureSvg: SVG_DOT,
  },
  scaling: {
    title: 'Why √dk shows up',
    bodyMd:
      'Dot products grow with the number of dimensions you add up. With dk = 64, scores can easily reach the tens; with dk = 512 they get much larger.\n\nSoftmax cares about *gaps* between scores. Feed it huge numbers and one token wins almost everything — the weights collapse to nearly one-hot and gradients go flat.\n\nDividing by `np.sqrt(dk)` puts the scores back into a range where softmax stays soft and every token keeps a real share.',
    figureSvg: SVG_SCALE,
  },
  'weighted-sum': {
    title: 'The output is a blend',
    bodyMd:
      'After softmax, each row of the weight matrix is a set of shares that add to 1.\n\nMultiply that row by V and you get a weighted average of every value vector: mostly the rows with big weights, a little of the rest. `weights @ v` does all rows at once.\n\nSo a token’s output is not "the best match" — it is a mixture, tilted toward whatever it paid the most attention to.',
  },
  heads: {
    title: 'Several looks at once',
    bodyMd:
      'One attention pass gives one opinion about what matters. A head is just that pass, run on a slice of the feature dimension.\n\nSplit dk across h heads, run attention independently in each, then concatenate the outputs. One head can track the subject of a sentence while another tracks the token right next door.',
  },
  projections: {
    title: 'Learned reshaping',
    bodyMd:
      'Q, K and V do not arrive ready to use — they are made by multiplying the input by learned matrices `Wq`, `Wk` and `Wv`.\n\nThose matrices decide what the model looks *for* (Q), what each token advertises (K) and what it hands over (V). A fourth matrix `Wo` mixes the concatenated heads back into one output.',
  },
};

const CHECKS: Record<string, { question: string; options: string[]; explain: string }> = {
  'dot-product': {
    question: 'Two vectors point in nearly the same direction. Their dot product is:',
    options: ['Large and positive', 'Close to zero', 'Large and negative'],
    explain: 'Aligned vectors give mostly positive products, so the sum is large and positive.',
  },
  scaling: {
    question: 'Why divide the scores by √dk before softmax?',
    options: [
      'Big dk makes scores huge and softmax would spike onto one token',
      'It turns the scores into integers',
      'It normalises the value vectors',
    ],
    explain: 'Scaling keeps score gaps small enough that softmax stays soft.',
  },
  softmax: {
    question: 'After softmax, each row of the attention matrix:',
    options: ['Is positive and sums to 1', 'Has one 1 and the rest 0', 'Sums to 0'],
    explain: 'Exponentiate then divide by the row total, so the row becomes shares adding to 1.',
  },
  'weighted-sum': {
    question: 'What does `weights @ v` give you?',
    options: [
      'A blend of all value rows, tilted by the weights',
      'The single value row with the largest weight',
      'The sum of the weights',
    ],
    explain: 'Each output row is a weighted average of every value row.',
  },
  heads: {
    question: 'Why run several heads instead of one?',
    options: [
      'Each head can track a different relationship',
      'It makes the matrices smaller',
      'It removes the need for softmax',
    ],
    explain: 'Independent heads attend on different slices, so they can notice different patterns.',
  },
  projections: {
    question: 'What do Wq, Wk and Wv do?',
    options: [
      'Turn the input into what to look for, advertise and hand over',
      'Normalise the scores',
      'Concatenate the heads',
    ],
    explain: 'They are learned matrices producing Q, K and V from the same input.',
  },
};

function cardUnit(concept: Concept): PrimerUnit {
  const preset = CARD_BODIES[concept.id];
  return {
    kind: 'card',
    id: `u-${concept.id}`,
    conceptId: concept.id,
    title: preset?.title ?? concept.label,
    bodyMd: preset?.bodyMd ?? `${concept.label}.\n\nHold on to that one sentence while you build — it is the whole idea.`,
    ...(preset?.figureSvg ? { figureSvg: preset.figureSvg } : {}),
  };
}

function checkUnit(concept: Concept): PrimerUnit {
  const preset = CHECKS[concept.id];
  return {
    kind: 'check',
    id: `c-${concept.id}`,
    conceptId: concept.id,
    question: preset?.question ?? `Which is true: ${concept.label}?`,
    options: preset?.options ?? [
      `Yes — ${concept.label}`,
      'That describes a different operation',
      'Only for one-dimensional inputs',
    ],
    answerIndex: 0, // every mock check answers 0
    explain: preset?.explain ?? `Because ${concept.label}.`,
  };
}

export function mockPrimer(milestone: Milestone, uncleared: Concept[]): PrimerDoc {
  // The single most central concept gets the story; everything else gets a card.
  const storyConcept =
    uncleared.find((c) => STORY_UNITS[c.id] !== undefined) ?? uncleared[0];

  const units: PrimerUnit[] = [];
  if (storyConcept) {
    const preset = STORY_UNITS[storyConcept.id];
    units.push(
      preset
        ? { ...preset }
        : {
            kind: 'story',
            id: `u-${storyConcept.id}`,
            conceptId: storyConcept.id,
            title: storyConcept.label,
            beats: [
              { text: `Start with the plain version: ${storyConcept.label}.` },
              { text: 'Now watch what changes when you apply it to a whole row at once.' },
              { text: 'That is the shape you are about to build in code.' },
            ],
          },
    );
  }
  for (const concept of uncleared) {
    if (storyConcept && concept.id === storyConcept.id) continue;
    units.push(cardUnit(concept));
  }
  for (const concept of uncleared) {
    units.push(checkUnit(concept));
  }

  return {
    milestoneId: milestone.id,
    units,
    steps: MOCK_STEPS.map((s) => ({ ...s })),
  };
}

// ---------- hint ----------

export function mockHint(req: HintRequest): HintResponse {
  if ((req.content ?? '').includes('np.sqrt')) {
    return {
      hint: 'Now apply softmax along the last axis — each row becomes shares that sum to 1.',
      stepIndex: 3,
    };
  }
  if (req.level === 'composite') {
    return {
      hint: 'Build the whole scoring block: q @ k.T, divide by √dk, then softmax each row.',
      stepIndex: 1,
    };
  }
  return {
    hint: 'Multiply q by k transposed — that scores every pair of tokens.',
    stepIndex: 1,
  };
}

// ---------- ghost ----------

export function mockGhost(_req: GhostRequest): GhostResponse {
  return { code: 'scores = q @ k.T / np.sqrt(dk)' };
}

// ---------- watch ----------

const NUDGE_NOTE = "You're using a name before defining it — define dk from k.shape first.";

export function mockWatch(req: WatchRequest): WatchResponse {
  if (req.exploreMode) return { posture: 'quiet' };

  const content = req.content ?? '';
  const bugLine = content.split('\n').findIndex((l) => l.includes('BUG!'));
  const hasBug = bugLine !== -1;
  const stuck = (req.secondsOnSpot ?? 0) >= 300;
  const contradicted =
    !!req.lastRun && req.lastRun.exitCode !== 0 && /NameError/.test(req.lastRun.stderr ?? '');

  if (hasBug || stuck || contradicted) {
    return { posture: 'nudge', note: NUDGE_NOTE, line: hasBug ? bugLine + 1 : 1 };
  }
  return { posture: 'quiet' };
}

// ---------- chat ----------

/**
 * Two deterministic tutor replies: an orienting one for "what/task/step"
 * questions, and an echo for everything else. The e2e suite matches these
 * strings exactly.
 */
export function mockChat(milestone: Milestone, message: string): string {
  const text = String(message ?? '');
  if (/task|what|step/i.test(text)) {
    const steps = milestone.steps ?? [];
    const step = steps[milestone.currentStep] ?? steps[0];
    const stepTitle = step?.title ?? 'getting set up';
    return `You're building "${milestone.title}" — next step: ${stepTitle}. (mock tutor)`;
  }
  return `Mock tutor reply: ${text.slice(0, 60)}`;
}
