// Calibrate: the course's own checks, asked once, before anything is taught.
// Nothing is graded — it only decides what we skip. Plus: grade what you already wrote.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CalibrationGradeRes, SkillProject } from '../../../shared/skills';
import type { Concept } from '../../../shared/types';
import { skillsApi } from '../api';
import { useNav } from '../../nav';

interface Probe {
  moduleId: string;
  conceptId: string;
  question: string;
  options: string[];
  answerIndex: number;
  explain: string;
}

export default function SkillCalibrate({
  project, onProject, onError,
}: { project: SkillProject; onProject: (p: SkillProject) => void; onError: (e: unknown) => void }) {
  const { go } = useNav();
  const modules = useMemo(() => project.course?.modules ?? [], [project]);

  const probes = useMemo<Probe[]>(() => modules.flatMap((m) => m.units
    .filter((u): u is Extract<typeof u, { kind: 'check' }> => u.kind === 'check')
    .map((u) => ({
      moduleId: m.id, conceptId: u.conceptId, question: u.question,
      options: u.options, answerIndex: u.answerIndex, explain: u.explain,
    }))), [modules]);

  const [answers, setAnswers] = useState<number[]>(() => new Array(probes.length).fill(-1));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ cleared: string[]; open: string[] } | null>(null);

  const [gradeOpen, setGradeOpen] = useState(false);
  const [emails, setEmails] = useState(project.frame.existingWork ?? '');
  const [grading, setGrading] = useState(false);
  const [grade, setGrade] = useState<CalibrationGradeRes | null>(null);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const rubricLabel = useCallback((id: string) => {
    for (const m of modules) {
      const r = m.rubric.find((x) => x.id === id);
      if (r) return r.label;
    }
    return id;
  }, [modules]);

  const answered = answers.filter((a) => a >= 0).length;

  const submit = useCallback(async () => {
    setBusy(true);
    // correct = cleared, wrong = a dent, "no idea yet" (or blank) = nothing
    const byModule = new Map<string, Map<string, number>>();
    probes.forEach((p, i) => {
      const a = answers[i];
      const noIdea = a < 0 || a === p.options.length - 1;
      const mastery = a === p.answerIndex ? 1 : noIdea ? 0 : 0.3;
      const m = byModule.get(p.moduleId) ?? new Map<string, number>();
      m.set(p.conceptId, Math.max(m.get(p.conceptId) ?? 0, mastery));
      byModule.set(p.moduleId, m);
    });

    const cleared: string[] = [];
    const open: string[] = [];
    let latest = project;
    try {
      for (const m of modules) {
        const marks = byModule.get(m.id);
        if (!marks) continue;
        const concepts: Concept[] = m.concepts.map((c) => {
          const mastery = marks.get(c.id);
          if (mastery === undefined) { (c.cleared ? cleared : open).push(c.label); return c; }
          const isCleared = c.cleared || mastery >= 1;
          (isCleared ? cleared : open).push(c.label);
          return {
            ...c,
            mastery: Math.max(c.mastery, mastery),
            cleared: isCleared,
            source: isCleared && !c.cleared ? 'calibration' : c.source,
          };
        });
        latest = await skillsApi.patchModule(project.id, m.id, { concepts });
      }
      onProject(latest);
    } catch (e) {
      onError(e);
    } finally {
      setDone({ cleared, open });
      setBusy(false);
    }
  }, [answers, probes, modules, project, onProject, onError]);

  const runGrade = useCallback(async () => {
    setGrading(true);
    try {
      const res = await skillsApi.gradeExisting(project.id, { emails });
      if (alive.current) setGrade(res);
    } catch (e) {
      onError(e);
    } finally {
      if (alive.current) setGrading(false);
    }
  }, [emails, project.id, onError]);

  const nextModule = useMemo(() => {
    const mods = project.course?.modules ?? [];
    return mods.find((m) => m.concepts.some((c) => !c.cleared)) ?? mods[0];
  }, [project]);

  const goLearn = () => go({ name: 'skill', skillId: project.id, screen: 'learn', moduleId: nextModule?.id });

  return (
    <section className="sk-screen" data-testid="skill-calibrate">
      <div className="sk-head">
        <div>
          <span className="eyebrow">step 3 · calibrate</span>
          <h1>What do you already know?</h1>
          <p className="sk-lede">
            Answer honestly — <b>“No idea yet” is a fine answer</b>. Nothing here is scored; it just
            decides what we skip.
          </p>
        </div>
      </div>

      {!done && (
        <>
          <ol className="sk-probes">
            {probes.map((p, qi) => (
              <li key={`${p.moduleId}-${qi}`} className="sk-probe card anim-rise" style={{ animationDelay: `${Math.min(qi, 8) * 50}ms` }}>
                <div className="cal-q-head">
                  <span className="cal-num" aria-hidden="true">{qi + 1}</span>
                  <p className="cal-text">{p.question}</p>
                </div>
                <div className="cal-opts" role="group" aria-label={p.question}>
                  {p.options.map((opt, oi) => {
                    const picked = (answers[qi] ?? -1) === oi;
                    const isNoIdea = oi === p.options.length - 1;
                    return (
                      <button
                        key={oi}
                        type="button"
                        className={`cal-opt${picked ? ' is-picked' : ''}${isNoIdea ? ' is-noidea' : ''}`}
                        data-testid={`calib-opt-${qi}-${oi}`}
                        aria-pressed={picked}
                        onClick={() => setAnswers((a) => {
                          const next = probes.map((_, j) => a[j] ?? -1);
                          next[qi] = next[qi] === oi ? -1 : oi;
                          return next;
                        })}
                      >
                        <span className="cal-key" aria-hidden="true">{String.fromCharCode(65 + oi)}</span>
                        <span>{opt}</span>
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ol>

          <div className="sk-actions">
            <button className="btn btn-primary btn-lg" data-testid="calib-submit" disabled={busy} onClick={submit}>
              {busy ? 'Reading your answers…' : 'Submit answers →'}
            </button>
            <span className="sk-quiet">{answered}/{probes.length} answered · blanks count as “no idea”</span>
          </div>
        </>
      )}

      {done && (
        <div className="card sk-panel anim-pop" data-testid="calib-summary">
          <span className="eyebrow">that's your starting line</span>
          <h2>{done.cleared.length} cleared, {done.open.length} to cover.</h2>
          <ul className="con-list con-list-row">
            {done.cleared.map((l) => (
              <li key={l} className="con-row is-cleared"><span className="con-tick" aria-hidden="true">✓</span><span>{l}</span></li>
            ))}
            {done.open.map((l) => (
              <li key={l} className="con-row"><span className="con-dot" aria-hidden="true" /><span>{l}</span></li>
            ))}
          </ul>
          <div className="sk-actions">
            <button className="btn btn-primary btn-lg" data-testid="calib-continue" onClick={goLearn}>
              Start with “{nextModule?.title ?? 'the first module'}” →
            </button>
          </div>
        </div>
      )}

      {/* ---------------- grade what you already wrote ---------------- */}
      <div className="card sk-grade">
        <button
          type="button"
          className="sk-grade-head"
          aria-expanded={gradeOpen}
          onClick={() => setGradeOpen((v) => !v)}
        >
          <b>Grade my existing emails</b>
          <span className="sk-quiet">Paste your last few. The rubric from the corpus marks them.</span>
          <span className="sk-caret" aria-hidden="true">{gradeOpen ? '▾' : '▸'}</span>
        </button>

        {gradeOpen && (
          <div className="sk-grade-body">
            <textarea
              className="textarea"
              data-testid="grade-existing-input"
              placeholder="Paste two or three emails you actually sent…"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
            />
            <div className="sk-actions">
              <button
                className="btn btn-secondary"
                data-testid="grade-existing-submit"
                disabled={grading || !emails.trim()}
                onClick={runGrade}
              >
                {grading ? 'Marking…' : 'Grade them →'}
              </button>
            </div>

            {grade && (
              <div className="sk-grade-result anim-pop" data-testid="grade-existing-result">
                <p className="sk-grade-summary">{grade.summary}</p>
                <ul className="sk-bars">
                  {grade.scores.map((s) => (
                    <li key={s.rubricId} className="sk-bar-row">
                      <span className="sk-bar-label">{rubricLabel(s.rubricId)}</span>
                      <span className="sk-bar"><i style={{ width: `${Math.round(s.score * 100)}%` }} data-low={s.score < 0.5 ? 'true' : 'false'} /></span>
                      <b>{s.score.toFixed(2)}</b>
                      <em>{s.note}</em>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
