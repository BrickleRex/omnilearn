// ---------------------------------------------------------------------------
// Ship — paste what actually happened. This is the only feedback that can prove
// the course wrong, so the form is three boxes and no ceremony.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import Modal from '../../components/Modal';

export interface ShipModalProps {
  versionLabel: number;
  predicted?: { low: number; high: number; unit: string };
  busy: boolean;
  onClose: () => void;
  onSubmit: (v: { sent: number; replies: number; meetings?: number; notes?: string }) => void;
}

export default function ShipModal({ versionLabel, predicted, busy, onClose, onSubmit }: ShipModalProps) {
  const [sent, setSent] = useState('');
  const [replies, setReplies] = useState('');
  const [meetings, setMeetings] = useState('');
  const [notes, setNotes] = useState('');

  const nSent = Number(sent);
  const nReplies = Number(replies);
  const ok = Number.isFinite(nSent) && nSent > 0 && Number.isFinite(nReplies) && nReplies >= 0;
  const rate = ok ? (nReplies / nSent) * 100 : null;

  return (
    <Modal
      onClose={onClose}
      testId="ship-modal"
      width={520}
      labelledBy="ship-title"
      title={<span id="ship-title">Ship v{versionLabel}</span>}
      footer={(
        <>
          <button className="btn btn-ghost" onClick={onClose}>cancel</button>
          <button
            className="btn btn-primary"
            data-testid="ship-submit"
            disabled={!ok || busy}
            onClick={() => onSubmit({
              sent: nSent,
              replies: nReplies,
              ...(meetings.trim() && Number.isFinite(Number(meetings)) ? { meetings: Number(meetings) } : {}),
              ...(notes.trim() ? { notes: notes.trim() } : {}),
            })}
          >
            {busy ? 'saving…' : 'record it'}
          </button>
        </>
      )}
    >
      {/* Modal's own autofocus fires on a 30ms timer and would otherwise yank
          the caret out of whichever box is being filled at that moment. A
          hidden input is the first thing it finds and cannot take focus, so the
          steal is a no-op and `autoFocus` below decides where the caret lands. */}
      <input type="hidden" aria-hidden="true" />

      <p className="mkShipLede">
        How did it go in the real world? The app diffs this against what the panel predicted.
      </p>

      <div className="mkShipGrid">
        <label>
          <span className="label">emails sent</span>
          <input
            className="input"
            data-testid="ship-sent"
            inputMode="numeric"
            autoFocus
            placeholder="100"
            value={sent}
            onChange={(e) => setSent(e.target.value)}
          />
        </label>
        <label>
          <span className="label">replies</span>
          <input
            className="input"
            data-testid="ship-replies"
            inputMode="numeric"
            placeholder="5"
            value={replies}
            onChange={(e) => setReplies(e.target.value)}
          />
        </label>
        <label>
          <span className="label">meetings (optional)</span>
          <input
            className="input"
            data-testid="ship-meetings"
            inputMode="numeric"
            placeholder="1"
            value={meetings}
            onChange={(e) => setMeetings(e.target.value)}
          />
        </label>
      </div>

      <label className="mkShipNotes">
        <span className="label">notes (optional)</span>
        <textarea
          className="textarea"
          data-testid="ship-notes"
          rows={3}
          placeholder="who replied, what they said"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>

      <p className="mkShipMath" data-testid="ship-math">
        {rate === null ? 'Enter how many you sent and how many replied.' : `That is ${rate.toFixed(1)}% replies.`}
        {predicted && ` The panel predicted ${predicted.low}–${predicted.high}${predicted.unit}.`}
      </p>
    </Modal>
  );
}
