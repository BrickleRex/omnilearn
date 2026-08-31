# Omnilearn — Product Spec (v1, signed off 2026-08-31)

A local learning app for re-building coding muscle: you pick a real goal ("MHSA in
numpy from scratch", "a tokenizer"), an instructor agent teaches *just enough*, and
you write **every line yourself** in a native editor. AI helps only on request
(hints, ghost lines) or when you're truly down a rabbit hole (watcher nudges).
All generation runs through the user's Claude subscription via the local
`claude` CLI in headless mode — never an API key, never OpenAI.

## Signed-off decisions (do not re-litigate)

1. **Structure**: Library → Project → Milestones. Per milestone, a five-beat loop:
   Pick → Calibrate → Primer → Build → Reflect.
2. **Identity**: **Playroom** — chunky 2-3px borders, offset hard shadows, rounded
   corners, loud primaries, sticker-like chips, playful but precise. Multiple
   color schemes including good dark variants (see Theming).
3. **Terminal**: right-side **translucent rail** (code visible beneath, editor keeps
   full width & height) that behaves like a **pulse**: collapsed to a slim strip at
   rest, springs open on run/output, auto-collapses after ~4s idle. Pinnable.
   `Ctrl+\`` toggles. Two tabs: **Run** (structured output of the last run) and
   **Shell** (real pty via xterm).
4. **Guidance**: BOTH **Compass** (slim strip above editor: step pips + current step
   title; `Ctrl+Space` unfolds one-sentence detail) and **Footlight** (bottom bar
   with amber lamp; hint types itself out). Setting `guidanceStyle:
   'compass'|'footlight'|'both'` (default `both`). Hints are 1–2 lines, explained
   like to a smart 15-year-old. First `Ctrl+Space` = precise next step; pressing
   again = composite/bigger step.
5. **Ghost line** (`Ctrl+Shift+Space`): treatment **G2 Hollow** — outlined
   (stroke-only) text that FILLS as you type matching characters. Tab is REFUSED
   (shake + "practice line — type it yourself"). The ghost never enters the file
   except through the user's typed characters. Esc dismisses; 3 diverging chars
   auto-dismisses. Normal editor autocomplete/intellisense stays enabled, visually
   warm/solid and Tab-able — never confusable with the ghost.
6. **Primer**: **Deck + Scroll-story hybrid.** A deck of units with progress dots;
   a unit is a `card` (one idea, optional figure), a `story` (scrollytelling:
   sticky figure that swaps as beats scroll), or a `check` (one question). Concept
   cleared = calibration evidence OR check passed. All concepts cleared → primer
   ends itself, straight into the editor. No text walls.
7. **Watcher**: reads editor state + run results in the background. Postures:
   **Quiet** (default — being wrong is allowed), **Nudge** (amber dot in gutter +
   footlight lamp; never interrupts; note is 1–2 kid-simple lines) only when a run
   error contradicts a cleared concept or the user circles the same spot ~10 min,
   **Explore** (`Alt+E`, user-toggled: watcher fully silent, diffs are experiments).
8. **Platform**: local web app. Node 22 + Express + ws backend, React 18 + Vite
   frontend, CodeMirror 6 editor, @xterm/xterm + node-pty shell, Playwright e2e.
   Projects are plain folders on disk under `data/projects/`. First language
   target: Python.

## The LLM layer ("use this subscription")

- All generation shells out to the **Claude Code CLI**: `claude -p --model <alias>
  --output-format json --max-turns 1`, prompt on stdin. Parse the `result` field;
  extract the first JSON block when structured output was requested. This bills the
  user's Claude subscription and needs zero key management.
- Model routing: `plan`/`calibrate`/`primer` → `opus`; `hint`/`ghost` → `sonnet`;
  `watch` → `haiku`. Configurable in settings.
- `LLM_MOCK=1` env → deterministic fixtures (no CLI calls). E2e runs in mock mode.
- Timeouts: 180s for opus tasks, 60s others. Kill the child on timeout. One retry.
- Server-side queue: max 2 concurrent CLI calls; watcher calls are lowest priority
  and throttled to ≥60s apart per project.
- Primer + calibration responses are cached in `<project>/.omnilearn/cache/` keyed
  by milestone id, so re-entering a milestone is instant and free.

## Screens

### Library
Project cards (name, goal, per-milestone progress ring, language chip) + "New
project". New-project flow: one textarea ("What do you want to build — and say if
it's not from scratch") → LLM returns plan {name, slug, language, milestones[]
each with concepts[] and starter files} → user reviews/edits milestone list
(rename, delete, reorder, add) → Accept creates the folder + files.

### Milestone entry (Calibrate → Primer)
If milestone has uncleared concepts and no calibration yet: show calibration —
3–5 multiple-choice probes (each tagged with a conceptId, "no idea" is always an
option, no shame). Submit → mastery per concept (0–1; ≥0.8 = cleared). Then primer
deck is generated for uncleared concepts only. Deck footer shows the concept
checklist filling in live ("what counts as enough" made visible). "Skip to
editor" always available (records concepts as skipped-not-cleared).

### Workspace (Build)
- Left: collapsible file tree (width ~200px, collapses to 36px rail).
- Center: CodeMirror 6, python highlighting, line numbers, autocompletion on.
- Top strip: Compass (when enabled): pips per step + step title.
- Bottom bar: Footlight (when enabled): lamp + typed-out hint/nudge text; also
  shows explore-mode state and save state.
- Right: Terminal rail (translucent, overlays editor edge; editor text remains
  readable beneath at low opacity).
- Run: `Cmd/Ctrl+Enter` runs the active file via POST /run (structured), output
  fills the rail Run tab, rail springs open, auto-collapses unless pinned/error.
- Reflect (light v1): when a run exits 0 and the compass is on its last step, the
  footlight offers "Mark milestone done?" → updates status, appends to
  `.omnilearn/journal.md`.

## Keyboard map (rebindable later; hardcode v1)
- `Ctrl+Space` hint (again within 10s = composite)
- `Ctrl+Shift+Space` ghost line
- `Ctrl+\`` terminal rail toggle/pin
- `Alt+E` explore mode
- `Alt+H` open pending nudge
- `Cmd/Ctrl+Enter` run active file
- `Cmd/Ctrl+S` save now (auto-save 800ms debounce regardless)

## Theming (Playroom, 4 schemes)
CSS custom properties on `:root[data-scheme=...]`, persisted in settings. All four
keep the Playroom language (chunky borders, offset shadows, rounded, three loud
accents) — they re-cost it, never flatten it:
- `sunshower` (light, default): cream #F2EFE8 ground, ink #1B1B1F, accents
  #FF5C39 / #2B50FF / #FFC700.
- `blackboard` (dark): deep slate #17181C ground, chalk ink #EFEDE6, borders
  #EFEDE6, accents #FF7A5C / #6E8BFF / #FFD34D. Shadows become dark glows/offsets.
- `arcade` (dark, high-energy): near-black #0D0E12, neon accents #FF4D6D /
  #3DDC97 / #FFC700, subtle scanline texture on chrome only, never on code.
- `mint` (light, calmer): #EEF4EF ground, ink #1E2521, accents #0F7B5F / #FF6B4A /
  #3B6CE8.
Editor syntax palettes are defined per scheme (4 CodeMirror highlight styles).
Terminal rail translucency: rail bg is scheme surface at ~0.82 alpha + blur(6px).

## Data model (on disk)
```
data/projects/<slug>/
  project.json          # Project (see shared/types.ts)
  .omnilearn/
    cache/<milestoneId>.calibration.json
    cache/<milestoneId>.primer.json
    journal.md
  <starter files>       # real, runnable workspace files
data/settings.json      # global Settings
```

## Testing bar
- `npm run test:e2e` = Playwright against the real app in LLM_MOCK mode; this is
  the gate. Must cover: create project → calibrate → primer deck+story+check →
  editor typing → hint (compass expand + footlight typeout) → ghost tab-refusal →
  ghost type-through fill → run file (real python) → rail pulse + output → watcher
  nudge appears (mock-forced) → explore silences watcher → theme switch → pty
  shell echo → milestone done.
- Unit tests where logic is tricky (ghost matcher, watcher throttle, LLM JSON
  extraction) via vitest, but e2e is the acceptance bar.
