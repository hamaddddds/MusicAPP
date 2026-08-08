import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface SplashIntroProps {
  onComplete: () => void;
}

export default function SplashIntro({ onComplete }: SplashIntroProps) {
  const [phase, setPhase] = useState(0);
  const [statusText, setStatusText] = useState('Loading...');
  const backendReady = useRef(false);

  useEffect(() => {
    let t1: NodeJS.Timeout, t2: NodeJS.Timeout, statusT1: NodeJS.Timeout, statusT2: NodeJS.Timeout;
    
    // Phase 0 -> 1: MV appears from bottom (0.5s)
    t1 = setTimeout(() => setPhase(1), 500);
    // Phase 1 -> 2: Progress bar starts, text splits (at 1.0s)
    t2 = setTimeout(() => {
      setPhase(2);
      checkBackend();
    }, 1000);

    // Status morphing timeouts (if backend hasn't responded yet)
    statusT1 = setTimeout(() => {
      if (!backendReady.current) setStatusText('Turn on machine...');
    }, 2500);
    statusT2 = setTimeout(() => {
      if (!backendReady.current) setStatusText('Just lil bit wait...');
    }, 5000);

    // Backend check function
    const checkBackend = async () => {
      let isReady = false;
      let attempts = 0;
      
      while (!isReady && attempts < 20) { // Max 10 seconds (20 * 500ms)
        try {
          const res = await fetch('http://127.0.0.1:8000/docs');
          if (res.ok || res.status === 200 || res.status === 404) {
            // Any response from port 8000 means uvicorn is alive
            isReady = true;
          }
        } catch (e) {
          // Connection refused, meaning backend not ready
        }
        
        if (isReady) {
          backendReady.current = true;
          setStatusText('Done');
          // Give it a brief moment to show "Done"
          setTimeout(() => {
            setPhase(3); // Collapse text
            setTimeout(() => onComplete(), 500); // Finish intro
          }, 600);
          break;
        }
        
        attempts++;
        await new Promise(r => setTimeout(r, 500));
      }
      
      // Fallback if backend failed to start after 10s so user isn't stuck forever
      if (!isReady) {
        backendReady.current = true;
        setStatusText('Done');
        setTimeout(() => {
          setPhase(3);
          setTimeout(() => onComplete(), 500);
        }, 600);
      }
    };

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(statusT1);
      clearTimeout(statusT2);
    };
  }, [onComplete]);

  // Phase 0: Hidden
  // Phase 1: MV at center, progress bar appears
  // Phase 2: Split to Music Venue and Ping Backend
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

        {/* Progress Bar & Status Text Container */}
        <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', height: '40px' }}>
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
                  overflow: 'hidden',
                  marginBottom: '10px'
                }}
              >
                {/* Indeterminate pulsing progress for realism */}
                <motion.div
                  initial={{ x: '-100%' }}
                  animate={{ x: '100%' }}
                  transition={{ 
                    duration: 1.5, 
                    ease: "linear",
                    repeat: Infinity
                  }}
                  style={{
                    width: '60%',
                    height: '100%',
                    background: '#ffffff',
                    borderRadius: '2px'
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {showProgress && (
              <motion.div
                key={statusText}
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 5 }}
                transition={{ duration: 0.3 }}
                style={{
                  color: 'rgba(255,255,255,0.5)',
                  fontSize: '0.8rem',
                  fontFamily: 'Inter, sans-serif',
                  letterSpacing: '0.5px'
                }}
              >
                {statusText}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </div>
    </motion.div>
  );
}
