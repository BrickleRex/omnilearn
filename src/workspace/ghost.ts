// ---------------------------------------------------------------------------
// Ghost line — treatment G2 "Hollow".
//
// A ghost is ONE line of code the model suggests. It never enters the buffer on
// its own: it is painted as an inline widget (hollow, stroke-only letters) that
// sits after the cursor. As the user types matching characters those characters
// become REAL buffer text (briefly tinted --ghost-fill, then fading to normal
// syntax colour) and the hollow remainder shrinks. Tab is refused. Esc, three
// diverging characters, or moving to another line dismiss it.
// ---------------------------------------------------------------------------
import { Prec, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import {
  Decoration, EditorView, ViewPlugin, WidgetType,
  keymap, type DecorationSet, type ViewUpdate,
} from '@codemirror/view';
import { closeCompletion, completionStatus } from '@codemirror/autocomplete';

export interface GhostState {
  /** The full text the user is expected to type (already stripped of what is on the line). */
  text: string;
  /** Anchor: document position where the ghost begins. */
  from: number;
  /** How many characters of `text` the user has correctly typed. */
  typedCount: number;
  /** Consecutive diverging insertions; 3 dismisses the ghost. */
  diverged: number;
  /** True while the "no Tab" refusal is being shown. */
  refusing: boolean;
}

export const setGhostEffect = StateEffect.define<{ text: string; from: number }>();
export const clearGhostEffect = StateEffect.define<null>();
export const refuseGhostEffect = StateEffect.define<boolean>();

const REFUSE_MS = 1500;
const FADE_MS = 1500;
const DIVERGE_LIMIT = 3;

// ---------------------------------------------------------------------------
// widget
// ---------------------------------------------------------------------------
class GhostWidget extends WidgetType {
  constructor(readonly remaining: string, readonly refusing: boolean) { super(); }

  eq(other: GhostWidget) {
    return other.remaining === this.remaining && other.refusing === this.refusing;
  }

  toDOM() {
    const wrap = document.createElement('span');
    wrap.className = 'cm-ghost-widget' + (this.refusing ? ' cm-ghost-shake' : '');
    wrap.setAttribute('data-testid', 'ghost-widget');

    const text = document.createElement('span');
    text.className = 'cm-ghost-text';
    // Preserve leading/interior spaces of the not-yet-typed remainder.
    text.textContent = this.remaining.replace(/ /g, ' ');
    wrap.appendChild(text);

    const chip = document.createElement('span');
    chip.className = 'cm-ghost-chip';
    chip.textContent = 'PRACTICE';
    wrap.appendChild(chip);

    if (this.refusing) {
      const tip = document.createElement('span');
      tip.className = 'cm-ghost-refuse';
      tip.setAttribute('data-testid', 'ghost-refuse');
      tip.textContent = 'practice line — type it yourself';
      wrap.appendChild(tip);
    }
    return wrap;
  }

  ignoreEvent() { return true; }
}

// ---------------------------------------------------------------------------
// state field
// ---------------------------------------------------------------------------
export const ghostField = StateField.define<GhostState | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setGhostEffect)) {
        return { text: e.value.text, from: e.value.from, typedCount: 0, diverged: 0, refusing: false };
      }
      if (e.is(clearGhostEffect)) return null;
    }
    if (!value) return null;

    let v = value;
    for (const e of tr.effects) if (e.is(refuseGhostEffect)) v = { ...v, refusing: e.value };
    if (!tr.docChanged) return v;

    // Collect the changes; ordinary typing is always exactly one.
    const changes: Array<{ fA: number; tA: number; ins: string }> = [];
    tr.changes.iterChanges((fA, tA, _fB, _tB, ins) => changes.push({ fA, tA, ins: ins.toString() }));
    if (changes.length !== 1) return null;

    const c = changes[0];
    const frontier = v.from + v.typedCount;
    const from = tr.changes.mapPos(v.from, -1);

    // (a) insertion exactly at the typing frontier
    if (c.fA === c.tA && c.fA === frontier && c.ins.length > 0) {
      const want = v.text.slice(v.typedCount, v.typedCount + c.ins.length);
      if (c.ins === want) {
        return { ...v, from, typedCount: v.typedCount + c.ins.length, diverged: 0, refusing: false };
      }
      const diverged = v.diverged + 1;
      return diverged >= DIVERGE_LIMIT ? null : { ...v, from, diverged };
    }

    // (b) backspace inside the already-typed region
    if (c.ins.length === 0 && c.tA === frontier && c.fA >= v.from && c.tA > c.fA) {
      return { ...v, from, typedCount: Math.max(0, v.typedCount - (c.tA - c.fA)) };
    }

    // (c) anything else counts as divergence
    const diverged = v.diverged + 1;
    return diverged >= DIVERGE_LIMIT ? null : { ...v, from, diverged };
  },
});

const ghostDecorations = EditorView.decorations.compute([ghostField], (state) => {
  const g = state.field(ghostField);
  if (!g) return Decoration.none;
  const pos = Math.min(Math.max(0, g.from + g.typedCount), state.doc.length);
  return Decoration.set([
    Decoration.widget({
      widget: new GhostWidget(g.text.slice(g.typedCount), g.refusing),
      side: 1,
    }).range(pos),
  ]);
});

// ---------------------------------------------------------------------------
// "just typed" fade decorations — solid --ghost-fill that relaxes to the normal
// syntax colour after FADE_MS. Added/removed on a timer.
// ---------------------------------------------------------------------------
const addFade = StateEffect.define<{ from: number; to: number; id: number }>();
const dropFade = StateEffect.define<number>();
let fadeSeq = 0;

const fadeField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(addFade)) {
        const { from, to, id } = e.value;
        if (to > from && to <= tr.newDoc.length) {
          set = set.update({ add: [Decoration.mark({ class: 'cm-ghost-typed', fadeId: id }).range(from, to)] });
        }
      } else if (e.is(dropFade)) {
        const id = e.value;
        set = set.update({
          filter: (_f, _t, val) => (val.spec as { fadeId?: number }).fadeId !== id,
        });
      }
    }
    return set;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---------------------------------------------------------------------------
// driver plugin: fades, auto-dismiss, autocomplete suppression
// ---------------------------------------------------------------------------
const ghostDriver = ViewPlugin.fromClass(class {
  private timers: number[] = [];
  constructor(readonly view: EditorView) {}

  update(u: ViewUpdate) {
    const prev = u.startState.field(ghostField, false) ?? null;
    const cur = u.state.field(ghostField, false) ?? null;
    if (!cur) return;

    // 1. newly typed characters get the fill decoration
    if (prev && cur.typedCount > prev.typedCount) {
      const from = cur.from + prev.typedCount;
      const to = cur.from + cur.typedCount;
      const id = ++fadeSeq;
      this.later(() => {
        this.view.dispatch({ effects: addFade.of({ from, to, id }) });
        this.later(() => this.view.dispatch({ effects: dropFade.of(id) }), FADE_MS);
      });
    }

    // 2. the ghost is fully typed — retire it
    if (cur.typedCount >= cur.text.length) {
      this.later(() => this.view.dispatch({ effects: clearGhostEffect.of(null) }));
      return;
    }

    // 3. cursor left the ghost's line
    const doc = u.state.doc;
    const anchorLine = doc.lineAt(Math.min(cur.from, doc.length)).number;
    const headLine = doc.lineAt(Math.min(u.state.selection.main.head, doc.length)).number;
    if (anchorLine !== headLine) {
      this.later(() => this.view.dispatch({ effects: clearGhostEffect.of(null) }));
      return;
    }

    // 4. never let the autocomplete tooltip share the screen with a ghost
    if (completionStatus(u.state) !== null) this.later(() => closeCompletion(this.view));
  }

  private later(fn: () => void, ms?: number) {
    const id = window.setTimeout(() => {
      this.timers = this.timers.filter((t) => t !== id);
      if (this.view.dom.isConnected) fn();
    }, ms ?? 0);
    this.timers.push(id);
  }

  destroy() { for (const t of this.timers) clearTimeout(t); this.timers = []; }
});

// ---------------------------------------------------------------------------
// keys (highest precedence): Tab refusal + Esc dismissal
// ---------------------------------------------------------------------------
function refuse(view: EditorView) {
  view.dispatch({ effects: refuseGhostEffect.of(true) });
  window.setTimeout(() => {
    if (!view.dom.isConnected) return;
    if (view.state.field(ghostField, false)) view.dispatch({ effects: refuseGhostEffect.of(false) });
  }, REFUSE_MS);
}

const ghostKeymap = Prec.highest(keymap.of([
  {
    key: 'Tab',
    run: (view) => {
      if (!view.state.field(ghostField, false)) return false; // normal Tab behaviour
      refuse(view);
      return true;
    },
  },
  {
    key: 'Escape',
    run: (view) => {
      if (!view.state.field(ghostField, false)) return false;
      view.dispatch({ effects: clearGhostEffect.of(null) });
      return true;
    },
  },
]));

export function ghostExtension(): Extension {
  return [ghostField, fadeField, ghostDecorations, ghostDriver, ghostKeymap];
}

// ---------------------------------------------------------------------------
// public helpers
// ---------------------------------------------------------------------------
export function ghostActive(state: EditorState): boolean {
  return state.field(ghostField, false) != null;
}

export function dismissGhost(view: EditorView) {
  if (view.state.field(ghostField, false)) view.dispatch({ effects: clearGhostEffect.of(null) });
}

/**
 * Turn a raw model line into the remainder the user still has to type, and pin
 * it at the cursor. Whatever is already on the line before the cursor is peeled
 * off the front so the ghost only ever shows what is missing.
 */
export function showGhost(view: EditorView, code: string) {
  const raw = (code ?? '').split('\n')[0].replace(/\s+$/, '');
  if (!raw.trim()) return;

  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const before = view.state.doc.sliceString(line.from, pos);

  let text = raw;
  if (before && raw.startsWith(before)) text = raw.slice(before.length);
  else if (/^\s*$/.test(before)) text = raw.replace(/^\s+/, '');
  else {
    const trimmed = raw.replace(/^\s+/, '');
    const beforeTrimmed = before.replace(/^\s+/, '');
    if (beforeTrimmed && trimmed.startsWith(beforeTrimmed)) text = trimmed.slice(beforeTrimmed.length);
  }
  if (!text) return;

  closeCompletion(view);
  view.dispatch({ effects: setGhostEffect.of({ text, from: pos }) });
  view.focus();
}
