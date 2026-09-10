import { useCallback, useRef, useState } from 'react';

export type ToastKind = 'error' | 'good' | 'info';
export interface Toast { id: number; kind: ToastKind; title: string; body: string }

const TITLES: Record<ToastKind, string> = {
  error: 'that did not work',
  good: 'nice',
  info: 'heads up',
};

/** Local toast queue — no provider needed, each screen owns its own stack. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, body: string, title?: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-2), { id, kind, title: title ?? TITLES[kind], body }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 9000 : 4500);
    return id;
  }, []);

  /** Convenience for catch blocks: never alert(), always a sticker. */
  const pushError = useCallback((e: unknown, prefix?: string) => {
    const msg = e instanceof Error ? e.message : String(e);
    return push('error', prefix ? `${prefix} ${msg}` : msg);
  }, [push]);

  return { toasts, push, pushError, dismiss };
}

export function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite" data-testid="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} data-testid={`toast-${t.kind}`}>
          <span className="toast-msg">
            <b>{t.title}</b>
            {t.body}
          </span>
          <button className="toast-x" aria-label="Dismiss" onClick={() => onDismiss(t.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}
