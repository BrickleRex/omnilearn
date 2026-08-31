// ---------------------------------------------------------------------------
// Compass — the slim strip above the editor. Pips for the build plan, the title
// of the step you're on, and (on Ctrl+Space) an unfolding one-sentence detail.
// ---------------------------------------------------------------------------
import type { Step } from '../../shared/types';

export interface CompassProps {
  steps: Step[];
  currentStep: number;
  thinking: boolean;
  detail: string | null;
  onPickStep: (index: number) => void;
  onDismissDetail: () => void;
}

export default function Compass({
  steps, currentStep, thinking, detail, onPickStep, onDismissDetail,
}: CompassProps) {
  const current = steps[currentStep];

  return (
    <div className="compass" data-testid="compass" data-thinking={thinking}>
      <div className="compassRow">
        <span className="compassLabel">plan</span>
        <div className="compassPips" role="tablist" aria-label="build steps">
          {steps.length === 0 && <span className="compassPipsEmpty">drawing up the plan…</span>}
          {steps.map((s, i) => (
            <button
              key={`${i}-${s.title}`}
              className="pip"
              role="tab"
              aria-selected={i === currentStep}
              aria-label={s.title}
              title={`${i + 1}. ${s.title}`}
              data-state={i < currentStep ? 'done' : i === currentStep ? 'current' : 'todo'}
              data-pulse={thinking && i === currentStep}
              onClick={() => onPickStep(i)}
            />
          ))}
        </div>
        <span className="compassStep" data-testid="compass-step">
          {current ? current.title : steps.length ? '—' : 'build'}
        </span>
        {thinking && <span className="compassThinking">thinking…</span>}
      </div>

      {detail && (
        <div className="compassDetail" data-testid="compass-detail" role="status">
          <span className="compassDetailText">{detail}</span>
          <button className="compassDetailX" aria-label="dismiss" onClick={onDismissDetail}>×</button>
        </div>
      )}
    </div>
  );
}
