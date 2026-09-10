// Calibrate: the course's own checks, asked once, before anything is taught.
// Nothing is graded — it only decides what we skip. Plus: grade what you already wrote.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CalibrationGradeRes, ProbeAnswer, SkillProject } from '../../../shared/skills';
import type { Concept } from '../../../shared/types';
import { skillsApi } from '../api';
import { useNav } from '../../nav';

interface Probe {
  unitId: string;
  moduleId: string;
  conceptId: string;
  question: string;
  options: string[];     // the REAL options only; "No idea yet" is appended at render time
  answerIndex: number;
  explain: string;
}

// Answer sentinels: >= 0 picks a real option, NO_IDEA is the appended opt-out,
// OWN means "graded from the text they typed", UNANSWERED is blank.
const UNANSWERED = -1;
const OWN = -2;
const NO_IDEA_RE = /^\s*(no idea|not sure|don'?t know)/i;
const CLEAR_AT = 0.8; // Concept semantics: mastery >= 0.8 clears

export default function SkillCalibrate({
  project, onProject, onError,
}: { project: SkillProject; onProject: (p: SkillProject) => void; onError: (e: unknown) => void }) {
  const { go } = useNav();
  const modules = useMemo(() => project.course?.modules ?? [], [project]);

  const probes = useMemo<Probe[]>(() => modules.flatMap((m) => m.units
    .filter((u): u is Extract<typeof u, { kind: 'check' }> => u.kind === 'check')
    .map((u) => {
      // Course checks sometimes end with their own opt-out; strip it so the
      // appended "No idea yet" is the only one and every real option scores as real.
      const last = u.options[u.options.length - 1] ?? '';
      const trailingOptOut = u.options.length > 2 && NO_IDEA_RE.test(last) && u.answerIndex !== u.options.length - 1;
      const options = trailingOptOut ? u.options.slice(0, -1) : u.options;
      return {
        unitId: u.id, moduleId: m.id, conceptId: u.conceptId, question: u.question,
        options, answerIndex: u.answerIndex, explain: u.explain,
      };
    })), [modules]);

  const [answers, setAnswers] = useState<number[]>(() => new Array(probes.length).fill(UNANSWERED));
  const [own, setOwn] = useState<string[]>(() => new Array(probes.length).fill(''));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ cleared: string[]; open: string[]; ownNotes: Array<{ qi: number; mastery: number; note: string }> } | null>(null);

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

  const answered = answers.filter((a, i) => a >= 0 || (a === OWN && own[i].trim())).length;

  const submit = useCallback(async () => {
    setBusy(true);
    // correct = cleared, wrong = a dent, "no idea yet" (or blank) = nothing,
    // own words = whatever the panel says it is worth
    const byModule = new Map<string, Map<string, number>>();
    const ownNotes: Array<{ qi: number; mastery: number; note: string }> = [];
    const cleared: string[] = [];
    const open: string[] = [];
    let latest = project;
    try {
      const ownAnswers: ProbeAnswer[] = [];
      probes.forEach((p, i) => {
        if (answers[i] === OWN && own[i].trim()) {
          ownAnswers.push({ unitId: p.unitId, question: p.question, options: p.options, answerIndex: p.answerIndex, explain: p.explain, answer: own[i].trim() });
        }
      });
      const graded = new Map<string, { mastery: number; note: string }>();
      if (ownAnswers.length) {
        const res = await skillsApi.gradeProbes(project.id, { answers: ownAnswers });
        for (const r of res.results) graded.set(r.unitId, { mastery: r.mastery, note: r.note });
      }

      probes.forEach((p, i) => {
        const a = answers[i];
        let mastery: number;
        if (a === OWN && graded.has(p.unitId)) {
          const g = graded.get(p.unitId)!;
          mastery = g.mastery;
          ownNotes.push({ qi: i, mastery: g.mastery, note: g.note });
        } else if (a === p.answerIndex) mastery = 1;
        else if (a >= 0 && a < p.options.length) mastery = 0.3;
        else mastery = 0; // "No idea yet", blank, or an own-answer left empty
        const m = byModule.get(p.moduleId) ?? new Map<string, number>();
        m.set(p.conceptId, Math.max(m.get(p.conceptId) ?? 0, mastery));
        byModule.set(p.moduleId, m);
      });

      for (const m of modules) {
        const marks = byModule.get(m.id);
        if (!marks) continue;
        const concepts: Concept[] = m.concepts.map((c) => {
          const mastery = marks.get(c.id);
          if (mastery === undefined) { (c.cleared ? cleared : open).push(c.label); return c; }
          const isCleared = c.cleared || mastery >= CLEAR_AT;
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
      setDone({ cleared, open, ownNotes });
      setBusy(false);
    }
  }, [answers, own, probes, modules, project, onProject, onError]);

  const pick = useCallback((qi: number, value: number) => {
    setAnswers((a) => {
      const next = probes.map((_, j) => a[j] ?? UNANSWERED);
      next[qi] = next[qi] === value ? UNANSWERED : value;
      return next;
    });
  }, [probes]);

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
            Answer honestly — <b>“No idea yet” is a fine answer</b>, and you can answer in your own
            words instead of picking. Nothing here is scored; it just decides what we skip.
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
                    const picked = (answers[qi] ?? UNANSWERED) === oi;
                    return (
                      <button
                        key={oi}
                        type="button"
                        className={`cal-opt${picked ? ' is-picked' : ''}`}
                        data-testid={`calib-opt-${qi}-${oi}`}
                        aria-pressed={picked}
                        onClick={() => pick(qi, oi)}
                      >
                        <span className="cal-key" aria-hidden="true">{String.fromCharCode(65 + oi)}</span>
                        <span>{opt}</span>
                      </button>
                    );
                  })}
                  {/* the honest opt-out — always appended, never one of the course's own options */}
                  <button
                    type="button"
                    className={`cal-opt is-noidea${answers[qi] === p.options.length ? ' is-picked' : ''}`}
                    data-testid={`calib-opt-${qi}-${p.options.length}`}
                    aria-pressed={answers[qi] === p.options.length}
                    onClick={() => pick(qi, p.options.length)}
                  >
                    <span className="cal-key" aria-hidden="true">{String.fromCharCode(65 + p.options.length)}</span>
                    <span>No idea yet</span>
                  </button>
                  <div className="cal-own">
                    <button
                      type="button"
                      className={`cal-opt${answers[qi] === OWN ? ' is-picked' : ''}`}
                      data-testid={`calib-own-${qi}`}
                      aria-pressed={answers[qi] === OWN}
                      onClick={() => pick(qi, OWN)}
                    >
                      <span className="cal-key" aria-hidden="true">✎</span>
                      <span>Answer in your own words</span>
                    </button>
                    {answers[qi] === OWN && (
                      <input
                        className="input cal-own-input"
                        data-testid={`calib-own-input-${qi}`}
                        placeholder="One or two sentences — a good answer in your words clears it."
                        value={own[qi] ?? ''}
                        autoFocus
                        onChange={(e) => setOwn((o) => { const next = probes.map((_, j) => o[j] ?? ''); next[qi] = e.target.value; return next; })}
                      />
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>

          <div className="sk-actions">
            <button className="btn btn-primary btn-lg" data-testid="calib-submit" disabled={busy} onClick={submit}>
              {busy ? (answers.includes(OWN) ? 'Reading your answers…' : 'Saving…') : 'Submit answers →'}
            </button>
            <span className="sk-quiet">{answered}/{probes.length} answered · blanks count as “no idea”</span>
          </div>
        </>
      )}

      {done && (
        <div className="card sk-panel anim-pop" data-testid="calib-summary">
          <span className="eyebrow">that's your starting line</span>
          <h2>{done.cleared.length} cleared, {done.open.length} to cover.</h2>
          {done.ownNotes.length > 0 && (
            <ul className="sk-own-list" aria-label="your own answers">
              {done.ownNotes.map((n) => (
                <li key={n.qi} data-testid={`calib-own-note-${n.qi}`}>
                  <b>Q{n.qi + 1} · {n.mastery >= CLEAR_AT ? '✓' : n.mastery >= 0.6 ? '½' : '✗'}</b> {n.note}
                </li>
              ))}
            </ul>
          )}
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
          data-testid="grade-existing-toggle"
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
