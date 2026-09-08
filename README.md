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
  shell tab — and an **Ask** tab (`Ctrl+/`): a concise tutor who knows your
  project, file, and last run. It explains; it never dumps code.
- **Real intellisense**: completions come from a local jedi daemon (static
  analysis, ~50ms, knows `np.zeros` and friends) — never an LLM. If jedi isn't
  importable and pip can't install it, the daemon runs itself through
  `uv run --with jedi` automatically — having `uv` on PATH is enough.
- **Hints look back**: `Ctrl+Space` gives the next step *and* flags at most one
  thing in your earlier code that's unambiguously wrong — plausible experiments
  stay unflagged. Re-read the milestone's primer anytime via the top-bar button.
- Playroom visual identity with 4 schemes (2 light, 2 dark).

## The Skills track (learn anything that isn't code)

Flip the Library to **Skills** to learn things like cold email, Meta ads or UGC
the same way: an agent crew maps every angle of the skill (an **outline ladder**
you prune), scouts the web with search — Reddit threads, X posts (via the public
syndication endpoint), YouTube transcripts, blogs, docs, public Facebook posts
where reachable — then an assessor scores every source for reputation,
recency and soundness, a reconciler marks contested claims, and an architect
builds a course. Evidence stays one click away as **index cards** and a
**consensus grid**. Then the rule is *volume, iteration, practice beat all*:

- **Drills** of four kinds, never gating: predict the documented A/B winner,
  sprint under a timer, spot the flawed sentence, rewrite for a persona.
- **Make** the real thing in the editor (same ghost line + hints, you type every
  word), **Run** it against three personas built from the corpus (a persona
  margin with the bail line highlighted, a scorecard citing claims, a predicted
  range next to the corpus median), climb a version ladder with score deltas,
  and **Ship** real results back to see prediction vs reality.

Long-tail targets are first-class: give the frame a target (who, industry,
where, deal size, what makes it different) and the crew searches **wide to
narrow** — the craft at large, neighbouring situations, then exactly that niche —
tagging every source and claim niche / adjacent / general. Niche evidence
outranks general advice when they disagree, and the personas, exemplars and
drills are built from the target.

Two finished, real courses ship in `examples/skills/` (generic B2B cold email:
214 sources, 163 claims; cold email to executives at US insurance firms: 269
sources, 169 claims, 22 of 35 angles niche-specific). `npm run seed:skills`
drops them into `data/skills/` so you can drill and make right away.
`SPEC-SKILLS.md` has the decisions; `shared/skills.ts` the contract. Data lives in
`data/skills/<slug>/`. Reddit's `.json` and YouTube transcripts are blocked from
datacenter IPs but work from a laptop; the research log says which sources were
only snippets.

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

- `SPEC.md` — the signed-off product spec; `SPEC-SKILLS.md` — the skills track.
- `shared/types.ts` and `shared/skills.ts` — the API + data contracts (server and client both build on them).
- `design/design-review-02-skills.html` — the skills-track design review.
- `design/design-review-01.html` — the original design review the UI was chosen from.
