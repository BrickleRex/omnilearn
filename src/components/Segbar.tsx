/**
 * Playful progress: chunky sticker segments, one per milestone. Filled ones pop
 * a little taller. Falls back to a single empty segment when total is 0.
 */
export default function Segbar({
  done, total, current, max = 9, label,
}: { done: number; total: number; current?: number; max?: number; label?: string }) {
  const n = Math.max(total, 1);
  const shown = Math.min(n, max);
  return (
    <span
      className="segbar"
      role="img"
      aria-label={label ?? `${done} of ${total} milestones done`}
      title={label ?? `${done} of ${total} done`}
    >
      {Array.from({ length: shown }, (_, i) => {
        const on = i < Math.round((done / n) * shown);
        const cur = current !== undefined && i === Math.min(current, shown - 1) && !on;
        return <i key={i} className={on ? 'on' : cur ? 'cur' : ''} />;
      })}
      {n > max && <b style={{ fontSize: 11, marginLeft: 4, color: 'var(--muted)' }}>+{n - max}</b>}
    </span>
  );
}
