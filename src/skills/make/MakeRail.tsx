// ---------------------------------------------------------------------------
// The rail — the same translucent pulse as the code track's terminal, with the
// skills track's three tabs: Run (persona margin + scorecard), Ask, Evidence.
// ---------------------------------------------------------------------------
import type { Claim, Persona, RubricItem, RunReport, SourceRef } from '../../../shared/skills';
import Evidence from '../evidence/Evidence';
import AskPane from './AskPane';
import RunPane from './RunPane';

export type MakeRailState = 'strip' | 'open' | 'pinned';
export type MakeRailTab = 'run' | 'ask' | 'evidence';

export interface MakeRailProps {
  skillId: string;
  moduleId: string;
  state: MakeRailState;
  tab: MakeRailTab;
  running: boolean;
  report: RunReport | null;
  personas: Persona[];
  rubric: RubricItem[];
  metric: { name: string; unit: string; corpusMedian: number };
  claims: Claim[];
  sources: SourceRef[];
  focusClaimId?: string;
  evidenceView: 'cards' | 'grid';
  onEvidenceView: (v: 'cards' | 'grid') => void;
  onClaim: (id: string) => void;
  runShow: { margin: boolean; scorecard: boolean };
  onRunShow: (s: { margin: boolean; scorecard: boolean }) => void;
  onHoverLine: (line: number | null) => void;
  getBody: () => string;
  askFocusSeq: number;
  onAskFocus: (focused: boolean) => void;
  onOpen: () => void;
  onClose: () => void;
  onTogglePin: () => void;
  onTab: (t: MakeRailTab) => void;
  onHover: () => void;
}

export default function MakeRail(props: MakeRailProps) {
  const {
    skillId, moduleId, state, tab, running, report, personas, rubric, metric,
    claims, sources, focusClaimId, evidenceView, onEvidenceView, onClaim,
    runShow, onRunShow, onHoverLine, getBody, askFocusSeq, onAskFocus,
    onOpen, onClose, onTogglePin, onTab, onHover,
  } = props;
  const open = state !== 'strip';
  const dot = running ? 'busy' : report ? 'good' : 'none';

  return (
    <aside
      className="rail mkRail"
      data-testid="make-rail"
      data-state={state}
      data-tab={tab}
      onMouseEnter={onHover}
    >
      {!open ? (
        <button className="railStrip" onClick={onOpen} title="the panel (Ctrl+`)" aria-label="open the panel">
          <span className="railDot" data-run={dot} />
          <span className="railKey">`</span>
          <span className="railCaption">panel</span>
        </button>
      ) : (
        <div className="railPanel">
          <header className="railHead">
            <button className="railTab" data-testid="rail-tab-run" data-active={tab === 'run'} onClick={() => onTab('run')}>Run</button>
            <button className="railTab" data-testid="rail-tab-ask" data-active={tab === 'ask'} onClick={() => onTab('ask')}>Ask</button>
            <button className="railTab" data-testid="rail-tab-evidence" data-active={tab === 'evidence'} onClick={() => onTab('evidence')}>Evidence</button>
            <span className="railSpacer" />
            <button
              className="railIcon"
              data-testid="rail-pin"
              data-on={state === 'pinned'}
              title={state === 'pinned' ? 'unpin' : 'pin open'}
              aria-label="pin the panel"
              onClick={onTogglePin}
            >
              📌
            </button>
            <button className="railIcon" title="close (Ctrl+`)" aria-label="close the panel" onClick={onClose}>×</button>
          </header>

          <div className="railBody">
            <div className="railPane mkPane" style={{ display: tab === 'run' ? 'flex' : 'none' }}>
              <RunPane
                report={report}
                running={running}
                personas={personas}
                rubric={rubric}
                metric={metric}
                show={runShow}
                onShow={onRunShow}
                onClaim={onClaim}
                onHoverLine={onHoverLine}
              />
            </div>

            <div className="railPane" style={{ display: tab === 'ask' ? 'flex' : 'none' }}>
              <AskPane
                skillId={skillId}
                moduleId={moduleId}
                visible={open && tab === 'ask'}
                getBody={getBody}
                focusSeq={askFocusSeq}
                onFocus={onAskFocus}
              />
            </div>

            <div className="railPane mkPane" style={{ display: tab === 'evidence' ? 'flex' : 'none' }}>
              <div className="mkEvidence">
                <Evidence
                  claims={claims}
                  sources={sources}
                  focusClaimId={focusClaimId}
                  view={evidenceView}
                  onView={onEvidenceView}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
