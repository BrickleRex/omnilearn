// Deterministic cold-email corpus for LLM_MOCK=1. The e2e suite depends on the
// ids and copy in here — change them together with e2e/skills.spec.ts.
// Both backend routers import from this file; neither owns it (integrator does).

import type {
  AngleMap, Claim, Course, Draft, DrillAttempt, Frame, RunReport, SourceRef, CalibrationGradeRes, HintRes, GhostRes,
} from '../../shared/skills';

export const MOCK_SKILL_NAME = 'Cold email';

export function mockMap(_frame: Frame): AngleMap {
  return {
    angles: [
      { id: 'targeting', title: 'Who to email', level: 'foundation', kept: true, estSources: 14, why: 'A perfect email to the wrong person is spam.' },
      { id: 'icp', title: 'Ideal customer profile', parentId: 'targeting', level: 'foundation', kept: true, estSources: 6 },
      { id: 'triggers', title: 'Timing triggers', parentId: 'targeting', level: 'working', kept: true, estSources: 8 },
      { id: 'copy', title: 'Writing the email', level: 'foundation', kept: true, estSources: 22, why: 'The words decide the reply.' },
      { id: 'subject', title: 'Subject lines', parentId: 'copy', level: 'foundation', kept: true, estSources: 9 },
      { id: 'opener', title: 'First line', parentId: 'copy', level: 'foundation', kept: true, estSources: 7 },
      { id: 'cta', title: 'The ask', parentId: 'copy', level: 'working', kept: true, estSources: 6 },
      { id: 'deliverability', title: 'Landing in the inbox', level: 'working', kept: true, estSources: 11, why: 'Unread emails cannot get replies.' },
      { id: 'warmup', title: 'Domain warm-up', parentId: 'deliverability', level: 'working', kept: true, estSources: 5 },
      { id: 'followups', title: 'Follow-up sequences', level: 'working', kept: true, estSources: 9 },
      { id: 'metrics', title: 'Measuring and iterating', level: 'advanced', kept: true, estSources: 6 },
    ],
  };
}

export function mockSources(): SourceRef[] {
  return [
    { id: 's1', url: 'https://www.reddit.com/r/sales/comments/abc/cold_email_reply_rates/', kind: 'reddit', title: 'What reply rates are you actually seeing? (r/sales)', date: '2026-05-12', angleIds: ['metrics', 'copy'], reputation: 0.55, soundness: 0.6, hasRealNumbers: true, quote: 'Across 4k sends we sit at 6-8% replies when the first line is about them, 2% when it is about us.', note: 'Practitioner thread with numbers; self-reported.', fetched: 'full' },
    { id: 's2', url: 'https://x.com/example/status/1', kind: 'x', title: 'Thread: 12 subject lines A/B tested', date: '2026-07-02', angleIds: ['subject'], reputation: 0.6, soundness: 0.7, hasRealNumbers: true, quote: 'Lowercase, 2-4 word subjects beat title-case by 31% opens over 9k sends.', note: 'Real A/B with sample size.', fetched: 'full' },
    { id: 's3', url: 'https://blog.example.com/cold-email-benchmarks-2026', kind: 'blog', title: 'Cold email benchmarks 2026 (12M emails)', date: '2026-03-20', angleIds: ['metrics', 'followups', 'copy'], reputation: 0.8, soundness: 0.8, hasRealNumbers: true, quote: 'Median reply rate 5.1%. Sequences of 3-4 emails earn 2x the replies of a single send.', note: 'Vendor data, large sample, some self-promo.', fetched: 'full' },
    { id: 's4', url: 'https://www.youtube.com/watch?v=xyz', kind: 'youtube', title: 'I sent 10,000 cold emails — what worked', date: '2026-01-15', angleIds: ['opener', 'cta'], reputation: 0.5, soundness: 0.55, hasRealNumbers: true, quote: 'Asking for "a quick call" got half the replies of asking a yes/no question.', note: 'Transcript; anecdotal but concrete.', fetched: 'full' },
    { id: 's5', url: 'https://www.facebook.com/groups/coldemailers/posts/123', kind: 'facebook', title: 'Warm-up schedule that kept us out of spam', date: '2025-11-03', angleIds: ['warmup', 'deliverability'], reputation: 0.4, soundness: 0.4, hasRealNumbers: false, quote: 'Ramp 5→40 sends a day over three weeks.', note: 'Snippet only (login wall).', fetched: 'snippet' },
    { id: 's6', url: 'https://docs.example.com/google-bulk-sender-rules', kind: 'docs', title: 'Bulk sender requirements (SPF, DKIM, DMARC)', date: '2026-02-01', angleIds: ['deliverability'], reputation: 0.95, soundness: 0.95, hasRealNumbers: false, quote: 'Senders must authenticate with SPF, DKIM and DMARC and keep spam rates under 0.3%.', note: 'Primary source.', fetched: 'full' },
    { id: 's7', url: 'https://blog.example.com/personalization-is-dead', kind: 'blog', title: 'Personalization is dead, relevance is not', date: '2026-06-11', angleIds: ['opener', 'icp'], reputation: 0.65, soundness: 0.6, hasRealNumbers: false, quote: 'Compliments about their podcast do nothing; naming the trigger that makes you relevant does.', note: 'Opinion piece from an operator.', fetched: 'full' },
    { id: 's8', url: 'https://www.reddit.com/r/Entrepreneur/comments/def/long_emails_win/', kind: 'reddit', title: 'Long, detailed emails outperform short ones for us', date: '2024-09-30', angleIds: ['copy'], reputation: 0.45, soundness: 0.35, hasRealNumbers: false, quote: 'Our 250-word emails do better than 60-word ones.', note: 'Contradicts the majority; small shop, no numbers.', fetched: 'full' },
  ];
}

export function mockClaims(): Claim[] {
  return [
    { id: 'c1', angleId: 'opener', text: 'A first line about THEM (their trigger) beats a first line about you, roughly 3x on replies.', verdict: 'solid', confidence: 0.86, sourceIds: ['s1', 's7', 's4'], newest: '2026-07-02', contextTags: ['b2b', 'first-touch'], consensus: { reddit: 'agree', blog: 'agree', youtube: 'agree' } },
    { id: 'c2', angleId: 'subject', text: 'Short lowercase subjects (2-4 words) out-open title-case subjects.', verdict: 'likely', confidence: 0.72, sourceIds: ['s2'], newest: '2026-07-02', contextTags: ['b2b'], consensus: { x: 'agree' } },
    { id: 'c3', angleId: 'copy', text: 'Emails under ~80 words get more replies than long ones.', verdict: 'contested', confidence: 0.61, sourceIds: ['s3', 's1', 's8'], newest: '2026-05-12', contextTags: ['b2b'], sides: { for: ['s3', 's1'], against: ['s8'] }, consensus: { blog: 'agree', reddit: 'mixed' } },
    { id: 'c4', angleId: 'cta', text: 'A yes/no question as the ask beats "got 15 minutes for a call?".', verdict: 'likely', confidence: 0.7, sourceIds: ['s4', 's1'], newest: '2026-05-12', contextTags: ['first-touch'], consensus: { youtube: 'agree', reddit: 'agree' } },
    { id: 'c5', angleId: 'followups', text: 'A 3-4 email sequence roughly doubles replies versus a single send.', verdict: 'solid', confidence: 0.84, sourceIds: ['s3', 's1'], newest: '2026-05-12', contextTags: ['b2b'], consensus: { blog: 'agree', reddit: 'agree' } },
    { id: 'c6', angleId: 'deliverability', text: 'SPF, DKIM and DMARC are mandatory; without them bulk mail is filtered.', verdict: 'solid', confidence: 0.97, sourceIds: ['s6'], newest: '2026-02-01', contextTags: ['deliverability'], consensus: { docs: 'agree' } },
    { id: 'c7', angleId: 'warmup', text: 'Ramp a new domain from ~5 to ~40 sends a day over three weeks.', verdict: 'stale', confidence: 0.4, sourceIds: ['s5'], newest: '2025-11-03', contextTags: ['deliverability'], consensus: { facebook: 'agree' } },
    { id: 'c8', angleId: 'metrics', text: 'A median cold-email reply rate is about 5%; 8%+ is very good.', verdict: 'solid', confidence: 0.8, sourceIds: ['s3', 's1'], newest: '2026-05-12', contextTags: ['b2b'], consensus: { blog: 'agree', reddit: 'agree' } },
  ];
}

export function mockCourse(): Course {
  return {
    metric: { name: 'reply rate', unit: '%', corpusMedian: 5 },
    personas: [
      { id: 'priya', name: 'Priya, VP Sales', role: 'Buys tools for a 40-rep team', bio: 'Gets 60 cold emails a week and reads the first line only. Replies to people who clearly know her quarter.', sourceIds: ['s1', 's7'] },
      { id: 'tom', name: 'Tom, founder', role: 'Runs a 6-person startup', bio: 'Skims on his phone. Anything that smells templated is archived on the spot.', sourceIds: ['s4', 's8'] },
      { id: 'lena', name: 'Lena, ops lead', role: 'Owns vendor selection', bio: 'Suspicious of hype, likes a concrete yes/no question she can forward.', sourceIds: ['s3', 's4'] },
    ],
    exemplars: [
      { id: 'x1', title: 'Trigger-led first touch', body: 'subject: your q3 hiring\n\nPriya — saw you opened 6 SDR roles this month. Ramp usually takes 90 days; we cut it to 30 at two teams your size.\n\nWorth a look at how, or is ramp not the bottleneck right now?', why: 'First line names her trigger (c1); short (c3); yes/no ask (c4); lowercase subject (c2).', sourceId: 's1' },
    ],
    modules: [
      {
        id: 'first-line', title: 'The first line', angleIds: ['opener', 'subject', 'icp'], status: 'current',
        concepts: [
          { id: 'trigger', label: 'a trigger is why you are relevant today', mastery: 0, cleared: false, source: 'unseen' },
          { id: 'them-not-you', label: 'open about them, not you', mastery: 0, cleared: false, source: 'unseen' },
        ],
        units: [
          { kind: 'card', id: 'u1', conceptId: 'trigger', title: 'Triggers', bodyMd: 'A **trigger** is the thing that happened in their world that makes your email make sense *today*: a hire, a launch, a funding round. Name it in the first line and you are not a stranger, you are someone paying attention.' },
          { kind: 'check', id: 'u2', conceptId: 'trigger', question: 'Which first line names a trigger?', options: ['I love your podcast!', 'Saw you opened 6 SDR roles this month.', 'We are the leading ramp platform.', 'No idea yet'], answerIndex: 1, explain: 'A trigger is an event in their world, not a compliment or your pitch.' },
          { kind: 'card', id: 'u3', conceptId: 'them-not-you', title: 'Them, not you', bodyMd: 'Readers decide in one line. If that line is about you ("we help companies…") it reads as an ad. If it is about them, it reads as a note from someone who did their homework.' },
          { kind: 'check', id: 'u4', conceptId: 'them-not-you', question: 'Why does "we help companies grow" lose?', options: ['Too short', 'It is about you, not them', 'No emoji', 'No idea yet'], answerIndex: 1, explain: 'Claim c1: first lines about them beat first lines about you about 3x.' },
        ],
        unitClaims: { u1: ['c1'], u2: ['c1'], u3: ['c1', 'c2'], u4: ['c1'] },
        rubric: [
          { id: 'r-trigger', label: 'Names a trigger', claimIds: ['c1'], weight: 3 },
          { id: 'r-short', label: 'Under 80 words', claimIds: ['c3'], weight: 2 },
          { id: 'r-ask', label: 'Yes/no ask', claimIds: ['c4'], weight: 2 },
          { id: 'r-subject', label: 'Short lowercase subject', claimIds: ['c2'], weight: 1 },
        ],
        drills: [
          { kind: 'predict', id: 'd-predict-1', moduleId: 'first-line', prompt: 'Two subject lines went out to 9,000 people. Which won?', options: ['Quick Question About Your Hiring Plans', 'your q3 hiring'], winner: 1, result: '31% more opens for the lowercase one.', why: 'Short lowercase subjects read like a colleague, not a campaign.', claimIds: ['c2'], sourceId: 's2' },
          { kind: 'sprint', id: 'd-sprint-1', moduleId: 'first-line', prompt: 'Write 3 first lines for Priya (VP Sales, just opened 6 SDR roles). Each names the trigger.', quota: 3, seconds: 60, rubricIds: ['r-trigger'] },
          { kind: 'spot', id: 'd-spot-1', moduleId: 'first-line', segments: [ { text: 'subject: your q3 hiring' }, { text: 'Priya — saw you opened 6 SDR roles this month.' }, { text: 'We are the leading SDR ramp platform trusted by 500 companies.', flaw: 'This line is about you. Cut it or turn it into her outcome.', claimIds: ['c1'] }, { text: 'Worth a look, or is ramp not the bottleneck right now?' } ] },
          { kind: 'rewrite', id: 'd-rewrite-1', moduleId: 'first-line', original: 'Priya — saw you opened 6 SDR roles this month. Ramp usually takes 90 days; we cut it to 30.', fromPersona: 'priya', toPersona: 'tom', rubricIds: ['r-trigger', 'r-short'] },
        ],
      },
      {
        id: 'sequence', title: 'Follow-ups and deliverability', angleIds: ['followups', 'deliverability', 'warmup'], status: 'todo',
        concepts: [ { id: 'sequence', label: 'a sequence is 3-4 short touches, not one email', mastery: 0, cleared: false, source: 'unseen' } ],
        units: [
          { kind: 'card', id: 'u5', conceptId: 'sequence', title: 'Sequences', bodyMd: 'One email is a coin flip. Three or four short touches, each adding one new reason, roughly **double** replies. Never "just bumping this".' },
          { kind: 'check', id: 'u6', conceptId: 'sequence', question: 'Best follow-up?', options: ['Just bumping this!', 'One new reason, two lines', 'Resend the same email', 'No idea yet'], answerIndex: 1, explain: 'Claim c5: sequences win because each touch adds something.' },
        ],
        unitClaims: { u5: ['c5'], u6: ['c5'] },
        rubric: [ { id: 'r-new-reason', label: 'Adds a new reason', claimIds: ['c5'], weight: 3 } ],
        drills: [
          { kind: 'predict', id: 'd-predict-2', moduleId: 'sequence', prompt: 'Single send vs a 4-email sequence, same list. Which got more total replies?', options: ['Single send', '4-email sequence'], winner: 1, result: 'About 2x the replies for the sequence.', why: 'Most replies come on touch 2-3.', claimIds: ['c5'], sourceId: 's3' },
        ],
      },
    ],
  };
}

// ---------- practice-side fixtures ----------

export function mockRun(body: string): RunReport {
  const lines = body.split('\n');
  const aboutUs = lines.findIndex((l) => /\b(we are|we're|leading|trusted by)\b/i.test(l));
  const hasTrigger = /\b(saw|noticed|opened|launched|raised|hired|hiring)\b/i.test(body);
  const short = body.trim().split(/\s+/).length <= 80;
  const yesNo = /\?\s*$/.test(body.trim()) && !/15 min/i.test(body);
  const low = 2 + (hasTrigger ? 2 : 0) + (short ? 1 : 0) + (yesNo ? 1 : 0) - (aboutUs >= 0 ? 2 : 0);
  const react = (id: string, bail: boolean) => ({
    personaId: id,
    reactions: lines.map((l, i) => ({
      line: i + 1,
      text: i === aboutUs ? 'This is about you. I stopped reading here.' : hasTrigger && i === 0 ? 'You know my quarter. Keep going.' : 'Fine.',
      ...(bail && i === aboutUs ? { bailed: true } : {}),
    })).filter((r) => lines[r.line - 1].trim()),
  });
  return {
    at: new Date().toISOString(),
    personas: [react('priya', true), react('tom', aboutUs >= 0), react('lena', false)],
    scores: [
      { rubricId: 'r-trigger', score: hasTrigger ? 0.9 : 0.2, note: hasTrigger ? 'Names the trigger (c1).' : 'No trigger named — why today? (c1)' },
      { rubricId: 'r-short', score: short ? 0.9 : 0.3, note: short ? 'Under 80 words (c3).' : 'Too long for a phone skim (c3).' },
      { rubricId: 'r-ask', score: yesNo ? 0.8 : 0.3, note: yesNo ? 'Yes/no ask (c4).' : 'Ask a yes/no question instead (c4).' },
      { rubricId: 'r-subject', score: /^subject:\s*[a-z0-9 ]{3,24}$/m.test(body) ? 0.9 : 0.4, note: 'Short lowercase subjects open more (c2).' },
    ],
    predicted: { low: Math.max(1, low), high: Math.max(2, low + 3), unit: '%', note: 'Model of the audience, not the audience. Corpus median 5%.' },
    biggestLever: aboutUs >= 0 ? `Line ${aboutUs + 1} is about you — cut it (c1).` : hasTrigger ? 'Tighten the ask to a yes/no question (c4).' : 'Open with their trigger, not your pitch (c1).',
  };
}

export function mockHint(body: string, level: 'step' | 'composite'): HintRes {
  const lines = body.split('\n');
  const aboutUs = lines.findIndex((l) => /\b(we are|we're|leading|trusted by)\b/i.test(l));
  const flag = aboutUs >= 0 ? { line: aboutUs + 1, note: 'This line is about you, not them. Readers bail here (c1).' } : undefined;
  if (!/subject:/i.test(body)) return { hint: level === 'step' ? 'Start with a subject line: 2-4 lowercase words about their world (c2).' : 'Subject → trigger line → one outcome → yes/no ask. Four lines, under 80 words.', flag };
  if (!/\b(saw|noticed|opened|launched|raised|hired|hiring)\b/i.test(body)) return { hint: 'First line: name the trigger — what happened in their world this month (c1).', flag };
  if (!/\?/.test(body)) return { hint: 'End with a yes/no question they can answer from their phone (c4).', flag };
  return { hint: 'Looks complete. Run it against the panel, then cut any word that is about you.', flag };
}

export function mockGhost(body: string): GhostRes {
  if (!/subject:/i.test(body)) return { text: 'subject: your q3 hiring' };
  if (!/\b(saw|noticed|opened)\b/i.test(body)) return { text: 'Priya — saw you opened 6 SDR roles this month.' };
  return { text: 'Worth a look, or is ramp not the bottleneck right now?' };
}

export function mockGrade(_emails: string): CalibrationGradeRes {
  return {
    scores: [
      { rubricId: 'r-trigger', score: 0.3, note: 'None of these name a trigger.' },
      { rubricId: 'r-short', score: 0.8, note: 'Good length.' },
      { rubricId: 'r-ask', score: 0.4, note: 'Asks for a call instead of a yes/no.' },
    ],
    summary: 'Short and polite, but every first line is about you. Start with their trigger.',
  };
}

/** Sprint + rewrite grading (the LLM panel in real mode). */
export function mockDrillFeedback(kind: 'sprint' | 'rewrite', answer: unknown): Pick<DrillAttempt, 'feedback' | 'scores'> {
  if (kind === 'sprint') {
    const lines = Array.isArray(answer) ? (answer as string[]).filter((s) => s.trim()) : [];
    const withTrigger = lines.filter((l) => /\b(saw|noticed|opened|hiring|roles)\b/i.test(l)).length;
    return { feedback: `${lines.length} lines, ${withTrigger} name the trigger. ${withTrigger === lines.length ? 'Every one lands.' : 'The rest read like compliments — say what happened.'}`, scores: [{ rubricId: 'r-trigger', score: lines.length ? withTrigger / lines.length : 0 }] };
  }
  const text = String(answer ?? '');
  const short = text.split(/\s+/).length <= 40;
  return { feedback: short ? 'Tom would read this on his phone. Good.' : 'Tom skims on his phone — halve it.', scores: [{ rubricId: 'r-short', score: short ? 0.9 : 0.4 }, { rubricId: 'r-trigger', score: /\b(saw|noticed|opened)\b/i.test(text) ? 0.9 : 0.3 }] };
}

export function mockChatReply(message: string): string {
  return `Short answer: ${message.trim().replace(/\?+$/, '')} comes down to the first line — name their trigger (c1), then ask a yes/no (c4).`;
}

export const mockStarterDraft: Pick<Draft, 'title'> & { body: string } = {
  title: 'Priya @ Acme — first touch',
  body: '',
};
