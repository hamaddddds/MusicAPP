import { useEffect, useRef } from 'react';

// efferd's Dotted Surface (21st.dev), same scene without three.js: a 40×60 grid of points,
// 150 apart, waving on two sines, seen by a 60° camera at (0, 355, 1220) looking down -z.
const SEPARATION = 150, AMOUNTX = 40, AMOUNTY = 60, CAMERA_Y = 355, CAMERA_Z = 1220, POINT_SIZE = 8;
const FOCAL = 1 / Math.tan(Math.PI / 6);

/** The Settings "Dot motion" choices. */
export type DotMode = 'grid' | 'flow' | 'wave' | 'orbit';

interface Props {
  className?: string;
  color?: string;
  opacity?: number;
  mode?: DotMode;
  /** 0–1 energy (e.g. the playing song's bass) that swells the motion. */
  level?: { readonly current: number };
}

export default function DottedSurface({ className = '', color = '200,200,200', opacity = 1, mode = 'wave', level }: Props) {
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
    const dot = (x: number, y: number, size: number, alpha: number) => {
      context.globalAlpha = opacity * Math.min(1, alpha);
      context.fillRect(x - size / 2, y - size / 2, size, size);
    };

    const wave = (t: number, energy: number) => {
      // The original advances `count` 0.1 per frame; tie it to time so 144 Hz screens don't race.
      const count = t * 0.006;
      const aspect = width / height, half = height / 2;
      const amplitude = 50 * (1 + energy * 1.4);
      context.globalAlpha = opacity;
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
    };

    // Quiet Grid: a flat lattice drifting diagonally while soft bands of light sweep across it.
    const grid = (t: number, energy: number) => {
      const GAP = 26, drift = (t * 0.006) % GAP;
      for (let x = drift - GAP; x < width + GAP; x += GAP) {
        for (let y = drift - GAP; y < height + GAP; y += GAP) {
          const glow = 0.5 + 0.5 * Math.sin(x * 0.011 + y * 0.007 - t * 0.0011);
          dot(x, y, 1.6 + glow * 1.1, 0.14 + glow * glow * (0.45 + energy * 0.5));
        }
      }
    };

    // Dot Flow: the lattice is carried by a drifting sine field, so the dots stream and eddy.
    const flow = (t: number, energy: number) => {
      const GAP = 24, k = 0.0055, s = t * 0.00045, push = 1 + energy * 1.2, shift = (t * 0.02) % GAP;
      for (let gx = shift - GAP * 2; gx < width + GAP * 2; gx += GAP) {
        for (let gy = -GAP * 2; gy < height + GAP * 2; gy += GAP) {
          const dx = (Math.sin(gy * k + s * 2.1) * 34 + Math.sin((gx + gy) * k * 0.7 - s * 1.3) * 20) * push;
          const dy = Math.cos(gx * k - s * 1.7) * 30 * push;
          const speed = Math.min(1, Math.hypot(dx, dy) / 58);
          dot(gx + dx, gy + dy, 1.3 + speed * 1.8, 0.1 + speed * 0.6);
        }
      }
    };

    // Orbit Field: rings of dots around the centre, turning in alternate directions, each with a travelling bright arc.
    const orbit = (t: number, energy: number) => {
      const cx = width / 2, cy = height * 0.46, maxR = Math.hypot(width, height) / 2 + 24;
      for (let r = 36, ring = 0; r < maxR; r += 30, ring++) {
        const n = Math.max(10, Math.round(2 * Math.PI * r / 15));
        const spin = t * 0.00018 * (ring % 2 ? -1 : 1) * (1.8 - r / maxR);
        const radius = r * (1 + energy * 0.05), fade = 1 - r / maxR;
        const head = t * 0.0005 * (1 + (ring % 3) * 0.4) + ring * 1.7;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + spin;
          const arc = Math.max(0, Math.cos(a - head)) ** 6;
          dot(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, 1.3 + arc * 1.8, (0.16 + arc * (0.7 + energy * 0.3)) * (0.35 + fade * 0.65));
        }
      }
    };

    const scene = { wave, grid, flow, orbit }[mode];
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);
      context.fillStyle = `rgb(${color})`;
      scene(reduced ? 0 : time, level?.current ?? 0);
      if (!reduced) frame = requestAnimationFrame(draw);
    };
    resize();
    const observer = new ResizeObserver(() => { resize(); if (reduced) draw(0); });
    observer.observe(canvas);
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [color, opacity, mode, level]);
  return <canvas ref={canvasRef} className={`dotted-surface ${className}`} aria-hidden="true" />;
}
