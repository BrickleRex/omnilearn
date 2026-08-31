// ---------------------------------------------------------------------------
// Watcher nudge marker: a small amber dot in its own gutter column. Never modal,
// never a popup — the note itself only appears in the Footlight (Alt+H or a
// click on the dot). The dot clears when that line is edited.
// ---------------------------------------------------------------------------
import { RangeSet, StateEffect, StateField, type Extension } from '@codemirror/state';
import { GutterMarker, gutter } from '@codemirror/view';

export const setNudgeLine = StateEffect.define<number | null>(); // 1-based line, null clears

class NudgeDot extends GutterMarker {
  toDOM() {
    const dot = document.createElement('span');
    dot.className = 'cm-nudge-dot';
    dot.setAttribute('data-testid', 'nudge-dot');
    dot.title = 'the watcher noticed something — Alt+H';
    return dot;
  }
}
const dot = new NudgeDot();

class NudgeSpacer extends GutterMarker {
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-nudge-spacer';
    return s;
  }
}
const spacer = new NudgeSpacer();

export const nudgeField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes);

    let explicit = false;
    for (const e of tr.effects) {
      if (!e.is(setNudgeLine)) continue;
      explicit = true;
      if (e.value == null) {
        set = RangeSet.empty;
      } else {
        const n = Math.max(1, Math.min(tr.newDoc.lines, e.value));
        set = RangeSet.of([dot.range(tr.newDoc.line(n).from)]);
      }
    }

    // editing the marked line retires the marker
    if (!explicit && tr.docChanged && set.size) {
      let at = -1;
      set.between(0, tr.newDoc.length, (from) => { at = from; return false; });
      if (at >= 0) {
        const line = tr.newDoc.lineAt(at);
        let touched = false;
        tr.changes.iterChangedRanges((_fA, _tA, fB, tB) => {
          if (tB >= line.from && fB <= line.to) touched = true;
        });
        if (touched) set = RangeSet.empty;
      }
    }
    return set;
  },
});

export function nudgeGutter(onOpen: () => void): Extension {
  return [
    nudgeField,
    gutter({
      class: 'cm-nudge-gutter',
      markers: (view) => view.state.field(nudgeField),
      initialSpacer: () => spacer,
      domEventHandlers: {
        mousedown: () => { onOpen(); return true; },
      },
    }),
  ];
}
