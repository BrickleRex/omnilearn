import type { CSSProperties } from 'react';

const LETTERS = 'Omnilearn'.split('');

/** Sticker wordmark, pure CSS: each letter is its own little tile. */
export default function Wordmark({ small = false }: { small?: boolean }) {
  return (
    <span className={small ? 'wordmark wordmark-sm' : 'wordmark'} aria-label="Omnilearn" role="img">
      {LETTERS.map((ch, i) => (
        <span key={i} className="wordmark-l" style={{ '--i': i } as CSSProperties} aria-hidden="true">
          {ch}
        </span>
      ))}
    </span>
  );
}
