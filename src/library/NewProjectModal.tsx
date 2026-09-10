import { useCallback, useRef, useState } from 'react';
import type { Idea, Project, ProjectPlan } from '../../shared/types';
import { api } from '../api';
import Modal from '../components/Modal';
import Loader from '../components/Loader';

const IDEAS_COPY = [
  'rolling the dice…',
  'raiding the toy box…',
  'looking for a good "aha"…',
  'skipping the boring ones…',
];

const LOADING_COPY = [
  'sizing up what you already know…',
  'carving milestones…',
  'picking the smallest first win…',
  'making sure step one is actually step one…',
  'trimming the text walls…',
  'naming things (the hard part)…',
];

export function slugify(s: string): string {
  return s.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

interface Row {
  key: string;
  id: string;
  title: string;
  concepts: Array<{ id: string; label: string }>;
  entryFile: string;
  isNew?: boolean;
}

let rowSeq = 0;
const nextKey = () => `r${++rowSeq}`;

function uniqueIds(rows: Row[]): string[] {
  const seen = new Set<string>();
  return rows.map((r, i) => {
    let id = (r.isNew ? slugify(r.title) : r.id) || slugify(r.title) || `milestone-${i + 1}`;
    let n = 2;
    while (seen.has(id)) id = `${id}-${n++}`;
    seen.add(id);
    return id;
  });
}

export default function NewProjectModal({
  onClose, onCreated, onError,
}: {
  onClose: () => void;
  onCreated: (p: Project) => void;
  onError: (e: unknown, prefix?: string) => void;
}) {
  const [stage, setStage] = useState<'goal' | 'loading' | 'review' | 'ideas'>('goal');
  const [goal, setGoal] = useState('');
  const [plan, setPlan] = useState<ProjectPlan | null>(null);
  const [name, setName] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [creating, setCreating] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [ideasBusy, setIdeasBusy] = useState(false);
  const [seed, setSeed] = useState<string | null>(null); // riffing on this idea's goal
  const seen = useRef<string[]>([]);                     // titles already shown, never repeated
  const alive = useRef(true);

  const close = useCallback(() => { alive.current = false; onClose(); }, [onClose]);

  const planFrom = useCallback(async (rawGoal: string) => {
    const g = rawGoal.trim();
    if (g.length < 6) { setWarn('Give it a sentence — what do you want to build?'); return; }
    setWarn(null);
    setGoal(g); // accept() stores this as the project's goal
    setStage('loading');
    try {
      const p = await api.planProject(g);
      if (!alive.current) return;
      setPlan(p);
      setName(p.name);
      setRows(p.milestones.map((m) => ({
        key: nextKey(),
        id: m.id,
        title: m.title,
        concepts: m.concepts ?? [],
        entryFile: m.entryFile,
      })));
      setStage('review');
    } catch (e) {
      if (!alive.current) return;
      setStage('goal');
      onError(e, 'Planning failed:');
    }
  }, [onError]);

  const submitGoal = useCallback(() => { void planFrom(goal); }, [planFrom, goal]);

  const fetchIdeas = useCallback(async (nextSeed: string | null) => {
    setIdeasBusy(true);
    setSeed(nextSeed);
    setStage('ideas');
    try {
      const res = await api.ideas({
        ...(nextSeed ? { seed: nextSeed } : {}),
        avoid: seen.current.slice(-20),
      });
      if (!alive.current) return;
      setIdeas(res.ideas);
      seen.current = [...seen.current, ...res.ideas.map((i) => i.title)].slice(-20);
    } catch (e) {
      if (!alive.current) return;
      setStage('goal');
      onError(e, 'Idea generation failed:');
    } finally {
      if (alive.current) setIdeasBusy(false);
    }
  }, [onError]);

  const move = (i: number, dir: -1 | 1) => setRows((rs) => {
    const j = i + dir;
    if (j < 0 || j >= rs.length) return rs;
    const copy = rs.slice();
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy;
  });

  const accept = useCallback(async () => {
    if (!plan) return;
    if (!name.trim()) { setWarn('Your project needs a name.'); return; }
    if (rows.length === 0) { setWarn('Keep at least one milestone.'); return; }
    if (rows.some((r) => !r.title.trim())) { setWarn('Every milestone needs a title.'); return; }
    setWarn(null);
    setCreating(true);
    const ids = uniqueIds(rows);
    // `goal` rides along so the server stores the user's original ask (it
    // otherwise falls back to the project name on the library card).
    const edited: ProjectPlan & { goal: string } = {
      ...plan,
      goal: goal.trim(),
      name: name.trim(),
      slug: slugify(name) || plan.slug,
      milestones: rows.map((r, i) => ({
        id: ids[i],
        title: r.title.trim(),
        concepts: r.concepts,
        entryFile: r.entryFile?.trim() || `${ids[i]}.py`,
      })),
    };
    try {
      const project = await api.createProject(edited);
      if (!alive.current) return;
      onCreated(project);
    } catch (e) {
      onError(e, 'Could not create the project:');
    } finally {
      setCreating(false);
    }
  }, [plan, goal, name, rows, onCreated, onError]);

  // ---------------------------------------------------------------- goal
  if (stage === 'goal' || stage === 'loading') {
    return (
      <Modal
        title={stage === 'loading' ? 'Thinking…' : 'What are you building?'}
        onClose={close}
        testId="new-project-modal"
        width={620}
        dismissOnScrim={stage !== 'loading'}
        footer={stage === 'loading' ? undefined : (
          <>
            <button className="btn btn-ghost" onClick={close}>Cancel</button>
            <button
              className="btn"
              data-testid="ideas-btn"
              title="not sure what to learn? roll five project ideas"
              onClick={() => void fetchIdeas(null)}
            >
              🎲 Inspire me
            </button>
            <button className="btn btn-primary" data-testid="goal-submit" onClick={submitGoal}>
              Plan it →
            </button>
          </>
        )}
      >
        {stage === 'loading' ? (
          <Loader lines={LOADING_COPY} testId="plan-loading" />
        ) : (
          <>
            <textarea
              className="textarea np-goal"
              data-testid="goal-input"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitGoal(); }}
              placeholder={'I want to implement multi-head self-attention in numpy from scratch…'}
              rows={5}
            />
            <p className="np-hint">
              <span className="chip chip-accent3 chip-tilt">psst</span>
              &nbsp;“Not from scratch” is completely allowed — say so and you can lean on a library
              (“a tokenizer, but using <code>regex</code>”). Say what you already know, too; the
              plan will skip it.
            </p>
            {warn && <p className="np-warn" role="alert">{warn}</p>}
          </>
        )}
      </Modal>
    );
  }

  // --------------------------------------------------------------- ideas
  if (stage === 'ideas') {
    return (
      <Modal
        title={seed ? 'In that spirit…' : 'Five directions'}
        onClose={close}
        testId="ideas-panel"
        width={680}
        dismissOnScrim={!ideasBusy}
        footer={
          <>
            <button className="btn btn-ghost" data-testid="ideas-back" disabled={ideasBusy} onClick={() => setStage('goal')}>
              ← Write my own
            </button>
            <button
              className="btn"
              data-testid="ideas-refresh"
              disabled={ideasBusy}
              title={seed ? 'five more in this spirit' : 'five completely different ones'}
              onClick={() => void fetchIdeas(seed)}
            >
              🎲 Five more
            </button>
          </>
        }
      >
        {ideasBusy || !ideas ? (
          <Loader lines={IDEAS_COPY} testId="ideas-loading" />
        ) : (
          <>
            {seed && (
              <p className="np-seed-note">
                <span className="chip chip-accent2 chip-tilt">seed</span>
                &nbsp;riffing on: <em>{seed}</em>
              </p>
            )}
            <ul className="np-ideas">
              {ideas.map((idea, i) => (
                <li key={`${idea.title}-${i}`} className="card np-idea anim-rise" style={{ animationDelay: `${i * 55}ms` }} data-testid={`idea-${i}`}>
                  <div className="np-idea-main">
                    <h3 className="np-idea-title">{idea.title}</h3>
                    <p className="np-idea-pitch">{idea.pitch}</p>
                  </div>
                  <div className="np-idea-tools">
                    <button
                      className="btn btn-primary btn-sm"
                      data-testid={`idea-plan-${i}`}
                      title="plan this project now"
                      onClick={() => void planFrom(idea.goal)}
                    >
                      Plan this →
                    </button>
                    <button
                      className="btn btn-sm"
                      data-testid={`idea-seed-${i}`}
                      title="five more ideas in the spirit of this one"
                      onClick={() => void fetchIdeas(idea.goal)}
                    >
                      ✨ more like this
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      data-testid={`idea-edit-${i}`}
                      title="drop it into the goal box to tweak first"
                      onClick={() => { setGoal(idea.goal); setStage('goal'); }}
                    >
                      ✎ edit
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Modal>
    );
  }

  // -------------------------------------------------------------- review
  return (
    <Modal
      title="Here's the plan"
      onClose={close}
      testId="plan-review"
      width={760}
      dismissOnScrim={false}
      footer={
        <>
          {warn && <span className="np-warn np-warn-inline" role="alert">{warn}</span>}
          <button className="btn btn-ghost" onClick={close} disabled={creating}>Cancel</button>
          <button className="btn btn-primary" data-testid="plan-accept" onClick={accept} disabled={creating}>
            {creating ? 'Building the folder…' : 'Accept & start →'}
          </button>
        </>
      }
    >
      <div className="np-review">
        <label className="np-name">
          <span className="label">Project name</span>
          <input
            className="input"
            data-testid="plan-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <div className="np-rows-head">
          <span className="label label-flush">Milestones</span>
          <span className="chip chip-quiet">{rows.length}</span>
        </div>

        <ol className="np-rows">
          {rows.map((r, i) => (
            <li key={r.key} className="np-row anim-rise" data-testid={`plan-milestone-${i}`}>
              <span className="np-num" aria-hidden="true">{i + 1}</span>
              <div className="np-row-main">
                <input
                  className="input input-bare np-title"
                  data-testid={`plan-title-${i}`}
                  value={r.title}
                  placeholder="name this milestone…"
                  aria-label={`Milestone ${i + 1} title`}
                  onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                />
                <div className="np-concepts">
                  {r.concepts.length === 0 && <span className="np-noconcepts">no concepts yet — that's fine</span>}
                  {r.concepts.map((c, ci) => (
                    <span key={c.id || ci} className="chip chip-tilt np-concept" title={c.label}>
                      {c.label || c.id}
                      <button
                        className="np-concept-x"
                        aria-label={`Remove concept ${c.label || c.id}`}
                        onClick={() => setRows((rs) => rs.map((x, j) => (
                          j === i ? { ...x, concepts: x.concepts.filter((_, k) => k !== ci) } : x
                        )))}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              </div>
              <div className="np-row-tools">
                <button
                  className="btn btn-ghost btn-icon"
                  data-testid={`plan-up-${i}`}
                  aria-label={`Move milestone ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >↑</button>
                <button
                  className="btn btn-ghost btn-icon"
                  data-testid={`plan-down-${i}`}
                  aria-label={`Move milestone ${i + 1} down`}
                  disabled={i === rows.length - 1}
                  onClick={() => move(i, 1)}
                >↓</button>
                <button
                  className="btn btn-ghost btn-icon np-del"
                  data-testid={`plan-delete-${i}`}
                  aria-label={`Delete milestone ${i + 1}`}
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                >✕</button>
              </div>
            </li>
          ))}
        </ol>

        <button
          className="btn np-add"
          data-testid="plan-add-milestone"
          onClick={() => setRows((rs) => [...rs, {
            key: nextKey(), id: '', title: '', concepts: [], entryFile: '', isNew: true,
          }])}
        >
          ＋ add milestone
        </button>

        <p className="np-note">
          Reorder, rename, cut anything that looks like busywork. You can always add more later —
          this is a plan, not a contract.
        </p>
      </div>
    </Modal>
  );
}
