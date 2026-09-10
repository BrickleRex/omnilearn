// Skills track contract — server and client both build on this. Builder agents:
// treat as frozen; additive changes only, noted in your report.
// Data lives under data/skills/<slug>/ (see SPEC-SKILLS.md).

import type { Concept, PrimerUnit } from './types';

export type SkillPhase =
  | 'framing' | 'mapping' | 'researching' | 'calibrating' | 'learning' | 'practicing' | 'making';

export type AngleLevel = 'foundation' | 'working' | 'advanced';

export interface Angle {
  id: string;            // slug
  title: string;         // <= 6 words
  parentId?: string;     // sub-angles hang off an angle
  level: AngleLevel;
  kept: boolean;         // pruning = false
  estSources: number;    // cartographer's guess, shown on the ladder
  why?: string;          // one line: why this angle matters for the frame
  scope?: 'niche' | 'general'; // additive: niche-specific angle vs a general rule applied to the niche
}
export interface AngleMap { angles: Angle[] }

export interface Frame {
  outcome: string;       // "5 qualified meetings a month"
  context: string;       // "B2B SaaS, $0 budget, sent ~50 cold emails ever"
  level: 'new' | 'some' | 'experienced';
  existingWork?: string; // optional paste: their last few emails
  // Additive: the long-tail target. When present the crew searches wide-to-narrow
  // (general craft → adjacent fields → this exact niche) and niche evidence wins.
  target?: SkillTarget;
}
export interface SkillTarget {
  who: string;           // "executives (CEO/COO/CFO) at insurance firms"
  industry: string;      // "insurance (carriers, brokers, MGAs)"
  where: string;         // "United States"
  deal: string;          // "high-ticket, $50k+ annual"
  different: string;     // one line: what makes this niche unlike the generic skill
}

/** How close a source or claim is to the frame's target. */
export type Specificity = 'niche' | 'adjacent' | 'general';

// ---------- corpus ----------
export type SourceKind = 'reddit' | 'youtube' | 'blog' | 'x' | 'facebook' | 'docs' | 'podcast' | 'user' | 'other';

export interface SourceRef {
  id: string;
  url: string;
  kind: SourceKind;
  title: string;
  date?: string;         // ISO if known
  angleIds: string[];
  reputation: number;    // 0..1 (assessor)
  soundness: number;     // 0..1 (assessor): mechanism, evidence, sample, no self-promo
  hasRealNumbers: boolean;
  quote?: string;        // the most load-bearing excerpt
  note?: string;         // assessor's one-line judgement
  fetched: 'full' | 'partial' | 'snippet' | 'failed'; // facebook is typically 'snippet'
  specificity?: Specificity; // additive (assessor): how close to the frame's target
  relevance?: number;        // additive (assessor): 0..1 fit to the target; feeds confidence
}

export type Verdict = 'solid' | 'likely' | 'contested' | 'stale';

export interface Claim {
  id: string;            // e.g. "c12"
  angleId: string;
  text: string;          // the claim as a plain sentence
  verdict: Verdict;
  confidence: number;    // 0..1 = f(reputation, recency, soundness, consensus)
  sourceIds: string[];
  newest?: string;       // ISO date of the newest supporting source
  contextTags: string[]; // e.g. ["b2b", "saas", "first-touch"]
  sides?: { for: string[]; against: string[] }; // present iff contested
  // consensus grid cell per source kind: agree / disagree / mixed / silent
  consensus: Partial<Record<SourceKind, 'agree' | 'disagree' | 'mixed'>>;
  specificity?: Specificity; // additive: niche = about this target; general = a rule of the wider skill
  relevance?: number;        // additive: 0..1 fit to the target
}

// ---------- course ----------
export interface RubricItem { id: string; label: string; claimIds: string[]; weight: number }

export interface Persona {
  id: string;
  name: string;          // "Priya, VP Sales"
  role: string;
  bio: string;           // 2 lines, built from the corpus
  sourceIds: string[];   // what she is made of
}

export interface Exemplar {
  id: string;
  title: string;
  body: string;          // a real (anonymized) high-performing example
  why: string;           // annotation: why it works, citing claim ids
  sourceId?: string;
}

export type Drill =
  | { kind: 'predict'; id: string; moduleId: string; prompt: string; options: [string, string]; winner: 0 | 1; result: string; why: string; claimIds: string[]; sourceId: string }
  | { kind: 'sprint'; id: string; moduleId: string; prompt: string; quota: number; seconds: number; rubricIds: string[] }
  | { kind: 'spot'; id: string; moduleId: string; segments: Array<{ text: string; flaw?: string; claimIds?: string[] }> }
  | { kind: 'rewrite'; id: string; moduleId: string; original: string; fromPersona: string; toPersona: string; rubricIds: string[] };

export interface SkillModule {
  id: string;
  title: string;
  angleIds: string[];
  concepts: Concept[];          // reuse code-track concept/mastery model
  units: PrimerUnit[];          // reuse deck units; claim refs live in unitClaims
  unitClaims: Record<string, string[]>; // unitId -> claimIds shown as chips
  drills: Drill[];
  rubric: RubricItem[];
  status: 'todo' | 'current' | 'done';
}

export interface Course {
  modules: SkillModule[];
  personas: Persona[];
  exemplars: Exemplar[];
  metric: { name: string; unit: string; corpusMedian: number }; // e.g. reply rate, %, 5
}

// ---------- research job ----------
export type ResearchPhase = 'idle' | 'cartography' | 'scouting' | 'enriching' | 'assessing' | 'reconciling' | 'architecting' | 'done' | 'failed';
export interface ResearchJob {
  phase: ResearchPhase;
  startedAt?: string;
  finishedAt?: string;
  progress: { anglesKept: number; anglesDone: number; sources: number; claims: number; modules: number };
  log: string[];         // last ~50 lines, human-readable
  error?: string;
}

// ---------- practice ----------
export interface DraftVersion {
  n: number;             // 1-based
  at: string;
  body: string;
  run?: RunReport;
}
export interface Draft {
  id: string;
  moduleId: string;
  title: string;         // "Priya @ Acme — first touch"
  versions: DraftVersion[];
}
export interface RunReport {
  at: string;
  personas: Array<{ personaId: string; reactions: Array<{ line: number; text: string; bailed?: boolean }> }>;
  scores: Array<{ rubricId: string; score: number; note: string }>; // 0..1
  predicted: { low: number; high: number; unit: string; note: string };
  biggestLever: string;  // one line, cites a claim id
}
export interface DrillAttempt {
  drillId: string;
  at: string;
  answer: unknown;       // predict: 0|1; sprint: string[]; spot: segment index; rewrite: string
  correct?: boolean;     // predict/spot
  feedback: string;      // sprint/rewrite: panel feedback; predict/spot: the why
  scores?: Array<{ rubricId: string; score: number }>;
}
export interface Shipment {
  id: string;
  draftId: string;
  version: number;
  at: string;
  sent: number;
  replies: number;
  meetings?: number;
  notes?: string;
  predictedLow: number;
  predictedHigh: number;
}

// ---------- project ----------
export interface SkillProject {
  id: string;            // slug == folder
  name: string;
  frame: Frame;
  phase: SkillPhase;
  createdAt: string;
  map?: AngleMap;
  course?: Course;
  reps: { drills: number; runs: number; ships: number };
}
export interface SkillSummary {
  id: string; name: string; phase: SkillPhase; reps: number; modulesDone: number; modulesTotal: number;
}

// ---------- requests / responses ----------
export interface CreateSkillRequest { name: string; frame: Frame }
export interface HintReq { moduleId: string; draftId: string; body: string; cursorLine: number; level: 'step' | 'composite' }
export interface HintRes { hint: string; flag?: { line: number; note: string } }
export interface GhostReq { moduleId: string; draftId: string; body: string; cursorLine: number }
export interface GhostRes { text: string }   // ONE sentence, hollow, type-through
export interface RunReq { draftId: string; version: number }
export interface DrillSubmit { drillId: string; answer: unknown }
export interface ShipReq { draftId: string; version: number; sent: number; replies: number; meetings?: number; notes?: string }
export interface CalibrationGrade { emails: string; }               // "grade my existing emails"
export interface CalibrationGradeRes { scores: Array<{ rubricId: string; score: number; note: string }>; summary: string }
// Additive: calibration probes answered in the learner's own words (the "your own
// answer" option). Graded by the panel model against the check's correct option.
export interface ProbeAnswer { unitId: string; question: string; options: string[]; answerIndex: number; explain: string; answer: string }
export interface ProbeGradeReq { answers: ProbeAnswer[] }
export interface ProbeGradeRes { results: Array<{ unitId: string; mastery: number; note: string }> } // mastery 0..1; >= 0.8 clears

// ---------- REST (all JSON; errors {error}) ----------
// GET    /api/skills                              -> SkillSummary[]
// POST   /api/skills                              -> SkillProject       (CreateSkillRequest) [LLM: cartographer → phase 'mapping', map set]
// GET    /api/skills/:id                          -> SkillProject
// DELETE /api/skills/:id                          -> {ok:true}
// PUT    /api/skills/:id/map                      -> SkillProject       (body: AngleMap — kept flags edited)
// POST   /api/skills/:id/research                 -> ResearchJob        (starts/resumes; idempotent)
// GET    /api/skills/:id/research                 -> ResearchJob
// GET    /api/skills/:id/research/stream          -> SSE: ResearchJob snapshots as JSON, then {phase:'done'|'failed'}
// GET    /api/skills/:id/claims                   -> Claim[]
// GET    /api/skills/:id/sources                  -> SourceRef[]
// POST   /api/skills/:id/sources                  -> SourceRef          (body: {url?, title, text}) user-pasted, kind 'user', reputation 0.9
// POST   /api/skills/:id/calibration/grade        -> CalibrationGradeRes (body: CalibrationGrade) [LLM]
// POST   /api/skills/:id/calibration/probes       -> ProbeGradeRes      (body: ProbeGradeReq)    [LLM panel; mock = keyword overlap]
// PATCH  /api/skills/:id/modules/:mid             -> SkillProject       (body: Partial<SkillModule>: concepts/status)
// GET    /api/skills/:id/drafts                   -> Draft[]
// POST   /api/skills/:id/drafts                   -> Draft              (body: {moduleId, title, body?})
// PUT    /api/skills/:id/drafts/:did              -> Draft              (body: {body}) → appends a version if body differs from last
// POST   /api/skills/:id/run                      -> RunReport          (RunReq) [LLM persona panel]
// POST   /api/skills/:id/hint                     -> HintRes            (HintReq) [LLM]
// POST   /api/skills/:id/ghost                    -> GhostRes           (GhostReq) [LLM]
// POST   /api/skills/:id/drills/submit            -> DrillAttempt       (DrillSubmit) [LLM for sprint/rewrite]
// GET    /api/skills/:id/drills/attempts          -> DrillAttempt[]
// POST   /api/skills/:id/ship                     -> Shipment           (ShipReq)
// GET    /api/skills/:id/ships                    -> Shipment[]
// POST   /api/skills/:id/refresh                  -> ResearchJob        [LLM haiku freshness]
// POST   /api/skills/:id/chat  + /chat/stream     -> same shapes as the code track (ChatRequest w/ milestoneId = moduleId) [LLM]
