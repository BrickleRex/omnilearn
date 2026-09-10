import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ModalProps {
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** data-testid placed on the panel */
  testId?: string;
  /** panel max width, default 640px */
  width?: number;
  /** clicking the scrim closes (default true) */
  dismissOnScrim?: boolean;
  labelledBy?: string;
}

/**
 * Playroom modal: hard-edged panel over a blurred scrim. Esc closes, focus is
 * pulled into the panel on mount and returned to the opener on unmount.
 */
export default function Modal({
  onClose, title, children, footer, testId, width = 640, dismissOnScrim = true, labelledBy,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const nodes = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    // Focus lands on the first field synchronously: the portal's DOM already
    // exists by the time this effect runs, so no timer is needed (a timer also
    // let a fast typist lose their first keystrokes).
    panelRef.current?.querySelector<HTMLElement>(
      'textarea, input, button:not([data-autofocus-skip])',
    )?.focus({ preventScroll: true });
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="modal-scrim"
      onMouseDown={(e) => { if (dismissOnScrim && e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        data-testid={testId}
        style={{ width: `min(${width}px, 100%)` }}
      >
        {title !== undefined && (
          <div className="modal-head scanlines">
            <h2 id={labelledBy}>{title}</h2>
            <button className="btn btn-ghost btn-icon" aria-label="Close" onClick={onClose} data-autofocus-skip>
              ✕
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
