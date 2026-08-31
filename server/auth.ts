// Optional access-token gate for exposing Omnilearn beyond localhost.
//
// Off by default: with no OMNILEARN_TOKEN env, everything behaves as before.
// With it set, every /api route (except health and login) and the terminal
// websocket require the token — as `Authorization: Bearer <token>` or the
// httpOnly cookie that POST /api/auth/login sets. The UI shows a gate screen
// on 401. This makes a personal tunnel/VPS deployment sane; it is still a
// single-user trust model (the token holder gets a real shell via the pty).

import { Router, type NextFunction, type Request, type Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const COOKIE = 'omnilearn_auth';
const COOKIE_MAX_AGE_S = 30 * 24 * 3600;

export function configuredToken(): string | undefined {
  const t = process.env.OMNILEARN_TOKEN?.trim();
  return t ? t : undefined;
}

/** Constant-time equality via sha256 (sidesteps length leaks). */
function tokenMatches(candidate: string | undefined, expected: string): boolean {
  if (!candidate) return false;
  const a = createHash('sha256').update(candidate).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function readCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === COOKIE) {
      try { return decodeURIComponent(part.slice(eq + 1).trim()); } catch { return undefined; }
    }
  }
  return undefined;
}

function presentedToken(req: Pick<IncomingMessage, 'headers'>): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim();
  return readCookie(req.headers.cookie);
}

/** Express gate for /api. No-op unless OMNILEARN_TOKEN is set. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = configuredToken();
  if (!expected || tokenMatches(presentedToken(req), expected)) { next(); return; }
  res.status(401).json({ error: 'unauthorized' });
}

/** Same check for the websocket upgrade (cookies ride the handshake). */
export function wsAuthorized(req: IncomingMessage): boolean {
  const expected = configuredToken();
  return !expected || tokenMatches(presentedToken(req), expected);
}

export const authRouter: Router = Router();

// POST /api/auth/login {token} -> sets the cookie the browser then rides on.
authRouter.post('/login', (req, res) => {
  const expected = configuredToken();
  if (!expected) { res.json({ ok: true }); return; }
  const supplied = (req.body as { token?: unknown } | undefined)?.token;
  if (typeof supplied !== 'string' || !tokenMatches(supplied, expected)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie',
    `${COOKIE}=${encodeURIComponent(supplied)}; Path=/; Max-Age=${COOKIE_MAX_AGE_S}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});
