// ---------------------------------------------------------------------------
// The version ladder: one rung per iteration, newest lit, each carrying the
// change in mean rubric score against the last version that was actually run.
// Under it: what you shipped, and how the prediction did against reality.
// ---------------------------------------------------------------------------
import type { RunReport, Shipment } from '../../../shared/skills';

export interface LadderItem {
  n: number;              // the server's version number (what run/ship use)
  label: number;          // what the learner sees: v1, v2, …
  at: string;
  body: string;
  run?: RunReport;
  delta: number | null;   // mean rubric score vs the previous run, null if first
}

export interface VersionLadderProps {
  items: LadderItem[];
  selected: number | null;
  previewing: boolean;
  ships: Shipment[];
  labelOf: (n: number) => number;
  reps: { drills: number; runs: number; ships: number };
  onSelect: (n: number) => void;
  onRestore: (n: number) => void;
  onSnapshot: () => void;
  onRefresh: () => void;
}

function deltaText(d: number | null): string {
  if (d === null) return '—';
  const s = Math.abs(d).toFixed(2);
  return d < 0 ? `−${s}` : `+${s}`;
}

function deltaTone(d: number | null): 'flat' | 'good' | 'bad' {
  if (d === null || Math.abs(d) < 0.005) return 'flat';
  return d > 0 ? 'good' : 'bad';
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export default function VersionLadder(props: VersionLadderProps) {
  const { items, selected, previewing, ships, labelOf, reps, onSelect, onRestore, onSnapshot, onRefresh } = props;
  const newest = items.length ? items[items.length - 1].n : null;

  return (
    <aside className="mkLadder" data-testid="version-ladder">
      <div className="mkLadderHead">
        <h2>versions</h2>
        <button className="mkGhostBtn" data-testid="make-snapshot" title="save this as a version (Cmd/Ctrl+S)" onClick={onSnapshot}>
          snapshot
        </button>
      </div>

      {items.length === 0 && (
        <p className="mkQuiet" data-testid="ladder-empty">
          No versions yet. Run or snapshot and this becomes your ladder.
        </p>
      )}

      <ol className="mkRungs">
        {items.map((it) => (
          <li key={it.n}>
            <button
              className="mkRung"
              data-testid={`version-${it.label}`}
              data-newest={it.n === newest}
              data-selected={it.n === selected}
              onClick={() => onSelect(it.n)}
              title={it.run ? 'ran against the panel' : 'not run yet'}
            >
              <span className="mkRungName">v{it.label}</span>
              <span className="mkRungWhen">{when(it.at)}</span>
              <span
                className="mkRungDelta"
                data-testid={`version-delta-${it.label}`}
                data-tone={deltaTone(it.delta)}
                title="change in mean rubric score against the last run"
              >
                {deltaText(it.delta)}
              </span>
            </button>

            {it.n === selected && previewing && (
              <div className="mkPreview" data-testid={`version-preview-${it.label}`}>
                <pre>{it.body || '(empty)'}</pre>
                <button className="mkRestore" data-testid={`version-restore-${it.label}`} onClick={() => onRestore(it.n)}>
                  Restore into editor
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>

      <p className="mkReps" data-testid="make-reps">
        Today: {reps.runs} run{reps.runs === 1 ? '' : 's'} · {reps.drills} drill{reps.drills === 1 ? '' : 's'}
        {' '}— aim for 3 iterations.
      </p>

      <div className="mkShips">
        <div className="mkLadderHead">
          <h2>shipped</h2>
          <button className="mkGhostBtn" data-testid="refresh-evidence" title="re-check the newest sources" onClick={onRefresh}>
            refresh evidence
          </button>
        </div>
        {ships.length === 0 && <p className="mkQuiet">Nothing sent yet. Real replies beat any simulation.</p>}
        {ships.map((s) => {
          const rate = s.sent > 0 ? (s.replies / s.sent) * 100 : 0;
          const hit = rate >= s.predictedLow && rate <= s.predictedHigh;
          return (
            <div className="mkShip" data-testid={`ship-${s.id}`} key={s.id} data-hit={hit}>
              <b>v{labelOf(s.version)}</b>
              <span>{s.sent} sent</span>
              <span>{s.replies} replies ({rate.toFixed(1)}%)</span>
              <span className="mkShipPred">
                predicted {s.predictedLow}–{s.predictedHigh}% {hit ? '✓' : '✗'}
              </span>
              {s.notes && <em className="mkShipNote">{s.notes}</em>}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
