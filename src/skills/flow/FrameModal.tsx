// Frame: what the cartographer needs before it can map a skill — the outcome,
// your situation, and (optional) the long-tail target you are aiming at.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Frame, SkillProject, SkillTarget } from '../../../shared/skills';
import Modal from '../../components/Modal';
import Loader from '../../components/Loader';
import { skillsApi } from '../api';
import '../skills.css';

const LEVELS: Array<{ id: Frame['level']; label: string; note: string }> = [
  { id: 'new', label: 'Brand new', note: 'never really done this' },
  { id: 'some', label: 'Some', note: 'tried it, mixed results' },
  { id: 'experienced', label: 'Experienced', note: 'want the sharp edges' },
];

// The long-tail fields, in the order they make sense out loud.
const TARGET_FIELDS: Array<{ key: keyof SkillTarget; label: string; placeholder: string; wide?: boolean }> = [
  { key: 'who', label: 'who exactly', placeholder: 'C-level at insurance carriers' },
  { key: 'industry', label: 'their industry', placeholder: 'insurance (carriers, brokers, MGAs)' },
  { key: 'where', label: 'where', placeholder: 'United States' },
  { key: 'deal', label: 'the deal', placeholder: 'high-ticket, $50k+ a year' },
  { key: 'different', label: 'what makes this niche different', placeholder: 'They are pitched all day and buy on trust.', wide: true },
];

const EMPTY_TARGET: SkillTarget = { who: '', industry: '', where: '', deal: '', different: '' };

const MAPPING = [
  'mapping every angle… this takes a couple of minutes',
  'asking what a skeptical practitioner would add…',
  'counting how much reading each angle is worth…',
  'you get to prune all of it in a second…',
];

export default function FrameModal({
  onClose, onCreated, onError,
}: { onClose: () => void; onCreated: (p: SkillProject) => void; onError: (e: unknown) => void }) {
  const [name, setName] = useState('');
  const [outcome, setOutcome] = useState('');
  const [context, setContext] = useState('');
  const [level, setLevel] = useState<Frame['level']>('new');
  const [existing, setExisting] = useState('');
  const [target, setTarget] = useState<SkillTarget>(EMPTY_TARGET);
  const [busy, setBusy] = useState(false);
  const alive = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const submit = useCallback(async () => {
    if (!name.trim() || !outcome.trim()) return;
    setBusy(true);
    // A target only counts once we know who or what industry — the rest is colour.
    const trimmed: SkillTarget = {
      who: target.who.trim(),
      industry: target.industry.trim(),
      where: target.where.trim(),
      deal: target.deal.trim(),
      different: target.different.trim(),
    };
    const aimed = Boolean(trimmed.who || trimmed.industry);
    try {
      const p = await skillsApi.create({
        name: name.trim(),
        frame: {
          outcome: outcome.trim(),
          context: context.trim(),
          level,
          ...(existing.trim() ? { existingWork: existing.trim() } : {}),
          ...(aimed ? { target: trimmed } : {}),
        },
      });
      onCreated(p);
    } catch (e) {
      onError(e);
      if (alive.current) setBusy(false);
    }
  }, [name, outcome, context, level, existing, target, onCreated, onError]);

  return (
    <Modal
      onClose={busy ? () => {} : onClose}
      title="What do you want to get good at?"
      testId="frame-modal"
      width={620}
      dismissOnScrim={!busy}
      labelledBy="frame-title"
      footer={busy ? undefined : (
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            data-testid="frame-submit"
            disabled={!name.trim() || !outcome.trim()}
            onClick={submit}
          >
            Map this skill →
          </button>
        </>
      )}
    >
      {busy ? (
        <Loader lines={MAPPING} testId="frame-mapping" />
      ) : (
        <div className="sk-frame">
          <label className="sk-field">
            <span className="label">the skill</span>
            <input
              className="input"
              data-testid="frame-name"
              placeholder="Cold email"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label className="sk-field">
            <span className="label">what counts as winning</span>
            <input
              className="input"
              data-testid="frame-outcome"
              placeholder="5 qualified meetings a month"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
            />
          </label>

          <label className="sk-field">
            <span className="label">your situation</span>
            <textarea
              className="textarea sk-short"
              data-testid="frame-context"
              placeholder="B2B SaaS, $0 budget, sent about 50 cold emails ever"
              value={context}
              onChange={(e) => setContext(e.target.value)}
            />
            <span className="sk-quiet">This filters every claim we keep. Be specific.</span>
          </label>

          <div className="sk-field sk-target-box">
            <span className="label">who you're aiming at (optional)</span>
            <p className="sk-quiet sk-target-note">
              The crew searches wide to narrow: the craft, then neighbours, then exactly this target.
            </p>
            <div className="sk-target-grid">
              {TARGET_FIELDS.map((f) => (
                <label key={f.key} className={`sk-field${f.wide ? ' sk-target-wide' : ''}`}>
                  <span className="label">{f.label}</span>
                  <input
                    className="input"
                    data-testid={`frame-target-${f.key}`}
                    placeholder={f.placeholder}
                    value={target[f.key]}
                    onChange={(e) => setTarget((t) => ({ ...t, [f.key]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="sk-field">
            <span className="label">how far in are you</span>
            <div className="sk-levels">
              {LEVELS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={`sk-level-btn${level === l.id ? ' is-on' : ''}`}
                  data-testid={`frame-level-${l.id}`}
                  aria-pressed={level === l.id}
                  onClick={() => setLevel(l.id)}
                >
                  <b>{l.label}</b>
                  <em>{l.note}</em>
                </button>
              ))}
            </div>
          </div>

          <label className="sk-field">
            <span className="label">optional: paste something you already wrote</span>
            <textarea
              className="textarea sk-short"
              data-testid="frame-existing"
              placeholder="Your last few emails. We grade them later, honestly."
              value={existing}
              onChange={(e) => setExisting(e.target.value)}
            />
          </label>
        </div>
      )}
    </Modal>
  );
}
