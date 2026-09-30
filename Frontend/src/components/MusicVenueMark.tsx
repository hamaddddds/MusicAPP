import type { CSSProperties } from 'react';

// Seven-point grid: the inner descending strokes of M also draw the V.
const mark = ['1000001', '1100011', '1010101', '1001001', '1000001', '1000001', '1000001'];

export default function MusicVenueMark({ className = '', field = false }: { className?: string; field?: boolean }) {
  return <svg className={`mv-mark ${className}`} viewBox="0 0 56 56" fill="currentColor" aria-hidden="true" focusable="false">
    {mark.flatMap((row, y) => [...row].map((dot, x) => dot === '1' || field
      ? <circle key={`${x}-${y}`} cx={7 + x * 7} cy={7 + y * 7} r={2.3} className={dot === '1' ? 'mark-dot' : 'mark-space'} style={{ '--dot-delay': `${(x + y) * .12}s` } as CSSProperties} /> : null))}
  </svg>;
}
