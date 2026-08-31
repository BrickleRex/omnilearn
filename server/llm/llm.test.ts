import { describe, expect, it } from 'vitest';
import { extractJson } from './llm';

describe('extractJson', () => {
  it('parses a bare object', () => {
    expect(extractJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses a bare array', () => {
    expect(extractJson<number[]>('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('skips leading prose', () => {
    expect(extractJson<{ hint: string }>('Sure! Here you go:\n{"hint":"go"}')).toEqual({ hint: 'go' });
  });

  it('ignores trailing prose', () => {
    expect(extractJson<{ a: 1 }>('{"a":1}\n\nHope that helps.')).toEqual({ a: 1 });
  });

  it('unwraps a ```json fence', () => {
    const text = 'Here:\n```json\n{"posture":"quiet"}\n```\nDone.';
    expect(extractJson<{ posture: string }>(text)).toEqual({ posture: 'quiet' });
  });

  it('unwraps an unlabelled fence', () => {
    expect(extractJson<{ code: string }>('```\n{"code":"x = 1"}\n```')).toEqual({ code: 'x = 1' });
  });

  it('is not fooled by braces inside strings', () => {
    const text = '```json\n{"note":"use {} to make a dict","line":3}\n```';
    expect(extractJson<{ note: string; line: number }>(text)).toEqual({
      note: 'use {} to make a dict',
      line: 3,
    });
  });

  it('handles escaped quotes and nested structures', () => {
    const text = 'prose {not json} more\n{"a":{"b":[1,{"c":"say \\"hi\\""}]}}';
    expect(extractJson<{ a: { b: unknown[] } }>(text)).toEqual({
      a: { b: [1, { c: 'say "hi"' }] },
    });
  });

  it('prefers the fenced block over earlier prose braces', () => {
    const text = 'I considered {a} first.\n```json\n{"chosen":true}\n```';
    expect(extractJson<{ chosen: boolean }>(text)).toEqual({ chosen: true });
  });

  it('throws when there is no JSON at all', () => {
    expect(() => extractJson('no json here')).toThrow(/no JSON/);
  });
});
