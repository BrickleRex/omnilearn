# Omnilearn — single-container deployment (server + built UI + python/uv + claude CLI).
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates curl git \
 && rm -rf /var/lib/apt/lists/*

# uv: interpreter + dependency runner for learner code (PEP 723 aware)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Claude Code CLI: the generation path (runs on your Claude subscription).
# Provide CLAUDE_CODE_OAUTH_TOKEN at runtime (from `claude setup-token`).
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

ENV NODE_ENV=production PORT=4650
EXPOSE 4650
VOLUME /app/data

# OMNILEARN_TOKEN is strongly recommended for anything internet-facing:
# without it the API and the pty shell are open to whoever can reach the port.
CMD ["npx", "tsx", "server/index.ts"]
