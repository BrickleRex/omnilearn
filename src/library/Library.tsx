import { useCallback, useEffect, useState } from 'react';
import type { Project, ProjectSummary, Settings } from '../../shared/types';
import { api } from '../api';
import { useNav } from '../nav';
import { ToastStack, useToasts } from '../components/Toast';
import Segbar from '../components/Segbar';
import SettingsModal from './SettingsModal';
import NewProjectModal from './NewProjectModal';
import Wordmark from './Wordmark';
import SkillsLane from '../skills/flow/SkillsLane';
import FrameModal from '../skills/flow/FrameModal';
import './library.css';

type Track = 'code' | 'skills';
const TRACK_KEY = 'omnilearn.track';

function readTrack(): Track {
  try { return localStorage.getItem(TRACK_KEY) === 'skills' ? 'skills' : 'code'; } catch { return 'code'; }
}

function entryMilestoneId(p: Project): string | undefined {
  const current = p.milestones.find((m) => m.status === 'current');
  return (current ?? p.milestones[0])?.id;
}

export default function Library({
  settings, onSettings,
}: { settings: Settings; onSettings: (s: Settings) => void }) {
  const { go } = useNav();
  const { toasts, push, pushError, dismiss } = useToasts();

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [track, setTrack] = useState<Track>(readTrack);
  const [showFrame, setShowFrame] = useState(false);

  const pickTrack = useCallback((t: Track) => {
    setTrack(t);
    try { localStorage.setItem(TRACK_KEY, t); } catch { /* private mode: this session only */ }
  }, []);

  const load = useCallback(() => {
    api.listProjects()
      .then(setProjects)
      .catch((e) => { setProjects([]); pushError(e, 'Could not load your projects:'); });
  }, [pushError]);

  useEffect(load, [load]);

  const open = useCallback(async (id: string) => {
    setOpening(id);
    try {
      const project = await api.getProject(id);
      const milestoneId = entryMilestoneId(project);
      if (!milestoneId) { push('info', 'This project has no milestones yet.'); return; }
      go({ name: 'milestone', projectId: id, milestoneId });
    } catch (e) {
      pushError(e, 'Could not open that project:');
    } finally {
      setOpening(null);
    }
  }, [go, push, pushError]);

  const remove = useCallback(async (id: string) => {
    setConfirmDelete(null);
    const before = projects;
    setProjects((ps) => (ps ?? []).filter((p) => p.id !== id));
    try {
      await api.deleteProject(id);
      push('good', 'Project deleted. Its folder is gone from data/projects.');
    } catch (e) {
      setProjects(before ?? null);
      pushError(e, 'Delete failed:');
    }
  }, [projects, push, pushError]);

  return (
    <div className="lib">
      <header className="lib-top scanlines">
        <div className="lib-top-left">
          <Wordmark />
          <div className="lib-track" role="group" aria-label="Track">
            <button
              type="button"
              className={`lib-track-btn${track === 'code' ? ' is-on' : ''}`}
              data-testid="track-code"
              aria-pressed={track === 'code'}
              onClick={() => pickTrack('code')}
            >
              Code
            </button>
            <button
              type="button"
              className={`lib-track-btn${track === 'skills' ? ' is-on' : ''}`}
              data-testid="track-skills"
              aria-pressed={track === 'skills'}
              onClick={() => pickTrack('skills')}
            >
              Skills
            </button>
          </div>
        </div>
        <div className="lib-top-right">
          {track === 'code' ? (
            <button
              className="btn btn-primary"
              data-testid="new-project"
              onClick={() => setShowNew(true)}
            >
              <span aria-hidden="true">＋</span> New project
            </button>
          ) : (
            <button
              className="btn btn-primary"
              data-testid="new-skill"
              onClick={() => setShowFrame(true)}
            >
              <span aria-hidden="true">＋</span> New skill
            </button>
          )}
          <button
            className="btn btn-icon"
            data-testid="settings"
            aria-label="Settings"
            title="Settings"
            onClick={() => setShowSettings(true)}
          >
            <span aria-hidden="true">⚙</span>
          </button>
        </div>
      </header>

      <main className="lib-main" data-testid="library">
        {track === 'skills' && <SkillsLane onNew={() => setShowFrame(true)} />}

        {track === 'code' && projects === null && (
          <div className="lib-skeletons" aria-hidden="true">
            {[0, 1, 2].map((i) => <div key={i} className="card lib-skel" style={{ animationDelay: `${i * 70}ms` }} />)}
          </div>
        )}

        {track === 'code' && projects !== null && projects.length === 0 && (
          <section className="lib-empty anim-pop">
            <div className="lib-empty-art" aria-hidden="true">
              <span className="blob b1" />
              <span className="blob b2" />
              <span className="blob b3" />
            </div>
            <h1>Nothing here yet. Good.</h1>
            <p>
              Pick something you actually want to build — multi-head self-attention, a tokenizer,
              a tiny interpreter. Omnilearn teaches you just enough, then gets out of the way while
              <b> you write every line</b>.
            </p>
            <button className="btn btn-primary btn-lg" onClick={() => setShowNew(true)}>
              Start your first project
            </button>
          </section>
        )}

        {track === 'code' && projects !== null && projects.length > 0 && (
          <>
            <div className="lib-heading">
              <h1>Your projects</h1>
              <span className="chip chip-quiet">{projects.length}</span>
            </div>
            <ul className="lib-grid">
              {projects.map((p, i) => (
                <li
                  key={p.id}
                  className="card card-lift lib-card anim-rise"
                  style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
                  data-testid={`project-card-${p.id}`}
                >
                  <div className="lib-card-top">
                    <h2 className="lib-card-name">{p.name}</h2>
                    {confirmDelete === p.id ? (
                      <span className="lib-confirm" role="group" aria-label="Confirm delete">
                        <span>Delete?</span>
                        <button
                          className="btn btn-sm btn-danger"
                          data-testid={`project-delete-yes-${p.id}`}
                          onClick={() => remove(p.id)}
                        >
                          Yes
                        </button>
                        <button className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(null)}>
                          No
                        </button>
                      </span>
                    ) : (
                      <button
                        className="btn btn-ghost btn-icon lib-x"
                        aria-label={`Delete ${p.name}`}
                        title="Delete project"
                        data-testid={`project-delete-${p.id}`}
                        onClick={() => setConfirmDelete(p.id)}
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <p className="lib-card-goal" title={p.goal}>{p.goal}</p>

                  <div className="lib-card-meta">
                    <span className="chip chip-accent2 chip-tilt">{p.language}</span>
                    <span className="lib-progress">
                      <Segbar
                        done={p.milestonesDone}
                        total={p.milestonesTotal}
                        current={p.milestonesDone}
                        label={`${p.milestonesDone} of ${p.milestonesTotal} milestones done`}
                      />
                      <b>{p.milestonesDone}/{p.milestonesTotal}</b>
                    </span>
                  </div>

                  <button
                    className="btn btn-primary lib-open"
                    data-testid={`project-open-${p.id}`}
                    disabled={opening === p.id}
                    onClick={() => open(p.id)}
                  >
                    {opening === p.id ? 'Opening…' : 'Open →'}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>

      {showSettings && (
        <SettingsModal
          settings={settings}
          onSettings={onSettings}
          onError={(e) => pushError(e, 'Could not save settings:')}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showFrame && (
        <FrameModal
          onClose={() => setShowFrame(false)}
          onError={(e) => pushError(e, 'Could not start that skill:')}
          onCreated={(p) => {
            setShowFrame(false);
            go({ name: 'skill', skillId: p.id, screen: 'map' });
          }}
        />
      )}

      {showNew && (
        <NewProjectModal
          onClose={() => setShowNew(false)}
          onError={(e, prefix) => pushError(e, prefix)}
          onCreated={(project) => {
            setShowNew(false);
            const milestoneId = entryMilestoneId(project);
            if (milestoneId) go({ name: 'milestone', projectId: project.id, milestoneId });
            else { load(); push('info', 'Project created, but it has no milestones.'); }
          }}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
