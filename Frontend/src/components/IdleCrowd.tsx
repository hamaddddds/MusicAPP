import { useEffect, useRef } from 'react';

/** Adapted from Skiper UI / reuno-ui's Canvas Crowd (skiper39), retrieved via
 * 21st.dev MCP. Original walk concept: codepen.io/zadvorsky/pen/xxwbBQV.
 * Illustrations: Open Peeps. See THIRD_PARTY_NOTICES.md for attribution.
 * Uses a single time-based canvas loop, bounded crowd size, and visibility pause.
 */
export default function IdleCrowd() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const image = new Image();
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let width = 1, height = 1, ratio = 1, frame = 0, last = 0, elapsed = 0, loaded = false, disposed = false, visible = true;
    const people = Array.from({ length: 48 }, (_, i) => ({
      sprite: Math.floor(Math.random() * 105), phase: Math.random(),
      speed: .022 + Math.random() * .026, direction: Math.random() > .5 ? 1 : -1,
      depth: i / 47, bounce: Math.random() * Math.PI * 2,
    }));
    const draw = (now: number) => {
      frame = 0;
      if (disposed || !loaded || !visible || document.hidden) return;
      if (last && !motion.matches) elapsed += Math.min((now - last) / 1000, .05);
      last = now;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const sw = image.naturalWidth / 15, sh = image.naturalHeight / 7;
      for (const person of people) {
        const h = Math.min(220, height * (.28 + person.depth * .26));
        const w = h * sw / sh;
        const progress = (person.phase + elapsed * person.speed) % 1;
        const x = -w + progress * (width + w * 2);
        const y = height * (.76 + person.depth * .29) - h - Math.abs(Math.sin(elapsed * 7 + person.bounce)) * 5;
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.translate(person.direction === 1 ? x : width - x, y);
        ctx.scale(person.direction, 1);
        ctx.drawImage(image, person.sprite % 15 * sw, Math.floor(person.sprite / 15) * sh, sw, sh, 0, 0, w, h);
        ctx.restore();
      }
      if (!motion.matches) frame = requestAnimationFrame(draw);
    };
    const start = () => { cancelAnimationFrame(frame); last = 0; frame = requestAnimationFrame(draw); };
    const resize = () => {
      width = canvas.clientWidth; height = canvas.clientHeight;
      ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      start();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; start(); });
    intersection.observe(canvas);
    document.addEventListener('visibilitychange', start);
    motion.addEventListener('change', start);
    image.onload = () => { if (!disposed) { loaded = true; resize(); } };
    image.src = '/crowd-peeps.png';
    return () => {
      disposed = true; image.onload = null; cancelAnimationFrame(frame);
      observer.disconnect(); intersection.disconnect();
      document.removeEventListener('visibilitychange', start); motion.removeEventListener('change', start);
    };
  }, []);
  return <div className="idle-crowd" aria-label="Music Venue ambient crowd">
    <div className="idle-crowd-heading"><span className="eyebrow">MUSIC BRINGS US TOGETHER</span><h2>Everyone has a soundtrack.</h2><p>Stay a while. The music keeps going.</p></div>
    <canvas ref={ref} aria-hidden="true" />
    <span className="idle-crowd-credit">Canvas Crowd · Skiper UI / Open Peeps</span>
  </div>;
}
