// One row on every skill screen: where you are, how many reps you have, and the
// two escape hatches (drills / make) that are never hidden.
import { useEffect, useRef } from 'react';
import type { SkillProject } from '../../../shared/skills';
import { useNav, type SkillScreen } from '../../nav';
import { BEATS, beatIndex, pickModule, repCount, targetLine } from './util';

export default function SkillHeader({
  project, screen, moduleId,
}: { project: SkillProject; screen: SkillScreen; moduleId?: string }) {
  const { go } = useNav();
  const here = beatIndex(screen, project);
  const mod = pickModule(project, moduleId);
  const reps = repCount(project);
  const noCourse = !mod;
  const aim = targetLine(project.frame?.target);
  const tip = 'Once research is done this opens up.';
  const topRef = useRef<HTMLElement | null>(null);

  // The header wraps into two or three rows as the width falls away; anything
  // that has to sit under it (the sticky evidence panel, scroll-into-view
  // margins) reads its real height from --sk-top-h.
  useEffect(() => {
    const el = topRef.current;
    if (!el) return undefined;
    const set = () => {
      const h = Math.round(el.getBoundingClientRect().height);
      if (h > 0) document.documentElement.style.setProperty('--sk-top-h', `${h}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--sk-top-h');
    };
  }, []);

  const jump = (s: SkillScreen) => {
    if (!mod) return;
    go({ name: 'skill', skillId: project.id, screen: s, moduleId: mod.id });
  };

  return (
    <header className="sk-top scanlines" ref={topRef}>
      <button
        className="btn btn-ghost btn-sm sk-back"
        data-testid="back-to-library"
        onClick={() => go({ name: 'library' })}
      >
        ← Library
      </button>

      <b className="sk-name">{project.name}</b>

      {aim && (
        <span className="sk-target" data-testid="skill-target" title={`aimed at ${aim}`} tabIndex={0}>
          → {aim}
        </span>
      )}

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
