// ---------------------------------------------------------------------------
// The Run tab: PERSONA MARGIN (three readers from the corpus react line by
// line; the line one of them bailed on is called out) and SCORECARD (rubric
// bars that cite the claims they grade against). Both are shown by default,
// margin first — the human reaction before the number.
// ---------------------------------------------------------------------------
import type { Persona, RubricItem, RunReport } from '../../../shared/skills';

export interface RunPaneProps {
  report: RunReport | null;
  running: boolean;
  personas: Persona[];
  rubric: RubricItem[];
  metric: { name: string; unit: string; corpusMedian: number };
  show: { margin: boolean; scorecard: boolean };
  onShow: (s: { margin: boolean; scorecard: boolean }) => void;
  onClaim: (claimId: string) => void;
  onHoverLine: (line: number | null) => void;
}

/** Claim ids the note already cites, in the order they appear, plus the
 *  rubric's own — the bar should always be able to show its evidence. */
function claimsFor(note: string, item?: RubricItem): string[] {
  const found = (note.match(/\bc\d+\b/g) ?? []).map((s) => s.toLowerCase());
  const out: string[] = [];
  for (const id of [...found, ...(item?.claimIds ?? [])]) if (!out.includes(id)) out.push(id);
  return out;
}

function scoreTone(score: number): 'good' | 'warn' | 'bad' {
  if (score >= 0.7) return 'good';
  if (score >= 0.45) return 'warn';
  return 'bad';
}

export default function RunPane(props: RunPaneProps) {
  const { report, running, personas, rubric, metric, show, onShow, onClaim, onHoverLine } = props;

  if (running && !report) {
    return (
      <div className="mkRunPane">
        <p className="mkRunBusy" data-testid="run-busy">the panel is reading your draft…</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="mkRunPane">
        <p className="mkRunEmpty" data-testid="run-empty">
          Run it against the panel (Ctrl+Enter). Three readers built from the corpus will
          tell you where they stopped.
        </p>
      </div>
    );
  }

  const byId = (id: string) => personas.find((p) => p.id === id);
  const pct = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 100);

  return (
    <div className="mkRunPane">
      <div className="mkSubToggle" role="group" aria-label="what the run shows">
        <button
          type="button"
          className={`mkSeg${show.margin ? ' is-on' : ''}`}
          data-testid="run-show-margin"
          aria-pressed={show.margin}
          onClick={() => onShow({ ...show, margin: !show.margin })}
        >
          Persona margin
        </button>
        <button
          type="button"
          className={`mkSeg${show.scorecard ? ' is-on' : ''}`}
          data-testid="run-show-scorecard"
          aria-pressed={show.scorecard}
          onClick={() => onShow({ ...show, scorecard: !show.scorecard })}
        >
          Scorecard
        </button>
      </div>

      {show.margin && (
        <section className="mkMargin" data-testid="persona-margin">
          {report.personas.map((p) => {
            const who = byId(p.personaId);
            const bailAt = p.reactions.find((r) => r.bailed)?.line;
            return (
              <article className="mkPersona" data-testid={`persona-${p.personaId}`} key={p.personaId}>
                <header className="mkPersonaHead">
                  <b>{who?.name ?? p.personaId}</b>
                  <span>{who?.role ?? ''}</span>
                  {bailAt !== undefined && <span className="mkBailTag">stopped at line {bailAt}</span>}
                </header>
                <ul className="mkReactions">
                  {p.reactions.map((r) => (
                    <li
                      key={`${p.personaId}-${r.line}`}
                      className={`mkReaction${r.bailed ? ' is-bail' : ''}`}
                      {...(r.bailed ? { 'data-testid': 'reaction-bail' } : {})}
                      onMouseEnter={() => onHoverLine(r.line)}
                      onMouseLeave={() => onHoverLine(null)}
                    >
                      <span className="mkLineNo">L{r.line}</span>
                      <span className="mkReactionText">{r.text}</span>
                      {r.bailed && <span className="mkBailFlag">stopped reading here</span>}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </section>
      )}

      {show.scorecard && (
        <section className="mkScorecard" data-testid="scorecard">
          {report.scores.map((s) => {
            const item = rubric.find((r) => r.id === s.rubricId);
            const cites = claimsFor(s.note, item);
            return (
              <div className="mkScore" data-testid={`score-${s.rubricId}`} key={s.rubricId}>
                <div className="mkScoreTop">
                  <span className="mkScoreLabel">{item?.label ?? s.rubricId}</span>
                  <span className="mkScoreNum">{s.score.toFixed(2)}</span>
                </div>
                <div className="mkBar" data-tone={scoreTone(s.score)}>
                  <i style={{ width: `${pct(s.score)}%` }} />
                </div>
                <p className="mkScoreNote">
                  {s.note.replace(/\s*\(c\d+(?:,\s*c\d+)*\)\s*$/i, '')}
                  {cites.map((id) => (
                    <button
                      type="button"
                      className="mkClaimChip"
                      data-testid={`score-claim-${s.rubricId}-${id}`}
                      key={id}
                      title="see the evidence behind this"
                      onClick={() => onClaim(id)}
                    >
                      {id}
                    </button>
                  ))}
                </p>
              </div>
            );
          })}

          <div className="mkPredict" data-testid="predicted-range">
            <b>
              {report.predicted.low}–{report.predicted.high} {report.predicted.unit} {metric.name}
            </b>
            <span> · corpus median {metric.corpusMedian} {metric.unit}</span>
            <em>{report.predicted.note}</em>
          </div>

          <p className="mkLever" data-testid="biggest-lever">
            <span className="mkLeverTag">biggest lever</span>
            {report.biggestLever}
          </p>
        </section>
      )}
    </div>
  );
}
