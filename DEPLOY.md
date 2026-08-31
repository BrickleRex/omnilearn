# Making Omnilearn reachable over the internet

Omnilearn is a single-user app with real teeth: its API writes files, runs
python, and serves a **real shell** over websocket. Never expose it without
`OMNILEARN_TOKEN` set — with the token set, everything (API, UI, terminal)
requires it, and the UI shows a login gate.

Generate a token once:

```bash
export OMNILEARN_TOKEN=$(openssl rand -hex 24)
```

## Path 1 — Tailscale (recommended: internet access without internet exposure)

Run the app normally on your laptop/home machine; install
[Tailscale](https://tailscale.com) on it and on your phone/iPad. The app is now
reachable from your devices anywhere at `http://<machine-name>:4650` — nothing
is exposed to the public internet, no token strictly needed (set one anyway if
others share the tailnet). For a real HTTPS URL on your tailnet:
`tailscale serve 4650`.

## Path 2 — Quick public tunnel from your machine

Keep it running locally, hand it a temporary public URL:

```bash
OMNILEARN_TOKEN=$OMNILEARN_TOKEN npm run build && OMNILEARN_TOKEN=$OMNILEARN_TOKEN npm start
# in another shell — pick one:
cloudflared tunnel --url http://localhost:4650     # free, no account, random URL
ngrok http 4650                                    # if you have ngrok
```

Open the printed URL, paste your token at the gate. The tunnel lives as long
as your machine does.

## Path 3 — A server you own (VPS / Fly.io / Railway), via Docker

The image bundles python3, uv, and the Claude Code CLI. Generation needs your
Claude subscription on the server — mint a long-lived CLI token **on your own
machine** and pass it as an env var:

```bash
claude setup-token        # prints CLAUDE_CODE_OAUTH_TOKEN=...
```

Then, on the server:

```bash
export OMNILEARN_TOKEN=...          # your access token
export CLAUDE_CODE_OAUTH_TOKEN=...  # from setup-token
docker compose up -d --build
```

Put a TLS reverse proxy (Caddy is two lines) or the platform's HTTPS in front;
the auth cookie is marked `Secure` automatically behind `x-forwarded-proto:
https`. On Fly.io: `fly launch` picks up the Dockerfile; set both env vars with
`fly secrets set`, and add a volume mounted at `/app/data` so projects survive
restarts.

Notes for any path:

- Data is plain folders under `data/` — back it up by copying the directory.
- The token holder gets the pty shell **inside the container/machine**, so on a
  shared box, keep it containerized and treat the token like a password.
- LLM calls bill your Claude subscription wherever the server runs.
