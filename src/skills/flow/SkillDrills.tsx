// Drills: the point of the whole track. Four kinds, on a loop, wrong answers
// cost nothing and always show the evidence.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Claim, Drill, DrillAttempt, Persona, RubricItem, SkillModule, SkillProject, SourceRef,
} from '../../../shared/skills';
import { skillsApi } from '../api';
import { useNav } from '../../nav';
import { ClaimChips, EvidencePanel } from './ClaimChips';
import { mmss } from './util';

type Submit = (answer: unknown) => Promise<DrillAttempt>;

const KIND_LABEL: Record<Drill['kind'], string> = {
  predict: 'predict the winner',
  sprint: 'sprint',
  spot: 'spot the mistake',
  rewrite: 'rewrite for a person',
};

function localAttempt(drill: Drill, answer: unknown): DrillAttempt {
  const at = new Date().toISOString();
  if (drill.kind === 'predict') {
    return { drillId: drill.id, at, answer, correct: answer === drill.winner, feedback: drill.why };
  }
  if (drill.kind === 'spot') {
    const seg = drill.segments[Number(answer)];
    return {
      drillId: drill.id, at, answer, correct: Boolean(seg?.flaw),
      feedback: seg?.flaw ?? 'That line is fine — the flawed one is highlighted.',
    };
  }
  if (drill.kind === 'sprint') {
    const lines = Array.isArray(answer) ? (answer as string[]).filter((s) => s.trim()) : [];
    return { drillId: drill.id, at, answer, feedback: `${lines.length} of ${drill.quota} written. Saved — the grader is offline, so no marks this time.` };
  }
  return { drillId: drill.id, at, answer, feedback: 'Saved — the grader is offline, so no marks this time.' };
}

function Bars({ scores, rubric }: { scores?: Array<{ rubricId: string; score: number }>; rubric: RubricItem[] }) {
  if (!scores || scores.length === 0) return null;
  return (
    <ul className="sk-bars">
      {scores.map((s) => (
        <li key={s.rubricId} className="sk-bar-row">
          <span className="sk-bar-label">{rubric.find((r) => r.id === s.rubricId)?.label ?? s.rubricId}</span>
          <span className="sk-bar"><i style={{ width: `${Math.round(s.score * 100)}%` }} data-low={s.score < 0.5 ? 'true' : 'false'} /></span>
          <b>{s.score.toFixed(2)}</b>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ predict */
function PredictDrill({
  drill, submit, claims, onOpenClaim,
}: { drill: Extract<Drill, { kind: 'predict' }>; submit: Submit; claims: Claim[]; onOpenClaim: (id: string) => void }) {
  const [picked, setPicked] = useState<0 | 1 | null>(null);
  const [res, setRes] = useState<DrillAttempt | null>(null);

  const choose = async (n: 0 | 1) => {
    if (picked !== null) return;
    setPicked(n);
    setRes(await submit(n));
  };

  const right = picked === drill.winner;
  // the server's feedback often repeats the result line — don't say it twice
  const why = res?.feedback && !res.feedback.includes(drill.result) ? res.feedback : drill.why;

  return (
    <>
      <p className="sk-drill-prompt">{drill.prompt}</p>
      <div className="sk-predict">
        {drill.options.map((opt, n) => (
          <button
            key={n}
            type="button"
            className={`sk-predict-opt${picked === n ? ' is-picked' : ''}${picked !== null && n === drill.winner ? ' is-winner' : ''}`}
            data-testid={`predict-opt-${n}`}
            disabled={picked !== null}
            onClick={() => choose(n as 0 | 1)}
          >
            <span className="sk-predict-key" aria-hidden="true">{n === 0 ? 'A' : 'B'}</span>
            <span className="sk-predict-text">{opt}</span>
          </button>
        ))}
      </div>
      {picked !== null && (
        <div className={`sk-result${right ? ' is-right' : ' is-wrong'} anim-pop`} data-testid="predict-result" role="status">
          <b>{right ? 'Right.' : 'Wrong — and that is the cheapest way to learn it.'}</b>
          <p><em>{drill.result}</em></p>
          <p>{why}</p>
          <ClaimChips claimIds={drill.claimIds} claims={claims} onOpen={onOpenClaim} />
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------- sprint */
function SprintDrill({
  drill, submit, rubric,
}: { drill: Extract<Drill, { kind: 'sprint' }>; submit: Submit; rubric: RubricItem[] }) {
  const [lines, setLines] = useState<string[]>(() => new Array(drill.quota).fill(''));
  const [left, setLeft] = useState(drill.seconds);
  const [res, setRes] = useState<DrillAttempt | null>(null);
  const [busy, setBusy] = useState(false);
  const sent = useRef(false);
  const linesRef = useRef(lines);
  linesRef.current = lines;

  const send = useCallback(async () => {
    if (sent.current) return;
    sent.current = true;
    setBusy(true);
    const a = await submit(linesRef.current);
    setRes(a);
    setBusy(false);
  }, [submit]);

  useEffect(() => {
    if (res) return undefined;
    const t = window.setInterval(() => setLeft((l) => l - 1), 1000);
    return () => window.clearInterval(t);
  }, [res]);

  useEffect(() => {
    if (left <= 0 && !sent.current) void send();
  }, [left, send]);

  const written = lines.filter((l) => l.trim()).length;

  return (
    <>
      <p className="sk-drill-prompt">{drill.prompt}</p>
      <div className="sk-sprint-top">
        <span className={`sk-timer${left <= 10 ? ' is-low' : ''}`} data-testid="sprint-timer">{mmss(Math.max(0, left))}</span>
        <span className="sk-quiet">{written}/{drill.quota} written · quantity first, quality follows</span>
      </div>
      <div className="sk-sprint-lines">
        {lines.map((v, n) => (
          <textarea
            key={n}
            className="textarea sk-sprint-line"
            data-testid={`sprint-line-${n}`}
            placeholder={`line ${n + 1}`}
            value={v}
            disabled={Boolean(res)}
            onChange={(e) => setLines((ls) => ls.map((x, j) => (j === n ? e.target.value : x)))}
          />
        ))}
      </div>
      {!res && (
        <button className="btn btn-primary" data-testid="sprint-submit" disabled={busy} onClick={send}>
          {busy ? 'Marking…' : 'Submit the batch →'}
        </button>
      )}
      {res && (
        <div className="sk-result anim-pop" data-testid="sprint-feedback" role="status">
          <b>{left <= 0 ? 'Time. Here is what landed.' : 'Here is what landed.'}</b>
          <p>{res.feedback}</p>
          <Bars scores={res.scores} rubric={rubric} />
        </div>
      )}
    </>
  );
}

/* --------------------------------------------------------------------- spot */
function SpotDrill({
  drill, submit, claims, onOpenClaim,
}: { drill: Extract<Drill, { kind: 'spot' }>; submit: Submit; claims: Claim[]; onOpenClaim: (id: string) => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const [res, setRes] = useState<DrillAttempt | null>(null);

  const flawIndex = drill.segments.findIndex((s) => s.flaw);
  const claimIds = flawIndex >= 0 ? (drill.segments[flawIndex].claimIds ?? []) : [];

  const tap = async (n: number) => {
    if (picked !== null) return;
    setPicked(n);
    setRes(await submit(n));
  };

  return (
    <>
      <p className="sk-drill-prompt">Tap the line that hurts this email.</p>
      <div className="sk-spot">
        {drill.segments.map((s, n) => (
          <button
            key={n}
            type="button"
            className={[
              'sk-spot-seg',
              picked === n ? 'is-picked' : '',
              picked !== null && s.flaw ? 'is-flaw' : '',
            ].filter(Boolean).join(' ')}
            data-testid={`spot-seg-${n}`}
            disabled={picked !== null}
            onClick={() => tap(n)}
          >
            {s.text}
          </button>
        ))}
      </div>
      {picked !== null && (
        <div className={`sk-result${picked === flawIndex ? ' is-right' : ' is-wrong'} anim-pop`} data-testid="spot-result" role="status">
          <b>{picked === flawIndex ? 'That is the one.' : 'Not that one — the flawed line is highlighted.'}</b>
          <p>{res?.feedback ?? drill.segments[flawIndex]?.flaw ?? ''}</p>
          <ClaimChips claimIds={claimIds} claims={claims} onOpen={onOpenClaim} />
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ rewrite */
function RewriteDrill({
  drill, submit, rubric, personas,
}: { drill: Extract<Drill, { kind: 'rewrite' }>; submit: Submit; rubric: RubricItem[]; personas: Persona[] }) {
  const [text, setText] = useState('');
  const [res, setRes] = useState<DrillAttempt | null>(null);
  const [busy, setBusy] = useState(false);
  const who = (id: string): Persona | undefined => personas.find((p) => p.id === id);
  const from = who(drill.fromPersona);
  const to = who(drill.toPersona);

  const send = async () => {
    setBusy(true);
    setRes(await submit(text));
    setBusy(false);
  };

  return (
    <>
      <p className="sk-drill-prompt">Same message, different reader. Rewrite it for them.</p>
      <div className="sk-rewrite-people">
        <div className="sk-person">
          <span className="label">written for</span>
          <b>{from?.name ?? drill.fromPersona}</b>
          <span className="sk-quiet">{from?.bio ?? ''}</span>
        </div>
        <span className="sk-arrow" aria-hidden="true">→</span>
        <div className="sk-person is-target">
          <span className="label">now for</span>
          <b>{to?.name ?? drill.toPersona}</b>
          <span className="sk-quiet">{to?.bio ?? ''}</span>
        </div>
      </div>
      <blockquote className="sk-original">{drill.original}</blockquote>
      <textarea
        className="textarea"
        data-testid="rewrite-input"
        placeholder="Rewrite it here…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button className="btn btn-primary" data-testid="rewrite-submit" disabled={busy || !text.trim()} onClick={send}>
        {busy ? 'Reading it as them…' : 'Submit the rewrite →'}
      </button>
      {res && (
        <div className="sk-result anim-pop" data-testid="rewrite-feedback" role="status">
          <b>{to?.name ?? 'They'} read it like this:</b>
          <p>{res.feedback}</p>
          <Bars scores={res.scores} rubric={rubric} />
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------- screen */
export default function SkillDrills({
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
  const drills = mod.drills;
  const [i, setI] = useState(0);
  const [focusClaim, setFocusClaim] = useState<string | null>(null);
  const alive = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const personas = useMemo(() => project.course?.personas ?? [], [project]);
  const drill = drills[i % Math.max(1, drills.length)];

  const submit = useCallback<(d: Drill) => Submit>((d) => async (answer: unknown) => {
    let attempt: DrillAttempt;
    try {
      attempt = await skillsApi.submitDrill(project.id, { drillId: d.id, answer });
    } catch (e) {
      onError(e);
      attempt = localAttempt(d, answer);
    }
    // reps are the score: pull the fresh count back into the header
    skillsApi.get(project.id).then((p) => { if (alive.current) onProject(p); }).catch(() => { /* header keeps its old count */ });
    return attempt;
  }, [project.id, onProject, onError]);

  const doSubmit = useMemo(() => (drill ? submit(drill) : (async () => localAttempt(drills[0], null))), [submit, drill, drills]);

  if (!drill) {
    return (
      <section className="sk-screen" data-testid="skill-drills">
        <div className="card sk-panel">
          <h1>No drills in this module yet.</h1>
          <p className="sk-lede">Go and write the real thing instead — that counts double.</p>
          <button className="btn btn-primary" data-testid="drills-to-make" onClick={() => go({ name: 'skill', skillId: project.id, screen: 'make', moduleId: mod.id })}>
            Go to Make →
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="sk-screen sk-drills" data-testid="skill-drills">
      <div className="sk-head">
        <div>
          <span className="eyebrow">step 4 · drills · {mod.title}</span>
          <h1>{KIND_LABEL[drill.kind]}</h1>
          <p className="sk-lede">Being wrong here is free. It is the fastest way in.</p>
        </div>
        <div className="sk-drill-nav card">
          <span>{(i % drills.length) + 1} / {drills.length}</span>
          <button className="btn btn-sm" data-testid="drill-next" onClick={() => { setFocusClaim(null); setI((n) => (n + 1) % drills.length); }}>
            Next drill →
          </button>
        </div>
      </div>

      <div className="sk-drills-body">
        <article className="card sk-drill anim-pop" key={`${drill.id}-${i}`} data-testid={`drill-${drill.id}`} data-kind={drill.kind}>
          {drill.kind === 'predict' && (
            <PredictDrill drill={drill} submit={doSubmit} claims={claims} onOpenClaim={setFocusClaim} />
          )}
          {drill.kind === 'sprint' && (
            <SprintDrill drill={drill} submit={doSubmit} rubric={mod.rubric} />
          )}
          {drill.kind === 'spot' && (
            <SpotDrill drill={drill} submit={doSubmit} claims={claims} onOpenClaim={setFocusClaim} />
          )}
          {drill.kind === 'rewrite' && (
            <RewriteDrill drill={drill} submit={doSubmit} rubric={mod.rubric} personas={personas} />
          )}
        </article>

        {focusClaim && (
          <EvidencePanel claims={claims} sources={sources} focusClaimId={focusClaim} onClose={() => setFocusClaim(null)} />
        )}
      </div>

      <div className="sk-actions">
        <button className="btn btn-highlight" data-testid="drills-to-make" onClick={() => go({ name: 'skill', skillId: project.id, screen: 'make', moduleId: mod.id })}>
          Write the real thing →
        </button>
        <span className="sk-quiet">Ten drills and three drafts a day is the whole trick.</span>
      </div>
    </section>
  );
}
