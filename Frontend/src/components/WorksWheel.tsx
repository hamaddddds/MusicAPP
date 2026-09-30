import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play } from "lucide-react";

export interface WheelItem { id: string; title: string; subtitle?: string; image: string }

// Proportions from crafterui's Works Wheel (21st.dev), with square cards for album art.
const CARD = 0.29, CARD_MAX_W = 0.3, STEP_DEG = 40, DRUM = 2.22, DEPTH = 2.7, RING = 1.14, BOW = 1.82, VISIBLE = 1.6, EASE = 0.12;
const WHEEL_PX = 500, DRAG_PX = 320, SNAP_MS = 140;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const bowAt = (deg: number, bow: number) => -bow * (1 - Math.cos(deg * Math.PI / 180));
/** Blend a card from its ring pose (open = 0) into its drum pose (open = 1). */
const place = (ringDeg: number, drumDeg: number, ringR: number, drumR: number, bow: number, open: number) =>
  `translateX(${open * bowAt(drumDeg, bow)}px) rotateZ(${(1 - open) * ringDeg}deg) translateY(${-(1 - open) * ringR}px) rotateX(${open * drumDeg}deg) translateZ(${open * drumR}px)`;

/**
 * Covers sit in a ring around the title; scroll, drag or arrow keys open them into a 3D drum
 * you turn one track at a time. Clicking the front cover plays it.
 */
export default function WorksWheel({ items, label, onPlay }: { items: WheelItem[]; label: string; onPlay: (index: number) => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const drum = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const title = useRef<HTMLDivElement>(null);
  const caption = useRef<HTMLDivElement>(null);
  const current = useRef(0), target = useRef(0), frame = useRef(0), snap = useRef(0);
  const drag = useRef<{ y: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const [active, setActive] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const count = items.length, last = Math.max(count - 1, 0);

  useEffect(() => {
    const el = stage.current!;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    const card = Math.min(size.h * CARD, size.w * CARD_MAX_W);
    const ringR = card * RING;
    const ringScale = count ? clamp(2 * Math.PI * ringR / count * 0.82 / (card || 1), 0.16, 1) : 1;
    return { card, ringR, ringScale, drumR: card * DRUM, bow: card * BOW, depth: card * DEPTH };
  }, [size, count]);

  // The latest pose function, so the running animation always uses the current layout.
  const step = useRef(() => {});
  step.current = () => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const delta = target.current - current.current;
    current.current = Math.abs(delta) < 5e-4 || reduced ? target.current : current.current + delta * EASE;
    const open = clamp(current.current, 0, 1), at = Math.max(0, current.current - 1);
    const { ringR, ringScale, drumR, bow } = layout;
    if (drum.current) drum.current.style.transform = `translateZ(${-open * drumR}px)`;
    for (let i = 0; i < count; i++) {
      const card = cards.current[i];
      if (!card) continue;
      const offset = i - at;
      card.style.transform = place(offset * (360 / count), offset * STEP_DEG, ringR, drumR, bow, open);
      card.style.opacity = open > 0.5 && Math.abs(offset) > VISIBLE ? "0" : "1";
      card.style.zIndex = String(Math.round(100 - Math.abs(offset) * 2));
      (card.firstElementChild as HTMLElement).style.transform = `scale(${ringScale + (1 - ringScale) * open})`;
    }
    if (title.current) title.current.style.opacity = String(1 - open);
    if (caption.current) caption.current.style.opacity = String(open);
    stage.current?.toggleAttribute("data-open", open > 0.5);
    const front = clamp(Math.round(at), 0, last);
    setActive(a => a === front ? a : front);
    frame.current = current.current === target.current ? 0 : requestAnimationFrame(() => step.current());
  };
  const kick = useCallback(() => { if (!frame.current) frame.current = requestAnimationFrame(() => step.current()); }, []);
  const go = useCallback((value: number) => { target.current = clamp(value, 0, last + 1); kick(); }, [last, kick]);

  useEffect(() => { kick(); }, [layout, items, kick]);
  useEffect(() => () => { cancelAnimationFrame(frame.current); frame.current = 0; clearTimeout(snap.current); }, []);

  useEffect(() => {
    const el = stage.current!;
    const onWheel = (event: WheelEvent) => {
      const next = target.current + event.deltaY / WHEEL_PX;
      // Past either end the page scrolls normally.
      if (next > 0 && next < last + 1) event.preventDefault();
      go(next);
      clearTimeout(snap.current);
      // Settle in the direction of travel, so one notch moves one cover instead of springing back.
      const down = event.deltaY > 0;
      snap.current = window.setTimeout(() => go(down ? Math.floor(target.current + 0.88) : Math.ceil(target.current - 0.88)), SNAP_MS);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [go, last]);

  const choose = (i: number) => {
    if (dragged.current) return;
    if (target.current >= 1 && Math.round(target.current - 1) === i) onPlay(i);
    else go(i + 1);
  };
  const item = items[active];
  const card = layout.card;

  return <section className="wheel" aria-label={label}>
    <div ref={stage} className="wheel-stage" tabIndex={0} role="listbox" aria-label={label} aria-activedescendant={`wheel-${active}`}
      style={{ perspective: `${layout.depth}px` }}
      onPointerDown={e => { drag.current = { y: e.clientY, moved: false }; dragged.current = false; }}
      onPointerMove={e => {
        const d = drag.current;
        if (!d || (!d.moved && Math.abs(e.clientY - d.y) < 4)) return;
        if (!d.moved) { d.moved = dragged.current = true; e.currentTarget.setPointerCapture(e.pointerId); }
        go(target.current + (d.y - e.clientY) / DRAG_PX);
        d.y = e.clientY;
      }}
      onPointerUp={() => { if (drag.current?.moved) go(Math.round(target.current)); drag.current = null; }}
      onKeyDown={e => {
        if (e.key === "ArrowDown") go(Math.round(target.current) + 1);
        else if (e.key === "ArrowUp") go(Math.round(target.current) - 1);
        else if (e.key === "Escape") go(0);
        else if (e.key === "Enter" && target.current >= 1) onPlay(active);
        else return;
        e.preventDefault();
      }}>
      <div ref={drum} className="wheel-drum">
        {items.map((it, i) => <button key={it.id} id={`wheel-${i}`} type="button" role="option" aria-selected={i === active} aria-label={`${it.title}${it.subtitle ? `, ${it.subtitle}` : ""}`}
          ref={el => { cards.current[i] = el; }} className="wheel-card" tabIndex={-1} onClick={() => choose(i)}
          style={{ width: card, height: card, marginLeft: -card / 2, marginTop: -card / 2 }}>
          <span className="wheel-cover">
            <img src={it.image} alt="" draggable={false} />
            <span className="wheel-play"><Play size={12} fill="currentColor" /> Play</span>
          </span>
        </button>)}
      </div>
    </div>
    <div ref={title} className="wheel-title"><strong>{label}</strong><small>{String(count).padStart(2, "0")} tracks</small><small className="wheel-hint">scroll to spin</small></div>
    <div ref={caption} className="wheel-caption" style={{ opacity: 0, maxWidth: Math.max(90, size.w / 2 - card / 2 - 48) }}>
      <small>{String(active + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}</small>
      <strong>{item?.title}</strong>
      <span>{item?.subtitle}</span>
    </div>
    <ol className="wheel-index">
      {items.map((it, i) => <li key={it.id}><button type="button" className={i === active ? "on" : ""} onClick={() => go(i + 1)}>{it.title}</button></li>)}
    </ol>
  </section>;
}
