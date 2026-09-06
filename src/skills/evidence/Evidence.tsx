// Evidence: the same claims two ways — INDEX CARDS (a researcher's desk) and a
// CONSENSUS GRID (claims x source kinds). Shared by Learn (claim chips) and
// Make (Evidence rail tab).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Claim, SourceKind, SourceRef, Verdict } from '../../../shared/skills';
import '../skills.css';

export interface EvidenceProps {
  claims: Claim[];
  sources: SourceRef[];
  focusClaimId?: string;          // scroll to / expand this card
  view?: 'cards' | 'grid';        // default 'cards'
  onView?: (v: 'cards' | 'grid') => void;
}

const KIND_ORDER: SourceKind[] = ['blog', 'docs', 'reddit', 'x', 'youtube', 'podcast', 'facebook', 'user', 'other'];
const KIND_LABEL: Record<SourceKind, string> = {
  blog: 'blogs', docs: 'docs', reddit: 'reddit', x: 'X', youtube: 'youtube',
  podcast: 'podcast', facebook: 'facebook', user: 'yours', other: 'other',
};
const KIND_TAG: Record<SourceKind, string> = {
  blog: 'BLG', docs: 'DOC', reddit: 'RDT', x: 'X', youtube: 'YT',
  podcast: 'POD', facebook: 'FB', user: 'YOU', other: 'OTH',
};
const VERDICT_WORD: Record<Verdict, string> = {
  solid: 'SOLID', likely: 'LIKELY', contested: 'CONTESTED', stale: 'STALE',
};
const CELL_WORD = { agree: 'agrees', disagree: 'disagrees', mixed: 'mixed', silent: 'says nothing' } as const;

const pct = (n: number) => `${Math.round((n ?? 0) * 100)}%`;

function niceDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function Meter({ label, value }: { label: string; value: number }) {
  const v = Math.max(0, Math.min(1, value ?? 0));
  return (
    <span className="sk-meter" title={`${label} ${pct(v)}`}>
      <b>{label[0]}</b>
      <i><em style={{ width: `${v * 100}%` }} /></i>
    </span>
  );
}

function SourceRow({ s }: { s: SourceRef }) {
  return (
    <li className="sk-src">
      <span className="sk-kind" data-kind={s.kind}>{KIND_TAG[s.kind] ?? 'OTH'}</span>
      <a className="sk-src-title" href={s.url} target="_blank" rel="noreferrer noopener" title={s.title}>{s.title}</a>
      <span className="sk-src-meters">
        <Meter label="rep" value={s.reputation} />
        <Meter label="sound" value={s.soundness} />
        <span className={`sk-fetched is-${s.fetched}`} title={`text fetched: ${s.fetched}`}>{s.fetched}</span>
      </span>
    </li>
  );
}

export default function Evidence({ claims, sources, focusClaimId, view, onView }: EvidenceProps) {
  const [innerView, setInnerView] = useState<'cards' | 'grid'>(view ?? 'cards');
  const [focus, setFocus] = useState<string | undefined>(focusClaimId);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});

  const shown = view ?? innerView;
  const setView = useCallback((v: 'cards' | 'grid') => {
    setInnerView(v);
    onView?.(v);
  }, [onView]);

  useEffect(() => { if (focusClaimId) setFocus(focusClaimId); }, [focusClaimId]);

  // bring the focused card into sight once it is on screen
  useEffect(() => {
    if (!focus || shown !== 'cards') return;
    const el = cardRefs.current[focus];
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focus, shown]);

  const byId = useMemo(() => {
    const m: Record<string, SourceRef> = {};
    for (const s of sources) m[s.id] = s;
    return m;
  }, [sources]);

  const kinds = useMemo(() => {
    const present = new Set<SourceKind>();
    for (const s of sources) present.add(s.kind);
    for (const c of claims) for (const k of Object.keys(c.consensus ?? {})) present.add(k as SourceKind);
    return KIND_ORDER.filter((k) => present.has(k));
  }, [sources, claims]);

  const openCard = useCallback((id: string) => {
    setFocus(id);
    setView('cards');
  }, [setView]);

  return (
    <div className="sk-ev">
      <div className="sk-ev-switch" role="group" aria-label="Evidence view">
        <button
          type="button"
          className={`sk-seg${shown === 'cards' ? ' is-on' : ''}`}
          data-testid="evidence-view-cards"
          aria-pressed={shown === 'cards'}
          onClick={() => setView('cards')}
        >
          Cards
        </button>
        <button
          type="button"
          className={`sk-seg${shown === 'grid' ? ' is-on' : ''}`}
          data-testid="evidence-view-grid"
          aria-pressed={shown === 'grid'}
          onClick={() => setView('grid')}
        >
          Who agrees
        </button>
        <span className="sk-ev-count">{claims.length} claims · {sources.length} sources</span>
      </div>

      {shown === 'cards' && (
        <div className="sk-ev-cards" data-testid="evidence-cards">
          {claims.length === 0 && <p className="sk-quiet">No claims yet — research fills this in.</p>}
          {claims.map((c) => {
            const srcs = c.sourceIds.map((id) => byId[id]).filter(Boolean);
            const side = (ids: string[]) => ids.map((id) => byId[id]).filter(Boolean);
            return (
              <article
                key={c.id}
                ref={(el) => { cardRefs.current[c.id] = el; }}
                className={`card sk-ev-card${focus === c.id ? ' is-focus' : ''}`}
                data-testid={`evidence-card-${c.id}`}
                data-verdict={c.verdict}
              >
                <span className={`sk-stamp sk-stamp-${c.verdict}`}>
                  {VERDICT_WORD[c.verdict]} · {pct(c.confidence)}
                </span>
                <p className="sk-ev-claim">{c.text}</p>
                <div className="sk-ev-meta">
                  <span className="chip chip-quiet">{c.angleId}</span>
                  {c.newest && <span>newest {niceDate(c.newest)}</span>}
                  <span>{c.sourceIds.length} source{c.sourceIds.length === 1 ? '' : 's'}</span>
                  {c.contextTags.slice(0, 3).map((t) => <span key={t} className="sk-tag">{t}</span>)}
                </div>

                {c.verdict === 'contested' && c.sides ? (
                  <div className="sk-sides">
                    <div className="sk-side sk-side-for">
                      <span className="label">for</span>
                      <ul className="sk-srcs">{side(c.sides.for).map((s) => <SourceRow key={s.id} s={s} />)}</ul>
                    </div>
                    <div className="sk-side sk-side-against">
                      <span className="label">against</span>
                      <ul className="sk-srcs">{side(c.sides.against).map((s) => <SourceRow key={s.id} s={s} />)}</ul>
                    </div>
                  </div>
                ) : (
                  <ul className="sk-srcs">{srcs.map((s) => <SourceRow key={s.id} s={s} />)}</ul>
                )}

                {srcs[0]?.quote && <blockquote className="sk-quote">“{srcs[0].quote}”</blockquote>}
              </article>
            );
          })}
        </div>
      )}

      {shown === 'grid' && (
        <div className="sk-grid-wrap">
          <table className="sk-grid" data-testid="evidence-grid">
            <thead>
              <tr>
                <th className="sk-grid-corner">claim</th>
                {kinds.map((k) => <th key={k} className="sk-grid-kind">{KIND_LABEL[k]}</th>)}
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id}>
                  <th className="sk-grid-claim">
                    <button type="button" className="sk-grid-claim-btn" onClick={() => openCard(c.id)}>{c.text}</button>
                  </th>
                  {kinds.map((k) => {
                    const v = c.consensus?.[k] ?? 'silent';
                    return (
                      <td key={k} className="sk-grid-td">
                        <button
                          type="button"
                          className={`sk-cell is-${v}`}
                          data-testid={`grid-cell-${c.id}-${k}`}
                          data-value={v}
                          title={`${KIND_LABEL[k]} ${CELL_WORD[v]}`}
                          aria-label={`${KIND_LABEL[k]} ${CELL_WORD[v]} — open the card`}
                          onClick={() => openCard(c.id)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="sk-legend">
            <span className="sk-cell is-agree" /> agrees
            <span className="sk-cell is-disagree" /> disagrees
            <span className="sk-cell is-mixed" /> mixed
            <span className="sk-cell is-silent" /> silent
          </p>
        </div>
      )}
    </div>
  );
}
