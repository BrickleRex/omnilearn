# Omnilearn — notes for agents

Read `SPEC.md` first; it is the signed-off product spec and its decisions are
settled. `shared/types.ts` is the frozen server/client contract — REST routes and
the terminal WS protocol are documented at the bottom of it; change it only
additively.

## Layout
- `server/` — Express + ws. `llm/` shells out to the Claude Code CLI
  (`claude -p --output-format json`) on the user's subscription; `LLM_MOCK=1`
  swaps in deterministic fixtures (`server/llm/fixtures.ts`) that the e2e suite
  depends on — keep fixtures and `e2e/app.spec.ts` in sync.
- `src/` — React 18. `theme/base.css` holds the Playroom token contract (the
  `--*` variable names are load-bearing across modules); `library/` + `primer/`
  are the flow screens; `workspace/` is the CodeMirror editor with the ghost
  line, compass/footlight guidance, watcher, and the terminal rail.
- `e2e/` — Playwright, the acceptance gate: `npm run test:e2e` boots the built
  app with the mock LLM on :4655 (fresh `data-e2e` each run).

## Rules of the road
- Verify with `npm run typecheck && npm run test:unit && npm run test:e2e`
  before calling anything done. E2e is the bar — unit tests alone hide UX breaks.
- The product premise: the user types every line. Nothing may auto-insert AI
  code into the buffer (no Tab-accept on ghosts, no closeBrackets auto-pairs).
- Guidance copy is 1–2 lines, explained like to a smart 15-year-old.
- Watcher stays quiet by default; being wrong is allowed.
- User data lives in `data/` (gitignored). `data-*` dirs are scratch.
