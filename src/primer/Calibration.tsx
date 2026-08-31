import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Calibration as CalibrationDoc, Concept } from '../../shared/types';
import { api } from '../api';
import Loader from '../components/Loader';

const LOADING = [
  'writing a few honest questions…',
  'nothing here is graded…',
  'looking for what you already know…',
];

export default function Calibration({
  projectId, milestoneId, concepts, onResult, onContinue, onStartBuilding, onSkip, onError,
}: {
  projectId: string;
  milestoneId: string;
  concepts: Concept[];
  onResult: (concepts: Concept[]) => void;
  onContinue: (concepts?: Concept[]) => void;
  onStartBuilding: () => void;
  onSkip: () => void;
  onError: (e: unknown) => void;
}) {
  const [doc, setDoc] = useState<CalibrationDoc | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Concept[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    api.calibration(projectId, milestoneId).then((d) => {
      if (cancelled) return;
      setDoc(d);
      setAnswers(new Array(d.questions.length).fill(-1));
    }).catch((e) => {
      if (cancelled) return;
      setFailed(true);
      onError(e);
    });
    return () => { cancelled = true; };
  }, [projectId, milestoneId, onError]);

  const answered = answers.filter((a) => a >= 0).length;

  const submit = useCallback(async () => {
    if (!doc) return;
    setBusy(true);
    try {
      const res = await api.submitCalibration(projectId, { milestoneId, answers });
      onResult(res.concepts);
      if (res.concepts.every((c) => c.cleared)) {
        // nothing left to teach: celebrate here, then straight to the editor
        setResult(res.concepts);
      } else {
        // otherwise the "cover / skip" summary rides on top of the deck
        onContinue(res.concepts);
      }
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }, [doc, projectId, milestoneId, answers, onResult, onContinue, onError]);

  // ------------------------------- everything already cleared: celebrate
  if (result) {
    const cleared = result.filter((c) => c.cleared);
    return (
      <section className="card ms-panel anim-pop" data-testid="calibration-summary">
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 10 }, (_, n) => (
            <i key={n} style={{ left: `${6 + n * 9}%`, animationDelay: `${n * 90}ms` }} />
          ))}
        </div>
        <span className="eyebrow">nothing to teach you</span>
        <h1>You already know all of this.</h1>
        <p className="ms-lede">
          Every concept in this milestone came back clear. No primer, no filler — go write it.
        </p>
        <ul className="con-list">
          {cleared.map((c) => (
            <li key={c.id} className="con-row is-cleared">
              <span className="con-tick" aria-hidden="true">✓</span>
              <span>{c.label}</span>
            </li>
          ))}
        </ul>
        <div className="ms-actions">
          <button className="btn btn-primary btn-lg" data-testid="start-building" onClick={onStartBuilding}>
            Start building →
          </button>
          <button className="btn btn-ghost btn-sm" data-testid="skip-to-editor" onClick={onSkip}>
            Skip to editor
          </button>
        </div>
      </section>
    );
  }

  // ------------------------------------------------------------- loading
  if (!doc) {
    return (
      <section className="card ms-panel anim-pop" data-testid="calibration">
        {failed ? (
          <>
            <h1>Calibration didn't come back.</h1>
            <p className="ms-lede">You can head straight into the primer instead.</p>
            <div className="ms-actions">
              <button className="btn btn-primary" onClick={() => onContinue()}>Go to the primer →</button>
              <button className="btn btn-ghost btn-sm" data-testid="skip-to-editor" onClick={onSkip}>Skip to editor</button>
            </div>
          </>
        ) : (
          <Loader lines={LOADING} testId="calibration-loading" />
        )}
      </section>
    );
  }

  // ------------------------------------------------------------- questions
  return (
    <section className="card ms-panel anim-pop" data-testid="calibration">
      <span className="eyebrow">step 1 of 2 · calibrate</span>
      <h1>Where are you starting from?</h1>
      <p className="ms-lede">
        Answer honestly — <b>“No idea yet” is a completely fine answer</b>. Nothing here is scored,
        it just decides what we skip and what we cover.
      </p>

      <ol className="cal-qs">
        {doc.questions.map((q, qi) => (
          <li key={q.id ?? qi} className="cal-q anim-rise" style={{ animationDelay: `${qi * 60}ms` }}>
            <div className="cal-q-head">
              <span className="cal-num" aria-hidden="true">{qi + 1}</span>
              <p className="cal-text">{q.question}</p>
            </div>
            <div className="cal-opts" role="group" aria-label={q.question}>
              {q.options.map((opt, oi) => {
                const picked = answers[qi] === oi;
                const isNoIdea = oi === q.options.length - 1;
                return (
                  <button
                    key={oi}
                    type="button"
                    className={`cal-opt${picked ? ' is-picked' : ''}${isNoIdea ? ' is-noidea' : ''}`}
                    data-testid={`calib-opt-${qi}-${oi}`}
                    aria-pressed={picked}
                    onClick={() => setAnswers((a) => a.map((v, j) => (j === qi ? (v === oi ? -1 : oi) : v)))}
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

      <div className="ms-actions cal-actions">
        <button
          className="btn btn-primary btn-lg"
          data-testid="calib-submit"
          disabled={busy}
          onClick={submit}
        >
          {busy ? 'Reading your answers…' : 'Submit answers →'}
        </button>
        <span className="cal-count">{answered}/{doc.questions.length} answered · blanks count as “no idea”</span>
        <button className="btn btn-ghost btn-sm" data-testid="skip-to-editor" onClick={onSkip}>
          Skip to editor
        </button>
      </div>
    </section>
  );
}
