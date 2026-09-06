// ---------------------------------------------------------------------------
// The header row: where you are, what the draft is called, how many reps you
// have, and the three things you can do to it (hint, run, ship).
// ---------------------------------------------------------------------------
import type { Scheme } from '../../../shared/types';

export interface MakeHeaderProps {
  skillName: string;
  moduleTitle?: string;
  title: string;
  reps: number;
  running: boolean;
  thinking: boolean;
  canRun: boolean;
  canShip: boolean;
  scheme: Scheme;
  onTitle: (v: string) => void;
  onBack: () => void;
  onDrills: () => void;
  onMake: () => void;
  onHint: () => void;
  onRun: () => void;
  onShip: () => void;
  onScheme: () => void;
}

export default function MakeHeader(props: MakeHeaderProps) {
  const {
    skillName, moduleTitle, title, reps, running, thinking, canRun, canShip, scheme,
    onTitle, onBack, onDrills, onMake, onHint, onRun, onShip, onScheme,
  } = props;

  return (
    <header className="mkTop">
      <button className="mkBack" data-testid="back-to-map" title="back to this module" onClick={onBack}>‹</button>

      <div className="mkTitle">
        <span className="mkSkill">{skillName}</span>
        {moduleTitle && <span className="mkSlash">/</span>}
        {moduleTitle && <span className="mkModule">{moduleTitle}</span>}
      </div>

      <input
        className="input input-bare mkDraftTitle"
        data-testid="draft-title"
        aria-label="draft name"
        value={title}
        placeholder="name this draft"
        onChange={(e) => onTitle(e.target.value)}
      />

      <span className="mkGrow" />

      <span className="mkRepChip" data-testid="rep-counter" title="drills + runs + ships so far">
        {reps} rep{reps === 1 ? '' : 's'}
      </span>

      <button className="mkSkip" data-testid="skip-to-drills" title="back to the drills" onClick={onDrills}>
        drills
      </button>
      <button className="mkSkip" data-testid="skip-to-make" aria-current="page" title="you are here" onClick={onMake}>
        make
      </button>

      <button className="mkHintBtn" data-testid="make-hint" title="a nudge, not the words (Ctrl+Space)" onClick={onHint}>
        {thinking ? '…' : '?'} hint
      </button>

      <button
        className="mkRun"
        data-testid="make-run"
        disabled={running || !canRun}
        title="run it against the panel (Cmd/Ctrl+Enter)"
        onClick={onRun}
      >
        {running ? '…' : '▶'} run
      </button>

      <button
        className="mkShipBtn"
        data-testid="ship-open"
        disabled={!canShip}
        title="paste in what really happened"
        onClick={onShip}
      >
        ship
      </button>

      <button className="mkScheme" data-testid="scheme-btn" title="next colour scheme" onClick={onScheme}>
        <span className="schemeSwatch" />
        {scheme}
      </button>
    </header>
  );
}
