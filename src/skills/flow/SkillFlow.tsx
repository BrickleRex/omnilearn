// The skills flow: one shell, five screens. Map → Research → Calibrate → Learn →
// Drills. Make lives in its own module; every screen can jump straight to it.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Settings } from '../../../shared/types';
import type { Claim, SkillProject, SourceRef } from '../../../shared/skills';
import { useNav, type SkillScreen } from '../../nav';
import Loader from '../../components/Loader';
import { ToastStack, useToasts } from '../../components/Toast';
import { skillsApi } from '../api';
import SkillHeader from './SkillHeader';
import SkillMap from './SkillMap';
import SkillResearch from './SkillResearch';
import SkillCalibrate from './SkillCalibrate';
import SkillLearn from './SkillLearn';
import SkillDrills from './SkillDrills';
import { pickModule } from './util';
import '../../primer/primer.css';
import '../skills.css';

const LOADING = ['opening your skill…'];

export default function SkillFlow({
  skillId, screen, moduleId,
}: { skillId: string; screen: Exclude<SkillScreen, 'make'>; moduleId?: string; settings: Settings }) {
  const { go } = useNav();
  const { toasts, pushError, dismiss } = useToasts();
  const [project, setProject] = useState<SkillProject | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [sources, setSources] = useState<SourceRef[]>([]);
  const alive = useRef(false);

  const onError = useCallback((e: unknown) => { pushError(e); }, [pushError]);

  useEffect(() => {
    alive.current = true;
    let live = true;
    skillsApi.get(skillId)
      .then((p) => { if (live) { setProject(p); setFailed(null); } })
      .catch((e: Error) => { if (live) setFailed(e.message); });
    return () => { live = false; alive.current = false; };
  }, [skillId]);

  // the corpus, for claim chips and the evidence panel
  useEffect(() => {
    alive.current = true;
    if (screen !== 'learn' && screen !== 'drills') return undefined;
    let live = true;
    skillsApi.claims(skillId).then((c) => { if (live) setClaims(c); }).catch(() => { /* chips fall back to ids */ });
    skillsApi.sources(skillId).then((s) => { if (live) setSources(s); }).catch(() => { /* cards show no sources */ });
    return () => { live = false; };
  }, [skillId, screen]);

  const onProject = useCallback((p: SkillProject) => { if (alive.current) setProject(p); }, []);

  if (failed && !project) {
    return (
      <div className="sk">
        <div className="sk-screen">
          <div className="card sk-panel anim-pop">
            <h1>That skill won't open.</h1>
            <p className="sk-lede">{failed}</p>
            <button className="btn btn-primary" onClick={() => go({ name: 'library' })}>← Back to the library</button>
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return <div className="sk"><div className="sk-screen"><Loader lines={LOADING} testId="skill-loading" /></div></div>;
  }

  const mod = pickModule(project, moduleId);
  const needsCourse = screen === 'calibrate' || screen === 'learn' || screen === 'drills';

  return (
    <div className="sk">
      <SkillHeader project={project} screen={screen} moduleId={mod?.id ?? moduleId} />

      {needsCourse && !mod ? (
        <div className="sk-screen">
          <div className="card sk-panel anim-pop">
            <h1>There's no course yet.</h1>
            <p className="sk-lede">Research has to finish first — it writes the modules, drills and evidence.</p>
            <button className="btn btn-primary" onClick={() => go({ name: 'skill', skillId, screen: 'research' })}>
              Go to research →
            </button>
          </div>
        </div>
      ) : (
        <>
          {screen === 'map' && <SkillMap project={project} onProject={onProject} onError={onError} />}
          {screen === 'research' && <SkillResearch project={project} onError={onError} />}
          {screen === 'calibrate' && <SkillCalibrate project={project} onProject={onProject} onError={onError} />}
          {screen === 'learn' && mod && (
            <SkillLearn project={project} module={mod} claims={claims} sources={sources} onProject={onProject} onError={onError} />
          )}
          {screen === 'drills' && mod && (
            <SkillDrills project={project} module={mod} claims={claims} sources={sources} onProject={onProject} onError={onError} />
          )}
        </>
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
