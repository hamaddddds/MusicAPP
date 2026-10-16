import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { extractPalette, type Palette } from '../lib/ambient';

// Ambient light, as YouTube's ambient mode does for video: the cover is painted once into a
// tiny canvas through a blur, and the browser's smooth upscale turns it into soft light.
// After that only opacity and transforms animate, so the glow costs almost nothing per frame.
const PAINT = 96, SAMPLE = 32, FADE_MS = 1600;

let canvasFilter: boolean | undefined;
/** WebView2 blurs inside the canvas; older WebKit ignores `ctx.filter`, so CSS blurs instead. */
function supportsCanvasFilter() {
  if (canvasFilter === undefined) {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) ctx.filter = 'blur(1px)';
    canvasFilter = ctx?.filter === 'blur(1px)';
  }
  return canvasFilter;
}

function loadImage(src: string, cors: boolean) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** CORS first so the colours can be read; a host without CORS headers still gets its glow. */
async function loadArtwork(src: string) {
  try { return { img: await loadImage(src, true), readable: true }; }
  catch { return { img: await loadImage(src, false), readable: false }; }
}

function readPalette(img: HTMLImageElement): Palette | null {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SAMPLE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
  try { return extractPalette(ctx.getImageData(0, 0, SAMPLE, SAMPLE).data); }
  catch { return null; } // tainted canvas
}

function paint(canvas: HTMLCanvasElement, img: HTMLImageElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, PAINT, PAINT);
  if (supportsCanvasFilter()) ctx.filter = `blur(${PAINT / 14}px) saturate(1.7) brightness(.85)`;
  // Overdraw past the edges so the blur does not pull transparent black in from outside.
  const pad = PAINT * 0.2;
  ctx.drawImage(img, -pad, -pad, PAINT + pad * 2, PAINT + pad * 2);
  ctx.filter = 'none';
}

type ReadyHandler = (id: number, result: { palette: Palette | null } | null) => void;

function Layer({ id, src, onReady }: { id: number; src: string; onReady: ReadyHandler }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    loadArtwork(src).then(({ img, readable }) => {
      if (!live || !ref.current) return;
      paint(ref.current, img);
      setReady(true);
      onReady(id, { palette: readable ? readPalette(img) : null });
    }, () => { if (live) onReady(id, null); });
    return () => { live = false; };
  }, [id, src, onReady]);
  return <canvas ref={ref} width={PAINT} height={PAINT}
    className={`ambient-layer${ready ? ' is-ready' : ''}${supportsCanvasFilter() ? '' : ' css-blur'}`} />;
}

interface Props {
  artwork?: string | null;
  /** 0–1 bass energy; the light swells with it. */
  level?: { readonly current: number };
  /** 0–1 brightness of the whole effect. */
  intensity?: number;
  /** The cover's colours, or null when they cannot be read. */
  onPalette?: (palette: Palette | null) => void;
  className?: string;
}

export default function AmbientBackdrop({ artwork, level, intensity = 1, onPalette, className = '' }: Props) {
  const [layers, setLayers] = useState<{ id: number; src: string }[]>([]);
  const nextId = useRef(0);
  const latest = useRef<{ id: number; src: string } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const timers = useRef(new Set<number>());
  const paletteRef = useRef(onPalette);
  paletteRef.current = onPalette;

  useEffect(() => {
    if (!artwork) { latest.current = null; setLayers([]); paletteRef.current?.(null); return; }
    if (latest.current?.src === artwork) return;
    const layer = { id: nextId.current++, src: artwork };
    latest.current = layer;
    setLayers(prev => [...prev.slice(-2), layer]);
  }, [artwork]);

  // The newest cover fades in over the old ones, which are dropped once it covers them.
  const handleReady = useCallback<ReadyHandler>((id, result) => {
    if (!result) { setLayers(prev => prev.filter(layer => layer.id !== id)); return; } // unreachable cover: keep the old light
    if (id !== latest.current?.id) return; // a skipped song finished loading late
    paletteRef.current?.(result.palette);
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setLayers(prev => prev.filter(layer => layer.id >= id));
    }, FADE_MS);
    timers.current.add(timer);
  }, []);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !level || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0, last = -1;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const beat = Math.round(level.current * 100) / 100;
      if (beat !== last) { last = beat; el.style.setProperty('--beat', String(beat)); }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [level]);

  return (
    <div ref={rootRef} className={`ambient-backdrop ${className}`} style={{ '--amb-intensity': intensity } as CSSProperties} aria-hidden="true">
      <div className={`ambient-idle${layers.length ? '' : ' is-on'}`}><i /><i /><i /></div>
      <div className="ambient-stack">
        {layers.map(layer => <Layer key={layer.id} id={layer.id} src={layer.src} onReady={handleReady} />)}
      </div>
      <div className="ambient-bloom" />
      <div className="ambient-veil" />
    </div>
  );
}
