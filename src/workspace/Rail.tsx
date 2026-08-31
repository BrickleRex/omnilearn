// ---------------------------------------------------------------------------
// Terminal rail — T1+T2+T3 hybrid. It overlays the right edge of the editor
// (the code keeps its full width beneath) and behaves like a pulse: a 28px
// strip at rest, springing open on a run and folding back after ~4s unless the
// run failed or the rail is pinned.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { ChatMessage, RunResult } from '../../shared/types';
import { api, termSocketUrl } from '../api';
import { Markdown } from '../components/Markdown';
import { cssVar } from './theme';

export type RailState = 'strip' | 'open' | 'pinned';
export type RailTab = 'run' | 'shell' | 'ask';

/** What the tutor needs to know about where the learner currently is. */
export interface AskContext { path: string | null; content: string }

export interface RailProps {
  projectId: string;
  milestoneId: string;
  state: RailState;
  tab: RailTab;
  lastRun: RunResult | null;
  running: boolean;
  /** Read live from the editor at send time — never a stale render's copy. */
  getAskContext: () => AskContext;
  /** Bumped by the workspace (Ctrl+/) to put the caret in the ask box. */
  askFocusSeq: number;
  onAskFocus: (focused: boolean) => void;
  onOpen: () => void;
  onClose: () => void;
  onTogglePin: () => void;
  onTab: (t: RailTab) => void;
  onHover: () => void;
}

/** ~4 lines of the ask textarea before it starts scrolling instead of growing. */
const ASK_INPUT_MAX = 84;

export default function Rail(props: RailProps) {
  const {
    projectId, milestoneId, state, tab, lastRun, running,
    getAskContext, askFocusSeq, onAskFocus,
    onOpen, onClose, onTogglePin, onTab, onHover,
  } = props;
  const open = state !== 'strip';

  const shellHost = useRef<HTMLDivElement | null>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const sock = useRef<WebSocket | null>(null);
  const closing = useRef(false);

  // --- Ask (tutor chat) ------------------------------------------------------
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState<{ text: string; reason: string } | null>(null);

  const askInput = useRef<HTMLTextAreaElement | null>(null);
  const askThread = useRef<HTMLDivElement | null>(null);
  const askingRef = useRef(false); askingRef.current = asking;
  const ctxRef = useRef(getAskContext); ctxRef.current = getAskContext;
  const historyFor = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const askVisible = open && tab === 'ask';

  // History is per-milestone and lives on the server; pull it once, the first
  // time the tab is actually shown.
  useEffect(() => {
    if (!askVisible || historyFor.current === milestoneId) return;
    historyFor.current = milestoneId;
    api.chatHistory(projectId, milestoneId)
      .then((h) => { if (alive.current) setMsgs(h ?? []); })
      .catch(() => { /* an empty thread is a fine place to start */ });
  }, [askVisible, projectId, milestoneId]);

  // Follow the conversation down as it grows.
  useEffect(() => {
    if (!askVisible) return;
    const el = askThread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [askVisible, msgs, asking, failed]);

  // Ctrl+/ from the workspace: put the caret in the box.
  useEffect(() => {
    if (!askVisible || askFocusSeq === 0) return;
    const raf = requestAnimationFrame(() => askInput.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [askFocusSeq, askVisible]);

  // Grow the textarea with its content, up to ~4 lines.
  useEffect(() => {
    const el = askInput.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, ASK_INPUT_MAX)}px`;
  }, [draft, askVisible]);

  const sendAsk = useCallback(async (raw: string) => {
    const message = raw.trim();
    if (!message || askingRef.current) return;

    askingRef.current = true;
    setFailed(null);
    setDraft('');
    setAsking(true);
    setMsgs((m) => [...m, { role: 'user', text: message, at: new Date().toISOString() }]);

    const ctx = ctxRef.current();
    const body = { milestoneId, message, path: ctx.path ?? undefined, content: ctx.content };
    try {
      // Stream first: words appear as the tutor produces them. A growing
      // tutor bubble is appended on the first delta and updated in place.
      let started = false;
      const reply = await api.chatStream(projectId, body, (text) => {
        if (!alive.current) return;
        if (!started) {
          started = true;
          setAsking(false); // thinking dots yield to the live bubble
          setMsgs((m) => [...m, { role: 'tutor', text, at: new Date().toISOString() }]);
        } else {
          setMsgs((m) => {
            const last = m[m.length - 1];
            if (!last || last.role !== 'tutor') return m;
            return [...m.slice(0, -1), { ...last, text: last.text + text }];
          });
        }
      }).catch(async (streamErr) => {
        // No deltas made it through -> plain request. A half-streamed bubble
        // means the stream died mid-reply; surface that instead of restarting.
        if (started) throw streamErr;
        const res = await api.chat(projectId, body);
        return res.reply;
      });
      if (!alive.current) return;
      setMsgs((m) => {
        const last = m[m.length - 1];
        if (started && last?.role === 'tutor') {
          return [...m.slice(0, -1), { ...last, text: reply }]; // settle on the final text
        }
        return [...m, { role: 'tutor', text: reply, at: new Date().toISOString() }];
      });
    } catch (e) {
      if (!alive.current) return;
      // Take the optimistic bubbles back out (a half-streamed tutor bubble too)
      // and hand the words to the learner again — retyping a question you
      // already asked is a small insult.
      setMsgs((m) => {
        let out = m;
        if (out.length && out[out.length - 1].role === 'tutor') out = out.slice(0, -1);
        if (out.length && out[out.length - 1].role === 'user') out = out.slice(0, -1);
        return out;
      });
      setFailed({ text: message, reason: (e as Error).message || 'could not reach the tutor' });
      setDraft(message);
    } finally {
      if (alive.current) setAsking(false);
      askingRef.current = false;
    }
  }, [projectId, milestoneId]);

  // The textarea is disabled while a reply is in flight, which blurs it; give
  // the caret back the moment the tutor is done talking.
  useEffect(() => {
    if (!asking && askVisible && msgs.length) askInput.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asking]);

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
        ws.onclose = () => { if (!closing.current) t.write('\r\n\x1b[2m[shell disconnected]\x1b[0m\r\n'); };
        t.onData((d) => send({ type: 'data', data: d }));
        t.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));
      }
    }
    // returning to the tab (or a resize while hidden) needs a re-fit
    const raf = requestAnimationFrame(() => { safeFit(); term.current?.focus(); });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, projectId]);

  // Keep the pty sized to the rail. Re-attached when the panel (and therefore
  // the host element) appears, since it doesn't exist while the rail is a strip.
  useEffect(() => {
    const el = shellHost.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => safeFit());
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

  useEffect(() => () => {
    closing.current = true;
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
      data-tab={tab}
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
            <button
              className="railTab"
              data-testid="rail-tab-ask"
              data-active={tab === 'ask'}
              title="ask the tutor (Ctrl+/)"
              onClick={() => onTab('ask')}
            >
              Ask
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
              📌
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
                    <div className="railCmd">$ {lastRun.command ?? `python3 ${lastRun.path}`}</div>
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

            <div className="railPane" style={{ display: tab === 'ask' ? 'flex' : 'none' }}>
              <div className="railAsk" data-testid="rail-ask">
                <div className="askThread" ref={askThread}>
                  {msgs.length === 0 && !asking && (
                    <p className="askEmpty" data-testid="ask-empty">
                      Ask about the task, a concept, or your error — short answers, no spoilers.
                    </p>
                  )}

                  {msgs.map((m, i) => (
                    <div
                      key={`${i}-${m.at}`}
                      className="askMsg"
                      data-role={m.role}
                      data-testid={m.role === 'user' ? 'ask-msg-user' : 'ask-msg-tutor'}
                    >
                      {m.role === 'user'
                        ? <span className="askBubble">{m.text}</span>
                        : <Markdown md={m.text} className="askMd" />}
                    </div>
                  ))}

                  {asking && (
                    <div className="askMsg" data-role="tutor">
                      <span className="askThinking" data-testid="ask-thinking" aria-label="thinking">
                        <i /><i /><i />
                      </span>
                    </div>
                  )}

                  {failed && (
                    <div className="askFail" data-testid="ask-error" role="alert">
                      <span className="askFailWhat">“{failed.text}” didn’t get through — {failed.reason}</span>
                      <button
                        className="askRetry"
                        data-testid="ask-retry"
                        onClick={() => void sendAsk(failed.text)}
                      >
                        retry
                      </button>
                    </div>
                  )}
                </div>

                <div className="askBar">
                  <textarea
                    ref={askInput}
                    className="askInput"
                    data-testid="ask-input"
                    rows={1}
                    placeholder="what is this step actually asking?"
                    aria-label="ask the tutor"
                    value={draft}
                    disabled={asking}
                    onChange={(e) => setDraft(e.target.value)}
                    onFocus={() => onAskFocus(true)}
                    onBlur={() => onAskFocus(false)}
                    onKeyDown={(e) => {
                      // Enter sends, Shift+Enter is a newline. Ctrl/Cmd+Enter is
                      // the workspace's "run", so leave it to the window handler.
                      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
                        e.preventDefault();
                        void sendAsk(draft);
                      }
                    }}
                  />
                  <button
                    className="askSend"
                    data-testid="ask-send"
                    disabled={asking || !draft.trim()}
                    title="send (Enter)"
                    aria-label="send"
                    onClick={() => void sendAsk(draft)}
                  >
                    ↑
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
