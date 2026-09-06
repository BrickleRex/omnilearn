// How fast a claim goes out of date, by the kind of angle it sits under.
// ONE table: the assessor weights recency with it and the freshness pass uses
// the same horizons to decide what has gone stale.

export type DecayFamily = 'deliverability' | 'tooling' | 'copy' | 'psychology';

/** Months a claim stays believable before its newest source is too old. */
export const DECAY_MONTHS: Record<DecayFamily, number> = {
  deliverability: 9,
  tooling: 12,
  copy: 36,
  psychology: 36,
};

export interface AngleLike { id: string; title: string; why?: string }

// First match wins; anything unmatched is treated as craft/copy (slow decay).
const FAMILY_WORDS: Array<[DecayFamily, RegExp]> = [
  ['deliverability', /deliver|inbox|spam|dmarc|dkim|spf|warm-?up|domain|bounce|blocklist|blacklist|sender|filter/i],
  ['tooling', /tool|software|platform|\bcrm\b|automation|\bapi\b|integration|vendor|scrap|enrichment|list.?build|sequencer/i],
  ['psychology', /psycholog|persuas|trust|motivat|behaviou?r|bias|objection|emotion/i],
];

export function familyFor(angle: AngleLike): DecayFamily {
  const hay = `${angle.id} ${angle.title} ${angle.why ?? ''}`;
  for (const [family, re] of FAMILY_WORDS) if (re.test(hay)) return family;
  return 'copy';
}

export function horizonMonths(angle: AngleLike | undefined): number {
  return angle ? DECAY_MONTHS[familyFor(angle)] : DECAY_MONTHS.copy;
}

/** Whole-ish months between an ISO date and `now`. Unparseable dates read as very old. */
export function monthsSince(iso: string | undefined, now: Date = new Date()): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso.length === 7 ? `${iso}-01` : iso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - t) / (1000 * 60 * 60 * 24 * 30.44);
}

/** A claim is stale when its newest supporting source is past the angle's horizon. */
export function isStale(newest: string | undefined, angle: AngleLike | undefined, now: Date = new Date()): boolean {
  return monthsSince(newest, now) > horizonMonths(angle);
}

/**
 * Recency multiplier on confidence: 1.0 while the newest source is inside half
 * the horizon, sliding down to a 0.5 floor well past it.
 */
export function recencyFactor(newest: string | undefined, horizon: number, now: Date = new Date()): number {
  const age = monthsSince(newest, now);
  if (!Number.isFinite(age)) return 0.6; // no date at all: mild penalty, not a death sentence
  const grace = horizon / 2;
  if (age <= grace) return 1;
  const decayed = 1 - (age - grace) / (horizon * 1.5);
  return Math.min(1, Math.max(0.5, decayed));
}
