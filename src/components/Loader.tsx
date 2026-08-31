import { useEffect, useState } from 'react';

/**
 * Playroom loader: four hopping sticker blocks, a sheen bar, and copy that
 * rotates so a 60s LLM call feels like something is happening.
 */
export default function Loader({
  lines,
  intervalMs = 2600,
  testId,
}: { lines: string[]; intervalMs?: number; testId?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (lines.length < 2) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % lines.length), intervalMs);
    return () => window.clearInterval(t);
  }, [lines.length, intervalMs]);

  return (
    <div className="loader" data-testid={testId} role="status" aria-live="polite">
      <div className="loader-blocks" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="loader-bar" aria-hidden="true" />
      <p className="loader-copy" key={i}>{lines[i] ?? lines[0]}</p>
    </div>
  );
}
