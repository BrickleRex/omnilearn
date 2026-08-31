// ---------------------------------------------------------------------------
// Workspace — the build screen. Owns the file, the guidance state and the run
// loop; the pieces (tree / compass / editor / rail / footlight) are dumb-ish
// and talk back through callbacks.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  FileNode, MilestoneStatus, Project, RunResult, Scheme, Settings, Step, WatchResponse,
} from '../../shared/types';
import { api } from '../api';
import { useNav } from '../nav';
import Compass from './Compass';
import Editor, { type EditorHandle, type SaveState } from './Editor';
import FileTree from './FileTree';
import Footlight, { type LampState } from './Footlight';
import Rail, { type RailState, type RailTab } from './Rail';
import { createWatcher, type Watcher } from './watcher';
import './workspace.css';

const TREE_KEY = 'omnilearn.workspace.treeCollapsed';
const SCHEMES: Scheme[] = ['sunshower', 'blackboard', 'arcade', 'mint'];
const HINT_COMPOSITE_WINDOW = 10_000;
const DETAIL_HIDE_MS = 12_000;
const RAIL_COLLAPSE_MS = 4_000;

interface OpenDoc { path: string; text: string; seq: number }
interface PendingNudge { line: number; note: string }

export default function Workspace(props: {
  projectId: string; milestoneId: string;
  settings: Settings; onSettings: (s: Settings) => void;
}) {
  const { projectId, milestoneId, settings, onSettings } = props;
  const nav = useNav();

  // --- state ---------------------------------------------------------------
  const [project, setProject] = useState<Project | null>(null);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [doc, setDoc] = useState<OpenDoc | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [explore, setExplore] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(() => {
    try { return localStorage.getItem(TREE_KEY) === '1'; } catch { return false; }
  });
  const [railOpen, setRailOpen] = useState(false);
  const [railPinned, setRailPinned] = useState(false);
  const [railTab, setRailTab] = useState<RailTab>('run');
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [lamp, setLamp] = useState<LampState>('idle');
  const [thinking, setThinking] = useState(false);
  const [footMsg, setFootMsg] = useState({ text: '', seq: 0 });
  const [compassDetail, setCompassDetail] = useState<string | null>(null);
  const [pendingNudge, setPendingNudge] = useState<PendingNudge | null>(null);
  const [nudgeOpened, setNudgeOpened] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const milestone = useMemo(
    () => project?.milestones.find((m) => m.id === milestoneId) ?? null,
    [project, milestoneId],
  );
  const compassOn = settings.guidanceStyle === 'compass' || settings.guidanceStyle === 'both';
  const footOn = settings.guidanceStyle === 'footlight' || settings.guidanceStyle === 'both';
  const railState: RailState = railOpen ? (railPinned ? 'pinned' : 'open') : 'strip';
  const activePath = doc?.path ?? null;

  // --- refs (for listeners / the watcher, which must never see stale state) --
  const editorRef = useRef<EditorHandle | null>(null);
  const watcherRef = useRef<Watcher | null>(null);
  const projectRef = useRef<Project | null>(null); projectRef.current = project;
  const activePathRef = useRef<string | null>(null); activePathRef.current = activePath;
  const lastRunRef = useRef<RunResult | null>(null); lastRunRef.current = lastRun;
  const exploreRef = useRef(explore); exploreRef.current = explore;
  const pinnedRef = useRef(railPinned); pinnedRef.current = railPinned;
  const pendingNudgeRef = useRef<PendingNudge | null>(null); pendingNudgeRef.current = pendingNudge;
  const stepsRef = useRef<Step[]>(steps); stepsRef.current = steps;
  const compassOnRef = useRef(compassOn); compassOnRef.current = compassOn;
  const footOnRef = useRef(footOn); footOnRef.current = footOn;

  const busyRef = useRef(false);            // an LLM call (hint/ghost) is in flight
  const runningRef = useRef(false);
  const cursorLineRef = useRef(1);
  const lastHintAt = useRef(0);
  const msgSeq = useRef(0);
  const detailTimer = useRef<number | null>(null);
  const collapseTimer = useRef<number | null>(null);
  const primerAsked = useRef(false);

  // --- small helpers -------------------------------------------------------
  const say = useCallback((text: string) => {
    msgSeq.current += 1;
    setFootMsg({ text, seq: msgSeq.current });
  }, []);

  const armDetailTimer = useCallback(() => {
    if (detailTimer.current !== null) clearTimeout(detailTimer.current);
    detailTimer.current = window.setTimeout(() => {
      detailTimer.current = null;
      setCompassDetail(null);
    }, DETAIL_HIDE_MS);
  }, []);

  const hideDetail = useCallback(() => {
    if (detailTimer.current !== null) { clearTimeout(detailTimer.current); detailTimer.current = null; }
    setCompassDetail(null);
  }, []);

  const cancelCollapse = useCallback(() => {
    if (collapseTimer.current !== null) { clearTimeout(collapseTimer.current); collapseTimer.current = null; }
  }, []);

  const scheduleCollapse = useCallback(() => {
    cancelCollapse();
    collapseTimer.current = window.setTimeout(() => {
      collapseTimer.current = null;
      if (!pinnedRef.current) setRailOpen(false);
    }, RAIL_COLLAPSE_MS);
  }, [cancelCollapse]);

  useEffect(() => () => { cancelCollapse(); if (detailTimer.current) clearTimeout(detailTimer.current); }, [cancelCollapse]);

  // --- boot ----------------------------------------------------------------
  const openFile = useCallback(async (path: string) => {
    try { await editorRef.current?.flush(); } catch { /* keep going */ }
    try {
      const { content } = await api.readFile(projectId, path);
      setDoc((d) => ({ path, text: content, seq: (d?.seq ?? 0) + 1 }));
    } catch {
      setDoc((d) => ({ path, text: '', seq: (d?.seq ?? 0) + 1 }));
    }
    setSaveState('saved');
  }, [projectId]);

  const refreshTree = useCallback(() => {
    api.listFiles(projectId).then(setTree).catch(() => { /* tree is optional */ });
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    api.getProject(projectId)
      .then((p) => {
        if (!alive) return;
        setProject(p);
        const ms = p.milestones.find((m) => m.id === milestoneId) ?? p.milestones[0];
        if (!ms) { setError('milestone not found'); return; }
        setSteps(ms.steps ?? []);
        setCurrentStep(Math.max(0, Math.min((ms.steps?.length ?? 1) - 1, ms.currentStep ?? 0)));
        if (ms.entryFile) void openFile(ms.entryFile);
        if ((!ms.steps || ms.steps.length === 0) && !primerAsked.current) {
          primerAsked.current = true;
          // cached server-side; populates the compass without blocking the editor
          api.primer(projectId, ms.id)
            .then((d) => {
              if (!alive || !d.steps?.length) return;
              setSteps(d.steps);
              // The server persists these onto the milestone; mirror them locally
              // so a later patchProject doesn't send them back as an empty array.
              setProject((cur) => (cur
                ? { ...cur, milestones: cur.milestones.map((m) => (m.id === ms.id ? { ...m, steps: d.steps } : m)) }
                : cur));
            })
            .catch(() => { /* the compass just stays empty */ });
        }
      })
      .catch((e: Error) => { if (alive) setError(e.message || 'could not open the project'); });
    refreshTree();
    return () => { alive = false; };
  }, [projectId, milestoneId, openFile, refreshTree]);

  // --- persist compass position -------------------------------------------
  const applyStep = useCallback((index: number, persist = true) => {
    const p = projectRef.current;
    const n = stepsRef.current.length;
    const i = Math.max(0, n ? Math.min(n - 1, index) : 0);
    setCurrentStep(i);
    if (!p || !persist) return;
    const milestones = p.milestones.map((m) => (m.id === milestoneId ? { ...m, currentStep: i } : m));
    setProject({ ...p, milestones });
    api.patchProject(projectId, { milestones }).catch(() => { /* local state still moved */ });
  }, [projectId, milestoneId]);

  // --- hint ----------------------------------------------------------------
  const requestHint = useCallback(async () => {
    const path = activePathRef.current;
    if (!path || busyRef.current) return;
    const now = Date.now();
    const level: 'step' | 'composite' = now - lastHintAt.current < HINT_COMPOSITE_WINDOW ? 'composite' : 'step';
    lastHintAt.current = now;

    busyRef.current = true;
    setThinking(true);
    setLamp('thinking');
    try {
      const res = await api.hint(projectId, {
        milestoneId,
        path,
        content: editorRef.current?.getContent() ?? '',
        cursorLine: editorRef.current?.getCursorLine() ?? 1,
        level,
      });
      applyStep(res.stepIndex);
      if (compassOnRef.current) { setCompassDetail(res.hint); armDetailTimer(); }
      if (footOnRef.current) say(res.hint);
      setLamp('hint');
    } catch {
      setLamp('idle');
      if (footOnRef.current) say('no hint right now — try again in a moment');
      else { setCompassDetail('no hint right now — try again in a moment'); armDetailTimer(); }
    } finally {
      busyRef.current = false;
      setThinking(false);
    }
  }, [projectId, milestoneId, applyStep, armDetailTimer, say]);

  // --- ghost ---------------------------------------------------------------
  const requestGhost = useCallback(async () => {
    const path = activePathRef.current;
    if (!path || busyRef.current) return;
    busyRef.current = true;
    setThinking(true);
    setLamp('thinking');
    try {
      const res = await api.ghost(projectId, {
        milestoneId,
        path,
        content: editorRef.current?.getContent() ?? '',
        cursorLine: editorRef.current?.getCursorLine() ?? 1,
      });
      editorRef.current?.showGhost(res.code);
      setLamp('idle');
    } catch {
      setLamp('idle');
      if (footOnRef.current) say('no practice line right now');
    } finally {
      busyRef.current = false;
      setThinking(false);
    }
  }, [projectId, milestoneId, say]);

  // --- run -----------------------------------------------------------------
  const doRun = useCallback(async () => {
    const path = activePathRef.current;
    if (!path || runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setRailTab('run');
    setRailOpen(true);
    cancelCollapse();
    try { await editorRef.current?.flush(); } catch { /* run what's on disk */ }
    try {
      const res = await api.run(projectId, path);
      setLastRun(res);
      watcherRef.current?.noteRun();
      setRailTab('run');
      setRailOpen(true);
      if (res.exitCode === 0 && !pinnedRef.current) scheduleCollapse();
    } catch (e) {
      setLastRun({
        path, exitCode: -1, stdout: '', stderr: (e as Error).message || 'run failed',
        durationMs: 0, startedAt: new Date().toISOString(),
      });
      setRailOpen(true);
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [projectId, cancelCollapse, scheduleCollapse]);

  // --- watcher -------------------------------------------------------------
  const onNudge = useCallback((res: WatchResponse) => {
    const line = res.line ?? cursorLineRef.current;
    const note = res.note ?? '';
    const prev = pendingNudgeRef.current;
    // Repeating the same nudge re-hangs the marker but must not re-open the
    // "something's off" affordance the learner has already read.
    if (!prev || prev.line !== line || prev.note !== note) {
      setPendingNudge({ line, note });
      setNudgeOpened(false);
    }
    setLamp('nudge');
    editorRef.current?.setNudge(line);
  }, []);

  useEffect(() => {
    const w = createWatcher({
      projectId,
      milestoneId,
      getPath: () => activePathRef.current,
      getContent: () => editorRef.current?.getContent() ?? '',
      getLastRun: () => lastRunRef.current,
      isExplore: () => exploreRef.current,
      isBusy: () => busyRef.current,
      onNudge,
    });
    watcherRef.current = w;
    w.start();
    return () => { w.stop(); watcherRef.current = null; };
  }, [projectId, milestoneId, onNudge]);

  const openNudge = useCallback(() => {
    const n = pendingNudgeRef.current;
    if (!n || !n.note) return;
    setNudgeOpened(true);
    setLamp('nudge');
    if (footOnRef.current) say(n.note);
    else { setCompassDetail(n.note); armDetailTimer(); }
  }, [say, armDetailTimer]);

  const toggleExplore = useCallback(() => {
    setExplore((prev) => {
      const next = !prev;
      if (next) {
        setPendingNudge(null);
        setNudgeOpened(false);
        editorRef.current?.setNudge(null);
        setLamp('idle');
      }
      return next;
    });
  }, []);

  // --- rail ----------------------------------------------------------------
  const toggleRail = useCallback(() => {
    cancelCollapse();
    setRailOpen((o) => !o);
  }, [cancelCollapse]);

  const togglePin = useCallback(() => {
    cancelCollapse();
    setRailPinned((p) => !p);
  }, [cancelCollapse]);

  // --- scheme --------------------------------------------------------------
  // `pendingScheme` keeps rapid clicks from all computing off the same stale
  // settings prop while the PUT is still in flight.
  const pendingScheme = useRef<Scheme | null>(null);
  if (pendingScheme.current === settings.scheme) pendingScheme.current = null;

  const cycleScheme = useCallback(() => {
    const from = pendingScheme.current ?? settings.scheme;
    const next = SCHEMES[(SCHEMES.indexOf(from) + 1) % SCHEMES.length];
    pendingScheme.current = next;
    api.putSettings({ scheme: next })
      .then(onSettings)
      .catch(() => onSettings({ ...settings, scheme: next }));
  }, [settings, onSettings]);

  // --- milestone done ------------------------------------------------------
  const showDone = !!lastRun && lastRun.exitCode === 0 && steps.length > 0 && currentStep >= steps.length - 1;

  const markDone = useCallback(async () => {
    const p = projectRef.current;
    if (!p) return;
    const idx = p.milestones.findIndex((m) => m.id === milestoneId);
    const milestones = p.milestones.map((m, i) => {
      if (i === idx) return { ...m, status: 'done' as MilestoneStatus };
      if (i === idx + 1 && m.status !== 'done') return { ...m, status: 'current' as MilestoneStatus };
      return m;
    });
    setCelebrating(true);
    setLamp('hint');
    try { await api.patchProject(projectId, { milestones }); } catch { /* still celebrate */ }
    window.setTimeout(() => nav.go({ name: 'library' }), 1200);
  }, [projectId, milestoneId, nav]);

  // --- file tree -----------------------------------------------------------
  const toggleTree = useCallback(() => {
    setTreeCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(TREE_KEY, next ? '1' : '0'); } catch { /* private mode */ }
      return next;
    });
  }, []);

  const newFile = useCallback(async (path: string) => {
    try {
      await api.writeFile(projectId, path, '');
      refreshTree();
      await openFile(path);
    } catch {
      say(`could not create ${path}`);
    }
  }, [projectId, refreshTree, openFile, say]);

  // --- editor callbacks ----------------------------------------------------
  const onEdit = useCallback(() => {
    watcherRef.current?.noteEdit();
    hideDetail();
  }, [hideDetail]);

  const onCursorLine = useCallback((line: number) => {
    cursorLineRef.current = line;
    watcherRef.current?.noteCursor(line);
  }, []);

  // --- global keys ---------------------------------------------------------
  const cmds = useRef({ doRun, requestHint, requestGhost, toggleExplore, openNudge, toggleRail });
  cmds.current = { doRun, requestHint, requestGhost, toggleExplore, openNudge, toggleRail };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inXterm = !!t?.closest?.('.xterm');
      const inEditor = !!t?.closest?.('.cm-editor');
      const inInput = !!t?.closest?.('input, textarea');
      const mod = e.metaKey || e.ctrlKey;

      // rail toggle wins everywhere, including inside the shell
      if (e.ctrlKey && !e.altKey && (e.key === '`' || e.code === 'Backquote')) {
        e.preventDefault(); cmds.current.toggleRail(); return;
      }
      if (inXterm) return;

      if (e.altKey && !mod && (e.code === 'KeyE' || e.key.toLowerCase() === 'e')) {
        e.preventDefault(); cmds.current.toggleExplore(); return;
      }
      if (e.altKey && !mod && (e.code === 'KeyH' || e.key.toLowerCase() === 'h')) {
        e.preventDefault(); cmds.current.openNudge(); return;
      }
      if (mod && e.key === 'Enter') { e.preventDefault(); void cmds.current.doRun(); return; }
      if (mod && !e.shiftKey && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) {
        e.preventDefault();
        void editorRef.current?.flush();
        return;
      }
      if (inEditor || inInput) return; // CodeMirror handles these two itself
      if (e.ctrlKey && !e.altKey && e.code === 'Space') {
        e.preventDefault();
        if (e.shiftKey) void cmds.current.requestGhost();
        else void cmds.current.requestHint();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // -------------------------------------------------------------------------
  return (
    <div
      className={`workspace${footOn ? ' has-footlight' : ''}`}
      data-testid="workspace"
      data-explore={explore ? 'true' : 'false'}
    >
      <header className="wsTop">
        <button
          className="wsBack"
          data-testid="back-btn"
          title="back to the library"
          onClick={() => nav.go({ name: 'library' })}
        >
          ‹
        </button>

        <div className="wsTitle">
          <span className="wsProject">{project?.name ?? 'loading…'}</span>
          {milestone && <span className="wsSlash">/</span>}
          {milestone && <span className="wsMilestone">{milestone.title}</span>}
        </div>

        <div className="wsFileTag" title={activePath ?? ''}>
          <span className="wsFileName">{activePath ?? (error ?? 'no file')}</span>
          <span className="wsSaveDot" data-save={saveState} title={saveState === 'saved' ? 'saved' : 'saving…'} />
        </div>

        <span className="wsGrow" />

        <button
          className="exploreSwitch"
          data-testid="explore-toggle"
          data-on={explore ? 'true' : 'false'}
          aria-pressed={explore}
          title="explore mode — the watcher goes quiet (Alt+E)"
          onClick={toggleExplore}
        >
          <span className="exploreTrack"><span className="exploreKnob" /></span>
          <span className="exploreLabel">explore</span>
        </button>

        <button
          className="wsRun"
          data-testid="run-btn"
          disabled={!activePath || running}
          title="run this file (Cmd/Ctrl+Enter)"
          onClick={() => void doRun()}
        >
          {running ? '…' : '▶'} run
        </button>

        <button
          className="wsScheme"
          data-testid="scheme-btn"
          title="next colour scheme"
          onClick={cycleScheme}
        >
          <span className="schemeSwatch" />
          {settings.scheme}
        </button>
      </header>

      <div className="wsBody">
        <FileTree
          tree={tree}
          activePath={activePath}
          collapsed={treeCollapsed}
          onToggleCollapsed={toggleTree}
          onOpen={(p) => void openFile(p)}
          onNewFile={(p) => void newFile(p)}
        />

        <main className="wsMain">
          {compassOn && (
            <Compass
              steps={steps}
              currentStep={currentStep}
              thinking={thinking}
              detail={compassDetail}
              onPickStep={(i) => applyStep(i)}
              onDismissDetail={hideDetail}
            />
          )}

          <div className="wsEditorWrap">
            {doc ? (
              <Editor
                key={`${doc.path}#${doc.seq}`}
                ref={editorRef}
                projectId={projectId}
                path={doc.path}
                initialDoc={doc.text}
                scheme={settings.scheme}
                onSaveState={setSaveState}
                onEdit={onEdit}
                onCursorLine={onCursorLine}
                onHint={() => void requestHint()}
                onGhost={() => void requestGhost()}
                onOpenNudge={openNudge}
              />
            ) : (
              <div className="wsEditorEmpty">{error ?? 'opening your file…'}</div>
            )}
          </div>

          <Rail
            projectId={projectId}
            state={railState}
            tab={railTab}
            lastRun={lastRun}
            running={running}
            onOpen={() => { cancelCollapse(); setRailOpen(true); }}
            onClose={() => { cancelCollapse(); setRailOpen(false); }}
            onTogglePin={togglePin}
            onTab={setRailTab}
            onHover={cancelCollapse}
          />
        </main>
      </div>

      {footOn && (
        <Footlight
          lamp={lamp}
          message={footMsg}
          explore={explore}
          saveState={saveState}
          pendingNudge={!!pendingNudge && !nudgeOpened}
          celebrating={celebrating}
          showDone={showDone}
          onDone={() => void markDone()}
          onOpenNudge={openNudge}
        />
      )}
    </div>
  );
}
