// PLACEHOLDER bootstrap — owned by the backend agent. Replace entirely, keeping:
// - PORT env (default 4650), LLM_MOCK env
// - static serving of ./dist when NODE_ENV=production
// - routes and WS protocol exactly per shared/types.ts
import express from 'express';

const app = express();
app.use(express.json({ limit: '4mb' }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT ?? 4650);
app.listen(port, () => console.log(`[omnilearn] server on :${port}`));
