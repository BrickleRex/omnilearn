// Learn: a fork of the primer deck over one module's units. Every card is
// rationed to ~120 words and wears the claims it rests on.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Claim, SkillModule, SkillProject, SourceRef } from '../../../shared/skills';
import type { Concept, PrimerUnit } from '../../../shared/types';
import { Markdown } from '../../components/Markdown';
import { skillsApi } from '../api';
import { useNav } from '../../nav';
import { ClaimChips, EvidencePanel } from './ClaimChips';
import { clampWords } from './util';

interface CheckState { picked: number; correct: boolean }

function UnitCard({ unit }: { unit: Extract<PrimerUnit, { kind: 'card' }> }) {
  const [open, setOpen] = useState(false);
  const { head, clamped } = useMemo(() => clampWords(unit.bodyMd, 120), [unit.bodyMd]);
  return (
    <div className="unit unit-card">
      <span className="eyebrow">idea</span>
      <h1>{unit.title}</h1>
      <div className="unit-card-body">
        <Markdown md={open ? unit.bodyMd : head} />
        {clamped && (
          <button type="button" className="btn btn-ghost btn-sm sk-more" onClick={() => setOpen((v) => !v)}>
            {open ? 'less' : 'more'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function SkillLearn({
  project, module: mod, claims, sources, onProject, onError,
}: {
  project: SkillProject;
  module: SkillModule;
  claims: Claim[];
  sources: SourceRef[];
  onProject: (p: SkillProject) => void;
  onError: (e: unknown) => void;
}) {
  const { go } = useNav();
  const units = mod.units;
  const last = units.length;                    // index of the finale slide
  const [i, setI] = useState(0);
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const [focusClaim, setFocusClaim] = useState<string | null>(null);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const cleared = mod.concepts.filter((c) => c.cleared).length;

  const mark = useCallback(async (conceptId: string) => {
    const concept = mod.concepts.find((c) => c.id === conceptId);
    if (!concept || concept.cleared) return;
    const concepts: Concept[] = mod.concepts.map((c) => (
      c.id === conceptId ? { ...c, mastery: 1, cleared: true, source: 'check' as const } : c
    ));
    try {
      const p = await skillsApi.patchModule(project.id, mod.id, { concepts });
      if (alive.current) onProject(p);
    } catch (e) {
      onError(e);
    }
  }, [mod, project.id, onProject, onError]);

  const pick = useCallback((unit: Extract<PrimerUnit, { kind: 'check' }>, j: number) => {
    const correct = j === unit.answerIndex;
    setChecks((c) => ({ ...c, [unit.id]: { picked: j, correct } }));
    if (correct) void mark(unit.conceptId);
  }, [mark]);

  const toDrills = () => go({ name: 'skill', skillId: project.id, screen: 'drills', moduleId: mod.id });

  const unit = i < units.length ? units[i] : null;
  const unitClaims = unit ? (mod.unitClaims?.[unit.id] ?? []) : [];

  return (
    <section className="sk-screen sk-learn" data-testid="skill-learn">
      <div className="sk-learn-main">
        <section className="deck" data-testid="primer-deck">
          <nav className="deck-dots" aria-label="Deck progress">
            {units.map((u, n) => (
              <button
                key={u.id ?? n}
                type="button"
                className={`dot dot-${u.kind}${n === i ? ' is-current' : ''}${n < i ? ' is-past' : ''}`}
                data-testid={`primer-dot-${n}`}
                aria-label={`Card ${n + 1} of ${units.length}`}
                onClick={() => setI(n)}
              />
            ))}
            <button
              type="button"
              className={`dot dot-finish${i === last ? ' is-current' : ''}`}
              data-testid={`primer-dot-${units.length}`}
              aria-label="Finish"
              onClick={() => setI(last)}
            >
              <span aria-hidden="true">⚑</span>
            </button>
          </nav>

          <article className="card deck-card anim-pop" key={i}>
            {unit?.kind === 'card' && <UnitCard unit={unit} />}

            {unit?.kind === 'story' && (
              <div className="unit unit-card">
                <span className="eyebrow">idea</span>
                <h1>{unit.title}</h1>
                <div className="unit-card-body">
                  {unit.beats.map((b, n) => <p key={n}>{clampWords(b.text, 120).head}</p>)}
                </div>
              </div>
            )}

            {unit?.kind === 'check' && (
              <div className="unit unit-check" data-testid="primer-check" data-correct={checks[unit.id] ? String(checks[unit.id].correct) : undefined}>
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
              <div className="unit unit-finish">
                <span className="eyebrow">end of the reading</span>
                <h1>That's the whole idea. Now reps.</h1>
                <p className="sk-lede">
                  {cleared} of {mod.concepts.length} concepts clear. You learn this by doing it wrong
                  a few times, quickly — the drills are where that happens.
                </p>
                <div className="sk-actions">
                  <button className="btn btn-primary btn-lg" data-testid="primer-finish" onClick={toDrills}>
                    Go to the drills →
                  </button>
                </div>
              </div>
            )}

            {unitClaims.length > 0 && (
              <ClaimChips claimIds={unitClaims} claims={claims} onOpen={setFocusClaim} />
            )}
          </article>

          <div className="deck-controls">
            <button className="btn btn-ghost" data-testid="primer-prev" disabled={i === 0} onClick={() => setI((n) => Math.max(0, n - 1))}>
              ← Back
            </button>
            <span className="deck-count">{Math.min(i + 1, last + 1)} / {last + 1}</span>
            <button className="btn btn-primary" data-testid="primer-next" disabled={i >= last} onClick={() => setI((n) => Math.min(last, n + 1))}>
              Next →
            </button>
          </div>

          <footer className="deck-foot card">
            <div className="deck-foot-head">
              <span className="label" style={{ margin: 0 }}>{mod.title}</span>
              <span className="chip chip-quiet">{cleared}/{mod.concepts.length}</span>
            </div>
            <ul className="con-list con-list-row">
              {mod.concepts.map((c) => (
                <li key={c.id} className={`con-row${c.cleared ? ' is-cleared' : ''}`} data-testid={`concept-${c.id}`} data-cleared={c.cleared ? 'true' : 'false'}>
                  <span className={c.cleared ? 'con-tick' : 'con-dot'} aria-hidden="true">{c.cleared ? '✓' : ''}</span>
                  <span>{c.label}</span>
                </li>
              ))}
            </ul>
            <button className="btn btn-highlight btn-sm deck-skip" data-testid="learn-to-drills" onClick={toDrills}>
              Skip to drills →
            </button>
          </footer>
        </section>
      </div>

      {focusClaim && (
        <EvidencePanel
          claims={claims}
          sources={sources}
          focusClaimId={focusClaim}
          onClose={() => setFocusClaim(null)}
        />
      )}
    </section>
  );
}
