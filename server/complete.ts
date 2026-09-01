// POST /api/projects/:id/complete — real python completions from a persistent
// jedi daemon (server/py/jedi_daemon.py). This is NOT an LLM: it is local static
// analysis, so it stays free, offline and fast (target: warm round trip < 100ms).
//
// Completions must fail SOFT. Every failure mode — jedi missing, daemon crashed,
// request timed out, too many in flight — answers with the word-scrape fallback
// and `engine: 'words'` instead of an error. The only 4xx here come from a bad
// project id or a path that escapes the project folder.

import { Router } from 'express';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CompleteRequest, CompleteResponse, CompletionItem } from '../shared/types';
import { HttpError, exists, projectDir, resolveInProject } from './store';
import { hasBin } from './interp';

const REQUEST_TIMEOUT_MS = 3_000;
const FIRST_REQUEST_TIMEOUT_MS = 20_000;
const UV_FIRST_REQUEST_TIMEOUT_MS = 90_000; // first uv spawn may download jedi+numpy
let warmed = false;
const IMPORT_CHECK_TIMEOUT_MS = 10_000;
const PIP_INSTALL_TIMEOUT_MS = 90_000;
const MAX_PENDING = 4;
const MAX_CONSECUTIVE_FAILURES = 3;
const GIVE_UP_MS = 60_000;
const MAX_WORD_ITEMS = 200;

// Resolve the script next to THIS module — the server may be started from any cwd.
const DAEMON_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'py', 'jedi_daemon.py');

// ---------- availability ----------

// How to run the daemon: system python3 with jedi installed, or through
// `uv run --with jedi` (no install step — uv resolves and caches it, and
// covers machines where pip is PEP 668-locked or python isn't on PATH).
type DaemonMode = 'unknown' | 'python3' | 'uv' | 'missing';
let daemonMode: DaemonMode = 'unknown';

function jediImports(): boolean {
  try {
    const probe = spawnSync('python3', ['-c', 'import jedi'], {
      timeout: IMPORT_CHECK_TIMEOUT_MS,
      stdio: 'ignore',
    });
    return probe.status === 0;
  } catch {
    return false;
  }
}

/**
 * Decide how to run the daemon, once per process, before the first spawn:
 * python3-with-jedi -> one pip attempt -> uv (`--with jedi`) -> give up soft.
 */
function ensureAvailable(): boolean {
  if (daemonMode !== 'unknown') return daemonMode !== 'missing';
  if (jediImports()) {
    daemonMode = 'python3';
    return true;
  }
  console.log('[omnilearn] jedi not found — trying one "pip3 install --user jedi"');
  try {
    spawnSync('pip3', ['install', '--user', '--quiet', 'jedi'], {
      timeout: PIP_INSTALL_TIMEOUT_MS,
      stdio: 'ignore',
    });
  } catch {
    // fall through to the re-check
  }
  if (jediImports()) {
    daemonMode = 'python3';
    return true;
  }
  if (hasBin('uv')) {
    daemonMode = 'uv';
    console.log('[omnilearn] running completions via "uv run --with jedi" (first spawn resolves deps, then cached)');
    return true;
  }
  daemonMode = 'missing';
  console.log('[omnilearn] jedi unavailable — completions fall back to buffer words. Fix: `pip3 install jedi` or put `uv` on PATH.');
  return false;
}

// ---------- the daemon ----------

interface Pending {
  resolve: (items: CompletionItem[]) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface DaemonMessage {
  id?: number;
  items?: unknown;
  error?: unknown;
}

let child: ChildProcess | null = null;
let stdoutBuffer = '';
let nextId = 1;
const pending = new Map<number, Pending>();

let consecutiveFailures = 0;
let giveUpUntil = 0;

function settleAllPending(err: Error): void {
  for (const [id, entry] of pending) {
    pending.delete(id);
    clearTimeout(entry.timer);
    entry.reject(err);
  }
}

function killDaemon(): void {
  const dying = child;
  child = null;
  stdoutBuffer = '';
  if (!dying) return;
  dying.removeAllListeners();
  dying.stdout?.removeAllListeners();
  dying.stderr?.removeAllListeners();
  try {
    dying.kill('SIGKILL');
  } catch {
    // already gone
  }
}

function onDaemonLine(line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg: DaemonMessage;
  try {
    msg = JSON.parse(trimmed) as DaemonMessage;
  } catch {
    return; // stray output — ignore rather than derail the protocol
  }
  const id = typeof msg.id === 'number' ? msg.id : NaN;
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  clearTimeout(entry.timer);
  if (typeof msg.error === 'string') {
    entry.reject(new Error(`jedi daemon: ${msg.error}`));
    return;
  }
  const raw = Array.isArray(msg.items) ? msg.items : [];
  const items: CompletionItem[] = [];
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    const label = typeof record.label === 'string' ? record.label : '';
    if (!label) continue;
    const item: CompletionItem = {
      label,
      kind: typeof record.kind === 'string' && record.kind ? record.kind : 'unknown',
    };
    if (typeof record.detail === 'string' && record.detail) item.detail = record.detail;
    items.push(item);
  }
  entry.resolve(items);
}

/** Start the daemon, wired for line-buffered JSON. Not detached: it dies with us. */
function startDaemon(): ChildProcess {
  // uv mode carries numpy too: jedi completes `np.` from what is importable in
  // ITS environment, and `uv run --with` envs are isolated from site-packages.
  const [bin, args] = daemonMode === 'uv'
    ? ['uv', ['run', '--quiet', '--with', 'jedi', '--with', 'numpy', 'python', DAEMON_SCRIPT]] as const
    : ['python3', ['-u', DAEMON_SCRIPT]] as const;
  const proc = spawn(bin, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  proc.stdout?.setEncoding('utf8');
  proc.stdout?.on('data', (chunk: string) => {
    stdoutBuffer += chunk;
    let nl = stdoutBuffer.indexOf('\n');
    while (nl !== -1) {
      const line = stdoutBuffer.slice(0, nl);
      stdoutBuffer = stdoutBuffer.slice(nl + 1);
      onDaemonLine(line);
      nl = stdoutBuffer.indexOf('\n');
    }
    // A single monstrous line would mean the protocol desynced; drop it.
    if (stdoutBuffer.length > 8_000_000) stdoutBuffer = '';
  });

  proc.stderr?.setEncoding('utf8');
  proc.stderr?.on('data', (chunk: string) => {
    const text = String(chunk).trim();
    if (text) console.error('[omnilearn][jedi]', text.slice(0, 500));
  });

  const die = (reason: string) => {
    if (child === proc) {
      child = null;
      stdoutBuffer = '';
    }
    settleAllPending(new Error(`jedi daemon ${reason}`));
  };
  proc.on('error', (err) => die(`could not start: ${err.message}`));
  proc.on('exit', (code, signal) => die(`exited (code ${code}, signal ${signal})`));

  return proc;
}

function daemon(): ChildProcess {
  if (child && !child.killed && child.exitCode === null) return child;
  child = startDaemon();
  return child;
}

/** Stop the daemon (process exit, tests). Safe to call when nothing is running. */
export function shutdownCompleteDaemon(): void {
  settleAllPending(new Error('jedi daemon shut down'));
  killDaemon();
}

/**
 * Fire-and-forget boot warm-up: spawn the daemon and pay jedi's one-time numpy
 * stub-indexing cost before any real keystroke needs it. Failures are fine —
 * the first real request just becomes the warm-up instead.
 */
export function warmCompleteDaemon(): void {
  if (!ensureAvailable()) return;
  askDaemon(
    { path: 'warmup.py', content: 'import numpy as np\nnp.', line: 2, column: 3 },
    null,
  ).then(
    () => { warmed = true; console.log('[omnilearn] jedi warm'); },
    () => { /* the first real request will warm it instead */ },
  );
}

/** Oldest-first drop valve: a burst of keystrokes must not queue up unbounded. */
function trimPending(): void {
  while (pending.size > MAX_PENDING) {
    const oldest = pending.keys().next();
    if (oldest.done) return;
    const entry = pending.get(oldest.value)!;
    pending.delete(oldest.value);
    clearTimeout(entry.timer);
    entry.resolve([]);
  }
}

function askDaemon(req: CompleteRequest, absPath: string | null): Promise<CompletionItem[]> {
  return new Promise<CompletionItem[]>((resolve, reject) => {
    let proc: ChildProcess;
    try {
      proc = daemon();
    } catch (err) {
      reject(new Error(`jedi daemon could not spawn: ${(err as Error).message}`));
      return;
    }
    if (!proc.stdin || proc.stdin.destroyed) {
      reject(new Error('jedi daemon has no stdin'));
      return;
    }

    const id = nextId++;
    // jedi's first pass over a big library (numpy) can take several seconds of
    // one-time stub indexing; only steady-state requests get the tight budget.
    // In uv mode the very first spawn may also resolve/download jedi+numpy.
    const budget = warmed
      ? REQUEST_TIMEOUT_MS
      : (daemonMode === 'uv' ? UV_FIRST_REQUEST_TIMEOUT_MS : FIRST_REQUEST_TIMEOUT_MS);
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`jedi daemon timed out after ${budget}ms`));
    }, budget);

    pending.set(id, { resolve, reject, timer });
    trimPending();

    const payload =
      JSON.stringify({
        id,
        source: req.content,
        path: absPath,
        line: req.line,
        column: req.column,
      }) + '\n';

    try {
      proc.stdin.write(payload, 'utf8');
    } catch (err) {
      pending.delete(id);
      clearTimeout(timer);
      reject(new Error(`writing to jedi daemon failed: ${(err as Error).message}`));
    }
  });
}

/**
 * One completion round trip, with at most ONE daemon restart per request.
 * Returns null when jedi cannot serve this request at all (caller falls back).
 */
async function completeViaJedi(req: CompleteRequest, absPath: string): Promise<CompletionItem[] | null> {
  if (Date.now() < giveUpUntil) return null;
  if (!ensureAvailable()) return null;

  try {
    const items = await askDaemon(req, absPath);
    consecutiveFailures = 0;
    warmed = true;
    return items;
  } catch (first) {
    // The daemon may simply have died. Tear it down — anything else queued
    // against it gets its own fallback rather than waiting out a timeout —
    // then restart once and try again.
    settleAllPending(new Error('jedi daemon restarting'));
    killDaemon();
    try {
      const items = await askDaemon(req, absPath);
      consecutiveFailures = 0;
      return items;
    } catch (second) {
      consecutiveFailures += 1;
      console.error(
        `[omnilearn] jedi completion failed (${consecutiveFailures}): ${(second as Error).message}` +
          ` [first attempt: ${(first as Error).message}]`,
      );
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        giveUpUntil = Date.now() + GIVE_UP_MS;
        consecutiveFailures = 0;
        killDaemon();
        console.error(`[omnilearn] jedi completions paused for ${GIVE_UP_MS / 1000}s`);
      }
      return null;
    }
  }
}

// ---------- fallback: identifiers already in the buffer ----------

const IDENTIFIER_RE = /[A-Za-z_][A-Za-z0-9_]*/g;

/** The identifier the cursor is currently in the middle of typing, if any. */
function tokenBeingTyped(content: string, line: number, column: number): string {
  const lines = content.split('\n');
  const text = lines[Math.min(Math.max(1, line), lines.length) - 1] ?? '';
  const col = Math.min(Math.max(0, column), text.length);
  const before = text.slice(0, col);
  const match = /[A-Za-z_][A-Za-z0-9_]*$/.exec(before);
  return match ? match[0] : '';
}

export function wordCompletions(content: string, line: number, column: number): CompletionItem[] {
  const typed = tokenBeingTyped(content, line, column);
  const seen = new Set<string>();
  const items: CompletionItem[] = [];
  for (const match of String(content ?? '').matchAll(IDENTIFIER_RE)) {
    const word = match[0];
    if (word === typed) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    items.push({ label: word, kind: 'word' });
    if (items.length >= MAX_WORD_ITEMS) break;
  }
  return items;
}

// ---------- route ----------

export async function complete(projectId: string, req: CompleteRequest): Promise<CompleteResponse> {
  const dir = projectDir(projectId); // 400 on a malformed id
  if (!(await exists(dir))) throw new HttpError(404, `no such project: ${projectId}`);
  const abs = resolveInProject(dir, req.path); // 400 on an escaping/empty path

  const items = await completeViaJedi(req, abs).catch(() => null);
  if (items) return { items, engine: 'jedi' };
  return { items: wordCompletions(req.content, req.line, req.column), engine: 'words' };
}

export const completeRouter: Router = Router();

completeRouter.post('/projects/:id/complete', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Partial<CompleteRequest>;
    const normalised: CompleteRequest = {
      path: typeof body.path === 'string' ? body.path : '',
      content: typeof body.content === 'string' ? body.content : '',
      line: Number.isFinite(body.line) ? Math.max(1, Math.floor(body.line as number)) : 1,
      column: Number.isFinite(body.column) ? Math.max(0, Math.floor(body.column as number)) : 0,
    };
    res.json(await complete(req.params.id, normalised));
  } catch (err) {
    next(err);
  }
});
