import { useEffect, useRef, useState, type RefObject } from "react";
import { Mic2, RefreshCw } from "lucide-react";
import { activeLineAt, type Lyrics } from "../lib/lyrics";

interface Props {
  lyrics: Lyrics | null;
  loading: boolean;
  audioRef: RefObject<HTMLAudioElement | null>;
  offset: number;
}

export default function SyncedLyrics({ lyrics, loading, audioRef, offset }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(-1);
  const [following, setFollowing] = useState(true);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => { setFollowing(true); setActive(-1); }, [lyrics]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !lyrics?.synced.length) return;
    let frame = 0;
    const paint = () => {
      const time = audio.currentTime + offset;
      const index = activeLineAt(lyrics.synced, time);
      setActive(previous => previous === index ? previous : index);
      const row = container.current?.querySelectorAll<HTMLElement>(".lyric-line")[index];
      row?.querySelectorAll<HTMLElement>(".lyric-word").forEach((word, i) => {
        const part = lyrics.synced[index].parts[i];
        const amount = reduced ? 1 : part.d > 0 ? Math.min(1, Math.max(0, (time - part.t) / part.d)) : Number(time >= part.t);
        word.style.setProperty("--word-progress", `${amount * 100}%`);
      });
    };
    const tick = () => { paint(); if (!audio.paused && !audio.ended) frame = requestAnimationFrame(tick); };
    const restart = () => { cancelAnimationFrame(frame); tick(); };
    ["play", "pause", "seeking", "seeked", "timeupdate", "loadedmetadata", "ended"].forEach(event => audio.addEventListener(event, restart));
    restart();
    return () => {
      cancelAnimationFrame(frame);
      ["play", "pause", "seeking", "seeked", "timeupdate", "loadedmetadata", "ended"].forEach(event => audio.removeEventListener(event, restart));
    };
  }, [lyrics, audioRef, offset, reduced]);

  useEffect(() => {
    const el = container.current;
    if (!el || !following) return;
    const center = () => {
      const line = el.querySelectorAll<HTMLElement>(".lyric-line")[Math.max(0, active)];
      if (!line) return;
      el.scrollTo({ top: Math.max(0, el.scrollTop + line.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientHeight * 0.4), behavior: reduced ? "instant" : "smooth" });
    };
    center();
    const resize = new ResizeObserver(center);
    resize.observe(el);
    return () => resize.disconnect();
  }, [active, following, lyrics, reduced]);

  return <section className="lyrics-stage" aria-label="Song lyrics">
    <div className="lyrics-toolbar">
      <span><Mic2 size={13} /> {lyrics?.source || "Lyrics"}</span>
      {lyrics?.synced.length ? <button className={`follow-lyrics ${following ? "on" : ""}`} onClick={() => setFollowing(!following)} aria-pressed={following}>
        <RefreshCw size={12} /> {following ? "Live lyrics" : "Resume sync"}
      </button> : null}
    </div>
    <div className="lyrics-scroll" ref={container} onWheel={() => setFollowing(false)} onTouchMove={() => setFollowing(false)}>
      {loading ? <div className="lyrics-message"><RefreshCw className="spin" size={24} /><p>Finding the words…</p></div> : lyrics?.synced.length ?
        <div className="lyrics-flow">{lyrics.synced.map((line, i) => <button key={i} type="button" dir="auto"
          className={`lyric-line ${i === active ? "is-active" : ""} ${i < active ? "is-past" : ""}`}
          aria-current={i === active ? "true" : undefined} aria-label={`Seek to ${line.text || "instrumental"}`}
          onClick={() => { const audio = audioRef.current; if (audio && audio.readyState > 0) { audio.currentTime = Math.max(0, Math.min(Number.isFinite(audio.duration) ? audio.duration : Infinity, line.t - offset)); setFollowing(true); } }}>
          <span className="lyric-primary">{line.parts.length ? line.parts.map((part, j) => <span key={j} className="lyric-word">{part.text}</span>) : line.text || <span className="instrumental-dots" aria-label="Instrumental">•••</span>}</span>
          {line.background && <span className="lyric-background">{line.background}</span>}
        </button>)}</div> : lyrics?.plain ? <div className="lyric-plain"><small>Timing is unavailable for this song</small>{lyrics.plain}</div> :
          <div className="lyrics-message"><Mic2 size={30} /><p>No lyrics for this one yet.</p><span>Enjoy the music. Lyrics will appear when available.</span></div>}
    </div>
    <p className="lyrics-caption">{lyrics?.notice || (lyrics?.synced.length ? "Tap a line to jump to that moment" : "")}</p>
  </section>;
}
