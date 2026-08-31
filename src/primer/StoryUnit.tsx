import { useEffect, useMemo, useRef, useState } from 'react';
import type { PrimerUnit } from '../../shared/types';
import { sanitizeSvg } from '../components/Markdown';

type Story = Extract<PrimerUnit, { kind: 'story' }>;

/**
 * Scrollytelling inside the card frame.
 *
 * The beats live in a scroll container; a sticky figure pane rides alongside.
 * An IntersectionObserver with a thin centre band (rootMargin -45%/-45%) fires
 * as each beat crosses the middle of the container: the beat lights up and the
 * figure pane crossfades to that beat's figure (or the most recent one, so a
 * text-only beat never blanks the picture). Short stories that never scroll
 * still resolve to beat 0 on mount, so they simply read as a stacked card.
 */
export default function StoryUnit({ unit, index }: { unit: Story; index: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const beatRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [active, setActive] = useState(0);

  const beats = unit.beats ?? [];

  const figures = useMemo(
    () => beats.map((b) => (b.figureSvg ? sanitizeSvg(b.figureSvg) : '')),
    [beats],
  );

  // which figure is on screen: this beat's, else the last one that had a figure
  const figureIndex = useMemo(() => {
    for (let n = active; n >= 0; n--) if (figures[n]) return n;
    return figures.findIndex((f) => f);
  }, [active, figures]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const nodes = beatRefs.current.filter(Boolean) as HTMLLIElement[];
    if (nodes.length === 0) return;

    const visible = new Set<number>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const n = Number((e.target as HTMLElement).dataset.beat);
        if (Number.isNaN(n)) continue;
        if (e.isIntersecting) visible.add(n); else visible.delete(n);
      }
      if (visible.size > 0) setActive(Math.min(...visible));
    }, { root, rootMargin: '-45% 0px -45% 0px', threshold: 0 });

    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [beats.length, index]);

  const hasFigures = figures.some((f) => f);

  return (
    <div className={`unit unit-story${hasFigures ? '' : ' no-figures'}`} data-testid="primer-story">
      <span className="eyebrow">story {index + 1}</span>
      <h1>{unit.title}</h1>

      <div className="story-scroll" ref={scrollRef} tabIndex={0} aria-label={`${unit.title} — scroll the beats`}>
        <div className="story-inner">
          {hasFigures && (
            <div className="story-figcol">
              <div className="story-sticky" data-testid="story-figure">
                {figures.map((f, n) => (
                  f ? (
                    <div
                      key={n}
                      className={`story-fig${n === figureIndex ? ' is-on' : ''}`}
                      aria-hidden={n === figureIndex ? undefined : true}
                      dangerouslySetInnerHTML={{ __html: f }}
                    />
                  ) : null
                ))}
              </div>
            </div>
          )}

          <ol className="story-beats">
            {beats.map((b, n) => (
              <li
                key={n}
                ref={(el) => { beatRefs.current[n] = el; }}
                data-beat={n}
                data-testid={`story-beat-${n}`}
                data-active={n === active ? 'true' : 'false'}
                className={`story-beat${n === active ? ' is-active' : ''}`}
                onClick={() => {
                  setActive(n);
                  beatRefs.current[n]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                }}
              >
                <span className="story-rail" aria-hidden="true" />
                <p>{b.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="story-progress" aria-hidden="true">
        {beats.map((_, n) => <i key={n} className={n <= active ? 'on' : ''} />)}
      </div>
    </div>
  );
}
