// ---------------------------------------------------------------------------
// Terminal rail — T1+T2+T3 hybrid. It overlays the right edge of the editor
// (the code keeps its full width beneath) and behaves like a pulse: a 28px
// strip at rest, springing open on a run and folding back after ~4s unless the
// run failed or the rail is pinned.
// ---------------------------------------------------------------------------
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { RunResult } from '../../shared/types';
import { termSocketUrl } from '../api';
import { cssVar } from './theme';

export type RailState = 'strip' | 'open' | 'pinned';
export type RailTab = 'run' | 'shell';

export interface RailProps {
  projectId: string;
  state: RailState;
  tab: RailTab;
  lastRun: RunResult | null;
  running: boolean;
  onOpen: () => void;
  onClose: () => void;
  onTogglePin: () => void;
  onTab: (t: RailTab) => void;
  onHover: () => void;
}

export default function Rail(props: RailProps) {
  const { projectId, state, tab, lastRun, running, onOpen, onClose, onTogglePin, onTab, onHover } = props;
  const open = state !== 'strip';

  const shellHost = useRef<HTMLDivElement | null>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const sock = useRef<WebSocket | null>(null);

  // --- lazily build the pty session the first time the Shell tab is shown ----
  useEffect(() => {
    if (!open || tab !== 'shell' || !shellHost.current) return;

    if (!term.current) {
      const t = new Terminal({
        fontFamily: cssVar('--font-mono') || 'ui-monospace, monospace',
        fontSize: 12,
        allowTransparency: true,
        cursorBlink: true,
        convertEol: false,
        theme: {
          background: 'rgba(0,0,0,0)',
          foreground: cssVar('--rail-ink'),
          cursor: cssVar('--accent'),
          selectionBackground: cssVar('--accent3'),
        },
      });
      const f = new FitAddon();
      t.loadAddon(f);
      t.open(shellHost.current);
      term.current = t;
      fit.current = f;

      let ws: WebSocket | null = null;
      try {
        ws = new WebSocket(termSocketUrl(projectId));
      } catch {
        t.write('\r\n\x1b[31mcould not reach the shell\x1b[0m\r\n');
      }
      if (ws) {
        sock.current = ws;
        ws.onopen = () => {
          safeFit();
          send({ type: 'resize', cols: t.cols, rows: t.rows });
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as
              { type: string; data?: string; code?: number };
            if (msg.type === 'data' && typeof msg.data === 'string') t.write(msg.data);
            else if (msg.type === 'exit') t.write(`\r\n\x1b[2m[shell exited: ${msg.code ?? 0}]\x1b[0m\r\n`);
          } catch { /* ignore malformed frames */ }
        };
        ws.onerror = () => t.write('\r\n\x1b[31m[shell connection error]\x1b[0m\r\n');
        ws.onclose = () => t.write('\r\n\x1b[2m[shell disconnected]\x1b[0m\r\n');
        t.onData((d) => send({ type: 'data', data: d }));
        t.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));
      }
    }
    // returning to the tab (or a resize while hidden) needs a re-fit
    const raf = requestAnimationFrame(() => { safeFit(); term.current?.focus(); });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, projectId]);

  // keep the pty sized to the rail
  useEffect(() => {
    const el = shellHost.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => safeFit());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => () => {
    try { sock.current?.close(); } catch { /* noop */ }
    term.current?.dispose();
    term.current = null;
    fit.current = null;
    sock.current = null;
  }, []);

  function send(msg: unknown) {
    const ws = sock.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function safeFit() {
    try { fit.current?.fit(); } catch { /* container not laid out yet */ }
  }

  const runDot = lastRun ? (lastRun.exitCode === 0 ? 'good' : 'bad') : 'none';

  return (
    <aside
      className="rail"
      data-testid="rail"
      data-state={state}
      onMouseEnter={onHover}
    >
      {!open ? (
        <button className="railStrip" onClick={onOpen} title="terminal (Ctrl+`)" aria-label="open terminal">
          <span className="railDot" data-run={runDot} />
          <span className="railKey">`</span>
          <span className="railCaption">terminal</span>
        </button>
      ) : (
        <div className="railPanel">
          <header className="railHead">
            <button
              className="railTab"
              data-testid="rail-tab-run"
              data-active={tab === 'run'}
              onClick={() => onTab('run')}
            >
              Run
            </button>
            <button
              className="railTab"
              data-testid="rail-tab-shell"
              data-active={tab === 'shell'}
              onClick={() => onTab('shell')}
            >
              Shell
            </button>
            <span className="railSpacer" />
            <button
              className="railIcon"
              data-testid="rail-pin"
              data-on={state === 'pinned'}
              title={state === 'pinned' ? 'unpin' : 'pin open'}
              aria-label="pin terminal"
              onClick={onTogglePin}
            >
              ✜
            </button>
            <button className="railIcon" title="close (Ctrl+`)" aria-label="close terminal" onClick={onClose}>
              ×
            </button>
          </header>

          <div className="railBody">
            <div className="railPane" style={{ display: tab === 'run' ? 'flex' : 'none' }}>
              <div className="railRun" data-testid="rail-run-out">
                {running && <div className="railRunning">running…</div>}
                {!lastRun && !running && <div className="railIdle">nothing has run yet — Cmd/Ctrl+Enter</div>}
                {lastRun && (
                  <>
                    <div className="railCmd">$ python3 {lastRun.path}</div>
                    {lastRun.stdout && <pre className="railOut">{lastRun.stdout}</pre>}
                    {lastRun.stderr && <pre className="railOut railErr">{lastRun.stderr}</pre>}
                    {!lastRun.stdout && !lastRun.stderr && <pre className="railOut railQuiet">(no output)</pre>}
                    <div className="railFoot">
                      <span className="railChip" data-ok={lastRun.exitCode === 0}>
                        exit {lastRun.exitCode}
                      </span>
                      <span className="railDur">{lastRun.durationMs}ms</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="railPane" style={{ display: tab === 'shell' ? 'flex' : 'none' }}>
              <div className="railShell" data-testid="rail-shell" ref={shellHost} />
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
