import { useEffect, useRef, useState, type RefObject } from "react";
import { Languages, Mic2, RefreshCw } from "lucide-react";
import { injectRomanization, injectTranslation } from "@braccato/core";
import "@braccato/core/element";
import type { BraccatoLyricsElement } from "@braccato/core/element";
import "@braccato/core/styles/variables.css";
import "@braccato/core/styles/lyrics.css";
import "@braccato/core/styles/instrumental.css";
import theme from "./eblp.css?raw";
import { translateLines, type Lyrics } from "../lib/lyrics";

interface Props {
  lyrics: Lyrics | null;
  loading: boolean;
  audioRef: RefObject<HTMLAudioElement | null>;
  offset: number;
}

const LANGUAGES: [string, string][] = [["en", "English"], ["id", "Indonesia"], ["ja", "日本語"], ["ko", "한국어"], ["zh-CN", "中文"], ["es", "Español"], ["pt", "Português"], ["fr", "Français"], ["de", "Deutsch"], ["ar", "العربية"], ["hi", "हिन्दी"], ["th", "ไทย"], ["vi", "Tiếng Việt"], ["ru", "Русский"]];
const saved = <T,>(key: string, fallback: T): T => { try { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); } catch { return fallback; } };

/** Better Lyrics' own renderer (@braccato/core) with the Even Better Lyrics Plus theme. */
export default function SyncedLyrics({ lyrics, loading, audioRef, offset }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const mount = useRef<HTMLDivElement>(null);
  const view = useRef<BraccatoLyricsElement | null>(null);
  const [userScrolling, setUserScrolling] = useState(false);
  const [translate, setTranslate] = useState(() => saved("mv:lyrics-translate", false));
  const [romanize, setRomanize] = useState(() => saved("mv:lyrics-romanize", true));
  const [language, setLanguage] = useState(() => saved("mv:lyrics-language", navigator.language.startsWith("id") ? "id" : "en"));
  const [translated, setTranslated] = useState<(string | null)[] | null>(null);

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

  // The engine subtracts its offset from the clock; the app's offset setting advances lyrics.
  useEffect(() => { if (view.current) view.current.tickOptions = { lyricOffset: -offset, passiveScrollEnabled: true }; }, [offset]);

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

  const hasRomanization = !!lyrics?.lines.some(line => line.romanization);
  return <section className="lyrics-stage" aria-label="Song lyrics">
    <div className="lyrics-toolbar">
      <span><Mic2 size={13} /> {lyrics?.source || "Lyrics"}</span>
      {lyrics?.lines.length ? <div className="lyrics-actions">
        {hasRomanization && <button className={`follow-lyrics ${romanize ? "on" : ""}`} onClick={() => setRomanize(!romanize)} aria-pressed={romanize} title="Romanization">Aa</button>}
        <button className={`follow-lyrics ${translate ? "on" : ""}`} onClick={() => setTranslate(!translate)} aria-pressed={translate} title="Translate lyrics"><Languages size={12} /> Translate</button>
        {translate && <select className="lyrics-language" value={language} onChange={e => setLanguage(e.target.value)} aria-label="Translation language">
          {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>}
        {userScrolling && <button className="follow-lyrics" onClick={() => view.current?.renderer?.resumeAutoscroll()}><RefreshCw size={12} /> Resume sync</button>}
      </div> : null}
    </div>
    <div className="lyrics-scroll" ref={scroller}>
      <div ref={mount} />
      {loading ? <div className="lyrics-message"><RefreshCw className="spin" size={24} /><p>Finding the words…</p></div>
        : !lyrics?.lines.length && <div className="lyrics-message"><Mic2 size={30} /><p>No lyrics for this one yet.</p><span>Enjoy the music. Lyrics will appear when available.</span></div>}
    </div>
  </section>;
}
