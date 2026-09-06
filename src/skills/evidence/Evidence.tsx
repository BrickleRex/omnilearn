// PLACEHOLDER — owned by the skills-flow agent. Replace entirely, keep the export + props.
// Shared by Learn (claim chips) and Make (Evidence rail tab).
import type { Claim, SourceRef } from '../../../shared/skills';

export interface EvidenceProps {
  claims: Claim[];
  sources: SourceRef[];
  focusClaimId?: string;          // scroll to / expand this card
  view?: 'cards' | 'grid';        // default 'cards'
  onView?: (v: 'cards' | 'grid') => void;
}

export default function Evidence(_p: EvidenceProps) {
  return <div data-testid="evidence-cards">Evidence placeholder</div>;
}
