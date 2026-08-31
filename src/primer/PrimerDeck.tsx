import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Concept, PrimerDoc, PrimerUnit } from '../../shared/types';
import { api } from '../api';
import Loader from '../components/Loader';
import { Figure, Markdown } from '../components/Markdown';
import StoryUnit from './StoryUnit';

const LOADING = [
  'writing your primer…',
  'drawing the figures…',
  'keeping it to one idea per card…',
  'cutting the text walls…',
  'saving the rest for the editor…',
];

interface CheckState { picked: number; correct: boolean }

export default function PrimerDeck({
  projectId, milestoneId, concepts, onCleared, onStartBuilding, onSkip, onError, onNotice,
}: {
  projectId: string;
  milestoneId: string;
  concepts: Concept[];
  onCleared: (conceptId: string) => void;
  onStartBuilding: () => void;
  onSkip: () => void;
  onError: (e: unknown) => void;
  onNotice: (msg: string) => void;
}) {
  const [doc, setDoc] = useState<PrimerDoc | null>(null);
  const [failed, setFailed] = useState(false);
  const [i, setI] = useState(0);
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const jumped = useRef(false);

  useEffect(() => {
    let cancelled = false;
    api.primer(projectId, milestoneId).then((d) => {
      if (!cancelled) setDoc(d);
    }).catch((e) => {
      if (cancelled) return;
      setFailed(true);
      onError(e);
    });
    return () => { cancelled = true; };
  }, [projectId, milestoneId, onError]);

  const units: PrimerUnit[] = useMemo(() => doc?.units ?? [], [doc]);
  const last = units.length; // index of the finale slide
  const allCleared = concepts.length > 0 && concepts.every((c) => c.cleared);

  const go = useCallback((n: number) => {
    setI((cur) => {
      const next = Math.max(0, Math.min(last, n));
      if (next !== cur) window.scrollTo({ top: 0, behavior: 'smooth' });
      return next;
    });
  }, [last]);

  // the deck ends itself the moment the last concept clears
  useEffect(() => {
    if (allCleared && units.length > 0 && !jumped.current) {
      jumped.current = true;
      const t = window.setTimeout(() => setI(units.length), 550);
      return () => window.clearTimeout(t);
    }
  }, [allCleared, units.length]);

  // arrow keys drive the deck (but never steal typing or story scrolling)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.closest('.story-scroll'))) return;
      e.preventDefault();
      go(i + (e.key === 'ArrowRight' ? 1 : -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [i, go]);

  const pick = useCallback((unit: Extract<PrimerUnit, { kind: 'check' }>, j: number) => {
    const correct = j === unit.answerIndex;
    setChecks((c) => ({ ...c, [unit.id]: { picked: j, correct } }));
    if (correct) {
      const concept = concepts.find((c) => c.id === unit.conceptId);
      if (concept && !concept.cleared) {
        onCleared(unit.conceptId);
        onNotice(`“${concept.label}” — cleared.`);
      }
    }
  }, [concepts, onCleared, onNotice]);

  // --------------------------------------------------------------- loading
  if (!doc) {
    return (
      <section className="card ms-panel anim-pop" data-testid="primer-loading-panel">
        {failed ? (
          <>
            <h1>The primer didn't come back.</h1>
            <p className="ms-lede">No shame in going straight to the editor — you can ask for hints in there.</p>
            <div className="ms-actions">
              <button className="btn btn-primary" data-testid="skip-to-editor" onClick={onSkip}>Go to the editor →</button>
            </div>
          </>
        ) : (
          <Loader lines={LOADING} testId="primer-loading" />
        )}
      </section>
    );
  }

  const unit = i < units.length ? units[i] : null;
  const openConcepts = concepts.filter((c) => !c.cleared);

  return (
    <section className="deck" data-testid="primer-deck">
      {/* ---- progress dots ---- */}
      <nav className="deck-dots" aria-label="Primer progress">
        {units.map((u, n) => (
          <button
            key={u.id ?? n}
            type="button"
            className={`dot dot-${u.kind}${n === i ? ' is-current' : ''}${n < i ? ' is-past' : ''}`}
            data-testid={`primer-dot-${n}`}
            aria-label={`Card ${n + 1} of ${units.length} (${u.kind})`}
            aria-current={n === i ? 'step' : undefined}
            onClick={() => go(n)}
          />
        ))}
        <button
          type="button"
          className={`dot dot-finish${i === last ? ' is-current' : ''}`}
          data-testid={`primer-dot-${units.length}`}
          aria-label="Finish"
          onClick={() => go(last)}
        >
          <span aria-hidden="true">⚑</span>
        </button>
      </nav>

      {/* ---- the card frame ---- */}
      <article className="card deck-card anim-pop" key={i}>
        {unit?.kind === 'card' && (
          <div className="unit unit-card">
            <span className="eyebrow">idea {i + 1}</span>
            <h1>{unit.title}</h1>
            <div className="unit-card-body">
              <Markdown md={unit.bodyMd} />
              {unit.figureSvg && <Figure svg={unit.figureSvg} testId="primer-figure" />}
            </div>
          </div>
        )}

        {unit?.kind === 'story' && <StoryUnit unit={unit} index={i} />}

        {unit?.kind === 'check' && (
          <div
            className="unit unit-check"
            data-testid="primer-check"
            data-correct={checks[unit.id] ? String(checks[unit.id].correct) : undefined}
          >
            <span className="eyebrow">quick check</span>
            <h1>{unit.question}</h1>
            <div className="check-opts" role="group" aria-label={unit.question}>
              {unit.options.map((opt, j) => {
                const st = checks[unit.id];
                const picked = st?.picked === j;
                const state = picked ? (st.correct ? ' is-right' : ' is-wrong') : '';
                const revealed = st?.correct && j === unit.answerIndex ? ' is-answer' : '';
                return (
                  <button
                    key={j}
                    type="button"
                    className={`check-opt${state}${revealed}`}
                    data-testid={`check-opt-${j}`}
                    aria-pressed={picked}
                    onClick={() => pick(unit, j)}
                  >
                    <span className="cal-key" aria-hidden="true">{String.fromCharCode(65 + j)}</span>
                    <span>{opt}</span>
                    {picked && <span className="check-mark" aria-hidden="true">{st.correct ? '✓' : '✕'}</span>}
                  </button>
                );
              })}
            </div>
            {checks[unit.id] && (
              <div className={`check-explain${checks[unit.id].correct ? ' is-right' : ' is-wrong'}`} role="status">
                <b>{checks[unit.id].correct ? 'Yep.' : 'Not quite — read this, then try again.'}</b>
                <p>{unit.explain}</p>
              </div>
            )}
          </div>
        )}

        {unit === null && (
          <div className="unit unit-finish" data-testid="primer-finish">
            {allCleared ? (
              <>
                <div className="confetti" aria-hidden="true">
                  {Array.from({ length: 12 }, (_, n) => (
                    <i key={n} style={{ left: `${4 + n * 8}%`, animationDelay: `${n * 80}ms` }} />
                  ))}
                </div>
                <span className="eyebrow">every concept cleared</span>
                <h1>That's enough — let's build.</h1>
                <p className="ms-lede">
                  You know the pieces. The rest is typing, running, and being wrong a few times —
                  which is the actual point.
                </p>
                {doc.steps?.length > 0 && (
                  <ol className="finish-steps">
                    {doc.steps.map((s, n) => (
                      <li key={n}>
                        <b>{s.title}</b>
                        <span>{s.detail}</span>
                      </li>
                    ))}
                  </ol>
                )}
                <div className="ms-actions">
                  <button className="btn btn-primary btn-lg" data-testid="start-building" onClick={onStartBuilding}>
                    Start building →
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="eyebrow">end of the deck</span>
                <h1>Still a couple of open ones.</h1>
                <p className="ms-lede">
                  Pass their checks and the deck lets you out — or go to the editor anyway, nothing
                  is locked.
                </p>
                <ul className="con-list">
                  {openConcepts.map((c) => <li key={c.id} className="con-row"><span className="con-dot" aria-hidden="true" />{c.label}</li>)}
                </ul>
                <div className="ms-actions">
                  <button className="btn btn-primary" onClick={() => go(0)}>Back through the deck</button>
                </div>
              </>
            )}
          </div>
        )}
      </article>

      {/* ---- deck controls ---- */}
      <div className="deck-controls">
        <button
          className="btn btn-ghost"
          data-testid="primer-prev"
          onClick={() => go(i - 1)}
          disabled={i === 0}
        >
          ← Back
        </button>
        <span className="deck-count">{Math.min(i + 1, last + 1)} / {last + 1}</span>
        <button
          className="btn btn-primary"
          data-testid="primer-next"
          onClick={() => go(i + 1)}
          disabled={i >= last}
        >
          Next →
        </button>
      </div>

      {/* ---- persistent concept checklist ---- */}
      <footer className="deck-foot card">
        <div className="deck-foot-head">
          <span className="label" style={{ margin: 0 }}>What counts as enough</span>
          <span className="chip chip-quiet">
            {concepts.filter((c) => c.cleared).length}/{concepts.length}
          </span>
        </div>
        <ul className="con-list con-list-row">
          {concepts.map((c) => (
            <li
              key={c.id}
              className={`con-row${c.cleared ? ' is-cleared' : ''}`}
              data-testid={`concept-${c.id}`}
              data-cleared={c.cleared ? 'true' : 'false'}
              title={c.cleared ? `cleared via ${c.source}` : 'not yet'}
            >
              <span className={c.cleared ? 'con-tick' : 'con-dot'} aria-hidden="true">{c.cleared ? '✓' : ''}</span>
              <span>{c.label}</span>
            </li>
          ))}
        </ul>
        <button className="btn btn-ghost btn-sm deck-skip" data-testid="skip-to-editor" onClick={onSkip}>
          Skip to editor
        </button>
      </footer>
    </section>
  );
}
