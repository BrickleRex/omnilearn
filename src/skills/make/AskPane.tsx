// ---------------------------------------------------------------------------
// Ask — the tutor chat, same shape as the code track's rail: streaming reply,
// optimistic bubbles taken back on failure, the learner's words handed back so
// nobody has to retype a question. History is per module.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatRequest } from '../../../shared/types';
import { skillsApi } from '../api';
import { Markdown } from '../../components/Markdown';

const ASK_INPUT_MAX = 84;

export interface AskPaneProps {
  skillId: string;
  moduleId: string;
  visible: boolean;
  /** Read live at send time — never a stale render's copy of the draft. */
  getBody: () => string;
  focusSeq: number;
  onFocus: (focused: boolean) => void;
}

/** SSE reader for POST /chat/stream — same frame shape as the code track. */
async function streamChat(url: string, body: ChatRequest, onDelta: (t: string) => void): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`stream failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let reply: string | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = frame.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('');
      if (!data) continue;
      let ev: { type: string; text?: string; reply?: string; message?: string };
      try { ev = JSON.parse(data); } catch { continue; }
      if (ev.type === 'delta' && ev.text) onDelta(ev.text);
      else if (ev.type === 'done') reply = ev.reply ?? '';
      else if (ev.type === 'error') throw new Error(ev.message || 'chat failed');
    }
  }
  if (reply === null) throw new Error('stream ended without a reply');
  return reply;
}

export default function AskPane({ skillId, moduleId, visible, getBody, focusSeq, onFocus }: AskPaneProps) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState<{ text: string; reason: string } | null>(null);

  const input = useRef<HTMLTextAreaElement | null>(null);
  const thread = useRef<HTMLDivElement | null>(null);
  const askingRef = useRef(false); askingRef.current = asking;
  const bodyRef = useRef(getBody); bodyRef.current = getBody;
  const historyFor = useRef<string | null>(null);

  // Set true in the BODY, not only at init: StrictMode's dev remount runs the
  // cleanup once, and the ref survives it — a cleanup-only guard would stay
  // false forever and silently swallow every reply in `npm run dev`.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (!visible || historyFor.current === moduleId) return;
    historyFor.current = moduleId;
    skillsApi.chatHistory(skillId, moduleId)
      .then((h) => { if (alive.current) setMsgs(h ?? []); })
      .catch(() => { /* an empty thread is a fine place to start */ });
  }, [visible, skillId, moduleId]);

  useEffect(() => {
    if (!visible) return;
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible, msgs, asking, failed]);

  useEffect(() => {
    if (!visible || focusSeq === 0) return;
    const raf = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [focusSeq, visible]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, ASK_INPUT_MAX)}px`;
  }, [draft, visible]);

  const send = useCallback(async (raw: string) => {
    const message = raw.trim();
    if (!message || askingRef.current) return;

    askingRef.current = true;
    setFailed(null);
    setDraft('');
    setAsking(true);
    setMsgs((m) => [...m, { role: 'user', text: message, at: new Date().toISOString() }]);

    const body: ChatRequest = { milestoneId: moduleId, message, content: bodyRef.current() };
    try {
      let started = false;
      const reply = await streamChat(skillsApi.chatStreamUrl(skillId), body, (text) => {
        if (!alive.current) return;
        if (!started) {
          started = true;
          setAsking(false);
          setMsgs((m) => [...m, { role: 'tutor', text, at: new Date().toISOString() }]);
        } else {
          setMsgs((m) => {
            const last = m[m.length - 1];
            if (!last || last.role !== 'tutor') return m;
            return [...m.slice(0, -1), { ...last, text: last.text + text }];
          });
        }
      }).catch(async (streamErr) => {
        if (started) throw streamErr;      // a half-streamed reply died: say so
        const res = await skillsApi.chat(skillId, body);
        return res.reply;
      });
      if (!alive.current) return;
      setMsgs((m) => {
        const last = m[m.length - 1];
        if (started && last?.role === 'tutor') return [...m.slice(0, -1), { ...last, text: reply }];
        return [...m, { role: 'tutor', text: reply, at: new Date().toISOString() }];
      });
    } catch (e) {
      if (!alive.current) return;
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
  }, [skillId, moduleId]);

  useEffect(() => {
    if (!asking && visible && msgs.length) input.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asking]);

  return (
    <div className="railAsk" data-testid="rail-ask">
      <div className="askThread" ref={thread}>
        {msgs.length === 0 && !asking && (
          <p className="askEmpty" data-testid="ask-empty">
            Ask about this draft, a persona, or a claim — short answers, no rewriting it for you.
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
            <span className="askThinking" data-testid="ask-thinking" aria-label="thinking"><i /><i /><i /></span>
          </div>
        )}

        {failed && (
          <div className="askFail" data-testid="ask-error" role="alert">
            <span className="askFailWhat">“{failed.text}” didn’t get through — {failed.reason}</span>
            <button className="askRetry" data-testid="ask-retry" onClick={() => void send(failed.text)}>retry</button>
          </div>
        )}
      </div>

      <div className="askBar">
        <textarea
          ref={input}
          className="askInput"
          data-testid="ask-input"
          rows={1}
          placeholder="why did Priya stop reading?"
          aria-label="ask the tutor"
          value={draft}
          disabled={asking}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => onFocus(true)}
          onBlur={() => onFocus(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
        />
        <button
          className="askSend"
          data-testid="ask-send"
          disabled={asking || !draft.trim()}
          title="send (Enter)"
          aria-label="send"
          onClick={() => void send(draft)}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
