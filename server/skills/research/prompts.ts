// Prompts for the skills research crew. Every structured prompt states the
// exact TypeScript shape inline and demands ONLY JSON back, so `extractJson`
// always has something to grab.
//
// House voice for anything a LEARNER reads (unit bodies, drill prompts, claim
// text): explain it to a smart 15-year-old, never condescending, no filler.

import type { Angle, Claim, Frame, SourceKind, SourceRef } from '../../../shared/skills';

const VOICE = `VOICE (for anything a learner reads)
- Explain like to a smart 15-year-old who is new to this, never talking down.
- Concrete over abstract: name the number, the line, the move.
- Short sentences. No preamble, no praise, no hedging, no emoji.`;

const ONLY_JSON = 'Respond with ONLY JSON matching this exact TypeScript shape';

function fence(shape: string): string {
  return `${ONLY_JSON}:\n\n${shape.trim()}\n\nNo markdown, no commentary, no code fence — just the JSON.`;
}

export function frameBlock(name: string, frame: Frame): string {
  return `SKILL: ${name}
OUTCOME THEY WANT: ${frame.outcome}
THEIR CONTEXT: ${frame.context}
SELF-RATED LEVEL: ${frame.level}${frame.existingWork ? `\nWORK THEY ALREADY DO:\n${frame.existingWork.slice(0, 2000)}` : ''}`;
}

const ANGLE_SHAPE = `{
  angles: Array<{
    id: string;            // lowercase-kebab slug, unique
    title: string;         // <= 6 words
    parentId?: string;     // omit for a top-level angle; otherwise an id from this same list
    level: "foundation" | "working" | "advanced";
    estSources: number;    // 3-30, how many good sources exist on this
    why?: string;          // ONE line: why this matters for THEIR outcome
  }>;
}`;

// ---------- cartographer ----------

export function cartographerPrompt(name: string, frame: Frame): string {
  return `Map every angle of this skill, the way an expert would break it down for someone
chasing this exact outcome. This is the table of contents for the whole course.

${frameBlock(name, frame)}

RULES
- 5 to 8 TOP-LEVEL angles, each with 0 to 4 sub-angles (parentId = the parent's id). Two levels only.
- Cover the whole surface: who/what to target, the craft itself, the mechanics that decide whether
  the work is even seen, the follow-through, and how to measure and improve.
- Order top-level angles foundation first, advanced last.
- estSources is your honest guess at how much real, findable material exists on that angle.
- Every "why" ties the angle to THEIR outcome, in one line.
- 20 to 35 angles total.

${VOICE}

${fence(ANGLE_SHAPE)}`;
}

export function cartographerCritiquePrompt(name: string, frame: Frame, draft: unknown): string {
  return `You are a skeptical practitioner who has actually done this work for years, reviewing
someone else's map of the skill.

${frameBlock(name, frame)}

THEIR DRAFT MAP
${JSON.stringify(draft)}

YOUR JOB
- What is MISSING that decides real results, and what is OVER-WEIGHTED (textbook filler,
  or three angles where one would do)?
- Add the missing angles. Merge or delete the over-weighted ones. Keep what earns its place.
- Return the MERGED, FINAL map — not a diff, not commentary. Same rules as the draft:
  5-8 top-level angles, two levels, 20-35 angles total, ids unique kebab slugs,
  parentId always an id in this same list.

${VOICE}

${fence(ANGLE_SHAPE)}`;
}

// ---------- scout ----------

export interface ScoutContext {
  name: string;
  frame: Frame;
  angle: Angle;
  siblings: string[];   // titles of the angles being scouted alongside this one
}

export function scoutPrompt(ctx: ScoutContext): string {
  const { angle } = ctx;
  return `You are harvesting the open web for evidence about ONE angle of a skill. Search hard,
read what you find, and come back with sources and the claims they support.

${frameBlock(ctx.name, ctx.frame)}

YOUR ANGLE: ${angle.title} (id: ${angle.id}, level: ${angle.level})
WHY IT MATTERS: ${angle.why ?? '(work it out from the outcome above)'}
OTHER SCOUTS ARE COVERING: ${ctx.siblings.length ? ctx.siblings.join(', ') : '(nothing else)'}
  — stay in your lane; do not return sources that are really about their angles.

HOW TO SEARCH
- Run SEVERAL searches, not one. Explicitly include platform-scoped queries:
  site:reddit.com, site:x.com, site:youtube.com, site:facebook.com, plus plain web
  searches for docs, vendor benchmark reports and practitioner blogs.
- Prefer 2025-2026 material. Older material only when it is the primary/authoritative source.
- Strongly prefer sources with REAL NUMBERS: sample sizes, A/B results, rates, before/after.
- WebFetch anything promising so your quote is real. Never invent a url, a date or a quote.

WHAT TO RETURN
- 5 to 10 sources SPANNING KINDS: aim for at least one each of reddit, x, youtube and a
  doc/blog, plus facebook or a podcast when the angle has them. Do not return 8 blogs.
- kind is what the url actually is: "reddit" | "x" | "youtube" | "blog" | "docs" | "facebook" | "podcast" | "other".
- date: ISO (YYYY-MM-DD or YYYY-MM) if the page states one; omit it rather than guessing.
- why: one line on what this source is good for.
- quote: the single most load-bearing sentence, verbatim from the page.
- hasRealNumbers: true only if the source states an actual measured number.
- claims: 4 to 10 candidate claims this angle's sources support. Each claim is ONE plain
  sentence a learner could act on, with the urls (from your own list) that back it.
  A claim states what WORKS and roughly how much, not "it depends".

${VOICE}

${fence(`{
  sources: Array<{ url: string; kind: string; title: string; date?: string; why: string; quote?: string; hasRealNumbers: boolean }>;
  claims: Array<{ text: string; sourceUrls: string[]; quote?: string }>;
}`)}`;
}

export const JSON_NUDGE = 'Return ONLY the JSON object described above. No prose, no fence, nothing else.';

// ---------- assessor ----------

export interface AssessSourceInput {
  id: string;
  kind: SourceKind;
  title: string;
  url: string;
  date?: string;
  angle: string;
  text: string;
}

const KIND_PRIORS = 'docs .9 · user .9 · blog .6 · reddit .5 · x .5 · youtube .5 · podcast .5 · facebook .35 · other .4';

export function assessSourcesPrompt(items: AssessSourceInput[]): string {
  const block = items
    .map((s) => `--- ${s.id}
kind: ${s.kind}   date: ${s.date ?? 'unknown'}   angle: ${s.angle}
title: ${s.title}
url: ${s.url}
text:
${s.text.slice(0, 1500) || '(nothing fetched — judge from the title and url alone)'}`)
    .join('\n\n');

  return `Judge how much each source can be trusted. Be hard to impress and hard to fool.

SOURCES
${block}

REPUTATION (0-1): who is talking and how much weight their word carries.
Start from the kind prior — ${KIND_PRIORS} — then MOVE IT for what you actually see:
first-hand operator with a track record up, anonymous rehash down, primary/official docs up.

SOUNDNESS (0-1): is the reasoning any good? Consider mechanism (do they explain WHY it works),
evidence (numbers vs vibes), sample size, self-promotion (a vendor selling the conclusion),
and survivorship (one winner's story presented as the rule).

ALSO
- hasRealNumbers: true only if the text states a measured number.
- note: ONE line of judgement, e.g. "Large sample but the vendor sells the fix."
- date: fill it in ONLY if the text itself states a publication date and the header above said unknown.

${fence(`{ sources: Array<{ id: string; reputation: number; soundness: number; hasRealNumbers: boolean; note: string; date?: string }> }`)}`;
}

export interface TagClaimInput { i: number; text: string; angle: string; kinds: SourceKind[] }

export function tagClaimsPrompt(name: string, frame: Frame, items: TagClaimInput[]): string {
  const block = items.map((c) => `${c.i}. [${c.angle}] (${c.kinds.join(', ') || 'no sources'}) ${c.text}`).join('\n');
  return `Tidy and tag candidate claims harvested about "${name}".

THEIR OUTCOME: ${frame.outcome}
THEIR CONTEXT: ${frame.context}

CLAIMS
${block}

FOR EACH CLAIM
- text: rewrite as ONE plain sentence a learner can act on. Keep any real number in it.
  Drop hedging ("it depends", "some say"). Do not invent numbers that are not already there.
- contextTags: 1-4 short lowercase tags saying WHERE this holds — the situation, audience or
  stage it was measured in (e.g. "b2b", "first-touch", "small-list"). Tags, not sentences.
- drop: true if the claim is empty, a tautology, or pure advertising.

${VOICE}

${fence(`{ claims: Array<{ i: number; text: string; contextTags: string[]; drop?: boolean }> }`)}`;
}

// ---------- reconciler ----------

export interface ReconcileInput { i: number; text: string; angleId: string; sourceIds: string[] }

export function reconcilerPrompt(items: ReconcileInput[], sources: SourceRef[]): string {
  const claims = items.map((c) => `${c.i}. [${c.angleId}] ${c.text}  <- ${c.sourceIds.join(',')}`).join('\n');
  const srcs = sources.map((s) => `${s.id} (${s.kind}, rep ${s.reputation.toFixed(2)}) ${s.title}`).join('\n');
  return `Reconcile a pile of candidate claims into a clean evidence set.

SOURCES
${srcs}

CANDIDATE CLAIMS (index. [angle] text <- source ids)
${claims}

DO THIS
1. CLUSTER near-duplicates — claims saying the same thing in different words become ONE claim.
   Its sourceIds are the union of the members'. Keep the clearest wording, keep the numbers.
2. CONTRADICTIONS: when sources genuinely disagree, emit ONE claim stating the majority position
   and set contested = true with sides.for (source ids that support it) and sides.against
   (source ids that contradict it). Never silently drop the minority.
3. Keep each claim tied to the angle most of its sources belong to.
4. Do not invent claims, sources, or numbers. Every sourceId must come from the list above.

${VOICE}

${fence(`{
  claims: Array<{
    text: string;
    angleId: string;
    sourceIds: string[];
    contested?: boolean;
    sides?: { for: string[]; against: string[] };
  }>;
}`)}`;
}

// ---------- architect ----------

export interface ArchitectContext {
  name: string;
  frame: Frame;
  angles: Angle[];
  claims: Claim[];
}

function claimLines(claims: Claim[]): string {
  return claims.map((c) => `${c.id} [${c.angleId}] (${c.verdict}, ${c.confidence.toFixed(2)}) ${c.text}`).join('\n');
}

export function architectPlanPrompt(ctx: ArchitectContext): string {
  return `Plan the modules of a course built ONLY from the evidence below.

${frameBlock(ctx.name, ctx.frame)}

ANGLES
${ctx.angles.map((a) => `- ${a.id}: ${a.title}${a.parentId ? ` (under ${a.parentId})` : ''}`).join('\n')}

CLAIMS
${claimLines(ctx.claims)}

RULES
- 3 to 6 modules. Each is a sub-skill the learner can practise on its own.
- Order foundation -> advanced: module 1 is the thing that changes results fastest.
- angleIds: which angles that module covers (ids from the list, no invention).
- id: lowercase-kebab slug. title: <= 5 words.

${VOICE}

${fence(`{ modules: Array<{ id: string; title: string; angleIds: string[] }> }`)}`;
}

export interface ModuleContext extends ArchitectContext {
  moduleId: string;
  moduleTitle: string;
  moduleClaims: Claim[];
  numberSources: Array<{ id: string; title: string; quote?: string; url: string }>;
  personaHint: string[];
}

export function architectModulePrompt(ctx: ModuleContext): string {
  return `Build ONE module of the course. Everything you write must trace back to the claims below.

${frameBlock(ctx.name, ctx.frame)}

MODULE: ${ctx.moduleTitle} (id: ${ctx.moduleId})

CLAIMS AVAILABLE TO THIS MODULE
${claimLines(ctx.moduleClaims)}

SOURCES WITH REAL DOCUMENTED NUMBERS (the only ones a predict drill may cite)
${ctx.numberSources.length
    ? ctx.numberSources.map((s) => `${s.id}: ${s.title}\n   ${s.quote ?? ''}`).join('\n')
    : '(none — then emit NO predict drill)'}

PERSONAS THE LEARNER WILL WRITE FOR: ${ctx.personaHint.join(', ') || '(none yet)'}

WHAT TO WRITE
- concepts: 2 to 4. A concept LABEL is the idea as a claim ("a trigger is why you are relevant
  today"), not a topic name. mastery 0, cleared false, source "unseen".
- units: for each concept ONE "card" (bodyMd UNDER 120 WORDS) then, after all cards, ONE "check"
  per concept (3-4 options, answerIndex, explain <= 30 words citing a claim id).
  Unit ids are slugs prefixed with the module id, e.g. "${ctx.moduleId}-u1".
- unitClaims: unitId -> the claim ids that unit rests on (chips the learner can open).
- rubric: 3 to 5 items. Each cites claimIds and carries weight 1-3. Ids like "r-trigger".
- drills: ALL FOUR kinds where the evidence allows, ids prefixed with the module id:
  * "predict": a real documented A/B from ONE of the number-sources above. Two options,
    winner index, result = what actually happened (with the number), why = one line. Set sourceId.
    OMIT this drill entirely if no number-source fits — never invent a result.
  * "sprint": a prompt, a quota (3-5) and seconds (60-120), rubricIds from this module's rubric.
  * "spot": a realistic artifact in 4 to 6 segments where EXACTLY ONE segment has a "flaw"
    (one line saying what is wrong) and claimIds explaining it. The other segments are clean.
  * "rewrite": one short original plus fromPersona/toPersona (ids from the persona list above),
    rubricIds from this module's rubric.

${VOICE}

${fence(`{
  concepts: Array<{ id: string; label: string; mastery: 0; cleared: false; source: "unseen" }>;
  units: Array<
    | { kind: "card"; id: string; conceptId: string; title: string; bodyMd: string }
    | { kind: "check"; id: string; conceptId: string; question: string; options: string[]; answerIndex: number; explain: string }
  >;
  unitClaims: Record<string, string[]>;
  rubric: Array<{ id: string; label: string; claimIds: string[]; weight: number }>;
  drills: Array<
    | { kind: "predict"; id: string; prompt: string; options: [string, string]; winner: 0 | 1; result: string; why: string; claimIds: string[]; sourceId: string }
    | { kind: "sprint"; id: string; prompt: string; quota: number; seconds: number; rubricIds: string[] }
    | { kind: "spot"; id: string; segments: Array<{ text: string; flaw?: string; claimIds?: string[] }> }
    | { kind: "rewrite"; id: string; original: string; fromPersona: string; toPersona: string; rubricIds: string[] }
  >;
}`)}`;
}

export function architectExtrasPrompt(ctx: ArchitectContext, sources: SourceRef[]): string {
  return `Build the simulated audience and the yardstick for this skill, from the corpus only.

${frameBlock(ctx.name, ctx.frame)}

CLAIMS
${claimLines(ctx.claims)}

SOURCES
${sources.map((s) => `${s.id} (${s.kind}) ${s.title}${s.quote ? ` — "${s.quote.slice(0, 160)}"` : ''}`).join('\n')}

WRITE
- personas: EXACTLY 3 people on the receiving end of this work, built from what the sources say
  real recipients do. name like "Priya, VP Sales". role: one line. bio: 2 lines about how they
  actually behave (what makes them stop reading, what makes them reply). sourceIds: what they are made of.
- exemplars: 1 to 3 short, realistic, anonymized high-performing examples. why: one line
  annotation citing claim ids.
- metric: the one number that says whether this is working — name, unit, and the corpus median
  you actually saw in the claims (a number, not a guess).

${VOICE}

${fence(`{
  personas: Array<{ id: string; name: string; role: string; bio: string; sourceIds: string[] }>;
  exemplars: Array<{ id: string; title: string; body: string; why: string; sourceId?: string }>;
  metric: { name: string; unit: string; corpusMedian: number };
}`)}`;
}

// ---------- freshness ----------

export function freshnessPrompt(name: string, angle: Angle, claims: Claim[]): string {
  return `Check whether the evidence on one angle of "${name}" has been overtaken.

ANGLE: ${angle.title} (${angle.id})
TODAY: ${new Date().toISOString().slice(0, 10)}

CLAIMS WE HOLD (id, newest supporting source we have)
${claims.map((c) => `${c.id} (newest ${c.newest ?? 'unknown'}) ${c.text}`).join('\n')}

Search for the NEWEST credible material on this angle. For each claim tell us the date of the
newest source you can find that speaks to it, and whether that source still agrees.
Dates ISO (YYYY-MM-DD or YYYY-MM). If you find nothing newer, return newest: null.

${fence(`{ claims: Array<{ id: string; newest: string | null; stillHolds: boolean; note?: string }> }`)}`;
}
