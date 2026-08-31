import { describe, expect, it } from 'vitest';
import { chooseRunner, scriptHasInlineDeps } from './interp';
import { HttpError } from './store';

const all = { uv: true, python3: true, python: true };
const uvOnly = { uv: true, python3: false, python: false };
const pyOnly = { uv: false, python3: true, python: false };
const none = { uv: false, python3: false, python: false };

describe('chooseRunner', () => {
  it('auto prefers python3 for plain scripts', () => {
    expect(chooseRunner('auto', all, false, 'a.py').bin).toBe('python3');
  });
  it('auto prefers uv when the script/project wants it', () => {
    expect(chooseRunner('auto', all, true, 'a.py').bin).toBe('uv');
  });
  it('auto falls back to uv when no python is on PATH', () => {
    expect(chooseRunner('auto', uvOnly, false, 'a.py').bin).toBe('uv');
  });
  it('auto falls back to bare python when python3 is missing', () => {
    expect(chooseRunner('auto', { uv: false, python3: false, python: true }, false, 'a.py').bin).toBe('python');
  });
  it('auto with nothing available throws a helpful 400', () => {
    expect(() => chooseRunner('auto', none, false, 'a.py')).toThrowError(HttpError);
    expect(() => chooseRunner('auto', none, false, 'a.py')).toThrowError(/uv/);
  });
  it('pref uv is honored and errors without uv', () => {
    expect(chooseRunner('uv', all, false, 'a.py').display).toBe('uv run a.py');
    expect(() => chooseRunner('uv', pyOnly, false, 'a.py')).toThrowError(/not on PATH/);
  });
  it('pref python never picks uv even when the script wants it', () => {
    expect(chooseRunner('python', all, true, 'a.py').bin).toBe('python3');
    expect(() => chooseRunner('python', uvOnly, true, 'a.py')).toThrowError(HttpError);
  });
  it('uv runs get the longer timeout', () => {
    expect(chooseRunner('uv', all, false, 'a.py').timeoutMs).toBeGreaterThan(
      chooseRunner('python', all, false, 'a.py').timeoutMs,
    );
  });
});

describe('scriptHasInlineDeps', () => {
  it('detects a PEP 723 block', () => {
    expect(scriptHasInlineDeps('# /// script\n# dependencies = ["numpy"]\n# ///\nimport numpy\n')).toBe(true);
  });
  it('detects it below a docstring', () => {
    expect(scriptHasInlineDeps('"""doc"""\n# /// script\n# dependencies = []\n# ///\n')).toBe(true);
  });
  it('ignores plain scripts and lookalikes', () => {
    expect(scriptHasInlineDeps('import os\nprint(os.name)\n')).toBe(false);
    expect(scriptHasInlineDeps('x = "# /// script"\n')).toBe(false);
  });
});
