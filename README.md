# Omnilearn

A local learning app for keeping your coding muscle sharp in the AI era: pick a
real goal ("MHSA in numpy from scratch", "my own BPE tokenizer"), an instructor
agent teaches *just enough*, and you write **every line yourself** in a native
editor. AI helps only on request — or when you're truly down a rabbit hole.

- **Calibrate → Primer → Build → Reflect** per milestone; the primer ends itself
  the moment every concept is cleared.
- **Ghost lines you can't Tab-accept**: `Ctrl+Shift+Space` shows one hollow line
  of code that only enters the file through your own fingers.
- **Hints on demand** (`Ctrl+Space`): the next precise step in 1–2 plain lines;
  press again for the composite step.
- **A watcher that respects struggle**: quiet by default, an amber gutter dot
  only when you're genuinely rabbit-holing, fully silent in explore mode (`Alt+E`).
- **A terminal that manages its own presence**: translucent right-hand rail that
  springs open on run output and folds itself away (`Ctrl+\``), with a real
  shell tab.
- Playroom visual identity with 4 schemes (2 light, 2 dark).

## Run it

```bash
npm install
npm run dev        # server :4650 + web :4652  → open http://localhost:4652
```

Generation runs through the **Claude Code CLI** (`claude -p`) using your Claude
subscription — no API key. Make sure `claude` is installed and logged in.

**Running code**: either `python3` or [`uv`](https://docs.astral.sh/uv/) on PATH
is enough. The runner is `auto` by default: plain python for plain scripts, and
`uv run` when the project has a `pyproject.toml`/`uv.lock`, when a script carries
PEP 723 inline deps (generated starter files declare things like numpy that way,
so uv installs them on first run), or when python isn't on PATH at all. Force
one or the other under Settings → Python runner.

## Tests

```bash
npm run typecheck
npm run test:unit
npm run test:e2e   # Playwright drives the real app with a deterministic mock LLM
```

## Access from other devices / the internet

See `DEPLOY.md` — Tailscale (recommended), a quick cloudflared/ngrok tunnel,
or Docker on a VPS/Fly.io. In every internet-facing setup, set
`OMNILEARN_TOKEN` — it gates the API, the UI, and the terminal.

## Docs

- `SPEC.md` — the signed-off product spec.
- `shared/types.ts` — the API + data contract (server and client both build on it).
- `design/design-review-01.html` — the original design review the UI was chosen from.
