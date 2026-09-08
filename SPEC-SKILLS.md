# Omnilearn — Skills Track Spec (v1, signed off 2026-09-06)

A second section beside the code track for learning non-code skills (pilot:
cold email for B2B). An agent crew maps every angle of the skill, harvests the
web with trust + recency + soundness weighting, and builds a course — then the
learner drills, MAKES the real artifact, runs it against a simulated audience,
ships it, and feeds real results back. Generation runs through the user's
Claude subscription via the `claude` CLI (web search included), never an API key.

## The governing principle (from the user): volume, iteration, practice beat all
- Reading is rationed. A unit is ≤120 words and ends in a drill within a minute.
  "Skip to drills" and "Skip to Make" are always visible.
- Reps are the default. Every screen shows a rep counter; the daily loop the app
  nudges toward is "10 drills + 3 iterations of a draft".
- Iteration is a first-class object: a draft has a version ladder (v1→v2→v3),
  each version has its Run report, and the ladder shows score deltas.
- Being wrong is cheap: drills never gate, wrong answers reveal the evidence.

## Signed-off decisions (do not re-litigate)
1. **Structure**: nine beats per skill project — Frame → Map → Research →
   Calibrate → Learn → Drill → Make → Ship → Refresh. Modules (sub-skills)
   organize Learn/Drill/Make.
2. **Angle map**: OUTLINE LADDER — a checkbox tree with per-angle source-count
   estimates; pruning = unchecking; whole subtrees toggle. Levels shown as tags.
3. **Evidence**: INDEX CARDS (claim, confidence stamp, sources, two-sided when
   contested) plus a CONSENSUS GRID (claims × source-types heatmap) as a second
   view of the same claims. Evidence is available inside Make as a rail tab.
4. **Run (simulator)**: PERSONA MARGIN (3 personas from the corpus react line by
   line; the bail line is highlighted) AND SCORECARD (rubric bars, each citing
   claim ids, + predicted metric range with the corpus median). Both in the rail.
5. **Drills**: all four — Predict-the-winner (real documented A/B), Sprint
   (timer + quota), Spot-the-mistake (tap the flawed sentence), Rewrite-for-persona.
6. **Models**: cartographer `claude-fable-5-1`; scouts, assessor, reconciler,
   architect `opus`; persona panel + drill grading `sonnet`; freshness `haiku`.
7. **Sources** (verified 2026-09-06): blogs/docs via search+fetch (ok); X via
   search → public syndication endpoint (full text, ok); Reddit public `.json`
   and YouTube transcripts (work from a laptop, blocked from datacenter IPs —
   verify at first run and report); Facebook public posts PARTIAL (search
   snippet + URL slug text only; body is a login shell; no groups; never automate
   a logged-in session). User-pasted sources get elevated trust.
8. **Platform**: same app, new section. Library gets a Code | Skills switch.
   Skill data lives under `data/skills/<slug>/`.

## The feedback ladder (what replaces the compiler), most honest first
1. Prediction drills against documented real results.
2. Simulator run (persona margin + scorecard) — labelled as a model of the
   audience, never the audience; every score cites claims.
3. Real results pasted back (Ship): prediction vs reality diff; disagreements
   flag the claims involved for re-verification.

## Research pipeline (resumable job with SSE progress; artifacts on disk)
data/skills/<slug>/research/{map.json, sources/*.json, claims.json, course.json, job.json}
- **Cartographer** (fable): from Frame → AngleMap (angles + sub-angles, level tag,
  est. source count). Second pass: "skeptical practitioner: what's missing?" merged.
- **Scouts** (opus, parallel ≤3, one per KEPT angle): `claude -p` with
  WebSearch/WebFetch allowed; return sources {url, kind, title, date, why} +
  candidate claims with quotes. Server ENRICHES by url kind: x.com → syndication
  JSON; reddit → `.json` (UA header); youtube → transcript; else readability
  fetch. Enriched text is cached per source.
- **Assessor** (opus, batched): per source → reputation (0-1), soundness (0-1:
  mechanism/evidence/sample/self-promo/survivorship), recency decay by angle
  (deliverability decays fast; psychology slow); per claim → confidence,
  contextTags. Emits Claim cards.
- **Reconciler** (opus): clusters, resolves, marks contested with sides, builds
  the consensus grid data.
- **Architect** (opus): modules → concepts, units (≤120 words, claim refs),
  checks, drills (all four kinds; predict drills ONLY from sources with real
  results), rubric (items cite claims), personas (3, from the corpus), exemplars.
- **Freshness** (haiku): on demand / scheduled: re-check newest sources per
  angle; claims whose newest source > decay horizon → 'stale'.
Mock mode (LLM_MOCK=1): a deterministic cold-email fixture corpus drives the
whole pipeline instantly (fake progress ticks) — the e2e suite depends on it.

## Screens
- Library: Code | Skills switch. Skill cards show phase + rep count.
- Frame (modal): outcome, context, self-rated level; optional paste of existing
  work. → creates project, kicks off Cartographer → Map.
- Map: outline ladder; prune; "Start research" shows est. sources + time.
- Research: live progress (phase, counts, log), resumable; when done → Calibrate.
- Calibrate: probes + optional "grade my existing emails" → mastery → Learn.
- Learn: deck (reuse primer deck) with claim chips; each unit ends in a drill.
- Drills: the four kinds, spaced; rep counter; wrong answers reveal evidence.
- Make: CodeMirror (markdown) with ghost line + hints (type-through rule holds);
  rail tabs: Run (persona margin / scorecard), Ask, Evidence (cards + grid);
  version ladder with deltas; Ship form (paste real results) + Refresh.

## Testing bar
`npm run test:e2e` covers the skills journey in mock mode: frame → map prune →
research (mock) → calibrate → learn → all four drills → make: draft, ghost,
run → persona margin + scorecard → v2 → delta → ship results → evidence tab.

## Mock corpus and test ids (the e2e contract)
`server/skills/fixtures.ts` is the deterministic cold-email corpus (LLM_MOCK=1):
angles targeting/copy/deliverability/followups/metrics (+ sub-angles), sources
s1–s8, claims c1–c8 (c3 contested, c7 stale), modules `first-line` (drills
d-predict-1, d-sprint-1, d-spot-1, d-rewrite-1) and `sequence` (d-predict-2),
personas priya/tom/lena, rubric r-trigger/r-short/r-ask/r-subject.
Mock research advances a phase every ~150ms and finishes in under 3s.

data-testids (must exist exactly):
- Library: `track-code`, `track-skills` (switch), `skills-lane`, `new-skill`,
  `skill-card-<id>`, `skill-open-<id>`.
- Frame modal: `frame-name`, `frame-outcome`, `frame-context`, `frame-level-<new|some|experienced>`,
  `frame-existing`, `frame-submit`.
- Map: `skill-map`, `angle-<id>` (row), `angle-toggle-<id>` (checkbox), `map-est` (est sources text),
  `start-research`, `skip-to-drills`, `skip-to-make` (the two skips appear on EVERY skill screen header).
- Research: `skill-research`, `research-phase` (text = current phase), `research-log`, `research-continue`
  (enabled when done → Calibrate).
- Calibrate: `skill-calibrate`, `calib-opt-<qi>-<oi>`, `calib-submit`, `grade-existing-toggle`, `grade-existing-input`, `grade-existing-submit`,
  `grade-existing-result`, `calib-continue`.
- Learn: `skill-learn`, own deck with ids `primer-deck`, `check-opt-<i>`, `primer-next`, `primer-finish`
  plus `claim-chip-<claimId>` (click opens `evidence-card-<claimId>`), `learn-to-drills`.
- Drills: `skill-drills`, `rep-counter` (text contains the number), `drill-<id>`,
  predict: `predict-opt-<0|1>`, `predict-result`; sprint: `sprint-timer`, `sprint-line-<i>` (textarea/input), `sprint-submit`, `sprint-feedback`;
  spot: `spot-seg-<i>`, `spot-result`; rewrite: `rewrite-input`, `rewrite-submit`, `rewrite-feedback`;
  `drill-next`, `drills-to-make`.
- Make: `skill-make`, `.cm-content` editor, `draft-title`, `version-ladder`, `version-<n>`, `version-delta-<n>`,
  `make-run`, rail tabs `rail-tab-run|ask|evidence`, `persona-margin`, `persona-<id>`, `reaction-bail` (highlighted bail line),
  `scorecard`, `score-<rubricId>`, `predicted-range`, `biggest-lever`, `make-hint` (or Ctrl+Space), `hint-text`,
  `.cm-ghost` (ghost line, Tab must NOT accept), `ship-open`, `ship-sent`, `ship-replies`, `ship-submit`, `ship-<id>` (row with prediction vs reality),
  `evidence-cards`, `evidence-card-<claimId>`, `evidence-grid`, `grid-cell-<claimId>-<kind>`, `evidence-view-cards|grid`,
  `back-to-map` (link back to the map/learn).

## Long-tail targets: wide → narrow (added 2026-09-08)
A frame may carry a structured `target` (who / industry / where / deal / what makes
it different). When present:
- **Cartographer** maps niche-specific angles (scope 'niche') AND the general rules
  of the skill (scope 'general'); the critique pass asks "what does a generic course
  get wrong for this niche?".
- **Scouts** search a ladder, wide to narrow, for every angle: (1) the general craft,
  (2) adjacent fields (other high-ticket / executive / regulated-industry outreach),
  (3) the exact niche (niche terms in every query, site-scoped too). Each source is
  tagged `specificity` niche | adjacent | general. A thin niche is reported, never
  faked.
- **Assessor** adds `relevance` (0..1 fit to the target) per source; claims inherit
  specificity from their sources and relevance feeds confidence (niche > adjacent >
  general at equal evidence).
- **Reconciler**: when niche evidence contradicts a general rule, the niche wins for
  this frame — the general claim becomes contested with the niche sources "against".
- **Architect**: modules lead with niche claims; a general claim used in a unit is
  labelled "general rule, applied to your niche"; personas, exemplars, rewrite drills
  and spot-the-mistake flaws are built from the target, not the corpus average.
- **UI**: frame modal target fields (`frame-target-who|industry|where|deal|different`),
  map rows show a NICHE / GENERAL scope chip, evidence cards and source rows show the
  specificity badge (`specificity-<niche|adjacent|general>` on cards).
  Exact ids: `angle-scope-<angleId>` (text 'niche' | 'general', general when the scope
  is missing); `skill-target` (the "→ who · industry · where" line on the skill header
  and on each library card); `specificity-<niche|adjacent|general>` on the evidence
  card badge and `source-spec-<...>` on a source row's small tag; the consensus grid
  gains a leading "fit" column (dot only, cell ids unchanged) and cards sort niche
  first once any claim carries a specificity.
