import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { motion } from 'framer-motion';
import MusicVenueMark from './MusicVenueMark';
import DottedSurface from './DottedSurface';

interface SplashIntroProps { onComplete: () => void; }

/** A quiet dot loader: the grid resolves into the Music Venue mark as the sidecar wakes. */
export default function SplashIntro({ onComplete }: SplashIntroProps) {
  const [status, setStatus] = useState('Connecting');
  const ready = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      for (let attempt = 0; attempt < 20 && !cancelled; attempt++) {
        try {
          const response = await fetch('http://127.0.0.1:8000/docs');
          if (response.ok || response.status === 404) {
            ready.current = true;
            setStatus('Ready');
            window.setTimeout(() => { if (!cancelled) onComplete(); }, 520);
            return;
          }
        } catch { /* sidecar is still starting */ }
        if (attempt === 4) setStatus('Warming up');
        if (attempt === 11) setStatus('Almost there');
        await new Promise(resolve => window.setTimeout(resolve, 400));
      }
      if (!cancelled) { setStatus('Ready'); window.setTimeout(onComplete, 520); }
    };
    const timer = window.setTimeout(check, 380);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [onComplete]);
  return <motion.div className="dot-splash" initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .55 }}>
    <DottedSurface className="dot-splash-surface" />
    <div className="dot-splash-inner">
      <motion.div className="dot-splash-logo" initial={{ scale: .82, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 190, damping: 18 }}>
        <span className="dot-splash-ring ring-one" /><span className="dot-splash-ring ring-two" />
        <MusicVenueMark className="splash-dot-mark" field />
        <MusicVenueMark className="splash-dot-core" />
      </motion.div>
      <motion.div className="dot-splash-wordmark" initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: .16, duration: .45 }}>Music Venue</motion.div>
      <div className="dot-loader" aria-label={`${status}…`} role="status">{Array.from({ length: 21 }, (_, i) => <i key={i} style={{ '--loader-delay': `${(i % 7) * .07 + Math.floor(i / 7) * .04}s` } as CSSProperties} />)}</div>
      <motion.div className="dot-splash-status" key={status} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>{status}</motion.div>
    </div>
  </motion.div>;
}
