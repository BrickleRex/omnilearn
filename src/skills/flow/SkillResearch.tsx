// Research: a live window on the crew (SSE). Resumable — POSTing again resumes.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ResearchJob, SkillProject } from '../../../shared/skills';
import { skillsApi } from '../api';
import { useNav } from '../../nav';
import Loader from '../../components/Loader';

const LOADING = [
  'reading the internet so you don\'t have to…',
  'weighing who is worth believing…',
  'throwing out the ads…',
  'turning arguments into claim cards…',
  'building your course…',
];

const PHASES: Array<{ key: ResearchJob['phase']; label: string }> = [
  { key: 'cartography', label: 'mapping' },
  { key: 'scouting', label: 'scouting' },
  { key: 'enriching', label: 'reading' },
  { key: 'assessing', label: 'judging' },
  { key: 'reconciling', label: 'resolving' },
  { key: 'architecting', label: 'building' },
  { key: 'done', label: 'done' },
];

export default function SkillResearch({
  project, onError,
}: { project: SkillProject; onError: (e: unknown) => void }) {
  const { go } = useNav();
  const [job, setJob] = useState<ResearchJob | null>(null);
  const [retrying, setRetrying] = useState(false);
  const alive = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    alive.current = true;
    let live = true;
    let es: EventSource | null = null;

    (async () => {
      try {
        const j = await skillsApi.research(project.id);
        if (!live) return;
        setJob(j);
        if (j.phase === 'idle') {
          const started = await skillsApi.startResearch(project.id);
          if (!live) return;
          setJob(started);
        }
      } catch (e) {
        if (live) onError(e);
      }
      if (!live) return;
      es = new EventSource(skillsApi.researchStreamUrl(project.id));
      es.onmessage = (ev) => {
        if (!live) return;
        try { setJob(JSON.parse(ev.data) as ResearchJob); } catch { /* keep the last snapshot */ }
      };
      es.onerror = () => { es?.close(); };
    })();

    return () => { live = false; alive.current = false; es?.close(); };
  }, [project.id, onError]);

  // the log scrolls itself
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [job?.log?.length]);

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      const j = await skillsApi.startResearch(project.id);
      if (alive.current) setJob(j);
    } catch (e) {
      onError(e);
    } finally {
      if (alive.current) setRetrying(false);
    }
  }, [project.id, onError]);

  const phase = job?.phase ?? 'idle';
  const done = phase === 'done';
  const failed = phase === 'failed';
  const p = job?.progress ?? { anglesKept: 0, anglesDone: 0, sources: 0, claims: 0, modules: 0 };
  const at = PHASES.findIndex((x) => x.key === phase);

  return (
    <section className="sk-screen" data-testid="skill-research">
      <div className="sk-head">
        <div>
          <span className="eyebrow">step 2 · research</span>
          <h1>{done ? 'Your course is built.' : failed ? 'The crew hit a wall.' : 'The crew is out reading.'}</h1>
          <p className="sk-lede">
            {done
              ? 'Sources read, claims weighed, modules written. Next we find out what you already know.'
              : failed
                ? 'Nothing is lost — starting again picks up where it stopped.'
                : 'They search, read, judge each source, then argue it out into claim cards. You can leave and come back.'}
          </p>
        </div>
        <div className="sk-phase card">
          <span className="label">phase</span>
          <b data-testid="research-phase">{phase}</b>
        </div>
      </div>

      <ol className="sk-phases">
        {PHASES.map((x, i) => (
          <li key={x.key} className={`sk-phase-step${phase === x.key ? ' is-now' : ''}${at > i && at >= 0 ? ' is-past' : ''}`}>
            <i aria-hidden="true" />
            <span>{x.label}</span>
          </li>
        ))}
      </ol>

      <div className="sk-counts">
        <div className="card sk-count"><b>{p.anglesDone}/{p.anglesKept}</b><span>angles</span></div>
        <div className="card sk-count"><b>{p.sources}</b><span>sources</span></div>
        <div className="card sk-count"><b>{p.claims}</b><span>claims</span></div>
        <div className="card sk-count"><b>{p.modules}</b><span>modules</span></div>
      </div>

      {!done && !failed && <Loader lines={LOADING} testId="research-loading" />}

      {failed && (
        <div className="sk-fail card">
          <b>{job?.error ?? 'The research job failed.'}</b>
          <button className="btn btn-primary" disabled={retrying} onClick={retry}>
            {retrying ? 'Picking it back up…' : 'Try again →'}
          </button>
        </div>
      )}

      <div className="sk-log card" data-testid="research-log" ref={logRef} aria-live="polite">
        {(job?.log ?? []).length === 0 && <p className="sk-quiet">waiting for the first scout…</p>}
        {(job?.log ?? []).map((line, i) => <p key={`${i}-${line}`} className="sk-log-line">{line}</p>)}
      </div>

      <div className="sk-actions">
        <button
          className="btn btn-primary btn-lg"
          data-testid="research-continue"
          disabled={!done}
          onClick={() => go({ name: 'skill', skillId: project.id, screen: 'calibrate' })}
        >
          {done ? 'What do you already know? →' : 'Still working…'}
        </button>
      </div>
    </section>
  );
}
