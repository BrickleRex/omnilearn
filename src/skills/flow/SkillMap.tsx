// The OUTLINE LADDER: every angle a checkbox, every checkbox a cost.
// Pruning is unchecking; unchecking a parent takes its subtree with it.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { Angle, SkillProject } from '../../../shared/skills';
import { skillsApi } from '../api';
import { useNav } from '../../nav';
import { angleTree, estimate, subtreeIds, type AngleNode } from './util';

export default function SkillMap({
  project, onProject, onError,
}: { project: SkillProject; onProject: (p: SkillProject) => void; onError: (e: unknown) => void }) {
  const { go } = useNav();
  const [angles, setAngles] = useState<Angle[]>(project.map?.angles ?? []);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);
  const alive = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (timer.current) window.clearTimeout(timer.current); };
  }, []);

  const save = useCallback((next: Angle[]) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      skillsApi.putMap(project.id, { angles: next })
        .then((p) => { if (alive.current) onProject(p); })
        .catch((e) => { if (alive.current) onError(e); });
    }, 400);
  }, [project.id, onProject, onError]);

  const toggle = useCallback((id: string, kept: boolean) => {
    setAngles((cur) => {
      const family = subtreeIds(cur, id);
      const next = cur.map((a) => (family.has(a.id) ? { ...a, kept } : a));
      save(next);
      return next;
    });
  }, [save]);

  const roots = useMemo(() => angleTree(angles), [angles]);
  const est = useMemo(() => estimate(angles), [angles]);
  const maxSrc = useMemo(() => Math.max(1, ...angles.map((a) => a.estSources || 0)), [angles]);
  const keptCount = angles.filter((a) => a.kept).length;

  const start = useCallback(async () => {
    setBusy(true);
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    try { await skillsApi.putMap(project.id, { angles }); } catch (e) { onError(e); }
    try { await skillsApi.startResearch(project.id); } catch (e) { onError(e); }
    go({ name: 'skill', skillId: project.id, screen: 'research' });
  }, [angles, project.id, go, onError]);

  const renderNode = (node: AngleNode, depth: number): ReactElement => {
    const a = node.angle;
    return (
      <li key={a.id} className="sk-angle-li">
        <div
          className={`sk-angle d${Math.min(depth, 3)}${a.kept ? '' : ' is-off'}`}
          data-testid={`angle-${a.id}`}
          data-kept={a.kept ? 'true' : 'false'}
        >
          <input
            type="checkbox"
            className="sk-check"
            id={`angle-cb-${a.id}`}
            data-testid={`angle-toggle-${a.id}`}
            checked={a.kept}
            aria-label={a.title}
            onChange={(e) => toggle(a.id, e.target.checked)}
          />
          <label className="sk-angle-main" htmlFor={`angle-cb-${a.id}`}>
            <span className="sk-angle-title">{a.title}</span>
            <span className={`sk-level is-${a.level}`}>{a.level}</span>
            <span
              className={`sk-scope is-${a.scope === 'niche' ? 'niche' : 'general'}`}
              data-testid={`angle-scope-${a.id}`}
              title={a.scope === 'niche' ? 'about your exact target' : 'a rule of the craft, applied to your target'}
            >
              {a.scope === 'niche' ? 'niche' : 'general'}
            </span>
            {a.why && <span className="sk-angle-why">{a.why}</span>}
          </label>
          <span className="sk-angle-cost" title={`about ${a.estSources} sources`}>
            <i><em style={{ width: `${Math.round(((a.estSources || 0) / maxSrc) * 100)}%` }} /></i>
            <b>{a.estSources}</b>
          </span>
        </div>
        {node.children.length > 0 && (
          <ul className="sk-angle-kids">{node.children.map((c) => renderNode(c, depth + 1))}</ul>
        )}
      </li>
    );
  };

  return (
    <section className="sk-screen" data-testid="skill-map">
      <div className="sk-head">
        <div>
          <span className="eyebrow">step 1 · the map</span>
          <h1>Every angle of this skill.</h1>
          <p className="sk-lede">
            Untick anything you don't care about — the ticked ones are what we go and read.
            Unticking a parent takes its sub-angles with it.
          </p>
          <p className="sk-quiet sk-scope-legend">
            <span className="sk-scope is-niche">niche</span> angles are about your exact target.
            <span className="sk-scope is-general">general</span> ones are the rules of the craft, applied to it.
          </p>
        </div>
        <div className="sk-est card" data-testid="map-est">
          <b>{est.text}</b>
          <span>{keptCount} of {angles.length} angles kept</span>
        </div>
      </div>

      <ul className="sk-ladder card">{roots.map((n) => renderNode(n, 0))}</ul>

      <div className="sk-actions">
        <button className="btn btn-primary btn-lg" data-testid="start-research" disabled={busy || keptCount === 0} onClick={start}>
          {busy ? 'Sending the scouts…' : 'Start research →'}
        </button>
        <span className="sk-quiet">{est.text} of reading, done for you.</span>
      </div>
    </section>
  );
}
