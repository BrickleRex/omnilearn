import { useState } from 'react';
import type { Concept } from '../../shared/types';

/**
 * The "here's what we'll cover / skip" beat, shown as a banner on top of the
 * primer deck so calibration flows straight into the cards without a gate.
 */
export default function CalibSummary({ concepts }: { concepts: Concept[] }) {
  const [open, setOpen] = useState(true);
  const cleared = concepts.filter((c) => c.cleared);
  const cover = concepts.filter((c) => !c.cleared);

  return (
    <section className={`card calsum${open ? '' : ' is-closed'}`} data-testid="calibration-summary">
      <div className="calsum-head">
        <span className="eyebrow">calibration done</span>
        <p className="calsum-line">
          Covering <b>{cover.length}</b>
          {cleared.length > 0 && <> · skipping <b>{cleared.length}</b> you already have</>}.
        </p>
        <button
          className="btn btn-ghost btn-sm"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Hide' : 'Details'}
        </button>
      </div>

      {open && (
        <div className="cal-split anim-rise">
          <div>
            <span className="label">We'll cover ({cover.length})</span>
            <ul className="con-list">
              {cover.map((c) => (
                <li key={c.id} className="con-row">
                  <span className="con-dot" aria-hidden="true" />
                  <span>{c.label}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <span className="label">We'll skip ({cleared.length})</span>
            {cleared.length === 0 ? (
              <p className="cal-none">Nothing skipped — fresh ground, all of it.</p>
            ) : (
              <ul className="con-list">
                {cleared.map((c) => (
                  <li key={c.id} className="con-row is-cleared">
                    <span className="con-tick" aria-hidden="true">✓</span>
                    <span>{c.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
