// Picking the python interpreter for a run: plain python3, or `uv run` for
// people who live in uv-land (or have no python on PATH at all).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { RunnerPref } from '../shared/types';
import { HttpError } from './store';

export interface RunnerChoice {
  bin: string;
  args: string[];
  display: string;   // what the rail shows as "$ <display>"
  timeoutMs: number; // uv gets longer: a first run may create an env and fetch deps
}

export interface Avail { uv: boolean; python3: boolean; python: boolean }

const PY_TIMEOUT_MS = 30_000;
const UV_TIMEOUT_MS = 120_000;

const binCache = new Map<string, boolean>();

export function hasBin(bin: string): boolean {
  const hit = binCache.get(bin);
  if (hit !== undefined) return hit;
  let ok = false;
  try {
    ok = spawnSync(bin, ['--version'], { stdio: 'ignore', timeout: 5_000 }).status === 0;
  } catch {
    ok = false;
  }
  binCache.set(bin, ok);
  return ok;
}

export function detectAvail(): Avail {
  return { uv: hasBin('uv'), python3: hasBin('python3'), python: hasBin('python') };
}

/** PEP 723 inline script metadata: `# /// script` near the top of the file. */
export function scriptHasInlineDeps(source: string): boolean {
  return /^# \/\/\/ script\s*$/m.test(source.slice(0, 4_000));
}

/** uv-shaped project: pyproject/uv.lock/.python-version at the project root. */
export function projectWantsUv(dir: string): boolean {
  return ['pyproject.toml', 'uv.lock', '.python-version'].some((f) =>
    fs.existsSync(path.join(dir, f)),
  );
}

export function chooseRunner(
  pref: RunnerPref,
  avail: Avail,
  wantsUv: boolean,
  rel: string,
): RunnerChoice {
  const uv: RunnerChoice = {
    bin: 'uv', args: ['run', '--quiet', rel], display: `uv run ${rel}`, timeoutMs: UV_TIMEOUT_MS,
  };
  const py3: RunnerChoice = { bin: 'python3', args: [rel], display: `python3 ${rel}`, timeoutMs: PY_TIMEOUT_MS };
  const py: RunnerChoice = { bin: 'python', args: [rel], display: `python ${rel}`, timeoutMs: PY_TIMEOUT_MS };

  if (pref === 'uv') {
    if (!avail.uv) {
      throw new HttpError(400, 'Runner is set to uv, but `uv` is not on PATH. Install it (https://docs.astral.sh/uv/) or switch the runner in settings.');
    }
    return uv;
  }
  if (pref === 'python') {
    if (avail.python3) return py3;
    if (avail.python) return py;
    throw new HttpError(400, 'Runner is set to python, but neither `python3` nor `python` is on PATH. Install Python or switch the runner to uv in settings.');
  }
  // auto: uv when the project/script asks for it or nothing else exists;
  // otherwise plain python, with uv as the final fallback.
  if (avail.uv && (wantsUv || (!avail.python3 && !avail.python))) return uv;
  if (avail.python3) return py3;
  if (avail.python) return py;
  if (avail.uv) return uv;
  throw new HttpError(400, 'No way to run python: nothing named `python3`, `python`, or `uv` is on PATH. Install Python or uv (https://docs.astral.sh/uv/).');
}

/** For runner.ts: resolve everything from disk + settings in one call. */
export function resolveRunner(
  pref: RunnerPref,
  projectDirAbs: string,
  rel: string,
  source: string,
): RunnerChoice {
  const wantsUv = scriptHasInlineDeps(source) || projectWantsUv(projectDirAbs);
  return chooseRunner(pref, detectAvail(), wantsUv, rel);
}

/** Test hook: clear the binary-detection cache. */
export function resetBinCache(): void {
  binCache.clear();
}
