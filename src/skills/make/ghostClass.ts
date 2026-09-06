// ---------------------------------------------------------------------------
// The skills track names the practice line `.cm-ghost` (SPEC-SKILLS test ids),
// while the shared widget in src/workspace/ghost.ts paints `.cm-ghost-widget`.
// Rather than fork the ghost (its refusal + type-through rules are the whole
// point of reusing it), this stamps the extra class onto the widget the moment
// it lands in the DOM. One class name, no behaviour of its own.
//
// Safe by CodeMirror's own rules: DOMObserver.readMutation ignores anything
// inside a widget, so tagging cannot be mistaken for the user editing the doc.
// ---------------------------------------------------------------------------
import { ViewPlugin, type EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

export function tagGhosts(root: HTMLElement | null | undefined): void {
  if (!root) return;
  root.querySelectorAll('.cm-ghost-widget:not(.cm-ghost)').forEach((el) => el.classList.add('cm-ghost'));
}

export function ghostClassExtension(): Extension {
  return ViewPlugin.fromClass(class {
    private obs: MutationObserver | null = null;

    constructor(readonly view: EditorView) {
      tagGhosts(view.dom);
      // A refusal or a typed character rebuilds the widget; the observer runs
      // in the microtask right after that DOM write, so `.cm-ghost` is never
      // missing for a frame the way a measure-phase tag can be.
      if (typeof MutationObserver !== 'undefined') {
        this.obs = new MutationObserver(() => tagGhosts(view.dom));
        this.obs.observe(view.dom, { childList: true, subtree: true });
      }
    }

    update() {
      // belt and braces for environments without MutationObserver
      if (!this.obs) this.view.requestMeasure({ read: () => null, write: () => tagGhosts(this.view.dom) });
    }

    destroy() { this.obs?.disconnect(); this.obs = null; }
  });
}
