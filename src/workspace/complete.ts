// ---------------------------------------------------------------------------
// Real intellisense. CodeMirror's own sources only know keywords and words that
// already exist in the buffer, so `np.` shows nothing. This source asks the
// server, which runs jedi (static analysis — fast, local, never an LLM) over the
// exact buffer the learner is looking at.
//
// It is deliberately fail-soft: no path, no trigger, a slow reply that a newer
// keystroke has already superseded, or any error at all -> return null and let
// the local sources carry the tooltip.
// ---------------------------------------------------------------------------
import type {
  Completion, CompletionContext, CompletionResult, CompletionSource,
} from '@codemirror/autocomplete';
import { api } from '../api';

/**
 * jedi's `type` strings -> CodeMirror completion types (which pick the icon).
 * Anything jedi invents that isn't listed falls back to 'variable'.
 */
const KIND_TO_TYPE: Record<string, string> = {
  function: 'function',
  class: 'class',
  module: 'namespace',
  instance: 'variable',
  statement: 'variable',
  keyword: 'keyword',
  param: 'variable',
  property: 'property',
};

/**
 * Jedi hands items back in relevance order, but CodeMirror re-sorts everything
 * from every source by fuzzy-match score. A small boost makes a jedi item win a
 * tie against an identically-matching local/keyword item without ever letting a
 * weak jedi match jump over a strong local one; the sub-thousandth tail keeps
 * jedi's own ordering intact among items that scored the same.
 */
const JEDI_BOOST = 1;

/** Bumped on every request so a stale reply can recognise itself and bow out. */
let seq = 0;

export function jediCompletionSource(
  projectId: string,
  getPath: () => string | null,
): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const path = getPath();
    if (!path) return null;

    const doc = context.state.doc;
    if (context.pos > doc.length) return null;

    // jedi's coordinates: line is 1-based, column is 0-based within that line.
    const docLine = doc.lineAt(context.pos);
    const line = docLine.number;
    const column = context.pos - docLine.from;

    // --- when to fire -------------------------------------------------------
    // Explicitly asked for; or the user just typed a '.' (the whole reason this
    // exists); or they are part-way through a word. Anything else — a bare
    // space, a fresh empty line — stays quiet rather than burning a request.
    const afterDot = context.pos > 0 && doc.sliceString(context.pos - 1, context.pos) === '.';
    const typing = context.matchBefore(/[\w.]+$/);
    if (!context.explicit && !afterDot && !typing) return null;

    // Replace only the word segment after the last '.', never the qualifier:
    // in `np.ze` the completion overwrites `ze`, leaving `np.` alone.
    const segment = context.matchBefore(/\w*$/);
    const from = segment ? segment.from : context.pos;

    const mine = ++seq;
    let items;
    let engine;
    try {
      const res = await api.complete(projectId, {
        path,
        content: doc.toString(),
        line,
        column,
      });
      items = res.items ?? [];
      engine = res.engine;
    } catch {
      return null; // fail soft — the local sources still have the tooltip
    }

    // The keystroke that asked for this may be long gone.
    if (context.aborted || mine !== seq) return null;
    if (!items.length) return null;

    const n = items.length;
    const options: Completion[] = items.map((item, i): Completion => ({
      label: item.label,
      // The 'words' fallback is not real analysis, so don't dress it up with
      // function/class icons — but do show it. Better than nothing.
      type: engine === 'words' ? 'text' : (KIND_TO_TYPE[item.kind] ?? 'variable'),
      detail: item.detail || undefined,
      boost: JEDI_BOOST + (n - i) / (n * 1000),
    }));

    // Typing more word characters filters this list in the browser instead of
    // asking the server again; a new '.' breaks the pattern and re-queries.
    return { from, options, validFor: /^\w*$/ };
  };
}
