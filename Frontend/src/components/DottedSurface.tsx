import { useEffect, useRef } from 'react';

// efferd's Dotted Surface (21st.dev), same scene without three.js: a 40×60 grid of points,
// 150 apart, waving on two sines, seen by a 60° camera at (0, 355, 1220) looking down -z.
const SEPARATION = 150, AMOUNTX = 40, AMOUNTY = 60, CAMERA_Y = 355, CAMERA_Z = 1220, POINT_SIZE = 8;
const FOCAL = 1 / Math.tan(Math.PI / 6);

interface Props {
  className?: string;
  color?: string;
  opacity?: number;
  /** 0–1 energy (e.g. the playing song's bass) that swells the wave. */
  level?: { readonly current: number };
}

export default function DottedSurface({ className = '', color = '200,200,200', opacity = 1, level }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    let frame = 0, width = 1, height = 1;
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, canvas.clientWidth);
      height = Math.max(1, canvas.clientHeight);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const draw = (time: number) => {
      // The original advances `count` 0.1 per frame; tie it to time so 144 Hz screens don't race.
      const count = reduced ? 0 : time * 0.006;
      const aspect = width / height, half = height / 2;
      const amplitude = 50 * (1 + (level?.current ?? 0) * 1.4);
      context.clearRect(0, 0, width, height);
      context.fillStyle = `rgba(${color},${opacity})`;
      for (let ix = 0; ix < AMOUNTX; ix++) {
        const x = ix * SEPARATION - (AMOUNTX * SEPARATION) / 2;
        const waveX = Math.sin((ix + count) * 0.3) * amplitude;
        for (let iy = 0; iy < AMOUNTY; iy++) {
          const depth = CAMERA_Z - (iy * SEPARATION - (AMOUNTY * SEPARATION) / 2);
          if (depth < 1) continue; // behind the near plane
          const y = waveX + Math.sin((iy + count) * 0.5) * amplitude;
          const sx = ((FOCAL / aspect) * x / depth + 1) * width / 2;
          const sy = (1 - FOCAL * (y - CAMERA_Y) / depth) * half;
          const size = POINT_SIZE * half / depth; // PointsMaterial sizeAttenuation
          if (sx < -size || sx > width + size || sy < -size || sy > height + size) continue;
          context.fillRect(sx - size / 2, sy - size / 2, size, size);
        }
      }
      if (!reduced) frame = requestAnimationFrame(draw);
    };
    resize();
    const observer = new ResizeObserver(() => { resize(); if (reduced) draw(0); });
    observer.observe(canvas);
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [color, opacity, level]);
  return <canvas ref={canvasRef} className={`dotted-surface ${className}`} aria-hidden="true" />;
}
