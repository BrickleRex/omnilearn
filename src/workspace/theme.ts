// ---------------------------------------------------------------------------
// CodeMirror theme + syntax highlighting, built by READING the Playroom CSS
// custom properties off :root. Rebuilt (via a Compartment in Editor.tsx) every
// time the scheme changes, so all four schemes get their own highlight style.
// ---------------------------------------------------------------------------
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

const FALLBACK: Record<string, string> = {
  '--code-bg': '#fffdf6',
  '--code-ink': '#1b1b1f',
  '--code-line': '#efe9da',
  '--gutter-ink': '#b5af9e',
  '--syn-kw': '#2b50ff',
  '--syn-fn': '#d14a26',
  '--syn-str': '#1d9e6f',
  '--syn-num': '#a05fc4',
  '--syn-com': '#a09a88',
  '--accent': '#ff5c39',
  '--accent2': '#2b50ff',
  '--accent3': '#ffc700',
  '--line': '#1b1b1f',
  '--muted': '#7a7668',
  '--surface': '#fffdf6',
  '--surface2': '#f7f3ea',
  '--ink': '#1b1b1f',
  '--font-mono': "ui-monospace, Menlo, monospace",
};

export function cssVar(name: string): string {
  if (typeof window === 'undefined') return FALLBACK[name] ?? '';
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || FALLBACK[name] || '';
}

export function readSchemeVars() {
  const names = Object.keys(FALLBACK);
  const out = {} as Record<string, string>;
  for (const n of names) out[n] = cssVar(n);
  return out;
}

/** Everything CodeMirror needs, in one Compartment-swappable extension. */
export function buildEditorTheme(): Extension {
  const v = readSchemeVars();

  const theme = EditorView.theme({
    '&': {
      color: v['--code-ink'],
      backgroundColor: v['--code-bg'],
      height: '100%',
      fontSize: '13.5px',
      fontFamily: v['--font-mono'],
    },
    '.cm-scroller': {
      fontFamily: v['--font-mono'],
      lineHeight: '1.6',
      overflow: 'auto',
    },
    '.cm-content': {
      caretColor: v['--accent'],
      paddingBottom: '40vh',
      paddingRight: '2rem',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: v['--accent'],
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-cursor': { borderLeftColor: v['--accent'] },
    '&.cm-focused': { outline: 'none' },
    '.cm-activeLine': { backgroundColor: v['--code-line'] },
    '.cm-activeLineGutter': { backgroundColor: v['--code-line'], color: v['--ink'] },
    '.cm-gutters': {
      backgroundColor: v['--code-bg'],
      color: v['--gutter-ink'],
      border: 'none',
      fontFamily: v['--font-mono'],
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px', minWidth: '2.2ch' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: hexAlpha(v['--accent3'], 0.35),
    },
    '.cm-selectionMatch': { backgroundColor: hexAlpha(v['--accent2'], 0.16) },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: hexAlpha(v['--accent2'], 0.2),
      outline: `1px solid ${hexAlpha(v['--accent2'], 0.6)}`,
      color: 'inherit',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: v['--surface2'],
      border: `1px solid ${v['--line']}`,
      color: v['--muted'],
    },
    // --- the warm, solid, Tab-able autocomplete: never confusable with a ghost
    '.cm-tooltip': { border: 'none', backgroundColor: 'transparent' },
    '.cm-tooltip.cm-tooltip-autocomplete': {
      backgroundColor: v['--surface'],
      color: v['--ink'],
      border: `2.5px solid ${v['--accent']}`,
      borderRadius: '10px',
      boxShadow: `3px 3px 0 ${hexAlpha(v['--line'], 0.9)}`,
      overflow: 'hidden',
      fontFamily: v['--font-mono'],
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': {
      fontFamily: v['--font-mono'],
      fontSize: '12.5px',
      maxHeight: '14em',
      padding: '4px',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
      padding: '3px 8px',
      borderRadius: '6px',
      color: v['--ink'],
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: v['--accent3'],
      color: '#1b1b1f',
      fontWeight: '700',
    },
    '.cm-completionIcon': { color: v['--muted'], paddingRight: '10px' },
    '.cm-completionLabel': { fontFamily: v['--font-mono'] },
    '.cm-completionMatchedText': {
      textDecoration: 'none',
      color: v['--accent'],
      fontWeight: '800',
    },
    '.cm-completionDetail': { color: v['--muted'], fontStyle: 'normal', marginLeft: '1em' },
  }, { dark: isDark(v['--code-bg']) });

  const highlight = HighlightStyle.define([
    { tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.operatorKeyword, t.self, t.null], color: v['--syn-kw'], fontWeight: '700' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: v['--syn-fn'] },
    { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: v['--code-ink'] },
    { tag: [t.className, t.typeName, t.namespace], color: v['--syn-fn'], fontWeight: '700' },
    { tag: [t.string, t.special(t.string), t.regexp], color: v['--syn-str'] },
    { tag: [t.number, t.bool, t.atom, t.literal], color: v['--syn-num'] },
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: v['--syn-com'], fontStyle: 'italic' },
    { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: v['--muted'] },
    { tag: [t.propertyName], color: v['--code-ink'] },
    { tag: [t.variableName], color: v['--code-ink'] },
    { tag: t.invalid, color: '#d33a2c' },
    { tag: [t.meta, t.processingInstruction], color: v['--syn-com'] },
    { tag: t.strong, fontWeight: '800' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.link, color: v['--accent2'], textDecoration: 'underline' },
  ], { themeType: isDark(v['--code-bg']) ? 'dark' : 'light' });

  return [theme, syntaxHighlighting(highlight, { fallback: true })];
}

// --- helpers ---------------------------------------------------------------
function isDark(color: string): boolean {
  const rgb = parseColor(color);
  if (!rgb) return false;
  const [r, g, b] = rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

function hexAlpha(color: string, alpha: number): string {
  const rgb = parseColor(color);
  if (!rgb) return color;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function parseColor(input: string): [number, number, number] | null {
  const c = (input || '').trim();
  const m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rm = c.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (rm) return [Number(rm[1]), Number(rm[2]), Number(rm[3])];
  return null;
}
