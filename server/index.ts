// Omnilearn server: Express REST under /api + a ws pty at /ws/term, on one
// http.Server. Projects are plain folders under <data>/projects/<slug>/.

import express, { type NextFunction, type Request, type Response } from 'express';
import http from 'node:http';
import path from 'node:path';
import { HttpError, ensureDir, projectsDir } from './store';
import { authRouter, configuredToken, requireAuth, wsAuthorized } from './auth';
import { settingsRouter } from './settings';
import { projectsRouter } from './projects';
import { runnerRouter } from './runner';
// The jedi daemon is stdio-attached and never detached: it sees EOF on stdin and
// exits with us, so index.ts needs no signal handler of its own.
import { completeRouter } from './complete';
import { agentsRouter } from './llm/agents';
import { chatRouter } from './llm/chat';
import { attachTerminal, termWss } from './term';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Login stays outside the gate; everything below requires the token when set.
app.use('/api/auth', authRouter);
app.use('/api', requireAuth);

// Order is irrelevant here (no path collides), but keep it readable.
app.use('/api', settingsRouter);
app.use('/api', agentsRouter);
app.use('/api', chatRouter);
app.use('/api', projectsRouter);
app.use('/api', runnerRouter);
app.use('/api', completeRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not found' });
});

// Production: serve the built SPA. Hash routing means no deep-link fallback.
if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(process.cwd(), 'dist');
  app.use(express.static(dist));
  app.get('/', (_req, res) => {
    res.sendFile(path.join(dist, 'index.html'));
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : 'internal error';
  if (status >= 500) console.error('[omnilearn]', err);
  res.status(status).json({ error: message });
});

const server = http.createServer(app);

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws/term') {
    socket.destroy();
    return;
  }
  if (!wsAuthorized(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  termWss.handleUpgrade(req, socket, head, (ws) => {
    void attachTerminal(ws, url);
  });
});

const port = Number(process.env.PORT ?? 4650);

async function main(): Promise<void> {
  await ensureDir(projectsDir());
  server.listen(port, () => {
    const flags = [
      process.env.LLM_MOCK === '1' ? 'LLM_MOCK' : '',
      configuredToken() ? 'auth: token' : 'auth: OFF (local trust)',
    ].filter(Boolean).join(', ');
    console.log(`[omnilearn] server on :${port} (${flags})`);
  });
}

void main();
