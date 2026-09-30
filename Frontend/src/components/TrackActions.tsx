import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export default function TrackActions({ x, y, title, onClose, children }: {
  x: number; y: number; title: string; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
    menu.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [x, y]);
  return createPortal(
    <div ref={ref} className="ctx-menu" role="dialog" aria-label={`Actions for ${title}`}
      style={{ left: x, top: y }} onClick={e => e.stopPropagation()}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          const items = Array.from(ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
          const current = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }
        if (e.key === 'Tab') onClose();
      }}>
      <div className="ctx-track-label">{title}</div>
      {children}
    </div>, document.body,
  );
}
