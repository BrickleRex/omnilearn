import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Settings } from '../shared/types';
import { api } from './api';
import { NavContext, type View } from './nav';
import Library from './library/Library';
import MilestoneFlow from './primer/MilestoneFlow';
import Workspace from './workspace/Workspace';
import TokenGate from './components/TokenGate';

function viewFromHash(): View {
  const m = location.hash.match(/^#\/(milestone|workspace)\/([^/]+)\/([^/]+?)(\/review)?$/);
  if (m) {
    const name = m[1] as 'milestone' | 'workspace';
    if (name === 'milestone' && m[4]) {
      return { name, projectId: m[2], milestoneId: m[3], review: true };
    }
    return { name, projectId: m[2], milestoneId: m[3] };
  }
  return { name: 'library' };
}

function hashFromView(v: View): string {
  if (v.name === 'library') return '#/';
  const review = v.name === 'milestone' && v.review ? '/review' : '';
  return `#/${v.name}/${v.projectId}/${v.milestoneId}${review}`;
}

export const SettingsContext = { current: null as Settings | null };

export default function App() {
  const [view, setView] = useState<View>(viewFromHash);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [locked, setLocked] = useState(false);

  const go = useCallback((v: View) => {
    setView(v);
    history.pushState(null, '', hashFromView(v));
  }, []);

  useEffect(() => {
    const onPop = () => setView(viewFromHash());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    api.getSettings().then(setSettings).catch((e: Error) => {
      if (e.message === 'unauthorized') { setLocked(true); return; }
      setSettings({
        scheme: 'sunshower', guidanceStyle: 'both',
        models: { plan: 'opus', primer: 'opus', hint: 'sonnet', ghost: 'sonnet', watch: 'haiku' },
      });
    });
  }, []);

  useEffect(() => {
    if (settings) document.documentElement.dataset.scheme = settings.scheme;
    SettingsContext.current = settings;
  }, [settings]);

  const nav = useMemo(() => ({ view, go }), [view, go]);
  if (locked) return <TokenGate />;
  if (!settings) return null;

  return (
    <NavContext.Provider value={nav}>
      {view.name === 'library' && <Library settings={settings} onSettings={setSettings} />}
      {view.name === 'milestone' && (
        <MilestoneFlow
          key={`${view.projectId}/${view.milestoneId}/${view.review ? 'r' : ''}`}
          projectId={view.projectId}
          milestoneId={view.milestoneId}
          review={view.review}
        />
      )}
      {view.name === 'workspace' && (
        <Workspace key={`${view.projectId}/${view.milestoneId}`} projectId={view.projectId} milestoneId={view.milestoneId} settings={settings} onSettings={setSettings} />
      )}
    </NavContext.Provider>
  );
}
