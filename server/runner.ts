// POST /api/projects/:id/run — run one python file inside the project folder.

import { Router } from 'express';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import type { RunResult } from '../shared/types';
import { HttpError, projectDir, resolveInProject, toPosix } from './store';
import { resolveRunner } from './interp';
import { getSettings } from './settings';
import path from 'node:path';

const OUTPUT_CAP = 200_000;

/** Last structured run per project — the watcher endpoint may lean on this. */
const lastRuns = new Map<string, RunResult>();

export function getLastRun(projectId: string): RunResult | undefined {
  return lastRuns.get(projectId);
}

function cap(text: string): string {
  return text.length > OUTPUT_CAP
    ? text.slice(0, OUTPUT_CAP) + `\n…[truncated at ${OUTPUT_CAP} chars]`
    : text;
}

export async function runFile(projectId: string, relPath: string): Promise<RunResult> {
  const dir = projectDir(projectId);
  const abs = resolveInProject(dir, relPath);
  try {
    const stat = await fsp.stat(abs);
    if (!stat.isFile()) throw new HttpError(400, `not a file: ${relPath}`);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(404, `no such file: ${relPath}`);
  }

  const rel = toPosix(path.relative(dir, abs));
  const source = await fsp.readFile(abs, 'utf8').catch(() => '');
  const settings = await getSettings();
  const runner = resolveRunner(settings.runner ?? 'auto', dir, rel, source);
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const result = await new Promise<RunResult>((resolve) => {
    const child = spawn(runner.bin, runner.args, {
      cwd: dir,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, runner.timeoutMs);

    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        stderr += `\n[omnilearn] killed after ${runner.timeoutMs / 1000}s timeout`;
      }
      resolve({
        path: rel,
        exitCode,
        stdout: cap(stdout),
        stderr: cap(stderr),
        durationMs: Date.now() - t0,
        startedAt,
        command: runner.display,
      });
    };

    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < OUTPUT_CAP * 2) stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < OUTPUT_CAP * 2) stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      stderr += `\n[omnilearn] could not start ${runner.bin}: ${err.message}`;
      finish(127);
    });
    child.on('close', (code, signal) => {
      finish(code === null ? (signal ? 137 : -1) : code);
    });
  });

  lastRuns.set(projectId, result);
  return result;
}

export const runnerRouter: Router = Router();

runnerRouter.post('/projects/:id/run', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { path?: unknown };
    if (typeof body.path !== 'string' || !body.path) {
      throw new HttpError(400, 'body.path must be a non-empty string');
    }
    res.json(await runFile(req.params.id, body.path));
  } catch (err) {
    next(err);
  }
});
