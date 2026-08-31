// Shared contract between server and client. Builder agents: treat this file as
// frozen — if you truly need a change, make it additive and note it in your report.

export type Scheme = 'sunshower' | 'blackboard' | 'arcade' | 'mint';
export type GuidanceStyle = 'compass' | 'footlight' | 'both';

/** How to run python files. 'auto' prefers uv when the project/script wants it
 *  (pyproject/uv.lock or PEP 723 inline deps) or when no python is on PATH. */
export type RunnerPref = 'auto' | 'uv' | 'python';

export interface Settings {
  scheme: Scheme;
  guidanceStyle: GuidanceStyle;
  models: { plan: string; primer: string; hint: string; ghost: string; watch: string; chat?: string };
  runner?: RunnerPref; // additive; server always fills it (default 'auto')
}

export type MilestoneStatus = 'todo' | 'current' | 'done';

export interface Concept {
  id: string;            // slug, e.g. "softmax"
  label: string;         // "softmax turns scores into shares"
  mastery: number;       // 0..1; >= 0.8 means cleared
  cleared: boolean;
  source: 'unseen' | 'calibration' | 'check' | 'skipped';
}

export interface Milestone {
  id: string;            // slug
  title: string;
  status: MilestoneStatus;
  concepts: Concept[];
  steps: Step[];         // build plan for the compass; filled by primer generation
  currentStep: number;   // index into steps
  entryFile: string;     // relative path of the main file for this milestone
}

export interface Step {
  title: string;         // <= 6 words, e.g. "score every pair"
  detail: string;        // one sentence, 15-year-old clear
}

export interface Project {
  id: string;            // slug == folder name
  name: string;
  goal: string;          // the user's original ask
  language: 'python';
  createdAt: string;
  milestones: Milestone[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  goal: string;
  language: string;
  milestonesDone: number;
  milestonesTotal: number;
}

// ---------- files ----------
export interface FileNode {
  name: string;
  path: string;          // project-relative, posix
  type: 'file' | 'dir';
  children?: FileNode[];
}

// ---------- plan (new project) ----------
export interface ProjectPlanRequest { goal: string }
export interface ProjectPlan {
  name: string;
  slug: string;
  language: 'python';
  milestones: Array<{
    id: string;
    title: string;
    concepts: Array<{ id: string; label: string }>;
    entryFile: string;
  }>;
  starterFiles: Array<{ path: string; content: string }>; // small: entry stubs, a README
}

// ---------- calibration ----------
export interface CalibrationQuestion {
  id: string;
  conceptId: string;
  question: string;      // 1-2 lines
  options: string[];     // 3-4 options; LAST one is always "No idea yet"
  answerIndex: number;   // index of the correct option
}
export interface Calibration { milestoneId: string; questions: CalibrationQuestion[] }
export interface CalibrationSubmit { milestoneId: string; answers: number[] } // -1 = skipped
export interface CalibrationResult { concepts: Concept[] }                    // updated concepts

// ---------- primer ----------
export interface PrimerBeat { text: string; figureSvg?: string }
export type PrimerUnit =
  | { kind: 'card'; id: string; conceptId: string; title: string; bodyMd: string; figureSvg?: string }
  | { kind: 'story'; id: string; conceptId: string; title: string; beats: PrimerBeat[] }
  | { kind: 'check'; id: string; conceptId: string; question: string; options: string[]; answerIndex: number; explain: string };
export interface PrimerDoc {
  milestoneId: string;
  units: PrimerUnit[];   // only for uncleared concepts; ends with each concept's check
  steps: Step[];         // the build plan, powers the compass
}

// ---------- in-editor guidance ----------
export interface HintRequest {
  milestoneId: string;
  path: string;
  content: string;       // full current buffer
  cursorLine: number;    // 1-based
  level: 'step' | 'composite';
}
export interface HintResponse {
  hint: string;
  stepIndex: number; // compass position
  // Additive: set ONLY when something in the code written so far is clearly and
  // unambiguously wrong for the goal (never stylistic, never plausible
  // exploration). Surfaces through the same gutter-dot + footlight channel as
  // watcher nudges. 1-2 kid-simple lines.
  flag?: { line: number; note: string };
}

export interface GhostRequest { milestoneId: string; path: string; content: string; cursorLine: number }
export interface GhostResponse { code: string }  // ONE line of code, no explanation

export interface WatchRequest {
  milestoneId: string;
  path: string;
  content: string;
  lastRun?: RunResult;   // most recent structured run, if any
  secondsOnSpot: number; // how long the cursor has hovered the same ~5-line region
  exploreMode: boolean;
}
export interface WatchResponse {
  posture: 'quiet' | 'nudge';
  note?: string;         // 1-2 lines, kid-simple; present iff posture === 'nudge'
  line?: number;         // gutter line to mark, 1-based
}

// ---------- code completion (local static analysis via jedi — NOT an LLM) ----------
export interface CompleteRequest {
  path: string;
  content: string;
  line: number;    // 1-based (jedi convention)
  column: number;  // 0-based within the line (jedi convention)
}
export interface CompletionItem {
  label: string;                 // e.g. "zeros"
  kind: string;                  // jedi type: "function" | "module" | "class" | "instance" | ...
  detail?: string;               // short signature/description if cheap to get
}
export interface CompleteResponse {
  items: CompletionItem[];       // capped at 1000 (jedi's order); `detail` only on the first ~80
  engine: 'jedi' | 'words';      // 'words' = fallback when jedi unavailable
}

// ---------- tutor chat ----------
export interface ChatMessage { role: 'user' | 'tutor'; text: string; at: string }
export interface ChatRequest {
  milestoneId: string;
  message: string;
  path?: string;      // active file, for context
  content?: string;   // its buffer, for context
}
export interface ChatResponse { reply: string }

// ---------- running code ----------
export interface RunRequest { path: string }
export interface RunResult {
  path: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  startedAt: string;
  command?: string; // additive: the exact command line used, e.g. "uv run mhsa.py"
}

// ---------- websocket (terminal) ----------
// Connect: /ws/term?projectId=<id>. Binary/textual frames:
// client -> server: {type:'data', data:string} | {type:'resize', cols:number, rows:number}
// server -> client: {type:'data', data:string} | {type:'exit', code:number}

// ---------- REST surface (all JSON; errors: {error: string} with 4xx/5xx) ----------
// GET    /api/settings                      -> Settings
// PUT    /api/settings                      -> Settings           (body: Partial<Settings>)
// GET    /api/projects                      -> ProjectSummary[]
// POST   /api/projects/plan                 -> ProjectPlan        (body: ProjectPlanRequest)  [LLM]
// POST   /api/projects                      -> Project            (body: ProjectPlan — as edited by user)
// GET    /api/projects/:id                  -> Project
// PATCH  /api/projects/:id                  -> Project            (body: deep-merge of {milestones?: ...} status/currentStep edits)
// DELETE /api/projects/:id                  -> {ok: true}
// GET    /api/projects/:id/files            -> FileNode[]
// GET    /api/projects/:id/file?path=       -> {content: string}
// PUT    /api/projects/:id/file?path=       -> {ok: true}         (body: {content: string})
// POST   /api/projects/:id/run              -> RunResult          (body: RunRequest)
// POST   /api/projects/:id/complete         -> CompleteResponse   (body: CompleteRequest)  [local jedi, never LLM]
// GET    /api/projects/:id/chat?milestoneId= -> ChatMessage[]     (persisted history)
// POST   /api/projects/:id/chat             -> ChatResponse       (body: ChatRequest)      [LLM]
// POST   /api/projects/:id/chat/stream      -> SSE: {type:'delta',text} ... {type:'done',reply} | {type:'error',message}
// POST   /api/projects/:id/calibration      -> Calibration        (body: {milestoneId})       [LLM, cached]
// POST   /api/projects/:id/calibration/submit -> CalibrationResult (body: CalibrationSubmit)
// POST   /api/projects/:id/primer           -> PrimerDoc          (body: {milestoneId})       [LLM, cached]
// POST   /api/projects/:id/hint             -> HintResponse       (body: HintRequest)         [LLM]
// POST   /api/projects/:id/ghost            -> GhostResponse      (body: GhostRequest)        [LLM]
// POST   /api/projects/:id/watch            -> WatchResponse      (body: WatchRequest)        [LLM, throttled >= 60s/project; explore => always quiet, no LLM call]
