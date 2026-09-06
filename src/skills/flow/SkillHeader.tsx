// One row on every skill screen: where you are, how many reps you have, and the
// two escape hatches (drills / make) that are never hidden.
import type { SkillProject } from '../../../shared/skills';
import { useNav, type SkillScreen } from '../../nav';
import { BEATS, beatIndex, pickModule, repCount } from './util';

export default function SkillHeader({
  project, screen, moduleId,
}: { project: SkillProject; screen: SkillScreen; moduleId?: string }) {
  const { go } = useNav();
  const here = beatIndex(screen, project);
  const mod = pickModule(project, moduleId);
  const reps = repCount(project);
  const noCourse = !mod;
  const tip = 'Once research is done this opens up.';

  const jump = (s: SkillScreen) => {
    if (!mod) return;
    go({ name: 'skill', skillId: project.id, screen: s, moduleId: mod.id });
  };

  return (
    <header className="sk-top scanlines">
      <button
        className="btn btn-ghost btn-sm sk-back"
        data-testid="back-to-library"
        onClick={() => go({ name: 'library' })}
      >
        ← Library
      </button>

      <b className="sk-name" title={project.name}>{project.name}</b>

      <ol className="sk-beats" aria-label="Skill beats">
        {BEATS.map((b, i) => (
          <li
            key={b}
            className={`sk-beat${i === here ? ' is-now' : ''}${i < here ? ' is-past' : ''}`}
            aria-current={i === here ? 'step' : undefined}
            data-testid={`beat-${b.toLowerCase()}`}
          >
            <i aria-hidden="true" />
            <span>{b}</span>
          </li>
        ))}
      </ol>

      <span className="chip chip-accent3 sk-reps" data-testid="rep-counter" title="drills + runs + ships">
        {reps} {reps === 1 ? 'rep' : 'reps'}
      </span>

      <div className="sk-skips">
        <button
          className="btn btn-sm sk-skip"
          data-testid="skip-to-drills"
          disabled={noCourse}
          title={noCourse ? tip : 'Practice beats reading.'}
          onClick={() => jump('drills')}
        >
          Skip to drills →
        </button>
        <button
          className="btn btn-sm sk-skip"
          data-testid="skip-to-make"
          disabled={noCourse}
          title={noCourse ? tip : 'Write the real thing.'}
          onClick={() => jump('make')}
        >
          Skip to Make →
        </button>
      </div>
    </header>
  );
}
