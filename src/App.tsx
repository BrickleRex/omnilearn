import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Settings } from '../shared/types';
import { api } from './api';
import { NavContext, type View } from './nav';
import Library from './library/Library';
import MilestoneFlow from './primer/MilestoneFlow';
import Workspace from './workspace/Workspace';

function viewFromHash(): View {
  const m = location.hash.match(/^#\/(milestone|workspace)\/([^/]+)\/([^/]+)$/);
  if (m) return { name: m[1] as 'milestone' | 'workspace', projectId: m[2], milestoneId: m[3] };
  return { name: 'library' };
}

function hashFromView(v: View): string {
  return v.name === 'library' ? '#/' : `#/${v.name}/${v.projectId}/${v.milestoneId}`;
}

export const SettingsContext = { current: null as Settings | null };

export default function App() {
  const [view, setView] = useState<View>(viewFromHash);
  const [settings, setSettings] = useState<Settings | null>(null);

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
    api.getSettings().then(setSettings).catch(() => {
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
  if (!settings) return null;

  return (
    <NavContext.Provider value={nav}>
      {view.name === 'library' && <Library settings={settings} onSettings={setSettings} />}
      {view.name === 'milestone' && (
        <MilestoneFlow key={`${view.projectId}/${view.milestoneId}`} projectId={view.projectId} milestoneId={view.milestoneId} />
      )}
      {view.name === 'workspace' && (
        <Workspace key={`${view.projectId}/${view.milestoneId}`} projectId={view.projectId} milestoneId={view.milestoneId} settings={settings} onSettings={setSettings} />
      )}
    </NavContext.Provider>
  );
}
