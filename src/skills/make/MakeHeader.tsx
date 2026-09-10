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

  const where = moduleTitle ? `${skillName} / ${moduleTitle}` : skillName;

  return (
    <header className="mkTop">
      <button className="mkBack" data-testid="back-to-map" title="back to this module" onClick={onBack}>‹</button>

      {/* One line in a dense bar, but never a dead end: the whole label is in
          the title attribute and unfolds on hover/focus. */}
      <div className="mkTitle hoverHost" tabIndex={0} title={where}>
        <span className="mkSkill">{skillName}</span>
        {moduleTitle && <span className="mkSlash">/</span>}
        {moduleTitle && <span className="mkModule">{moduleTitle}</span>}
        <span className="hoverPop" role="tooltip">{where}</span>
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

      <button
        className="mkHintBtn"
        data-testid="make-hint"
        title="a nudge, not the words (Ctrl+Space)"
        aria-label="hint"
        onClick={onHint}
      >
        <span aria-hidden="true">{thinking ? '…' : '?'}</span>
        <span className="mkLabel">hint</span>
      </button>

      <button
        className="mkRun"
        data-testid="make-run"
        disabled={running || !canRun}
        title="run it against the panel (Cmd/Ctrl+Enter)"
        onClick={onRun}
      >
        <span aria-hidden="true">{running ? '…' : '▶'}</span>
        <span>run</span>
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

      <button
        className="mkScheme"
        data-testid="scheme-btn"
        title="next colour scheme"
        aria-label={`colour scheme: ${scheme}`}
        onClick={onScheme}
      >
        <span className="schemeSwatch" />
        <span className="mkLabel">{scheme}</span>
      </button>
    </header>
  );
}
