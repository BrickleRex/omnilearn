// The LLM layer: every generation shells out to the local Claude Code CLI in
// headless mode, which bills the user's Claude subscription. There is
// deliberately NO API key and NO Anthropic SDK here — see SPEC.md.
//
//   claude -p --model <alias> --output-format json --max-turns 1   (prompt on stdin)
//
// Concurrency: at most 2 CLI children at a time. 'watch' is lowest priority and
// additionally throttled to one call per project per 60s.

import { spawn } from 'node:child_process';
import { getSettings } from '../settings';

export type LlmTask = 'plan' | 'calibration' | 'primer' | 'hint' | 'ghost' | 'watch';

export interface CallClaudeOptions {
  task: LlmTask;
  prompt: string;
}

export function isMock(): boolean {
  return process.env.LLM_MOCK === '1';
}

const SLOW_TASKS = new Set<LlmTask>(['plan', 'calibration', 'primer']);
const TIMEOUT_SLOW_MS = 180_000;
const TIMEOUT_FAST_MS = 60_000;
const WATCH_THROTTLE_MS = 60_000;
const MAX_CONCURRENT = 2;

// ---------- model routing ----------

/** Settings has no `calibration` model slot; calibration rides with `plan` (opus). */
export async function modelForTask(task: LlmTask): Promise<string> {
  const { models } = await getSettings();
  switch (task) {
    case 'plan':
    case 'calibration':
      return models.plan;
    case 'primer':
      return models.primer;
    case 'hint':
      return models.hint;
    case 'ghost':
      return models.ghost;
    case 'watch':
      return models.watch;
  }
}

// ---------- watch throttle (per project) ----------

const lastWatchAt = new Map<string, number>();

/**
 * Reserve a watcher slot for a project. Returns false when the last watcher
 * call for that project was under 60s ago (caller should answer 'quiet'
 * without touching the CLI). Never throttles in mock mode.
 */
export function tryReserveWatch(projectId: string): boolean {
  if (isMock()) return true;
  const now = Date.now();
  const prev = lastWatchAt.get(projectId);
  if (prev !== undefined && now - prev < WATCH_THROTTLE_MS) return false;
  lastWatchAt.set(projectId, now);
  return true;
}

/** Test/debug helper — forget all throttle state. */
export function resetWatchThrottle(): void {
  lastWatchAt.clear();
}

// ---------- tiny priority queue (max 2 concurrent CLI calls) ----------

interface Waiter {
  priority: number; // lower runs first; watch = 10, everything else = 0
  seq: number;
  release: () => void;
}

let active = 0;
let seqCounter = 0;
const waiting: Waiter[] = [];

function pump(): void {
  while (active < MAX_CONCURRENT && waiting.length > 0) {
    waiting.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    const next = waiting.shift()!;
    active += 1;
    next.release();
  }
}

function acquire(priority: number): Promise<() => void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      active -= 1;
      pump();
    };
    waiting.push({ priority, seq: seqCounter++, release: () => resolve(finish) });
    pump();
  });
}

// ---------- the CLI call ----------

interface CliJson {
  result?: unknown;
  is_error?: boolean;
  error?: unknown;
  [k: string]: unknown;
}

function tail(text: string, n = 600): string {
  const t = text.trim();
  return t.length > n ? `…${t.slice(-n)}` : t;
}

function runCli(model: string, prompt: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      ['-p', '--model', model, '--output-format', 'json', '--max-turns', '1'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };
    const ok = (value: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => fail(new Error(`claude CLI could not start: ${err.message}`)));

    child.on('close', (code) => {
      if (timedOut) return fail(new Error(`claude CLI timed out after ${timeoutMs}ms (model ${model})`));
      if (code !== 0) {
        return fail(new Error(`claude CLI exited ${code}: ${tail(stderr) || tail(stdout)}`));
      }
      let parsed: CliJson;
      try {
        parsed = JSON.parse(stdout.trim()) as CliJson;
      } catch {
        return fail(new Error(`claude CLI returned non-JSON output: ${tail(stdout)}`));
      }
      if (parsed.is_error) {
        const msg = typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.error ?? parsed);
        return fail(new Error(`claude CLI reported an error: ${tail(String(msg))}`));
      }
      if (typeof parsed.result !== 'string') {
        return fail(new Error(`claude CLI response had no string "result" field: ${tail(stdout)}`));
      }
      ok(parsed.result);
    });

    try {
      child.stdin.write(prompt, 'utf8');
      child.stdin.end();
    } catch (err) {
      fail(new Error(`failed writing prompt to claude CLI: ${(err as Error).message}`));
    }
  });
}

/**
 * Run one headless Claude CLI turn and return its `result` text.
 * Queued (max 2 concurrent, watch last) and retried once on failure.
 */
export async function callClaude(opts: CallClaudeOptions): Promise<string> {
  const { task, prompt } = opts;
  if (isMock()) {
    throw new Error('callClaude must not be reached in LLM_MOCK mode — use fixtures');
  }
  const model = await modelForTask(task);
  const timeoutMs = SLOW_TASKS.has(task) ? TIMEOUT_SLOW_MS : TIMEOUT_FAST_MS;
  const release = await acquire(task === 'watch' ? 10 : 0);
  try {
    try {
      return await runCli(model, prompt, timeoutMs);
    } catch (first) {
      // one retry
      try {
        return await runCli(model, prompt, timeoutMs);
      } catch (second) {
        throw new Error(
          `claude CLI failed for task "${task}" (twice): ${(second as Error).message} ` +
            `[first attempt: ${(first as Error).message}]`,
        );
      }
    }
  } finally {
    release();
  }
}

// ---------- JSON extraction ----------

/**
 * Pull the first JSON object/array out of a model response. Tolerates
 * ```json fences, leading prose and trailing prose.
 */
export function extractJson<T>(text: string): T {
  if (typeof text !== 'string') throw new Error('extractJson: expected a string');

  // Fenced blocks first — the fence tells us exactly where the payload is.
  const fence = /```[ \t]*(?:json|JSON|json5)?[ \t]*\r?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text)) !== null) {
    const found = scanForJson<T>(m[1]);
    if (found.ok) return found.value;
  }

  const direct = scanForJson<T>(text);
  if (direct.ok) return direct.value;

  throw new Error(`no JSON object or array found in response: ${tail(text, 300)}`);
}

type Scan<T> = { ok: true; value: T } | { ok: false };

/** Try every `{`/`[` as a start, balanced-scan to its close, JSON.parse it. */
function scanForJson<T>(text: string): Scan<T> {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '{' && ch !== '[') continue;
    const end = matchBalanced(text, i);
    if (end === -1) continue;
    const slice = text.slice(i, end + 1);
    try {
      return { ok: true, value: JSON.parse(slice) as T };
    } catch {
      // not valid JSON starting here; keep looking
    }
  }
  return { ok: false };
}

/** Index of the bracket closing the one at `start`, or -1. String-aware. */
function matchBalanced(text: string, start: number): number {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}
