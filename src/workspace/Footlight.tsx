// ---------------------------------------------------------------------------
// Footlight — the fixed bottom bar. A lamp, text that types itself out, and the
// small persistent facts: explore mode, save state, a pending nudge.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';
import type { SaveState } from './Editor';

export type LampState = 'idle' | 'thinking' | 'hint' | 'nudge';

export interface FootlightMessage { text: string; seq: number }

export interface FootlightProps {
  lamp: LampState;
  message: FootlightMessage;
  explore: boolean;
  saveState: SaveState;
  pendingNudge: boolean;
  celebrating: boolean;
  showDone: boolean;
  onDone: () => void;
  onOpenNudge: () => void;
}

const CHAR_MS = 25;

function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function Footlight(props: FootlightProps) {
  const {
    lamp, message, explore, saveState, pendingNudge, celebrating, showDone, onDone, onOpenNudge,
  } = props;
  const [typed, setTyped] = useState('');
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current !== null) { clearInterval(timer.current); timer.current = null; }
    const text = message.text;
    if (!text) { setTyped(''); return; }
    if (prefersReducedMotion()) { setTyped(text); return; }
    setTyped('');
    let i = 0;
    timer.current = window.setInterval(() => {
      i += 1;
      setTyped(text.slice(0, i));
      if (i >= text.length && timer.current !== null) {
        clearInterval(timer.current);
        timer.current = null;
      }
    }, CHAR_MS);
    return () => { if (timer.current !== null) { clearInterval(timer.current); timer.current = null; } };
  }, [message.text, message.seq]);

  const saveLabel = saveState === 'saved' ? 'saved' : saveState === 'error' ? 'save failed' : 'saving…';

  return (
    <div className="footlight" data-testid="footlight" data-celebrate={celebrating || undefined}>
      <button
        className="footLamp"
        data-testid="footlight-lamp"
        data-state={celebrating ? 'hint' : lamp}
        title={pendingNudge ? 'open the nudge (Alt+H)' : 'guidance lamp'}
        aria-label="guidance lamp"
        onClick={onOpenNudge}
      />
      <span className="footText" data-testid="footlight-text">
        {celebrating ? 'nice — milestone done ✦' : typed}
        {typed && typed.length < message.text.length && <span className="footCaret" />}
      </span>

      <span className="footRight">
        {showDone && (
          <button className="footDone" data-testid="milestone-done" onClick={onDone}>
            Mark milestone done?
          </button>
        )}
        {pendingNudge && (
          <button className="footPending" onClick={onOpenNudge} title="open the nudge">
            something&apos;s off — Alt+H
          </button>
        )}
        {explore && <span className="footExplore">exploring — watcher off</span>}
        <span className="footSave" data-save={saveState}>
          <span className="footSaveDot" />
          {saveLabel}
        </span>
      </span>
    </div>
  );
}
