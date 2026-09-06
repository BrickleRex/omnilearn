// ---------------------------------------------------------------------------
// The Make editor: CodeMirror 6 + markdown, wired to the shared ghost line, the
// shared nudge gutter and the bail-line tint. No autocompletion, no bracket
// closing, no Tab-accept — the learner types every word of the draft.
// Saving is NOT here: a version is an iteration, so only Run / Snapshot /
// Cmd+S write to the server (see SkillMake).
// ---------------------------------------------------------------------------
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import {
  EditorView, drawSelection, dropCursor, highlightActiveLine,
  highlightActiveLineGutter, keymap, lineNumbers, rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import type { Scheme } from '../../../shared/types';
import { buildEditorTheme } from '../../workspace/theme';
import { dismissGhost, ghostActive, ghostExtension, showGhost } from '../../workspace/ghost';
import { nudgeGutter, setNudgeLine } from '../../workspace/nudge';
import { bailLineExtension, setBailLine } from './bailLine';
import { ghostClassExtension, tagGhosts } from './ghostClass';

export interface MakeEditorHandle {
  getContent(): string;
  getCursorLine(): number;
  /** false when the line already says it — nothing was shown. */
  showGhost(text: string): boolean;
  dismissGhost(): void;
  setNudge(line: number | null): void;
  setBail(line: number | null): void;
  focus(): void;
}

export interface MakeEditorProps {
  initialDoc: string;
  scheme: Scheme;
  readOnly?: boolean;
  onEdit: (text: string) => void;
  onCursorLine: (line: number) => void;
  onHint: () => void;
  onGhost: () => void;
  onRun: () => void;
  onSnapshot: () => void;
  onOpenNudge: () => void;
}

const MakeEditor = forwardRef<MakeEditorHandle, MakeEditorProps>(function MakeEditor(props, ref) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;

  const themeComp = useRef(new Compartment());
  const roComp = useRef(new Compartment());
  const lastLine = useRef(0);

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
        EditorState.allowMultipleSelections.of(true),
        EditorView.lineWrapping,

        // These have to beat every built-in binding, and Mod-Enter especially:
        // defaultKeymap would otherwise open a blank line in the draft on every
        // run, quietly editing text the learner did not type.
        Prec.highest(keymap.of([
          { key: 'Ctrl-Space', preventDefault: true, run: () => { latest.current.onHint(); return true; } },
          { key: 'Ctrl-Shift-Space', preventDefault: true, run: () => { latest.current.onGhost(); return true; } },
          { key: 'Mod-Enter', preventDefault: true, run: () => { latest.current.onRun(); return true; } },
          { key: 'Mod-s', preventDefault: true, run: () => { latest.current.onSnapshot(); return true; } },
        ])),

        ghostExtension(),
        ghostClassExtension(),
        bailLineExtension(),
        markdown(),

        // No closeBrackets, no autocompletion, no indentWithTab: nothing may put
        // a character in this buffer that the learner did not type.
        keymap.of([...defaultKeymap, ...historyKeymap]),

        themeComp.current.of(buildEditorTheme()),
        roComp.current.of(EditorState.readOnly.of(!!props.readOnly)),

        EditorView.updateListener.of((u) => {
          if (u.docChanged) latest.current.onEdit(u.state.doc.toString());
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
    lastLine.current = v.state.doc.lineAt(v.state.selection.main.head).number;
    if (!props.readOnly) v.focus();

    return () => { v.destroy(); view.current = null; };
    // Remounted (keyed on the draft/version) whenever the document identity
    // changes, so this only ever runs once per instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // scheme swap: App writes :root[data-scheme] in a parent effect that runs
  // after this one, so wait a frame for the new palette.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      view.current?.dispatch({ effects: themeComp.current.reconfigure(buildEditorTheme()) });
    });
    return () => cancelAnimationFrame(raf);
  }, [props.scheme]);

  useEffect(() => {
    view.current?.dispatch({
      effects: roComp.current.reconfigure(EditorState.readOnly.of(!!props.readOnly)),
    });
  }, [props.readOnly]);

  useImperativeHandle(ref, (): MakeEditorHandle => ({
    getContent: () => view.current?.state.doc.toString() ?? '',
    getCursorLine: () => {
      const v = view.current;
      if (!v) return 1;
      return v.state.doc.lineAt(v.state.selection.main.head).number;
    },
    showGhost: (text) => {
      const v = view.current;
      if (!v) return false;
      showGhost(v, text);
      requestAnimationFrame(() => tagGhosts(v.dom));
      return ghostActive(v.state);
    },
    dismissGhost: () => { const v = view.current; if (v) dismissGhost(v); },
    setNudge: (line) => view.current?.dispatch({ effects: setNudgeLine.of(line) }),
    setBail: (line) => view.current?.dispatch({ effects: setBailLine.of(line) }),
    focus: () => view.current?.focus(),
  }), []);

  return <div className="mkEditor" data-testid="make-editor" ref={host} />;
});

export default MakeEditor;
