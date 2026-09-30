import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { ChevronLeft, ChevronRight, Clock, Languages, Mic2, Minus, Plus, RefreshCw } from "lucide-react";
import { injectRomanization, injectTranslation } from "@braccato/core";
import "@braccato/core/element";
import type { BraccatoLyricsElement } from "@braccato/core/element";
import "@braccato/core/styles/variables.css";
import "@braccato/core/styles/lyrics.css";
import "@braccato/core/styles/instrumental.css";
import theme from "./eblp.css?raw";
import { translateLines, type Lyrics } from "../lib/lyrics";

interface Props {
  sources: Lyrics[] | null;
  loading: boolean;
  audioRef: RefObject<HTMLAudioElement | null>;
  /** Seconds; positive shows lyrics later (Better Lyrics' convention). */
  offset: number;
  onOffsetChange: Dispatch<SetStateAction<number>>;
}

const LANGUAGES: [string, string][] = [["en", "English"], ["id", "Indonesia"], ["ja", "日本語"], ["ko", "한국어"], ["zh-CN", "中文"], ["es", "Español"], ["pt", "Português"], ["fr", "Français"], ["de", "Deutsch"], ["ar", "العربية"], ["hi", "हिन्दी"], ["th", "ไทย"], ["vi", "Tiếng Việt"], ["ru", "Русский"]];
const saved = <T,>(key: string, fallback: T): T => { try { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); } catch { return fallback; } };

/** Better Lyrics' own renderer (@braccato/core) with the Even Better Lyrics Plus theme and its lyrics dock. */
export default function SyncedLyrics({ sources, loading, audioRef, offset, onOffsetChange }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const mount = useRef<HTMLDivElement>(null);
  const view = useRef<BraccatoLyricsElement | null>(null);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [userScrolling, setUserScrolling] = useState(false);
  const [translate, setTranslate] = useState(() => saved("mv:lyrics-translate", false));
  const [romanize, setRomanize] = useState(() => saved("mv:lyrics-romanize", true));
  const [language, setLanguage] = useState(() => saved("mv:lyrics-language", navigator.language.startsWith("id") ? "id" : "en"));
  const [translated, setTranslated] = useState<(string | null)[] | null>(null);
  const lyrics = sources?.[sourceIndex] ?? null;
  const count = sources?.length ?? 0;

  useEffect(() => setSourceIndex(0), [sources]);

  useEffect(() => {
    localStorage.setItem("mv:lyrics-translate", JSON.stringify(translate));
    localStorage.setItem("mv:lyrics-romanize", JSON.stringify(romanize));
    localStorage.setItem("mv:lyrics-language", JSON.stringify(language));
  }, [translate, romanize, language]);

  useEffect(() => {
    const el = document.createElement("braccato-lyrics") as BraccatoLyricsElement;
    el.host = { getScrollElement: () => scroller.current };
    el.theme = theme;
    el.source = audioRef.current;
    const onScrollState = (event: Event) => setUserScrolling((event as CustomEvent<{ userScrolling: boolean }>).detail.userScrolling);
    el.addEventListener("braccato:scroll-state", onScrollState);
    mount.current!.appendChild(el);
    view.current = el;
    return () => { el.removeEventListener("braccato:scroll-state", onScrollState); el.remove(); view.current = null; };
  }, [audioRef]);

  useEffect(() => { if (view.current) view.current.tickOptions = { lyricOffset: offset, passiveScrollEnabled: true }; }, [offset]);

  useEffect(() => {
    setTranslated(null);
    if (!translate || !lyrics?.lines.length) return;
    const controller = new AbortController();
    translateLines(lyrics.lines.map(line => line.words), language, controller.signal).then(setTranslated).catch(() => {});
    return () => controller.abort();
  }, [lyrics, translate, language]);

  // Rebuilding the lines is how decorations come off again when a toggle turns them off.
  useEffect(() => {
    const el = view.current;
    if (!el) return;
    el.lyricsOptions = { language: lyrics?.language, songwriters: lyrics?.songwriters };
    el.lyrics = lyrics?.lines ?? [];
    const renderer = el.renderer;
    if (!renderer || !lyrics?.lines.length || !(romanize || translate)) return;
    renderer.lines.forEach((line, i) => {
      const lyric = lyrics.lines[i];
      if (romanize && lyric.romanization && lyric.romanization !== lyric.words) {
        injectRomanization(document, line.lyricElement, line, lyric.romanization, lyric.timedRomanization ?? null);
      }
      const own = lyric.translations?.[language] ?? (lyric.translation?.lang === language ? lyric.translation.text : undefined);
      const text = translate ? own ?? translated?.[i] : null;
      if (text) injectTranslation(document, line.lyricElement, text, language);
    });
    renderer.relayout(true);
  }, [lyrics, romanize, translate, translated, language]);

  const nudge = (delta: number) => onOffsetChange(value => Math.round(Math.max(-10, Math.min(10, value + delta)) * 10) / 10);
  const hasRomanization = !!lyrics?.lines.some(line => line.romanization);
  return <section className="lyrics-stage" aria-label="Song lyrics">
    <div className="lyrics-scroll" ref={scroller}>
      <div ref={mount} />
      {loading ? <div className="lyrics-message"><RefreshCw className="spin" size={24} /><p>Finding the words…</p></div>
        : !lyrics?.lines.length && <div className="lyrics-message"><Mic2 size={30} /><p>No lyrics for this one yet.</p><span>Enjoy the music. Lyrics will appear when available.</span></div>}
    </div>
    {lyrics && <div className="lyrics-dock">
      {userScrolling && <><button className="dock-btn" onClick={() => view.current?.renderer?.resumeAutoscroll()} title="Resume sync"><RefreshCw size={14} /></button><span className="dock-sep" /></>}
      {count > 1 && <button className="dock-btn" aria-label="Previous lyrics source" onClick={() => setSourceIndex((sourceIndex + count - 1) % count)}><ChevronLeft size={14} /></button>}
      <span className="dock-source">{lyrics.source}<small>{sourceIndex + 1}/{count}</small></span>
      {count > 1 && <button className="dock-btn" aria-label="Next lyrics source" onClick={() => setSourceIndex((sourceIndex + 1) % count)}><ChevronRight size={14} /></button>}
      <span className="dock-sep" />
      {hasRomanization && <button className={`dock-btn ${romanize ? "on" : ""}`} onClick={() => setRomanize(!romanize)} aria-pressed={romanize} title="Romanization">Aa</button>}
      <button className={`dock-btn ${translate ? "on" : ""}`} onClick={() => setTranslate(!translate)} aria-pressed={translate} title="Translate lyrics"><Languages size={15} /></button>
      {translate && <select className="dock-select" value={language} onChange={e => setLanguage(e.target.value)} aria-label="Translation language">
        {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
      </select>}
      <span className="dock-sep" />
      <Clock size={14} className="dock-icon" aria-hidden />
      <button className="dock-btn" aria-label="Show lyrics earlier" title="Earlier (Shift: 1s)" onClick={e => nudge(e.shiftKey ? -1 : -0.1)}><Minus size={14} /></button>
      <button className="dock-offset" title="Reset timing" onClick={() => onOffsetChange(0)}>{offset > 0 ? "+" : ""}{offset.toFixed(1)}s</button>
      <button className="dock-btn" aria-label="Show lyrics later" title="Later (Shift: 1s)" onClick={e => nudge(e.shiftKey ? 1 : 0.1)}><Plus size={14} /></button>
    </div>}
  </section>;
}
