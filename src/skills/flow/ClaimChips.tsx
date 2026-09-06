// Claim chips: the receipts. Every taught line and every drill answer carries the
// claims it rests on; tapping one opens the evidence beside it.
import type { Claim, SourceRef } from '../../../shared/skills';
import Evidence from '../evidence/Evidence';
import { shorten } from './util';

export function ClaimChips({
  claimIds, claims, onOpen, label = 'why we say that',
}: { claimIds: string[]; claims: Claim[]; onOpen: (id: string) => void; label?: string }) {
  const found = claimIds.map((id) => claims.find((c) => c.id === id) ?? { id, text: id, verdict: 'likely' as const });
  if (found.length === 0) return null;
  return (
    <div className="sk-chips">
      <span className="sk-chips-label">{label}</span>
      {found.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`sk-chip-claim is-${c.verdict}`}
          data-testid={`claim-chip-${c.id}`}
          title={c.text}
          onClick={() => onOpen(c.id)}
        >
          <span className="sk-chip-stamp">{c.verdict}</span>
          <span className="sk-chip-text">{shorten(c.text, 42)}</span>
        </button>
      ))}
    </div>
  );
}

export function EvidencePanel({
  claims, sources, focusClaimId, onClose,
}: { claims: Claim[]; sources: SourceRef[]; focusClaimId?: string; onClose: () => void }) {
  return (
    <aside className="sk-ev-panel anim-pop" aria-label="Evidence">
      <div className="sk-ev-panel-head">
        <b>The evidence</b>
        <button className="btn btn-ghost btn-icon" aria-label="Close evidence" onClick={onClose}>✕</button>
      </div>
      <div className="sk-ev-panel-body">
        <Evidence claims={claims} sources={sources} focusClaimId={focusClaimId} />
      </div>
    </aside>
  );
}
