// ---------------------------------------------------------------------------
// MAKE — where the skill stops being reading and becomes a real artifact. The
// learner types every word; the model may only point (ghost line, hint, nudge)
// and react (the panel in the rail). A server version is one ITERATION, so the
// draft is saved locally on every keystroke but only versioned on Run,
// Snapshot or Cmd+S — that is what makes the ladder's deltas mean anything.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Scheme, Settings } from '../../../shared/types';
import type { Claim, Draft, RubricItem, RunReport, Shipment, SkillProject, SourceRef } from '../../../shared/skills';
import { api } from '../../api';
import { useNav, type SkillScreen } from '../../nav';
import { ToastStack, useToasts } from '../../components/Toast';
import { skillsApi } from '../api';
import MakeEditor, { type MakeEditorHandle } from './MakeEditor';
import MakeHeader from './MakeHeader';
import MakeRail, { type MakeRailState, type MakeRailTab } from './MakeRail';
import ShipModal from './ShipModal';
import VersionLadder, { type LadderItem } from './VersionLadder';
import '../../workspace/workspace.css';
import './make.css';

const SCHEMES: Scheme[] = ['sunshower', 'blackboard', 'arcade', 'mint'];
const HINT_COMPOSITE_WINDOW = 10_000;

const bodyKey = (skillId: string, draftId: string) => `omnilearn.skill.${skillId}.${draftId}`;
const titleKey = (skillId: string, draftId: string) => `omnilearn.skill.${skillId}.${draftId}.title`;

function readLocal(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeLocal(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* private mode: state still lives in memory */ }
}

/** The ladder's number: the rubric's weighted mean, matching how the server
 *  scores a version (server/skills/practice/drafts.ts). Falls back to a plain
 *  mean when a run scores something the rubric does not list. */
function meanScore(run: RunReport | undefined, rubric: RubricItem[]): number | null {
  if (!run || !run.scores.length) return null;
  let sum = 0;
  let weight = 0;
  for (const item of rubric) {
    const score = run.scores.find((s) => s.rubricId === item.id);
    if (!score) continue;
    const w = Number.isFinite(item.weight) && item.weight > 0 ? item.weight : 1;
    sum += Math.min(1, Math.max(0, score.score)) * w;
    weight += w;
  }
  if (weight) return sum / weight;
  return run.scores.reduce((a, s) => a + s.score, 0) / run.scores.length;
}

const bailLineOf = (r: RunReport | null): number | null => {
  if (!r) return null;
  for (const p of r.personas) {
    const hit = p.reactions.find((x) => x.bailed);
    if (hit) return hit.line;
  }
  return null;
};

export default function SkillMake(props: {
  skillId: string; moduleId?: string; settings: Settings; onSettings: (s: Settings) => void;
}) {
  const { skillId, moduleId, settings, onSettings } = props;
  const nav = useNav();
  const { toasts, push, pushError, dismiss } = useToasts();

  // --- state ---------------------------------------------------------------
  const [project, setProject] = useState<SkillProject | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [title, setTitle] = useState('');
  const [claims, setClaims] = useState<Claim[]>([]);
  const [sources, setSources] = useState<SourceRef[]>([]);
  const [ships, setShips] = useState<Shipment[]>([]);
  const [initialDoc, setInitialDoc] = useState<string | null>(null);
  const [docSeq, setDocSeq] = useState(0);

  const [report, setReport] = useState<RunReport | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [hint, setHint] = useState<{ text: string; flag?: { line: number; note: string } } | null>(null);

  const [railOpen, setRailOpen] = useState(false);
  const [railPinned, setRailPinned] = useState(false);
  const [railTab, setRailTab] = useState<MakeRailTab>('run');
  const [askFocusSeq, setAskFocusSeq] = useState(0);
  const [runShow, setRunShow] = useState({ margin: true, scorecard: true });
  const [evidenceView, setEvidenceView] = useState<'cards' | 'grid'>('cards');
  const [focusClaimId, setFocusClaimId] = useState<string | undefined>(undefined);

  const [shipOpen, setShipOpen] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- derived -------------------------------------------------------------
  const course = project?.course ?? null;
  const modules = useMemo(() => course?.modules ?? [], [course]);
  const module = useMemo(() => (
    modules.find((m) => m.id === moduleId)
    ?? modules.find((m) => m.status === 'current')
    ?? modules[0]
    ?? null
  ), [modules, moduleId]);
  const activeModuleId = module?.id ?? moduleId ?? '';

  /** Empty placeholder versions are bookkeeping, not iterations — the ladder
   *  counts only rungs a learner actually made. */
  const rubric = useMemo<RubricItem[]>(() => module?.rubric ?? [], [module]);
  const ladder = useMemo<LadderItem[]>(() => {
    const real = (draft?.versions ?? []).filter((v) => v.body.trim() !== '' || v.run);
    let prevMean: number | null = null;
    return real.map((v, i) => {
      const mine = meanScore(v.run, rubric);
      const delta = mine !== null && prevMean !== null ? mine - prevMean : null;
      if (mine !== null) prevMean = mine;
      return { n: v.n, label: i + 1, at: v.at, body: v.body, run: v.run, delta };
    });
  }, [draft, rubric]);

  const reps = project ? project.reps.drills + project.reps.runs + project.reps.ships : 0;
  const labelOf = useCallback((n: number) => ladder.find((i) => i.n === n)?.label ?? n, [ladder]);
  const latest = ladder.length ? ladder[ladder.length - 1] : null;

  // --- refs ----------------------------------------------------------------
  const editorRef = useRef<MakeEditorHandle | null>(null);
  const draftRef = useRef<Draft | null>(null); draftRef.current = draft;
  const moduleIdRef = useRef(activeModuleId); moduleIdRef.current = activeModuleId;
  const runningRef = useRef(false);
  const busyRef = useRef(false);
  const lastHintAt = useRef(0);
  const cursorLineRef = useRef(1);
  const bailRef = useRef<number | null>(null);
  const railOpenRef = useRef(railOpen); railOpenRef.current = railOpen;
  const railTabRef = useRef(railTab); railTabRef.current = railTab;
  const askFocusedRef = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const creating = useRef<{ key: string; p: Promise<Draft> } | null>(null);

  // --- boot ----------------------------------------------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await skillsApi.get(skillId);
        if (!alive) return;
        setProject(p);

        const mods = p.course?.modules ?? [];
        const mod = mods.find((m) => m.id === moduleId)
          ?? mods.find((m) => m.status === 'current')
          ?? mods[0];
        if (!mod) { setError('this skill has no course yet — finish research first.'); return; }

        const all = await skillsApi.drafts(skillId);
        if (!alive) return;
        const mine = all.filter((d) => d.moduleId === mod.id);
        let d = mine.length ? mine[mine.length - 1] : null;
        if (!d) {
          // StrictMode mounts this effect twice in dev; a ref survives that, so
          // both runs await the SAME create and the learner gets one draft.
          const key = `${skillId}/${mod.id}`;
          if (creating.current?.key !== key) {
            creating.current = {
              key,
              p: skillsApi.createDraft(skillId, {
                moduleId: mod.id,
                title: `${p.course?.personas[0]?.name ?? 'Draft'} — first touch`,
                body: '',
              }),
            };
          }
          d = await creating.current.p;
        }
        if (!alive || !d) return;

        const versions = d.versions ?? [];
        const last = versions.length ? versions[versions.length - 1] : null;
        const stashed = readLocal(bodyKey(skillId, d.id));
        setDraft(d);
        setTitle(readLocal(titleKey(skillId, d.id)) ?? d.title);
        setInitialDoc(stashed ?? last?.body ?? '');

        const withRun = [...versions].reverse().find((v) => v.run);
        if (withRun?.run) {
          setReport(withRun.run);
          setSelected(withRun.n);
        } else if (last) {
          setSelected(last.n);
        }
      } catch (e) {
        if (alive) setError((e as Error).message || 'could not open this draft');
      }
    })();
    return () => { alive = false; };
  }, [skillId, moduleId]);

  // evidence + shipments ride along; neither blocks the editor
  useEffect(() => {
    let alive = true;
    skillsApi.claims(skillId).then((c) => { if (alive) setClaims(c ?? []); }).catch(() => { /* tab shows empty */ });
    skillsApi.sources(skillId).then((s) => { if (alive) setSources(s ?? []); }).catch(() => { /* tab shows empty */ });
    skillsApi.ships(skillId).then((s) => { if (alive) setShips(s ?? []); }).catch(() => { /* strip stays empty */ });
    return () => { alive = false; };
  }, [skillId]);

  useEffect(() => () => { if (saveTimer.current !== null) clearTimeout(saveTimer.current); }, []);

  // A restore remounts the editor; re-hang the bail tint on the fresh view.
  useEffect(() => {
    if (bailRef.current != null) editorRef.current?.setBail(bailRef.current);
  }, [docSeq, initialDoc]);

  // --- local persistence ---------------------------------------------------
  const onEdit = useCallback((text: string) => {
    const d = draftRef.current;
    if (!d) return;
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      writeLocal(bodyKey(skillId, d.id), text);
    }, 300);
  }, [skillId]);

  const onTitle = useCallback((value: string) => {
    setTitle(value);
    const d = draftRef.current;
    // The draft PUT only carries the body (frozen contract), so a rename lives
    // here until the next draft is created.
    if (d) writeLocal(titleKey(skillId, d.id), value);
  }, [skillId]);

  // --- saving = versioning -------------------------------------------------
  const saveVersion = useCallback(async (): Promise<Draft | null> => {
    const d = draftRef.current;
    if (!d) return null;
    const body = editorRef.current?.getContent() ?? '';
    writeLocal(bodyKey(skillId, d.id), body);
    const saved = await skillsApi.saveDraft(skillId, d.id, body);
    setDraft(saved);
    return saved;
  }, [skillId]);

  const doSnapshot = useCallback(async () => {
    try {
      const saved = await saveVersion();
      if (!saved) return;
      // count the rungs the ladder actually shows, not the raw versions
      const n = saved.versions.filter((v) => v.body.trim() !== '' || v.run).length;
      push('good', `saved as v${n} — the ladder keeps it.`);
    } catch (e) { pushError(e, 'could not save:'); }
  }, [saveVersion, push, pushError]);

  // --- run -----------------------------------------------------------------
  const askHolds = useCallback(
    () => askFocusedRef.current || (railOpenRef.current && railTabRef.current === 'ask'),
    [],
  );

  const doRun = useCallback(async () => {
    const d = draftRef.current;
    if (!d || runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    if (!askHolds()) { setRailTab('run'); setRailOpen(true); }
    try {
      const saved = await saveVersion();
      const versions = saved?.versions ?? [];
      const last = versions.length ? versions[versions.length - 1] : null;
      if (!last) throw new Error('nothing to run yet — write a line first');

      const rep = await skillsApi.run(skillId, d.id, last.n);
      setDraft((cur) => (cur
        ? { ...cur, versions: cur.versions.map((v) => (v.n === last.n ? { ...v, run: rep } : v)) }
        : cur));
      setReport(rep);
      setSelected(last.n);
      setPreviewing(false);
      setRailTab('run');
      setRailOpen(true);

      const bail = bailLineOf(rep);
      bailRef.current = bail;
      editorRef.current?.setBail(bail);

      setProject((cur) => (cur ? { ...cur, reps: { ...cur.reps, runs: cur.reps.runs + 1 } } : cur));
    } catch (e) {
      pushError(e, 'the panel could not read it:');
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [skillId, saveVersion, askHolds, pushError]);

  // --- hint / ghost --------------------------------------------------------
  const requestHint = useCallback(async () => {
    const d = draftRef.current;
    if (!d || busyRef.current) return;
    const now = Date.now();
    const level: 'step' | 'composite' = now - lastHintAt.current < HINT_COMPOSITE_WINDOW ? 'composite' : 'step';
    lastHintAt.current = now;

    busyRef.current = true;
    setThinking(true);
    try {
      const res = await skillsApi.hint(skillId, {
        moduleId: moduleIdRef.current,
        draftId: d.id,
        body: editorRef.current?.getContent() ?? '',
        cursorLine: editorRef.current?.getCursorLine() ?? 1,
        level,
      });
      setHint({ text: res.hint, ...(res.flag ? { flag: res.flag } : {}) });
      editorRef.current?.setNudge(res.flag ? res.flag.line : null);
    } catch {
      setHint({ text: 'no hint right now — try again in a moment.' });
    } finally {
      busyRef.current = false;
      setThinking(false);
    }
  }, [skillId]);

  const requestGhost = useCallback(async () => {
    const d = draftRef.current;
    if (!d || busyRef.current) return;
    busyRef.current = true;
    setThinking(true);
    try {
      const res = await skillsApi.ghost(skillId, {
        moduleId: moduleIdRef.current,
        draftId: d.id,
        body: editorRef.current?.getContent() ?? '',
        cursorLine: editorRef.current?.getCursorLine() ?? 1,
      });
      // showGhost peels off whatever is already on the line; when nothing is
      // left there is no ghost, and silence would read as a broken key.
      const shown = editorRef.current?.showGhost(res.text);
      if (!shown) setHint({ text: 'This line already says it — start a new line and ask again.' });
    } catch {
      setHint({ text: 'no practice line right now — keep going in your own words.' });
    } finally {
      busyRef.current = false;
      setThinking(false);
    }
  }, [skillId]);

  const openNudge = useCallback(() => {
    setHint((h) => (h?.flag ? { text: h.flag.note, flag: h.flag } : h));
  }, []);

  // --- versions ------------------------------------------------------------
  const selectVersion = useCallback((n: number) => {
    // clicking the open rung folds it away again
    setPreviewing(!(selected === n && previewing));
    setSelected(n);
    const item = ladder.find((i) => i.n === n);
    if (item?.run) {
      setReport(item.run);
      setRailTab('run');
      setRailOpen(true);
    }
  }, [ladder, selected, previewing]);

  const restoreVersion = useCallback((n: number) => {
    const item = ladder.find((i) => i.n === n);
    const d = draftRef.current;
    if (!item || !d) return;
    writeLocal(bodyKey(skillId, d.id), item.body);
    setInitialDoc(item.body);
    setDocSeq((s) => s + 1);
    setPreviewing(false);
    const bail = bailLineOf(item.run ?? null);
    bailRef.current = bail;
    push('info', `v${item.label} is back in the editor. Edit it and run again.`);
  }, [ladder, skillId, push]);

  // --- ship ----------------------------------------------------------------
  const doShip = useCallback(async (v: { sent: number; replies: number; meetings?: number; notes?: string }) => {
    const d = draftRef.current;
    if (!d || !latest) return;
    setShipping(true);
    try {
      const s = await skillsApi.ship(skillId, { draftId: d.id, version: latest.n, ...v });
      setShips((cur) => [...cur.filter((x) => x.id !== s.id), s]);
      setShipOpen(false);
      setProject((cur) => (cur ? { ...cur, reps: { ...cur.reps, ships: cur.reps.ships + 1 } } : cur));
      const rate = v.sent ? (v.replies / v.sent) * 100 : 0;
      const hit = rate >= s.predictedLow && rate <= s.predictedHigh;
      push(hit ? 'good' : 'info', hit
        ? `${rate.toFixed(1)}% — inside what the panel predicted.`
        : `${rate.toFixed(1)}% — outside the prediction. Reality wins; the claims get re-checked.`);
    } catch (e) {
      pushError(e, 'could not record that:');
    } finally {
      setShipping(false);
    }
  }, [skillId, latest, push, pushError]);

  const doRefresh = useCallback(async () => {
    push('info', 'checking the newest sources for this skill…');
    try {
      await skillsApi.refresh(skillId);
      const [c, s] = await Promise.all([skillsApi.claims(skillId), skillsApi.sources(skillId)]);
      setClaims(c ?? []);
      setSources(s ?? []);
      push('good', 'evidence re-checked.');
    } catch (e) {
      pushError(e, 'could not refresh the evidence:');
    }
  }, [skillId, push, pushError]);

  // --- rail ----------------------------------------------------------------
  const pickTab = useCallback((t: MakeRailTab) => {
    setRailTab(t);
    setRailOpen(true);
    if (t === 'ask') setAskFocusSeq((s) => s + 1);
  }, []);

  const onClaim = useCallback((id: string) => {
    setFocusClaimId(id);
    setEvidenceView('cards');
    setRailTab('evidence');
    setRailOpen(true);
  }, []);

  const onHoverLine = useCallback((line: number | null) => {
    editorRef.current?.setBail(line ?? bailRef.current);
  }, []);

  const getBody = useCallback(() => editorRef.current?.getContent() ?? '', []);

  // --- scheme --------------------------------------------------------------
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

  // --- keys ----------------------------------------------------------------
  const cmds = useRef({ doRun, requestHint, requestGhost, doSnapshot, openNudge });
  cmds.current = { doRun, requestHint, requestGhost, doSnapshot, openNudge };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inEditor = !!t?.closest?.('.cm-editor');
      const inInput = !!t?.closest?.('input, textarea');
      const mod = e.metaKey || e.ctrlKey;

      if (e.ctrlKey && !e.altKey && (e.key === '`' || e.code === 'Backquote')) {
        e.preventDefault(); setRailOpen((o) => !o); return;
      }
      if (e.altKey && !mod && (e.code === 'KeyH' || e.key.toLowerCase() === 'h')) {
        e.preventDefault(); cmds.current.openNudge(); return;
      }
      // Inside CodeMirror these are claimed by the editor's own Prec.highest
      // keymap (it has to be, or defaultKeymap's Mod-Enter would open a blank
      // line in the draft first).
      if (inEditor) return;
      if (mod && e.key === 'Enter') { e.preventDefault(); void cmds.current.doRun(); return; }
      if (mod && !e.shiftKey && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) {
        e.preventDefault(); void cmds.current.doSnapshot(); return;
      }
      if (inInput) return;
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
  const railState: MakeRailState = railOpen ? (railPinned ? 'pinned' : 'open') : 'strip';
  const goScreen = (screen: SkillScreen) =>
    nav.go({ name: 'skill', skillId, screen, ...(activeModuleId ? { moduleId: activeModuleId } : {}) });
  const goLearn = () => goScreen('learn');

  return (
    <div className="skillMake" data-testid="skill-make">
      <MakeHeader
        skillName={project?.name ?? 'loading…'}
        moduleTitle={module?.title}
        title={title}
        reps={reps}
        running={running}
        thinking={thinking}
        canRun={!!draft}
        canShip={!!latest}
        scheme={settings.scheme}
        onTitle={onTitle}
        onBack={goLearn}
        onDrills={() => goScreen('drills')}
        onMake={() => goScreen('make')}
        onHint={() => void requestHint()}
        onRun={() => void doRun()}
        onShip={() => setShipOpen(true)}
        onScheme={cycleScheme}
      />

      <div className="mkBody">
        <VersionLadder
          items={ladder}
          selected={selected}
          previewing={previewing}
          ships={ships}
          labelOf={labelOf}
          reps={project?.reps ?? { drills: 0, runs: 0, ships: 0 }}
          onSelect={selectVersion}
          onRestore={restoreVersion}
          onSnapshot={() => void doSnapshot()}
          onRefresh={() => void doRefresh()}
        />

        <main className="mkMain">
          <div className="mkStage">
            <div className="mkEditorWrap">
              {initialDoc !== null && draft ? (
                <MakeEditor
                  key={`${draft.id}#${docSeq}`}
                  ref={editorRef}
                  initialDoc={initialDoc}
                  scheme={settings.scheme}
                  onEdit={onEdit}
                  onCursorLine={(l) => { cursorLineRef.current = l; }}
                  onHint={() => void requestHint()}
                  onGhost={() => void requestGhost()}
                  onRun={() => void doRun()}
                  onSnapshot={() => void doSnapshot()}
                  onOpenNudge={openNudge}
                />
              ) : (
                <div className="mkEditorEmpty">{error ?? 'opening your draft…'}</div>
              )}
            </div>

            <MakeRail
              skillId={skillId}
              moduleId={activeModuleId}
              state={railState}
              tab={railTab}
              running={running}
              report={report}
              personas={course?.personas ?? []}
              rubric={rubric}
              metric={course?.metric ?? { name: 'reply rate', unit: '%', corpusMedian: 5 }}
              claims={claims}
              sources={sources}
              focusClaimId={focusClaimId}
              evidenceView={evidenceView}
              onEvidenceView={setEvidenceView}
              onClaim={onClaim}
              runShow={runShow}
              onRunShow={setRunShow}
              onHoverLine={onHoverLine}
              getBody={getBody}
              askFocusSeq={askFocusSeq}
              onAskFocus={(f) => { askFocusedRef.current = f; }}
              onOpen={() => setRailOpen(true)}
              onClose={() => setRailOpen(false)}
              onTogglePin={() => setRailPinned((p) => !p)}
              onTab={pickTab}
              onHover={() => { /* the make rail never auto-collapses */ }}
            />
          </div>

          <div className="mkFoot" data-lit={hint ? 'true' : 'false'}>
            <span className="mkLamp" data-on={thinking ? 'true' : 'false'} />
            {hint ? (
              <>
                <span className="mkHintText" data-testid="hint-text">{hint.text}</span>
                {hint.flag && (
                  <button className="mkFlagBtn" data-testid="hint-flag" onClick={openNudge}>
                    line {hint.flag.line}
                  </button>
                )}
                <button className="mkFootX" aria-label="dismiss" onClick={() => setHint(null)}>×</button>
              </>
            ) : (
              <span className="mkHintIdle">
                Ctrl+Space for a hint · Ctrl+Shift+Space for a practice line you type yourself.
              </span>
            )}
          </div>
        </main>
      </div>

      {shipOpen && latest && (
        <ShipModal
          versionLabel={latest.label}
          predicted={latest.run?.predicted}
          busy={shipping}
          onClose={() => setShipOpen(false)}
          onSubmit={(v) => void doShip(v)}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
