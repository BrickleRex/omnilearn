// ---------------------------------------------------------------------------
// The editor. CodeMirror 6 + python, wired to: auto-save (800ms debounce), the
// ghost line, the nudge gutter, and the workspace keyboard map.
// ---------------------------------------------------------------------------
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import {
  EditorView, drawSelection, dropCursor, highlightActiveLine,
  highlightActiveLineGutter, keymap, lineNumbers, rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import {
  acceptCompletion, autocompletion, closeCompletion, completionKeymap,
} from '@codemirror/autocomplete';
import { globalCompletion, localCompletionSource, python } from '@codemirror/lang-python';
import type { Scheme } from '../../shared/types';
import { api } from '../api';
import { jediCompletionSource } from './complete';
import { buildEditorTheme } from './theme';
import { dismissGhost, ghostActive, ghostExtension, showGhost } from './ghost';
import { nudgeGutter, setNudgeLine } from './nudge';

export type SaveState = 'saved' | 'saving' | 'error';

export interface EditorHandle {
  getContent(): string;
  getCursorLine(): number;
  /** Cancel the debounce and write immediately. */
  flush(): Promise<void>;
  showGhost(code: string): void;
  dismissGhost(): void;
  ghostActive(): boolean;
  setNudge(line: number | null): void;
  focus(): void;
}

export interface EditorProps {
  projectId: string;
  path: string;
  initialDoc: string;
  scheme: Scheme;
  onSaveState: (s: SaveState) => void;
  onEdit: () => void;
  onCursorLine: (line: number) => void;
  onHint: () => void;
  onGhost: () => void;
  onOpenNudge: () => void;
}

const SAVE_DEBOUNCE = 800;

const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(props, ref) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;

  const savedText = useRef(props.initialDoc);
  const timer = useRef<number | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const themeComp = useRef(new Compartment());
  const lastLine = useRef(0);

  // --- saving --------------------------------------------------------------
  const write = async () => {
    const v = view.current;
    if (!v) return;
    const { projectId, path, onSaveState } = latest.current;
    const content = v.state.doc.toString();
    if (content === savedText.current) { onSaveState('saved'); return; }
    onSaveState('saving');
    try {
      await api.writeFile(projectId, path, content);
      savedText.current = content;
      // another keystroke may have landed while we were writing
      const now = view.current?.state.doc.toString();
      onSaveState(now === undefined || now === savedText.current ? 'saved' : 'saving');
    } catch {
      latest.current.onSaveState('error');
    }
  };

  const save = () => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
    const run = (inFlight.current ?? Promise.resolve()).then(write, write);
    inFlight.current = run;
    return run;
  };

  const scheduleSave = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    latest.current.onSaveState('saving');
    timer.current = window.setTimeout(() => { timer.current = null; void save(); }, SAVE_DEBOUNCE);
  };

  // --- construction --------------------------------------------------------
  useEffect(() => {
    if (!host.current) return;

    const state = EditorState.create({
      doc: props.initialDoc,
      extensions: [
        lineNumbers(),
        nudgeGutter(() => latest.current.onOpenNudge()),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        indentOnInput(),
        bracketMatching(),
        // NOTE: no closeBrackets(). Auto-inserting the closing half of a pair
        // puts characters in the buffer that the learner did not type, which
        // both breaks ghost matching and quietly undercuts "type every line
        // yourself". Bracket *matching* (highlighting) stays.
        EditorState.allowMultipleSelections.of(true),
        EditorView.lineWrapping,

        // Workspace keys that must beat every built-in binding. These come
        // FIRST on purpose: autocompletion() registers its own Prec.highest
        // keymap (which owns Ctrl-Space), and within one precedence level the
        // earlier extension wins.
        Prec.highest(keymap.of([
          {
            key: 'Ctrl-Space',
            preventDefault: true,
            run: (v) => { closeCompletion(v); latest.current.onHint(); return true; },
          },
          {
            key: 'Ctrl-Shift-Space',
            preventDefault: true,
            run: (v) => { closeCompletion(v); latest.current.onGhost(); return true; },
          },
        ])),
        ghostExtension(),

        // ...and the completion keys minus Ctrl-Space, which is the hint now.
        //
        // `override` rather than another `pythonLanguage.data.of(...)`: it makes
        // the running order explicit and unarguable — jedi first, then the two
        // sources python() would have registered on its own (which we therefore
        // have to name here, since override replaces the language-data set).
        autocompletion({
          activateOnTyping: true,
          icons: true,
          defaultKeymap: false,
          override: [
            jediCompletionSource(props.projectId, () => latest.current.path),
            localCompletionSource,
            globalCompletion,
          ],
        }),
        Prec.high(keymap.of(completionKeymap.filter((b) => b.key !== 'Ctrl-Space'))),
        python(),

        // Tab: accept a completion if one is open, otherwise indent. The ghost's
        // Prec.highest Tab guard already refused before we get here.
        keymap.of([
          { key: 'Tab', run: acceptCompletion },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),

        themeComp.current.of(buildEditorTheme()),

        EditorView.updateListener.of((u) => {
          if (u.docChanged) { latest.current.onEdit(); scheduleSave(); }
          if (u.docChanged || u.selectionSet) {
            const line = u.state.doc.lineAt(u.state.selection.main.head).number;
            if (line !== lastLine.current) {
              lastLine.current = line;
              latest.current.onCursorLine(line);
            }
          }
        }),
      ],
    });

    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    savedText.current = props.initialDoc;
    lastLine.current = v.state.doc.lineAt(v.state.selection.main.head).number;
    v.focus();

    return () => {
      if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
      v.destroy();
      view.current = null;
    };
    // A new file remounts the component (keyed on path in Workspace), so this
    // only ever needs to run once per instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- scheme swap: rebuild the theme + highlight style ---------------------
  useEffect(() => {
    // App writes :root[data-scheme] in a parent effect, which runs AFTER this
    // child effect — wait a frame so getComputedStyle sees the new palette.
    const raf = requestAnimationFrame(() => {
      view.current?.dispatch({ effects: themeComp.current.reconfigure(buildEditorTheme()) });
    });
    return () => cancelAnimationFrame(raf);
  }, [props.scheme]);

  // --- imperative surface --------------------------------------------------
  useImperativeHandle(ref, (): EditorHandle => ({
    getContent: () => view.current?.state.doc.toString() ?? '',
    getCursorLine: () => {
      const v = view.current;
      if (!v) return 1;
      return v.state.doc.lineAt(v.state.selection.main.head).number;
    },
    flush: () => save(),
    showGhost: (code) => { const v = view.current; if (v) showGhost(v, code); },
    dismissGhost: () => { const v = view.current; if (v) dismissGhost(v); },
    ghostActive: () => (view.current ? ghostActive(view.current.state) : false),
    setNudge: (line) => view.current?.dispatch({ effects: setNudgeLine.of(line) }),
    focus: () => view.current?.focus(),
  }), []);

  return <div className="wsEditor" data-testid="editor" ref={host} />;
});

export default Editor;
