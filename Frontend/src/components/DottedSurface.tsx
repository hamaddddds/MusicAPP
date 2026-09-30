import { useEffect, useRef } from 'react';

/** A dependency-free adaptation of the Dotted Surface wave: a sparse perspective field that moves like water. */
export default function DottedSurface({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    let frame = 0;
    let width = 0;
    let height = 0;
    let ratio = 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);
      const cols = Math.max(28, Math.min(58, Math.round(width / 23)));
      const rows = Math.max(16, Math.min(32, Math.round(height / 25)));
      const gapX = width / (cols + 1);
      const gapY = height / (rows + 1);
      for (let row = 0; row < rows; row++) {
        const depth = row / rows;
        for (let col = 0; col < cols; col++) {
          const x = (col + 1) * gapX;
          const wave = Math.sin(col * .28 + time * .0008) * (5 + depth * 10) + Math.cos(row * .42 + time * .00055) * 3;
          const y = (row + 1) * gapY + wave;
          const perspective = .55 + depth * .85;
          const distance = Math.abs(y - height * .5) / (height * .5);
          const alpha = Math.max(.06, (.34 - distance * .2) * perspective);
          context.beginPath();
          context.fillStyle = `rgba(238,238,238,${alpha.toFixed(3)})`;
          context.arc(x, y, .75 + perspective * .55, 0, Math.PI * 2);
          context.fill();
        }
      }
      frame = requestAnimationFrame(draw);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);
  return <canvas ref={canvasRef} className={`dotted-surface ${className}`} aria-hidden="true" />;
}
