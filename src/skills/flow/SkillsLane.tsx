// The Skills lane in the Library: one card per skill project.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SkillPhase, SkillSummary } from '../../../shared/skills';
import Segbar from '../../components/Segbar';
import { useNav } from '../../nav';
import { skillsApi } from '../api';
import { screenForPhase } from './util';
import '../skills.css';

const PHASE_NEXT: Record<SkillPhase, string> = {
  framing: 'Tell it what winning looks like.',
  mapping: 'Prune the angle map, then send the scouts.',
  researching: 'The crew is out reading the web.',
  calibrating: 'Find out what you already know.',
  learning: 'A short read, then straight into reps.',
  practicing: 'Drills are waiting. Reps are the whole trick.',
  making: 'Write the real thing and run it past the panel.',
};

const PHASE_WORD: Record<SkillPhase, string> = {
  framing: 'framing',
  mapping: 'mapping',
  researching: 'researching',
  calibrating: 'calibrating',
  learning: 'learning',
  practicing: 'drilling',
  making: 'making',
};

export default function SkillsLane({ onNew }: { onNew: () => void }) {
  const { go } = useNav();
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(false);

  const load = useCallback(() => {
    skillsApi.list()
      .then((s) => { if (alive.current) { setSkills(s); setFailed(false); } })
      .catch(() => { if (alive.current) { setSkills([]); setFailed(true); } });
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    return () => { alive.current = false; };
  }, [load]);

  const open = (s: SkillSummary) => go({
    name: 'skill', skillId: s.id, screen: screenForPhase(s),
  });

  return (
    <div data-testid="skills-lane">
      {skills === null && (
        <div className="lib-skeletons" aria-hidden="true">
          {[0, 1].map((i) => <div key={i} className="card lib-skel" style={{ animationDelay: `${i * 70}ms` }} />)}
        </div>
      )}

      {skills !== null && skills.length === 0 && (
        <section className="lib-empty anim-pop">
          <div className="lib-empty-art" aria-hidden="true">
            <span className="blob b1" />
            <span className="blob b2" />
            <span className="blob b3" />
          </div>
          <h1>Pick a skill the world grades you on.</h1>
          <p>
            Cold email, cold calls, thumbnails, pitch decks. We map every angle, read the web for
            you, then you <b>drill it and make the real thing</b> — and reality gets the last word.
          </p>
          <button className="btn btn-primary btn-lg" onClick={onNew}>Start your first skill</button>
          {failed && <p className="sk-quiet">(the skills service isn't answering yet)</p>}
        </section>
      )}

      {skills !== null && skills.length > 0 && (
        <>
          <div className="lib-heading">
            <h1>Your skills</h1>
            <span className="chip chip-quiet">{skills.length}</span>
          </div>
          <ul className="lib-grid">
            {skills.map((s, i) => (
              <li
                key={s.id}
                className="card card-lift lib-card anim-rise"
                style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
                data-testid={`skill-card-${s.id}`}
              >
                <div className="lib-card-top">
                  <h2 className="lib-card-name">{s.name}</h2>
                  <span className="chip chip-accent2 chip-tilt">{PHASE_WORD[s.phase] ?? s.phase}</span>
                </div>

                <p className="lib-card-goal">{PHASE_NEXT[s.phase] ?? 'Pick up where you left off.'}</p>

                <div className="lib-card-meta">
                  <span className="chip chip-accent3" title="drills + runs + ships">{s.reps} {s.reps === 1 ? 'rep' : 'reps'}</span>
                  <span className="lib-progress">
                    <Segbar
                      done={s.modulesDone}
                      total={s.modulesTotal}
                      current={s.modulesDone}
                      label={`${s.modulesDone} of ${s.modulesTotal} modules done`}
                    />
                    <b>{s.modulesDone}/{s.modulesTotal}</b>
                  </span>
                </div>

                <button className="btn btn-primary lib-open" data-testid={`skill-open-${s.id}`} onClick={() => open(s)}>
                  Open →
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
