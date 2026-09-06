// Pure logic behind the practice routes: the version-append rule, the ladder's
// delta math, predict/spot grading, the ship prediction lookup, and the run
// report coercion that keeps a sloppy model answer renderable.

import { describe, expect, it } from 'vitest';
import type { Draft, Drill, RunReport, SkillModule } from '../../shared/skills';
import { mockCourse } from './fixtures';
import {
  MAX_VERSIONS, appendVersion, findVersion, ladderText, newDraft, nextDraftId, nextId,
  overallScore, predictionFor, versionLadder,
} from './practice/drafts';
import { findDrill, gradePredict, gradeSpot } from './practice/drills';
import { coerceRunReport } from './practice/run';
import { cleanGhost } from './practice/guidance';
import { flagNote, flaggedClaimIds, nextShipId, outsideRange, realityRate } from './practice/ship';

const course = mockCourse();
const firstLine = course.modules[0];

function draftWith(bodies: string[]): Draft {
  let draft = newDraft('d1', 'first-line', 'Priya @ Acme', bodies[0] ?? '');
  for (const body of bodies.slice(1)) draft = appendVersion(draft, body);
  return draft;
}

function runWith(scores: Array<[string, number]>, predicted = { low: 3, high: 6 }): RunReport {
  return {
    at: new Date().toISOString(),
    personas: [],
    scores: scores.map(([rubricId, score]) => ({ rubricId, score, note: '' })),
    predicted: { ...predicted, unit: '%', note: 'model of the audience' },
    biggestLever: 'Open with their trigger (c1).',
  };
}

describe('draft ids', () => {
  it('numbers past the highest existing id', () => {
    expect(nextDraftId([])).toBe('d1');
    expect(nextDraftId([newDraft('d1', 'm', 't'), newDraft('d7', 'm', 't')])).toBe('d8');
    expect(nextId(['sh1', 'sh2'], 'sh')).toBe('sh3');
  });
});

describe('version append rule', () => {
  it('starts at one version', () => {
    const draft = newDraft('d1', 'first-line', 'Priya @ Acme', 'hello');
    expect(draft.versions).toHaveLength(1);
    expect(draft.versions[0]).toMatchObject({ n: 1, body: 'hello' });
  });

  it('appends only when the body actually changed', () => {
    const v1 = newDraft('d1', 'first-line', 'Priya @ Acme', 'hello');
    const same = appendVersion(v1, 'hello');
    expect(same).toBe(v1);
    expect(same.versions).toHaveLength(1);

    const v2 = appendVersion(v1, 'hello there');
    expect(v2).not.toBe(v1);
    expect(v2.versions.map((v) => v.n)).toEqual([1, 2]);
    expect(v1.versions).toHaveLength(1); // the input draft is never mutated
  });

  it('fills an empty, never-run v1 in place instead of opening the ladder with a blank rung', () => {
    const empty = newDraft('d1', 'first-line', 'Priya @ Acme');
    const filled = appendVersion(empty, 'subject: your q3 hiring');
    expect(filled.versions).toHaveLength(1);
    expect(filled.versions[0]).toMatchObject({ n: 1, body: 'subject: your q3 hiring' });
    // once that version has been run, it is a real rung and the next edit appends
    filled.versions[0].run = runWith([['r-trigger', 0.5]]);
    expect(appendVersion(filled, 'something else').versions.map((v) => v.n)).toEqual([1, 2]);
  });

  it('compares trimmed, so whitespace alone is not a new version', () => {
    const draft = newDraft('d1', 'first-line', 't', 'line one\n');
    expect(appendVersion(draft, '  line one  ')).toBe(draft);
    expect(appendVersion(draft, 'line one\nline two').versions).toHaveLength(2);
  });

  it('caps the ladder at 50 while version numbers keep climbing', () => {
    let draft = newDraft('d1', 'first-line', 't', 'v1');
    for (let i = 2; i <= 60; i++) draft = appendVersion(draft, `v${i}`);
    expect(draft.versions).toHaveLength(MAX_VERSIONS);
    expect(draft.versions[draft.versions.length - 1].n).toBe(60);
    expect(draft.versions[0].n).toBe(11);
    // capping shifts indexes, so lookup must go by n
    expect(findVersion(draft, 60)?.body).toBe('v60');
    expect(findVersion(draft, 3)).toBeUndefined();
  });
});

describe('delta math', () => {
  const rubric = firstLine.rubric; // weights 3, 2, 2, 1

  it('weights the rubric', () => {
    const run = runWith([['r-trigger', 1], ['r-short', 0], ['r-ask', 1], ['r-subject', 0]]);
    expect(overallScore(run, rubric)).toBeCloseTo(5 / 8, 6);
  });

  it('ignores rubric items the run did not score, and clamps out-of-range scores', () => {
    expect(overallScore(runWith([['r-trigger', 0.5]]), rubric)).toBeCloseTo(0.5, 6);
    expect(overallScore(runWith([['r-trigger', 4]]), rubric)).toBe(1);
    expect(overallScore(undefined, rubric)).toBeNull();
    expect(overallScore(runWith([['nope', 1]]), rubric)).toBeNull();
  });

  it('deltas run against the previous SCORED version', () => {
    const draft = draftWith(['a', 'b', 'c']);
    draft.versions[0].run = runWith([['r-trigger', 0.2], ['r-short', 0.2], ['r-ask', 0.2], ['r-subject', 0.2]]);
    draft.versions[2].run = runWith([['r-trigger', 0.7], ['r-short', 0.7], ['r-ask', 0.7], ['r-subject', 0.7]]);
    const ladder = versionLadder(draft, rubric);
    expect(ladder.map((r) => r.n)).toEqual([1, 2, 3]);
    expect(ladder[0].score).toBeCloseTo(0.2, 6);
    expect(ladder[0].delta).toBeNull();
    expect(ladder[1]).toMatchObject({ score: null, delta: null });
    expect(ladder[2].delta).toBeCloseTo(0.5, 6);
    expect(ladderText(draft, rubric)).toBe('v1: 0.20\nv2: not run yet\nv3: 0.70 (+0.50)');
  });
});

describe('drill grading', () => {
  const predict = findDrill(course, 'd-predict-1')!.drill as Extract<Drill, { kind: 'predict' }>;
  const spot = findDrill(course, 'd-spot-1')!.drill as Extract<Drill, { kind: 'spot' }>;

  it('finds a drill and the module that owns it', () => {
    expect(findDrill(course, 'd-predict-2')?.module.id).toBe('sequence');
    expect(findDrill(course, 'nope')).toBeUndefined();
  });

  it('predict: correct only on the documented winner, and always shows the result', () => {
    const right = gradePredict(predict, 1);
    expect(right.correct).toBe(true);
    expect(right.feedback).toContain('31% more opens');
    expect(right.feedback).toContain(predict.why);

    const wrong = gradePredict(predict, 0);
    expect(wrong.correct).toBe(false);
    expect(wrong.feedback).toBe(right.feedback); // wrong answers still reveal the evidence
    expect(gradePredict(predict, '1').correct).toBe(true); // form posts strings
    expect(gradePredict(predict, undefined).correct).toBe(false);
  });

  it('spot: correct only on the flawed segment, flaw revealed either way', () => {
    const flaw = spot.segments[2].flaw;
    expect(gradeSpot(spot, 2)).toEqual({ correct: true, feedback: flaw });
    expect(gradeSpot(spot, 0)).toEqual({ correct: false, feedback: flaw });
    expect(gradeSpot(spot, 99)).toEqual({ correct: false, feedback: flaw });
    expect(gradeSpot(spot, 'x')).toEqual({ correct: false, feedback: flaw });
  });
});

describe('ship prediction lookup', () => {
  it('copies the range off that version\'s run report', () => {
    const draft = draftWith(['a', 'b']);
    draft.versions[1].run = runWith([['r-trigger', 1]], { low: 4, high: 9 });
    expect(predictionFor(draft, 2)).toEqual({ low: 4, high: 9, ran: true });
  });

  it('falls back to 0/0 when that version never ran', () => {
    const draft = draftWith(['a', 'b']);
    expect(predictionFor(draft, 1)).toEqual({ low: 0, high: 0, ran: false });
    expect(predictionFor(draft, 42)).toEqual({ low: 0, high: 0, ran: false });
  });

  it('flags only when reality lands outside the predicted range', () => {
    expect(realityRate(100, 3)).toBe(3);
    expect(realityRate(0, 3)).toBeNull();
    expect(outsideRange(3, 4, 9)).toBe(true);
    expect(outsideRange(10, 4, 9)).toBe(true);
    expect(outsideRange(4, 4, 9)).toBe(false);
    expect(outsideRange(null, 4, 9)).toBe(false);
  });

  it('flags the lever claim plus the rubric claims', () => {
    const run = runWith([['r-trigger', 1]]);
    expect(flaggedClaimIds(run, firstLine as SkillModule)).toEqual(['c1', 'c3', 'c4', 'c2']);
    expect(flagNote(3.04, 4, 9, '%')).toBe('Predicted 4-9%, reality 3%. Re-check the claims behind that call.');
    expect(nextShipId([])).toBe('sh1');
  });
});

describe('run report coercion', () => {
  const body = 'subject: your q3 hiring\n\nPriya — saw you opened 6 SDR roles.\nWe are the leading ramp platform.';
  const ctx = {
    frame: { outcome: 'meetings', context: 'b2b', level: 'some' as const },
    module: firstLine,
    claims: [],
    personas: course.personas,
    metric: course.metric,
    body,
  };

  it('drops blank-line reactions, keeps one bail, and scores every rubric id', () => {
    const report = coerceRunReport(
      {
        personas: [
          {
            personaId: 'priya',
            reactions: [
              { line: 2, text: 'blank line' },
              { line: 99, text: 'off the end' },
              { line: 4, text: 'This is about you.', bailed: true },
              { line: 3, text: 'You know my quarter.', bailed: true },
              { line: 3, text: 'duplicate' },
            ],
          },
          { personaId: 'ghost', reactions: [{ line: 1, text: 'not in the course' }] },
        ],
        scores: [{ rubricId: 'r-trigger', score: 3 }, { rubricId: 'made-up', score: 1, note: 'x' }],
        predicted: { low: 8, high: 2 },
        biggestLever: '',
      },
      ctx,
    );

    expect(report.personas.map((p) => p.personaId)).toEqual(['priya', 'tom', 'lena']);
    expect(report.personas[0].reactions.map((r) => r.line)).toEqual([3, 4]);
    expect(report.personas[0].reactions.filter((r) => r.bailed)).toHaveLength(1);
    expect(report.personas[0].reactions.find((r) => r.line === 4)?.bailed).toBe(true);
    expect(report.personas[1].reactions).toEqual([]);

    expect(report.scores.map((s) => s.rubricId)).toEqual(['r-trigger', 'r-short', 'r-ask', 'r-subject']);
    expect(report.scores[0]).toMatchObject({ score: 1, note: 'not judged' });
    expect(report.scores[1]).toMatchObject({ score: 0.5, note: 'not judged' });

    expect(report.predicted.high).toBeGreaterThanOrEqual(report.predicted.low);
    expect(report.predicted.unit).toBe('%');
    expect(report.predicted.note).toContain('5%');
    expect(report.biggestLever).toBeTruthy();
  });
});

describe('ghost cleanup', () => {
  it('returns one plain sentence', () => {
    expect(cleanGhost('"subject: your q3 hiring"')).toBe('subject: your q3 hiring');
    expect(cleanGhost('```\n- Saw you opened 6 SDR roles.\n```')).toBe('Saw you opened 6 SDR roles.');
    expect(cleanGhost('\n\nWorth a look?\nextra line')).toBe('Worth a look?');
    expect(cleanGhost('')).toBe('');
  });
});
