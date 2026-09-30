import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { motion, type Variants } from 'framer-motion';
import DottedSurface from './DottedSurface';

interface SplashIntroProps { onComplete: () => void; }

// Same seven-point grid as MusicVenueMark: the inner strokes of the M also draw the V.
const MARK = ['1000001', '1100011', '1010101', '1001001', '1000001', '1000001', '1000001'];
// 5×7 dot-matrix glyphs, only the letters in the wordmark.
const GLYPHS: Record<string, string[]> = {
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
};
const WORD = 'MUSIC VENUE', PITCH = 6, MIN_SHOW_MS = 2100;

/** Every lit dot of the wordmark with its column, so letters can light up left to right. */
function wordDots() {
  const dots: { x: number; y: number; delay: number }[] = [];
  let col = 0, letter = 0;
  for (const ch of WORD) {
    if (ch === ' ') { col += 3; continue; }
    GLYPHS[ch].forEach((row, y) => [...row].forEach((on, x) => {
      if (on === '1') dots.push({ x: (col + x) * PITCH + 3, y: y * PITCH + 3, delay: 1.05 + letter * 0.055 + x * 0.018 });
    }));
    col += 6;
    letter++;
  }
  return { dots, width: (col - 1) * PITCH };
}
const WORDMARK = wordDots();

const splash: Variants = {
  show: { opacity: 1 },
  leave: { opacity: 0, transition: { duration: 0.5, delay: 0.3, ease: 'easeInOut' } },
};
const logo: Variants = {
  show: { scale: 1, opacity: 1 },
  leave: { scale: 1.35, opacity: 0, transition: { duration: 0.6, ease: [0.4, 0, 0.2, 1] } },
};
// Each dot flies in from its own scattered spot, then flies back out along the same line.
const dot: Variants = {
  hidden: ({ ox, oy }) => ({ x: ox, y: oy, scale: 0, opacity: 0 }),
  show: ({ delay, lit }) => ({ x: 0, y: 0, scale: 1, opacity: lit ? 1 : 0.14, transition: { type: 'spring', stiffness: 150, damping: 15, delay } }),
  leave: ({ ox, oy }) => ({ x: ox * 1.8, y: oy * 1.8, scale: 0.3, opacity: 0, transition: { duration: 0.55, ease: [0.5, 0, 0.75, 0] } }),
};
const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: (delay: number) => ({ opacity: 1, y: 0, transition: { delay, duration: 0.5, ease: [0.16, 1, 0.3, 1] } }),
  leave: { opacity: 0, y: -6, transition: { duration: 0.25 } },
};

/** Scattered dots assemble into the Music Venue mark while the sidecar wakes, then burst away. */
export default function SplashIntro({ onComplete }: SplashIntroProps) {
  const [status, setStatus] = useState('Connecting');
  // Random but stable scatter origins, farther out for dots farther from the center.
  const [markDots] = useState(() => MARK.flatMap((row, y) => [...row].map((on, x) => {
    const angle = Math.random() * Math.PI * 2, radius = 70 + Math.random() * 90;
    const fromCenter = Math.hypot(x - 3, y - 3);
    return { x: 7 + x * 7, y: 7 + y * 7, lit: on === '1', ox: Math.cos(angle) * radius, oy: Math.sin(angle) * radius, delay: 0.15 + fromCenter * 0.07 + Math.random() * 0.12 };
  })));

  useEffect(() => {
    let cancelled = false;
    const started = performance.now();
    const finish = () => window.setTimeout(() => { if (!cancelled) onComplete(); }, Math.max(0, MIN_SHOW_MS - (performance.now() - started)) + 350);
    const check = async () => {
      for (let attempt = 0; attempt < 20 && !cancelled; attempt++) {
        try {
          const response = await fetch('http://127.0.0.1:8000/docs');
          if (response.ok || response.status === 404) { setStatus('Ready'); finish(); return; }
        } catch { /* sidecar is still starting */ }
        if (attempt === 4) setStatus('Warming up');
        if (attempt === 11) setStatus('Almost there');
        await new Promise(resolve => window.setTimeout(resolve, 400));
      }
      if (!cancelled) { setStatus('Ready'); finish(); }
    };
    const timer = window.setTimeout(check, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [onComplete]);

  return <motion.div className="dot-splash" variants={splash} initial="hidden" animate="show" exit="leave">
    <DottedSurface className="dot-splash-surface" />
    <div className="dot-splash-inner">
      <motion.div className="dot-splash-logo" variants={logo}>
        <span className="dot-splash-shock" />
        <span className="dot-splash-ring" />
        <svg className="splash-mark" viewBox="0 0 56 56" overflow="visible" aria-hidden="true">
          {markDots.map((d, i) => <motion.circle key={i} cx={d.x} cy={d.y} r={2.4} custom={d} variants={dot} className={d.lit ? 'splash-lit' : undefined} />)}
        </svg>
      </motion.div>
      <motion.svg className="splash-wordmark" viewBox={`0 0 ${WORDMARK.width} ${7 * PITCH}`} variants={fadeUp} custom={0.95} role="img" aria-label="Music Venue">
        {WORDMARK.dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={2.1} style={{ '--d': `${d.delay}s` } as CSSProperties} />)}
      </motion.svg>
      <motion.div className="splash-wave" variants={fadeUp} custom={1.5} role="status" aria-label={`${status}…`}>
        {Array.from({ length: 15 }, (_, col) => <span key={col}>{Array.from({ length: 5 }, (_, row) => <i key={row} style={{ '--d': `${col * 0.07 + Math.abs(row - 2) * 0.12}s` } as CSSProperties} />)}</span>)}
      </motion.div>
      <motion.div className="dot-splash-status" variants={fadeUp} custom={1.6}>
        <motion.span key={status} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>{status}</motion.span>
      </motion.div>
    </div>
  </motion.div>;
}
