import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Concept, Milestone, Project } from '../../shared/types';
import { api } from '../api';
import { useNav } from '../nav';
import { ToastStack, useToasts } from '../components/Toast';
import Loader from '../components/Loader';
import Wordmark from './../library/Wordmark';
import Calibration from './Calibration';
import CalibSummary from './CalibSummary';
import PrimerDeck from './PrimerDeck';
import './primer.css';

type Phase = 'loading' | 'calibration' | 'primer' | 'error';

/** Decide the entry beat for this milestone. */
export function decidePhase(m: Milestone | undefined): 'calibration' | 'primer' | 'workspace' {
  if (!m) return 'workspace';
  const uncleared = m.concepts.filter((c) => !c.cleared);
  if (uncleared.length === 0) return 'workspace';
  if (m.concepts.some((c) => c.source === 'unseen')) return 'calibration';
  return 'primer';
}

export default function MilestoneFlow({
  projectId, milestoneId, review = false,
}: { projectId: string; milestoneId: string; review?: boolean }) {
  const { go } = useNav();
  const { toasts, pushError, dismiss } = useToasts();

  const [project, setProject] = useState<Project | null>(null);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [calibrated, setCalibrated] = useState<Concept[] | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => () => { alive.current = false; }, []);

  const milestone = useMemo(
    () => project?.milestones.find((m) => m.id === milestoneId),
    [project, milestoneId],
  );

  const toWorkspace = useCallback(() => {
    go({ name: 'workspace', projectId, milestoneId });
  }, [go, projectId, milestoneId]);

  // ---- load the project, then pick the phase --------------------------------
  useEffect(() => {
    let cancelled = false;
    api.getProject(projectId).then((p) => {
      if (cancelled) return;
      setProject(p);
      const m = p.milestones.find((x) => x.id === milestoneId);
      if (!m) { setFatal(`No milestone “${milestoneId}” in this project.`); setPhase('error'); return; }
      setConcepts(m.concepts);
      if (review) { setPhase('primer'); return; } // re-reading: no calibration, no auto-forward
      const next = decidePhase(m);
      if (next === 'workspace') { go({ name: 'workspace', projectId, milestoneId }); return; }
      setPhase(next);
    }).catch((e) => {
      if (cancelled) return;
      setFatal(e instanceof Error ? e.message : String(e));
      setPhase('error');
    });
    return () => { cancelled = true; };
  }, [projectId, milestoneId, review, go]);

  /** Write concepts back to disk (and into local state). */
  const applyConcepts = useCallback(async (
    next: Concept[],
    opts?: { status?: 'current'; persist?: boolean },
  ) => {
    setConcepts(next);
    setProject((p) => (p ? {
      ...p,
      milestones: p.milestones.map((m) => (m.id === milestoneId ? { ...m, concepts: next } : m)),
    } : p));
    const base = project;
    if (!base || opts?.persist === false) return;
    const milestones = base.milestones.map((m) => (m.id === milestoneId
      ? { ...m, concepts: next, status: opts?.status && m.status === 'todo' ? opts.status : m.status }
      : m));
    try {
      const saved = await api.patchProject(projectId, { milestones });
      if (alive.current && saved) setProject(saved);
    } catch (e) {
      if (alive.current) pushError(e, 'Progress could not be saved:');
    }
  }, [project, projectId, milestoneId, pushError]);

  const clearConcept = useCallback((conceptId: string, source: Concept['source']) => {
    const next = concepts.map((c) => (
      c.id === conceptId ? { ...c, mastery: 1, cleared: true, source } : c
    ));
    void applyConcepts(next);
  }, [concepts, applyConcepts]);

  /** Skip to the editor: nothing gets cleared, it's just marked as skipped. */
  const skipToEditor = useCallback(() => {
    const next = concepts.map((c) => (c.cleared ? c : { ...c, source: 'skipped' as const }));
    void applyConcepts(next, { status: 'current' });
    toWorkspace();
  }, [concepts, applyConcepts, toWorkspace]);

  const startBuilding = useCallback(() => {
    void applyConcepts(concepts, { status: 'current' });
    toWorkspace();
  }, [concepts, applyConcepts, toWorkspace]);

  // ---- chrome ---------------------------------------------------------------
  const header = (
    <header className="ms-top scanlines">
      <div className="ms-top-left">
        <button
          className="btn btn-ghost btn-sm"
          data-testid="back-to-library"
          onClick={() => go({ name: 'library' })}
        >
          ← Library
        </button>
        <Wordmark small />
      </div>
      <div className="ms-crumbs">
        <span className="ms-project">{project?.name ?? '…'}</span>
        <span className="ms-sep" aria-hidden="true">/</span>
        <strong className="ms-milestone">{milestone?.title ?? milestoneId}</strong>
      </div>
      <div className="ms-top-right">
        {review && <span className="chip chip-accent2">reviewing</span>}
        <span className="chip chip-quiet">
          {concepts.filter((c) => c.cleared).length}/{concepts.length} concepts
        </span>
      </div>
    </header>
  );

  return (
    <div className="ms" data-testid="milestone-flow">
      {header}
      <main className="ms-main">
        {phase === 'loading' && (
          <div className="card ms-panel anim-pop">
            <Loader lines={['opening the project…', 'reading your milestone…']} testId="milestone-loading" />
          </div>
        )}

        {phase === 'error' && (
          <div className="card ms-panel ms-error anim-pop" data-testid="milestone-error">
            <h1>That did not open.</h1>
            <p>{fatal}</p>
            <button className="btn btn-primary" onClick={() => go({ name: 'library' })}>Back to library</button>
          </div>
        )}

        {phase === 'calibration' && milestone && (
          <Calibration
            projectId={projectId}
            milestoneId={milestoneId}
            concepts={concepts}
            onError={(e) => pushError(e, 'Calibration:')}
            /* the server already persisted the grading — just mirror it locally */
            onResult={(next) => { void applyConcepts(next, { persist: false }); }}
            onContinue={(next) => { if (next) setCalibrated(next); setPhase('primer'); }}
            onStartBuilding={startBuilding}
            onSkip={skipToEditor}
          />
        )}

        {phase === 'primer' && milestone && (
          <>
            {calibrated && <CalibSummary concepts={calibrated} />}
            <PrimerDeck
              projectId={projectId}
              milestoneId={milestoneId}
              concepts={concepts}
              review={review}
              onCleared={(conceptId) => clearConcept(conceptId, 'check')}
              onStartBuilding={startBuilding}
              onSkip={skipToEditor}
              onError={(e) => pushError(e, 'Primer:')}
            />
          </>
        )}
      </main>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
