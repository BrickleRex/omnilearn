// ---------------------------------------------------------------------------
// Bail line — the one line a persona stopped reading at, painted as a soft red
// line background in the editor. It is a report, not a warning: no gutter mark,
// no popup, and it retires the moment the learner edits that line.
// ---------------------------------------------------------------------------
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

/** 1-based line number, or null to clear. */
export const setBailLine = StateEffect.define<number | null>();

const bailMark = Decoration.line({ class: 'cm-bail-line' });

export const bailLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    set = set.map(tr.changes);

    let explicit = false;
    for (const e of tr.effects) {
      if (!e.is(setBailLine)) continue;
      explicit = true;
      if (e.value == null) {
        set = Decoration.none;
      } else {
        const n = Math.max(1, Math.min(tr.newDoc.lines, e.value));
        set = Decoration.set([bailMark.range(tr.newDoc.line(n).from)]);
      }
    }

    // Editing the flagged line means the learner is already fixing it — the
    // tint has done its job and gets out of the way.
    if (!explicit && tr.docChanged && set.size) {
      let at = -1;
      set.between(0, tr.newDoc.length, (from) => { at = from; return false; });
      if (at >= 0) {
        const line = tr.newDoc.lineAt(at);
        let touched = false;
        tr.changes.iterChangedRanges((_fA, _tA, fB, tB) => {
          if (tB >= line.from && fB <= line.to) touched = true;
        });
        if (touched) set = Decoration.none;
      }
    }
    return set;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function bailLineExtension(): Extension {
  return [bailLineField];
}
