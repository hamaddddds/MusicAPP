import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface SplashIntroProps {
  onComplete: () => void;
}

export default function SplashIntro({ onComplete }: SplashIntroProps) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    // Sequence timing
    // Phase 0 -> 1: MV appears from bottom (0.5s)
    const t1 = setTimeout(() => setPhase(1), 500);
    // Phase 1 -> 2: Progress bar starts, text splits (at 1.0s)
    const t2 = setTimeout(() => setPhase(2), 1000);
    // Phase 2 -> 3: Text collapses back (at 2.3s)
    const t3 = setTimeout(() => setPhase(3), 2300);
    // Phase 3 -> complete: Intro done (at 2.8s)
    const t4 = setTimeout(() => {
      onComplete();
    }, 2800);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [onComplete]);

  // Phase 0: Hidden
  // Phase 1: MV at center, progress bar appears
  // Phase 2: Split to Music Venue
  // Phase 3: Collapse back to MV

  const isSplit = phase === 2;
  const showProgress = phase >= 1;

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#0a0a0a', // deep elegant black
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        
        {/* Typographic Container */}
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          style={{ 
            display: 'flex', 
            fontSize: '3.5rem', 
            fontWeight: 800,
            letterSpacing: '-1.5px',
            color: '#ffffff',
            fontFamily: 'Inter, sans-serif',
            overflow: 'hidden',
            padding: '10px 20px',
            position: 'relative'
          }}
        >
          {/* M - usic */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <motion.span layout transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>M</motion.span>
            <AnimatePresence>
              {isSplit && (
                <motion.span
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 'auto', opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  style={{ overflow: 'hidden', whiteSpace: 'nowrap', display: 'inline-block' }}
                >
                  usic
                </motion.span>
              )}
            </AnimatePresence>
          </div>

          <AnimatePresence>
            {isSplit && (
              <motion.span 
                initial={{ width: 0 }} 
                animate={{ width: '12px' }} 
                exit={{ width: 0 }} 
                transition={{ duration: 0.5 }} 
              />
            )}
          </AnimatePresence>

          {/* V - enue */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <motion.span layout transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>V</motion.span>
            <AnimatePresence>
              {isSplit && (
                <motion.span
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 'auto', opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  style={{ overflow: 'hidden', whiteSpace: 'nowrap', display: 'inline-block' }}
                >
                  enue
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Progress Bar Container */}
        <div style={{ height: '20px', marginTop: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <AnimatePresence>
            {showProgress && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                style={{
                  width: '120px',
                  height: '2px',
                  background: 'rgba(255,255,255,0.15)',
                  borderRadius: '2px',
                  overflow: 'hidden'
                }}
              >
                <motion.div
                  initial={{ width: '0%' }}
                  animate={{ width: '100%' }}
                  transition={{ 
                    duration: 2.2, // spans from phase 1 through phase 3
                    ease: "easeInOut" 
                  }}
                  style={{
                    height: '100%',
                    background: '#ffffff',
                    borderRadius: '2px'
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </div>
    </motion.div>
  );
}

