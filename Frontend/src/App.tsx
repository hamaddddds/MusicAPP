import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Pause, SkipForward, SkipBack,
  Volume2, Volume1, VolumeX, Search, Home, Heart, Radio, Clock,
  X, Minus, Square, Maximize, Repeat, Repeat1, Shuffle,
  ListMusic, Mic2, ChevronRight, ChevronDown, MoreHorizontal, Sparkles,
  ListPlus, CornerDownRight, Download, Share2, User, Ban, RefreshCw,
  Settings, Palette, Sun, Moon, Monitor, Upload, Check, LogIn, Mail,
  UserCircle, Gamepad2, ChevronLeft
} from "lucide-react";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";

// ... Types ...
interface Track { videoId: string; title: string; artist: string; artwork: string; }
type RepeatMode = "off" | "all" | "one";
type ShuffleMode = "off" | "random" | "smart";
interface WordPart { t: number; d: number; text: string } // t start, d duration (seconds)
interface SyncedLine { t: number; end?: number; text: string; parts: WordPart[] } // parts synthesized when empty
interface Lyrics { synced: SyncedLine[]; plain: string }
interface HistEntry extends Track { count: number; last: number; }
interface Region { country: string | null; countryCode: string | null; city: string | null; }
interface CtxMenu { x: number; y: number; track: Track; context: Track[]; }
interface UpdateInfo { version: string; obj: any; }
interface ArtistHead { artistId: string; name: string; thumbnails: any[]; subscribers?: string | null; }
interface ArtistPage { artist: ArtistHead | null; songs: Track[]; albums: any[]; singles: any[]; }

const isTauri = "__TAURI_INTERNALS__" in window;
const API_URL = "http://127.0.0.1:8000";
const prefersReduced =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;


const PROVIDERS = [
  { id: "google", label: "Google", Icon: LogIn },
  { id: "github", label: "GitHub", Icon: LogIn },
  { id: "email", label: "Email", Icon: Mail },
  { id: "discord", label: "Discord", Icon: Gamepad2, ChevronLeft },
];

// ... localStorage helpers ...
const load = <T,>(k: string, fallback: T): T => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
};

// ... Track mapping / algorithms ...
// YouTube Music serves tiny thumbnails (60...120px). Google's image CDN lets us
// request a bigger size by rewriting the URL params, so artwork stays crisp.
function hiResThumb(url: string, size = 512): string {
  if (!url) return url;
  // i.ytimg video thumbnails: use the clean hqdefault (480px), drop crop query.
  const m = url.match(/i\.ytimg\.com\/vi\/([^/]+)\//);
  if (m) return `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`;
  // Google CDN album/artist art: request a larger size via the URL params.
  if (/googleusercontent\.com|ggpht\.com/.test(url)) {
    if (/=w\d+-h\d+/.test(url)) return url.replace(/=w\d+-h\d+[^=]*$/i, `=w${size}-h${size}-l90-rj`);
    if (/=s\d+/.test(url)) return url.replace(/=s\d+[^=]*$/i, `=s${size}`);
    return url + `=w${size}-h${size}-l90-rj`;
  }
  return url;
}

function pickArtwork(thumbnails: any[]): string {
  const url = thumbnails?.[thumbnails.length - 1]?.url || thumbnails?.[0]?.url;
  return url ? hiResThumb(url) : "https://picsum.photos/300";
}

function mapTracks(data: any): Track[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((item: any) => item.videoId)
    .map((item: any) => ({
      videoId: item.videoId,
      title: item.title || item.name || "Unknown Title",
      artist: (item.artists && item.artists[0]?.name) || "Unknown Artist",
      artwork: pickArtwork(item.thumbnails),
    }));
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function smartOrder(list: Track[], start: Track): Track[] {
  const pool = shuffleArray(list.filter((t) => t.videoId !== start.videoId));
  const result: Track[] = [start];
  while (pool.length) {
    const lastArtist = result[result.length - 1].artist;
    let idx = pool.findIndex((t) => t.artist !== lastArtist);
    if (idx === -1) idx = 0;
    result.push(pool.splice(idx, 1)[0]);
  }
  return result;
}

function parseLRC(lrc: string): SyncedLine[] {
  const out: SyncedLine[] = [];
  for (const raw of lrc.split("\n")) {
    const matches = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!matches.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of matches) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const frac = m[3] ? parseInt(m[3].padEnd(3, "0"), 10) / 1000 : 0;
      out.push({ t: min * 60 + sec + frac, text, parts: [] });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Word timings synthesized from a line when richsync is unavailable. When the
 * line has a known end time, words get proportional durations spanning [t, end]
 * so the karaoke swipe advances word-by-word left→right. Without an end time,
 * words are line-synced (d:0 → sweep over the line window). */
function synthParts(text: string, lineT: number, lineEnd?: number): WordPart[] {
  const tokens = (text.match(/\S+/g) ?? []);
  if (!tokens.length) return [];
  const span = (lineEnd ?? 0) - lineT;
  if (span > 0) {
    const nonWs = tokens.reduce((n, tk) => n + tk.length, 0) || 1;
    let cursor = 0;
    return tokens.map((tk) => {
      const wStart = lineT + (span * cursor) / nonWs;
      cursor += tk.length;
      const wEnd = lineT + (span * cursor) / nonWs;
      return { t: wStart, d: wEnd - wStart, text: tk };
    });
  }
  return tokens.map((w, i) => ({ t: lineT + i * 0.05, d: 0, text: w }));
}

/** Accepts the new backend shape ({lines:[{t,end,text,parts}]}) AND the legacy
 * shape ({synced: LRC-string, plain}), so old/new backends both work. */
function normalizeLyrics(d: any): Lyrics {
  const lines: SyncedLine[] = [];
  if (Array.isArray(d?.lines)) {
    for (const raw of d.lines) {
      if (!raw || typeof raw.t === "undefined") continue;
      const t = Number(raw.t);
      const end = raw.end != null ? Number(raw.end) : undefined;
      const text = String(raw.text ?? "");
      const rawParts: any[] = Array.isArray(raw.parts) ? raw.parts : [];
      const parts: WordPart[] = rawParts
        .filter((p: any) => p && typeof p.t === "number")
        .map((p: any) => ({ t: Number(p.t), d: Number(p.d ?? 0), text: String(p.text ?? "") }))
        .filter((p) => p.text.trim().length > 0);
      lines.push({ t, end, text, parts: parts.length ? parts : synthParts(text, t, end) });
    }
  } else if (typeof d?.synced === "string") {
    // Legacy: backend still returned LRC under 'synced'.
    lines.push(...parseLRC(d.synced).map((l) => ({ ...l, parts: synthParts(l.text, l.t) })));
  }
  return { synced: lines.sort((a, b) => a.t - b.t), plain: d?.plain || "" };
}

/** Karaoke "passing light" lyric animation. Each word span has a ::after overlay
 * (content: attr(data-content), solid white, background-clip:text) whose opacity
 * is driven by --lyric-lit (set inline on the word). Only the word currently
 * being sung is lit bright; past words fade back to dim and upcoming words stay
 * dim, so the eye tracks the active word as it advances left→right.
 *
 * We drive the custom prop directly on the word's inline style from a
 * requestAnimationFrame loop (pseudo-element WAAPI is dropped by some webviews).
 * The ::after inherits it, so the overlay re-computes every frame. The RAF loop
 * only runs while audio plays; it freezes on pause and re-seeds on seek. */
function useLyricAnimation(
  lines: SyncedLine[] | null,
  activeIndex: number,
  currentTime: number,
  isPlaying: boolean,
  containerRef: React.RefObject<HTMLDivElement | null>,
  syncEnabled = true,
) {
  // Latest currentTime, read by the RAF loop without re-running the effect.
  const timeRef = useRef(currentTime);
  timeRef.current = currentTime;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  // Drive the word swipes + line activation classes from a RAF loop.
  useEffect(() => {
    if (prefersReduced) return; // static reveal via CSS class instead
    const container = containerRef.current;
    if (!container) return;
    if (activeIndex < 0) return;
    const line = lines?.[activeIndex];
    if (!line) return;

    // Toggle active/past classes on the affected lines.
    const lineEls = container.querySelectorAll<HTMLElement>(".blyrics--line");
    const lo = Math.max(0, activeIndex - 1);
    const hi = Math.min(lineEls.length - 1, activeIndex + 1);
    for (let i = lo; i <= hi; i++) {
      const el = lineEls[i];
      if (!el) continue;
      el.classList.toggle("blyrics--active", i === activeIndex);
      el.classList.toggle("blyrics--past", i < activeIndex);
    }

    // Collect the active line's word spans directly from the DOM.
    const activeLineEl = container.querySelectorAll<HTMLElement>(".blyrics--line")[activeIndex];
    const wordNodes = activeLineEl
      ? [...activeLineEl.querySelectorAll<HTMLSpanElement>(".blyrics--word")]
      : [];
    const els: { el: HTMLSpanElement; t: number; d: number }[] = [];
    for (let j = 0; j < Math.min(wordNodes.length, line.parts.length); j++) {
      const part = line.parts[j];
      const el = wordNodes[j];
      if (!el) continue;
      els.push({ el, t: part.t, d: part.d });
    }
    if (!els.length) return;

    // Sweep window for line-synced (d:0) words — use the line's own duration
    // when known so the whole line lights progressively, not all at once.
    const lineDur = Math.max(0.3, (line.end ?? 0) - line.t || 0.6);

    let raf = 0;
    const tick = () => {
      const now = timeRef.current;

      // "Passing light" karaoke: only the word currently being sung is lit
      // bright; past words fade back to dim, upcoming words stay dim. A small
      // lead time lights each word slightly before its timestamp so the swipe
      // keeps up with the vocals (no perceived lag).
      const LEAD_MS = 0.08; // 80ms lead — word starts lighting a touch early
      for (const { el, t, d } of els) {
        const dur = d > 0 ? d : lineDur;
        const elapsed = now - t + LEAD_MS;
        let lit: number;
        if (elapsed <= 0) {
          lit = 0; // not yet sung
        } else if (elapsed < dur) {
          // currently being sung — shine bright, ramping up quickly
          lit = 0.5 + 0.5 * (elapsed / dur);
        } else {
          lit = 0; // already sung → fade back to dim
        }
        el.style.setProperty("--lyric-lit", lit.toFixed(3));
      }
      if (isPlayingRef.current) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [lines, activeIndex, containerRef]);

  // Auto-scroll the container so the active line sits ~37% from the top.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || activeIndex < 0 || !syncEnabled) return;
    const lineEl = el.querySelector<HTMLElement>(".blyrics--line.blyrics--active") || el.children[activeIndex] as HTMLElement | undefined;
    if (!lineEl) return;
    const target = lineEl.offsetTop + lineEl.offsetHeight / 2 - el.clientHeight * 0.37;
    el.scrollTo({ top: Math.max(0, target), behavior: prefersReduced ? "auto" : "smooth" });
  }, [activeIndex, containerRef, syncEnabled]);
}

function formatTime(seconds: number) {
  if (isNaN(seconds) || seconds <= 0) return "0:00";
  const mm = Math.floor(seconds / 60);
  const ss = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function artistScores(history: Record<string, HistEntry>): [string, number][] {
  const now = Date.now();
  const scores: Record<string, number> = {};
  for (const h of Object.values(history)) {
    const days = (now - h.last) / 86400000;
    const recency = Math.pow(0.5, days / 14);
    scores[h.artist] = (scores[h.artist] || 0) + h.count * (0.4 + 0.6 * recency);
  }
  return Object.entries(scores).sort((a, b) => b[1] - a[1]);
}

/* Animated control button (motion.dev API). Wraps the icon button with a hover
   spring + tap pulse. The label renders OUTSIDE the button (a sibling below),
   shown as a floating glass tooltip on hover — or persistently under the icon
   when inside the Now Playing (lyrics) tab. */
function CtrlButton({
  label,
  className = "",
  children,
  ...rest
}: Omit<React.ComponentPropsWithoutRef<typeof motion.button>, "children"> & { label: string; children?: React.ReactNode }) {
  return (
    <span className="ctrl-wrap">
      <motion.button
        className={`ctrl-btn ${className}`}
        whileHover={{ scale: 1.12, y: -2 }}
        whileTap={{ scale: 0.9 }}
        transition={{ type: "spring", stiffness: 420, damping: 18 }}
        {...rest}
      >
        {children}
      </motion.button>
      <span className="ctrl-tooltip">{label}</span>
    </span>
  );
}

export default function App() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(() => load("mv:last-track", null));
  const [activeTab, setActiveTab] = useState("home");
  const [activeShelf, setActiveShelf] = useState<string | null>(null);
  const [homeShelvesState, setHomeShelvesState] = useState<{id: string, title: string, subtitle: string, query?: string}[]>([]);
  const [isAuth, setIsAuth] = useState<boolean>(false);
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);
  const [loginData, setLoginData] = useState<{user_code: string, verification_url: string, device_code: string} | null>(null);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const [shelves, setShelves] = useState<Record<string, Track[]>>({});
  const [quickPicks, setQuickPicks] = useState<Track[]>(() => load("mv:quickpicks", { tracks: [] } as any).tracks || []);
  const [searchTopResult, setSearchTopResult] = useState<any>(null);
  const [searchSongsResults, setSearchSongsResults] = useState<Track[]>([]);
  const [searchVideos, setSearchVideos] = useState<Track[]>([]);
  const [searchAlbums, setSearchAlbums] = useState<any[]>([]);
  const [artistView, setArtistView] = useState<ArtistPage | null>(null);
  const [artistLoading, setArtistLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>(() => load("mv:searches", []));
  const [favorites, setFavorites] = useState<Track[]>(() => load("mv:favorites", []));
  const [history, setHistory] = useState<Record<string, HistEntry>>(() => load("mv:history", {}));
  const [blocked, setBlocked] = useState<string[]>(() => load("mv:blocked", []));
  const [region, setRegion] = useState<Region | null>(() => load("mv:region", null));

  const [theme, setTheme] = useState<string>(() => load("mv:theme", "dark"));
  const [customCss, setCustomCss] = useState<string>(() => load("mv:customcss", ""));
  const [profileTab, setProfileTab] = useState("appearance");
  const [profile, setProfile] = useState<{ name: string; color: string; avatar?: string | null; banner?: string | null; username?: string | null; bio?: string | null; accent_color?: string | null }>(() => load("mv:profile", { name: "Guest", color: "#fa243c" }));
  const [accounts, setAccounts] = useState<{ provider: string; label: string; id: string; avatar?: string | null; username?: string | null; bio?: string | null; banner?: string | null }[]>(() => load("mv:accounts", []));
  const rpcClientId = "1527667258552352848";
  const [rpcEnabled, setRpcEnabled] = useState<boolean>(() => load("mv:rpc-enabled", false));
  const [rpcStatus, setRpcStatus] = useState<"off" | "connecting" | "on" | "error">("off");
  const [updateStatus, setUpdateStatus] = useState<string>("");
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  const [currentTime, setCurrentTime] = useState(() => parseFloat(localStorage.getItem("mv:last-time") || "0"));
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => parseFloat(localStorage.getItem("mv:volume") || "0.8"));
  useEffect(() => { localStorage.setItem("mv:volume", volume.toString()); }, [volume]);
  const [isMuted, setIsMuted] = useState(false);
  const [playerUrl, setPlayerUrl] = useState<string | null>(null);
  const [streamLoading, setStreamLoading] = useState(false);

  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [shuffleMode, setShuffleMode] = useState<ShuffleMode>("off");

  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [justUpdatedChangelog, setJustUpdatedChangelog] = useState<string | null>(null);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);

  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const orderRef = useRef<Track[]>(load("mv:last-order", []));
  const posRef = useRef(load("mv:last-pos", 0));
  const contextRef = useRef<Track[]>(load("mv:last-context", []));
  const currentTrackRef = useRef<Track | null>(null);
  const durationRef = useRef(0);
  const repeatRef = useRef<RepeatMode>("off");
  const shuffleRef = useRef<ShuffleMode>("off");
  const triedDownloadRef = useRef(false);
  const playRequestRef = useRef(0);
  const freshTrackRef = useRef(false); // true while a brand-new track is loading
  const lyricsContainerRef = useRef<HTMLDivElement | null>(null);
  const [lyricSync, setLyricSync] = useState(true);
  const toastTimer = useRef<number | undefined>(undefined);
  const suggestTimer = useRef<number | undefined>(undefined);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const rpcStatusRef = useRef<"off" | "connecting" | "on" | "error">("off");

  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { durationRef.current = duration; }, [duration]);
  useEffect(() => { repeatRef.current = repeatMode; }, [repeatMode]);
  useEffect(() => { localStorage.setItem("mv:last-track", JSON.stringify(currentTrack)); }, [currentTrack]);
  useEffect(() => { 
    const t = setInterval(() => { 
      if (audioRef.current && !audioRef.current.paused) localStorage.setItem("mv:last-time", audioRef.current.currentTime.toString()); 
      localStorage.setItem("mv:last-order", JSON.stringify(orderRef.current));
      localStorage.setItem("mv:last-pos", posRef.current.toString());
      localStorage.setItem("mv:last-context", JSON.stringify(contextRef.current));
    }, 2000); 
    return () => clearInterval(t); 
  }, []);
  useEffect(() => { localStorage.setItem("mv:favorites", JSON.stringify(favorites)); }, [favorites]);
  useEffect(() => { localStorage.setItem("mv:history", JSON.stringify(history)); }, [history]);
  useEffect(() => { localStorage.setItem("mv:blocked", JSON.stringify(blocked)); }, [blocked]);
  useEffect(() => { localStorage.setItem("mv:searches", JSON.stringify(searchHistory)); }, [searchHistory]);
  useEffect(() => { localStorage.setItem("mv:profile", JSON.stringify(profile)); }, [profile]);
  useEffect(() => { localStorage.setItem("mv:accounts", JSON.stringify(accounts)); }, [accounts]);
  useEffect(() => { rpcStatusRef.current = rpcStatus; }, [rpcStatus]);

  const handleAuthPayload = useCallback((base64Payload: string) => {
    try {
      const payloadStr = atob(base64Payload);
      const data = JSON.parse(payloadStr);
      setProfile((p) => ({ ...p, name: data.name || p.name, avatar: data.avatar || p.avatar || null, banner: data.banner || p.banner || null, username: data.username || p.username || null, bio: data.bio || p.bio || null, accent_color: data.accent_color || p.accent_color || null }));
      setAccounts((prev) => {
        const filtered = prev.filter(a => a.provider !== data.provider);
        return [...filtered, { provider: data.provider, label: data.name, id: String(data.id), avatar: data.avatar || null, username: data.username || null, bio: data.bio || null, banner: data.banner || null }];
      });
      flashToast(`Successfully logged in with ${data.provider}`);
    } catch (e) {
      console.error("Failed to parse auth payload", e);
      flashToast("Gagal memproses data login.");
    }
  }, []);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === "MUSICVENUE_AUTH") {
        if (e.data.error) console.error("Auth error:", e.data.error);
        else if (e.data.payload) handleAuthPayload(e.data.payload);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleAuthPayload]);

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("mv:theme", JSON.stringify(theme)); }, [theme]);
  useEffect(() => {
    let el = document.getElementById("mv-custom-css") as HTMLStyleElement | null;
    if (!el) { el = document.createElement("style"); el.id = "mv-custom-css"; document.head.appendChild(el); }
    el.textContent = customCss;
    localStorage.setItem("mv:customcss", JSON.stringify(customCss));
  }, [customCss]);

  useEffect(() => { localStorage.setItem("mv:rpc-clientid", JSON.stringify(rpcClientId)); }, [rpcClientId]);
  useEffect(() => { localStorage.setItem("mv:rpc-enabled", JSON.stringify(rpcEnabled)); }, [rpcEnabled]);

  const flashToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const searchTracks = useCallback(async (query: string): Promise<Track[]> => {
    const res = await fetch(`${API_URL}/search?q=${encodeURIComponent(query)}`);
    return mapTracks(await res.json());
  }, []);

  const searchSongs = useCallback(async (query: string): Promise<Track[]> => {
    const res = await fetch(`${API_URL}/search?q=${encodeURIComponent(query)}&filter=songs`);
    return mapTracks(await res.json());
  }, []);


  const handleLoginClick = async () => {
    try {
      setShowLoginModal(true);
      setLoginData(null);
      const res = await fetch(`${API_URL}/auth/login`);
      const data = await res.json();
      setLoginData(data);
    } catch (err) {
      console.error(err);
      setShowLoginModal(false);
    }
  };

  const startPolling = async () => {
    if (!loginData || isPolling) return;
    setIsPolling(true);
    try {
      const res = await fetch(`${API_URL}/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: loginData.device_code })
      });
      if (res.ok) {
        setIsAuth(true);
        setShowLoginModal(false);
        setLoginData(null);
        loadHome();
      } else {
        console.error("Token polling failed");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsPolling(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, { method: "POST" });
      setIsAuth(false);
      loadHome(); // refresh home
    } catch(err) {
      console.error(err);
    }
  };

  const loadHome = useCallback(async () => {
    setLoading(true);
    
    // Check if authenticated
    if (isAuth) {
        try {
            const homeData = await fetch(`${API_URL}/home`).then(res => res.json());
            const dynamicShelves: any[] = [];
            const map: Record<string, Track[]> = {};
            
            homeData.forEach((shelf: any, i: number) => {
                if (shelf.contents && shelf.contents.length > 0) {
                    const id = `auth_shelf_${i}`;
                    dynamicShelves.push({ id, title: shelf.title, subtitle: shelf.subtitle || "" });
                    
                    // transform contents to Track[]
                    const tracks: Track[] = shelf.contents.map((c: any) => ({
                        videoId: c.videoId,
                        title: c.title,
                        artists: c.artists,
                        album: c.album,
                        thumbnails: c.thumbnails,
                        duration_seconds: null,
                    })).filter((c: any) => c.videoId);
                    
                    map[id] = tracks;
                }
            });
            
            setHomeShelvesState(dynamicShelves);
            setShelves(map);
            setLoading(false);
            return;
        } catch (e) {
            console.error("Failed to load authenticated home", e);
            // fallback to history
        }
    }
    
    // history is Record<string, HistEntry>
    const historyList = Object.values(history).sort((a, b) => b.last - a.last);
    const recentHistory = historyList.slice(0, 15);
    const olderHistory = historyList.slice(15, 30);
    
    let similarArtist = "The Weeknd";
    if (historyList.length > 0) {
      const randomIdx = Math.floor(Math.random() * Math.min(historyList.length, 10));
      if (historyList[randomIdx] && historyList[randomIdx].artist) similarArtist = historyList[randomIdx].artist;
    }
    
    const similarTracks = await searchTracks(similarArtist).catch(() => [] as Track[]);
    const dynamicShelves = [];
    const map: Record<string, Track[]> = {};
    
    if (recentHistory.length > 0) {
       dynamicShelves.push({ id: "keep_listening", title: "Keep listening", subtitle: "Pick up where you left off" });
       map["keep_listening"] = recentHistory;
    }
    
    dynamicShelves.push({ id: "similar", title: `Similar to ${similarArtist}`, subtitle: "Based on your taste" });
    map["similar"] = similarTracks;
    
    if (olderHistory.length > 0) {
       dynamicShelves.push({ id: "listen_again", title: "Listen again", subtitle: "Your past favorites" });
       map["listen_again"] = olderHistory;
    } else if (recentHistory.length > 0 && historyList.length > 5) {
       dynamicShelves.push({ id: "listen_again", title: "Listen again", subtitle: "Your past favorites" });
       map["listen_again"] = [...historyList].sort(() => Math.random() - 0.5).slice(0, 10);
    }
    
    setHomeShelvesState(dynamicShelves);
    setShelves(map);
    setLoading(false);
  }, [searchTracks, history, isAuth]);

  const runSearch = useCallback(async (query: string) => {
    setLoading(true);
    setShowSuggest(false);
    setSearchHistory((prev) => [query, ...prev.filter((x) => x !== query)].slice(0, 8));
    try {
      const res = await fetch(`${API_URL}/search?q=${encodeURIComponent(query)}`);
      const d = await res.json();
      if (!Array.isArray(d)) throw new Error();
      
      let topResult = null;
      if (d.length > 0 && d[0].category === "Top result") {
        topResult = d[0];
      }
      
      const songs = d.filter((x: any) => x.resultType === "song" && x !== topResult);
      const videos = d.filter((x: any) => x.resultType === "video" && x !== topResult);
      const albums = d.filter((x: any) => x.resultType === "album" && x !== topResult);

      setSearchTopResult(topResult);
      setSearchAlbums(albums);
      setSearchSongsResults(mapTracks(songs));
      setSearchVideos(mapTracks(videos));
    } catch {
      setSearchTopResult(null); setSearchAlbums([]); setSearchSongsResults([]); setSearchVideos([]);
    }
    setLoading(false);
  }, []);

  const fetchSuggestions = useCallback((q: string) => {
    window.clearTimeout(suggestTimer.current);
    if (!q.trim()) { setSuggestions([]); return; }
    suggestTimer.current = window.setTimeout(async () => {
      try {
        const d = await (await fetch(`${API_URL}/suggest?q=${encodeURIComponent(q)}`)).json();
        setSuggestions(d.suggestions || []);
      } catch { setSuggestions([]); }
    }, 180);
  }, []);

  const openArtist = useCallback(async (opts: { artistId?: string; name?: string }) => {
    setActiveTab("artist");
    setShowSuggest(false);
    setArtistLoading(true);
    setArtistView(null);
    try {
      let aId = opts.artistId;
      if (!aId && opts.name) {
        const res = await fetch(`${API_URL}/search?q=${encodeURIComponent(opts.name)}&filter=artists`);
        const hits = await res.json();
        if (hits.length > 0) aId = hits[0].browseId;
      }
      if (aId) {
        const d = await (await fetch(`${API_URL}/artist/${encodeURIComponent(aId)}`)).json();
        let songs = [...(d.songs?.results || []), ...(d.singles?.results || [])];
        if (songs.length <= 10 && d.name) {
          try {
            const fallbackRes = await fetch(`${API_URL}/search?q=${encodeURIComponent(d.name)}&filter=songs`);
            const fallbackHits = await fallbackRes.json();
            if (Array.isArray(fallbackHits) && fallbackHits.length > songs.length) {
              fallbackHits.forEach((s: any) => { if (!s.artists || s.artists[0]?.name === "Song") s.artists = [{ name: d.name, id: aId }]; });
              songs = fallbackHits;
            }
          } catch (err) { console.error("Fallback search failed:", err); }
        }
        setArtistView({ artist: d, songs: mapTracks(songs), albums: d.albums?.results || [], singles: d.singles?.results || [] });
      } else { setArtistView({ artist: null, songs: [], albums: [], singles: [] }); }
    } catch { setArtistView({ artist: null, songs: [], albums: [], singles: [] }); }
    setArtistLoading(false);
  }, []);

  const buildQuickPicks = useCallback(async (reg: Region | null) => {
    const cache = load("mv:quickpicks", null as any);
    const fresh = cache && Date.now() - cache.at < 3 * 3600_000 && cache.tracks?.length;
    if (fresh) { setQuickPicks(cache.tracks); return; }
    const blockedSet = new Set(blocked);
    const topArtists = artistScores(history).slice(0, 4).map((a) => a[0]);
    const regionQuery = reg?.country ? `top songs ${reg.country}` : "top songs 2026";
    const queries = topArtists.length ? [...topArtists, regionQuery] : [regionQuery, "popular songs 2026", "top hits 2026"];
    const groups = await Promise.all(queries.map((q) => searchSongs(q).catch(() => [] as Track[])));
    const merged: Track[] = [];
    const seen = new Set<string>();
    for (let round = 0; round < 4; round++) {
      for (const g of groups) {
        const t = g[round];
        if (t && !seen.has(t.videoId) && !blockedSet.has(t.artist)) { seen.add(t.videoId); merged.push(t); }
      }
    }
    const picks = merged.slice(0, 12);
    setQuickPicks(picks);
    localStorage.setItem("mv:quickpicks", JSON.stringify({ at: Date.now(), tracks: picks }));
  }, [history, blocked, searchSongs]);

  const reshuffleHome = useCallback(async () => {
    flashToast("Menyusun ulang...");
    setShelves((prev) => { const n: Record<string, Track[]> = {}; for (const k in prev) n[k] = shuffleArray(prev[k]); return n; });
    localStorage.removeItem("mv:quickpicks");
    await loadHome();
    buildQuickPicks(region);
  }, [loadHome, buildQuickPicks, region, flashToast]);

  const pushRpc = useCallback(async (track: Track) => {
    if (rpcStatusRef.current !== "on" || !isTauri) return;
    try {
      const audio = audioRef.current;
      const now = Math.floor(Date.now() / 1000);
      let startTime: number | null = null;
      let endTime: number | null = null;
      if (audio && !audio.paused && audio.duration) { startTime = now - Math.floor(audio.currentTime); endTime = startTime + Math.floor(audio.duration); }
      await invoke("set_rpc_activity", { details: track.title, state: track.artist, largeImage: track.artwork || "https://musicvenue.vercel.app/icon.png", largeText: "Playing on Music Venue", startTime, endTime });
    } catch (e) { console.error("Gagal push RPC", e); }
  }, []);

  const DiscordIcon = ({ size = 24 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 127.14 96.36" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1,105.25,105.25,0,0,0,32.19-16.14c0,0,.04-.06.05-.09h0c2.69-28.53-3.69-52.05-19.64-72.12ZM42.68,68.3c-5.72,0-10.43-5.26-10.43-11.7s4.65-11.7,10.43-11.7c5.82,0,10.51,5.3,10.43,11.7,0,6.44-4.65,11.7-10.43,11.7Zm41.72,0c-5.72,0-10.43-5.26-10.43-11.7s4.65-11.7,10.43-11.7c5.82,0,10.51,5.3,10.43,11.7,0,6.44-4.61,11.7-10.43,11.7Z" />
    </svg>
  );

  const checkForUpdate = useCallback(async () => {
    if (!isTauri) { setUpdateStatus("Auto-update is only available on the desktop app."); return; }
    setIsCheckingUpdate(true);
    setUpdateStatus("Memeriksa pembaruan...");
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update?.available) { setUpdateInfo({ version: update.version, obj: update }); setUpdateStatus(`Versi ${update.version} tersedia!`); }
      else setUpdateStatus("You are already on the latest version.");
    } catch (e) { console.error(e); setUpdateStatus("Gagal memeriksa pembaruan."); }
    finally { setIsCheckingUpdate(false); }
  }, []);

  const exportConfig = useCallback(() => {
    const cfg: Record<string, any> = {};
    for (const k of Object.keys(localStorage)) if (k.startsWith("mv:")) cfg[k] = localStorage.getItem(k);
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "musicvenue-config.json";
    a.click();
    URL.revokeObjectURL(a.href);
    flashToast("Configuration exported");
  }, [flashToast]);

  const importConfig = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const cfg = JSON.parse(String(reader.result));
        for (const k in cfg) if (k.startsWith("mv:")) localStorage.setItem(k, cfg[k]);
        flashToast("Configuration imported - reloading...");
        setTimeout(() => location.reload(), 800);
      } catch { flashToast("Invalid configuration file."); }
    };
    reader.readAsText(file);
  }, [flashToast]);

  const uploadCss = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => { setCustomCss(String(reader.result)); flashToast("Custom CSS applied"); };
    reader.readAsText(file);
  }, [flashToast]);

  const toggleAccount = useCallback(async (p: { id: string; label: string }) => {
    const connected = accounts.find((a) => a.provider === p.id);
    if (connected) {
      setAccounts((prev) => prev.filter((a) => a.provider !== p.id));
      if (accounts.length === 1) setProfile(old => ({ ...old, avatar: null, banner: null }));
      flashToast(`Akun ${p.label} diputus`);
      return;
    }
    if (p.id === "email") { flashToast("Email login is not yet available."); return; }
    let authUrl = `https://musicvenue.vercel.app/api/auth?action=login&provider=${p.id}`;
    if (isTauri) {
      try {
        const port = await invoke<number>("start_oauth_server");
        authUrl += `&port=${port}`;
        await openUrl(authUrl);
      } catch (e) { console.error(e); flashToast("Failed to open browser."); }
    } else {
      const w = 500; const h = 600; const left = window.screen.width / 2 - w / 2; const top = window.screen.height / 2 - h / 2;
      window.open(authUrl, "MusicVenueAuth", `width=${w},height=${h},top=${top},left=${left}`);
    }
  }, [accounts, flashToast]);

  const connectDiscord = useCallback(async () => {
    setRpcStatus("connecting");
    rpcStatusRef.current = "connecting";
    try {
      await invoke("connect_rpc", { clientId: rpcClientId });
      setRpcStatus("on");
      rpcStatusRef.current = "on";
      setRpcEnabled(true);
      if (currentTrackRef.current) pushRpc(currentTrackRef.current);
    } catch (e) {
      console.error(e);
      setRpcStatus("error");
      rpcStatusRef.current = "error";
      flashToast("Failed to connect to Discord.");
    }
  }, [pushRpc, flashToast]);

  const disconnectDiscord = useCallback(async () => {
    try { if (isTauri) await invoke("disconnect_rpc"); } catch (e) { console.error(e); }
    setRpcStatus("off"); rpcStatusRef.current = "off"; setRpcEnabled(false);
  }, []);

  useEffect(() => {
    if (isTauri) {
      setTimeout(() => invoke("show_main_window").catch(console.error), 150);
    }
  }, []);
  
  useEffect(() => {
    const interval = setInterval(() => {
      if (isTauri) checkForUpdate();
    }, 120000);
    return () => clearInterval(interval);
  }, [checkForUpdate]);
  
  useEffect(() => {
    const initApp = async () => {
      if (isTauri) {
        try {
          onOpenUrl((urls) => {
            if (urls.length > 0) {
              const url = new URL(urls[0]);
              if (url.protocol === "musicvenue:") {
                const payload = url.searchParams.get("payload");
                const error = url.searchParams.get("error");
                if (payload) handleAuthPayload(payload);
                else if (error) flashToast(`Failed to login: ${error}`);
              }
            }
          }).catch(console.error);
          listen<string>("oauth-payload", (event) => { if (event.payload) handleAuthPayload(event.payload); });
        } catch (e) { console.error("Tauri invoke error", e); }
      }
    };
    setTimeout(initApp, 150);
    loadHome();
    (async () => {
      let reg = load<Region | null>("mv:region", null);
      try {
        if (!reg) {
          const res = await fetch("https://ipapi.co/json/");
          const data = await res.json();
          reg = { country: data.country_name, countryCode: data.country_code, city: data.city };
          localStorage.setItem("mv:region", JSON.stringify(reg));
          setRegion(reg);
        }
      } catch { }
      buildQuickPicks(reg);
    })();
  }, [handleAuthPayload, loadHome, buildQuickPicks, flashToast]);

  useEffect(() => {
    if (!isTauri) return;
    (async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (update?.available) {
          localStorage.setItem("mv:update-latest", update.version);
          setUpdateInfo({ version: update.version, obj: update });
        }
      } catch (e) { console.error("update check failed", e); }
    })();
  }, []);

  const runUpdate = useCallback(async () => {
    if (!updateInfo) return;
    try {
      setUpdateProgress(0);
      let total = 0, got = 0;
      await updateInfo.obj.downloadAndInstall((ev: any) => {
        if (ev.event === "Started") total = ev.data.contentLength || 0;
        else if (ev.event === "Progress") { got += ev.data.chunkLength || 0; if (total) setUpdateProgress(Math.round((got / total) * 100)); }
        else if (ev.event === "Finished") setUpdateProgress(100);
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      console.error("update failed", e);
      flashToast("Failed to update. Try again later.");
      setUpdateProgress(null);
    }
  }, [updateInfo, flashToast]);

  const resolveStreamUrl = async (videoId: string): Promise<string> => `${API_URL}/stream/${videoId}`;

  const startStream = useCallback(async (track: Track, resumeTime?: number) => {
    const requestId = ++playRequestRef.current;
    setStreamLoading(true);
    setPlayerUrl(null);
    if (resumeTime) { setCurrentTime(resumeTime); setDuration(0); }
    else { setCurrentTime(0); setDuration(0); }
    try {
      let url: string;
      if (isTauri) url = await invoke<string>("resolve_audio_url", { videoId: track.videoId });
      else url = await resolveStreamUrl(track.videoId);
      if (playRequestRef.current !== requestId) return;
      setPlayerUrl(url);
      setIsPlaying(true);
      if (resumeTime) setTimeout(() => { if (audioRef.current) audioRef.current.currentTime = resumeTime; }, 100);
    } catch (e) {
      console.error("Failed to resolve stream", e);
      if (playRequestRef.current === requestId) { setIsPlaying(false); flashToast("Failed to load audio."); }
    } finally {
      if (playRequestRef.current === requestId) {
        setStreamLoading(false);
        freshTrackRef.current = false; // stream is ready — no longer a fresh load
      }
    }
  }, [flashToast]);

  useEffect(() => {
    // Resume the current track's saved position only when this is NOT a fresh
    // track switch. A fresh load already started at 0, so resuming here would
    // stomp it with the previous track's timestamp.
    if (freshTrackRef.current) return;
    if (isPlaying && !playerUrl && currentTrackRef.current) {
      startStream(currentTrackRef.current, parseFloat(localStorage.getItem("mv:last-time") || "0"));
    }
  }, [isPlaying, playerUrl, startStream]);

  const recordPlay = useCallback((track: Track) => {
    setHistory((prev) => {
      const cur = prev[track.videoId];
      return { ...prev, [track.videoId]: { ...track, count: (cur?.count || 0) + 1, last: Date.now() } };
    });
  }, []);

  const loadAndPlay = useCallback((track: Track) => {
    triedDownloadRef.current = false;
    freshTrackRef.current = true; // brand-new track → start from 0, not resume
    setCurrentTrack(track);
    currentTrackRef.current = track;
    recordPlay(track);
    startStream(track);
  }, [startStream, recordPlay]);

  const buildOrder = useCallback((context: Track[], start: Track) => {
    const base = context.length ? context : [start];
    contextRef.current = base;
    let order: Track[];
    if (shuffleRef.current === "random") order = [start, ...shuffleArray(base.filter((t) => t.videoId !== start.videoId))];
    else if (shuffleRef.current === "smart") order = smartOrder(base, start);
    else order = [...base];
    orderRef.current = order;
    posRef.current = Math.max(0, order.findIndex((t) => t.videoId === start.videoId));
  }, []);

  const playTrack = useCallback((track: Track, context: Track[]) => {
    buildOrder(context, track);
    loadAndPlay(track);
  }, [buildOrder, loadAndPlay]);

  const advance = useCallback((manual: boolean) => {
    const order = orderRef.current;
    if (!order.length) return;
    let next = posRef.current + 1;
    if (next >= order.length) {
      if (repeatRef.current === "all" || manual) next = 0;
      else { setIsPlaying(false); return; }
    }
    posRef.current = next;
    loadAndPlay(order[next]);
  }, [loadAndPlay]);

  const playPrev = useCallback(() => {
    const order = orderRef.current;
    if (!order.length) return;
    if (audioRef.current && audioRef.current.currentTime > 3) { audioRef.current.currentTime = 0; return; }
    let prev = posRef.current - 1;
    if (prev < 0) prev = order.length - 1;
    posRef.current = prev;
    loadAndPlay(order[prev]);
  }, [loadAndPlay]);

  const togglePlay = useCallback(() => {
    if (!currentTrackRef.current) return;
    setIsPlaying((p) => !p);
  }, []);

  const handleEnded = useCallback(() => {
    if (repeatRef.current === "one" && audioRef.current) { audioRef.current.currentTime = 0; audioRef.current.play().catch(() => { }); return; }
    advance(false);
  }, [advance]);

  const handleAudioError = useCallback(() => {
    if (!isTauri && currentTrackRef.current && !triedDownloadRef.current) {
      triedDownloadRef.current = true;
      startStream(currentTrackRef.current);
    } else setIsPlaying(false);
  }, [startStream]);

  const playNext = useCallback((track: Track) => {
    if (!currentTrackRef.current) { playTrack(track, [track]); return; }
    const order = [...orderRef.current];
    order.splice(posRef.current + 1, 0, track);
    orderRef.current = order;
    flashToast("Playing next");
  }, [playTrack, flashToast]);

  const addToQueue = useCallback((track: Track) => {
    if (!currentTrackRef.current) { playTrack(track, [track]); return; }
    orderRef.current = [...orderRef.current, track];
    flashToast("Added to queue");
  }, [playTrack, flashToast]);

  const startMix = useCallback(async (track: Track) => {
    playTrack(track, [track]);
    flashToast("Memulai mix...");
    try {
      const related = (await searchSongs(track.artist)).filter((t) => t.videoId !== track.videoId);
      const order = [track, ...shuffleArray(related)];
      orderRef.current = order;
      contextRef.current = order;
      posRef.current = 0;
    } catch { }
  }, [playTrack, searchSongs, flashToast]);

  const goToArtist = useCallback((artist: string) => { openArtist({ name: artist }); }, [openArtist]);
  const shareTrack = useCallback(async (track: Track) => {
    const link = `https://music.youtube.com/watch?v=${track.videoId}`;
    try { await navigator.clipboard.writeText(link); flashToast("Link copied to clipboard"); }
    catch { flashToast(link); }
  }, [flashToast]);

  const downloadTrack = useCallback(async (track: Track) => {
    if (isTauri) {
      flashToast("Mengunduh...");
      try { const dir = await invoke<string>("download_track", { videoId: track.videoId }); flashToast(`Saved to ${dir}`); }
      catch { flashToast("Failed to download."); }
    } else window.open(`https://music.youtube.com/watch?v=${track.videoId}`, "_blank");
  }, [flashToast]);

  const notInterested = useCallback((track: Track) => {
    setBlocked((prev) => (prev.includes(track.artist) ? prev : [...prev, track.artist]));
    setQuickPicks((prev) => prev.filter((t) => t.artist !== track.artist));
    localStorage.removeItem("mv:quickpicks");
    flashToast(`Not recommending ${track.artist}`);
  }, [flashToast]);

  const cycleRepeat = useCallback(() => setRepeatMode((m) => (m === "off" ? "all" : m === "all" ? "one" : "off")), []);
  const cycleShuffle = useCallback(() => setShuffleMode((m) => (m === "off" ? "random" : m === "random" ? "smart" : "off")), []);

  useEffect(() => {
    shuffleRef.current = shuffleMode;
    const cur = currentTrackRef.current;
    if (cur && contextRef.current.length) buildOrder(contextRef.current, cur);
  }, [shuffleMode, buildOrder]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !playerUrl) return;
    if (isPlaying) audio.play().catch(() => setIsPlaying(false));
    else audio.pause();
  }, [isPlaying, playerUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = isMuted ? 0 : volume;
  }, [volume, isMuted, playerUrl]);

  const isFavorite = useCallback((videoId: string) => favorites.some((t) => t.videoId === videoId), [favorites]);
  const toggleFavorite = useCallback((track: Track) => {
    setFavorites((prev) => prev.some((t) => t.videoId === track.videoId) ? prev.filter((t) => t.videoId !== track.videoId) : [track, ...prev]);
  }, []);

  useEffect(() => {
    if (!currentTrack) { setLyrics(null); return; }
    let cancelled = false;
    setLyrics(null); setLyricsLoading(true);
    (async () => {
      try {
        const url = `${API_URL}/lyrics/${encodeURIComponent(currentTrack.videoId)}/auto`;
        const d = await (await fetch(url)).json();
        if (cancelled) return;
        setLyrics(d.error ? null : normalizeLyrics(d));
      } catch { if (!cancelled) setLyrics({ synced: [], plain: "" }); }
      finally { if (!cancelled) setLyricsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [currentTrack]);

  const activeLyric = useMemo(() => {
    if (!lyrics?.synced.length) return -1;
    let idx = -1;
    for (let i = 0; i < lyrics.synced.length; i++) {
      if (lyrics.synced[i].t <= currentTime + 0.25) idx = i; else break;
    }
    return idx;
  }, [lyrics, currentTime]);

  useLyricAnimation(
    lyrics?.synced ?? null,
    activeLyric,
    currentTime,
    isPlaying,
    lyricsContainerRef,
    lyricSync,
  );

  useEffect(() => {
    if (!("mediaSession" in navigator) || !currentTrack) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: currentTrack.title, artist: currentTrack.artist, album: "Music Venue", artwork: [{ src: currentTrack.artwork, sizes: "512x512", type: "image/jpeg" }] });
    navigator.mediaSession.setActionHandler("play", () => setIsPlaying(true));
    navigator.mediaSession.setActionHandler("pause", () => setIsPlaying(false));
    navigator.mediaSession.setActionHandler("previoustrack", () => playPrev());
    navigator.mediaSession.setActionHandler("nexttrack", () => advance(true));
  }, [currentTrack, playPrev, advance]);

  useEffect(() => { if (currentTrack && duration > 0) pushRpc(currentTrack); }, [currentTrack, isPlaying, duration, pushRpc]);
  useEffect(() => {
    if (isPlaying && rpcStatusRef.current === "off" && isTauri) {
      connectDiscord();
    }
  }, [isPlaying, connectDiscord]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      switch (e.code) {
        case "Space": e.preventDefault(); togglePlay(); break;
        case "ArrowRight": if (audioRef.current) audioRef.current.currentTime = Math.min(durationRef.current, audioRef.current.currentTime + 5); break;
        case "ArrowLeft": if (audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5); break;
        case "ArrowUp": e.preventDefault(); setVolume((v) => Math.min(1, +(v + 0.05).toFixed(2))); setIsMuted(false); break;
        case "ArrowDown": e.preventDefault(); setVolume((v) => Math.max(0, +(v - 0.05).toFixed(2))); break;
        case "KeyN": advance(true); break;
        case "KeyP": playPrev(); break;
        case "KeyS": cycleShuffle(); break;
        case "KeyR": cycleRepeat(); break;
        case "KeyM": setIsMuted((m) => !m); break;
        case "KeyL": if (currentTrackRef.current) setNowPlayingOpen((o) => !o); break;
        case "Escape": setNowPlayingOpen(false); setCtxMenu(null); setShowQueue(false); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, advance, playPrev, cycleShuffle, cycleRepeat]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close); window.addEventListener("scroll", close, true); window.addEventListener("resize", close);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [ctxMenu]);

  useEffect(() => {
    if (!showSuggest) return;
    const onDown = (e: MouseEvent) => { if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) setShowSuggest(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showSuggest]);

  const openCtx = (e: React.MouseEvent, track: Track, context: Track[]) => {
    e.preventDefault();
    const menuW = 232, menuH = 372;
    const x = Math.min(e.clientX, window.innerWidth - menuW - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuH - 8);
    setCtxMenu({ x: Math.max(8, x), y: Math.max(8, y), track, context });
  };

  const handleMinimize = async () => { if (isTauri) await getCurrentWindow().minimize(); };
  const handleMaximize = async () => {
    if (!isTauri) return;
    const w = getCurrentWindow();
    if (await w.isMaximized()) { await w.unmaximize(); setIsMaximized(false); }
    else { await w.maximize(); setIsMaximized(true); }
  };
  const handleClose = async () => { if (isTauri) await getCurrentWindow().close(); };
  const handleDrag = async (e: React.MouseEvent) => { if (isTauri && e.button === 0) await getCurrentWindow().startDragging(); };


  // const volumeBarRef = useRef<HTMLDivElement>(null);

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); if (searchQuery.trim()) { setActiveTab("search"); runSearch(searchQuery); } };
  const handleTabClick = (tab: string) => { if (tab === "home" && activeTab === "home") { reshuffleHome(); return; } setActiveTab(tab); if (tab === "home" && !Object.keys(shelves).length) loadHome(); else if (tab === "radio") runSearch("Lo-fi radio chill"); };

  const getPageTitle = () => {
    switch (activeTab) {
      case "home": return "Listen Now";
      case "favorites": return "Liked Music";
      case "radio": return "Radio";
      case "search": return "Search";
      case "artist": return artistView?.artist?.name || "Artist";
      case "profile": return "Profile";
      default: return "Music Venue";
    }
  };

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const VolIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const upNext = orderRef.current.slice(posRef.current + 1);
  // Build a Track from the current top result (if it's a song) so the context
  // menu / play actions can reuse it.
  const topResultTrack: Track | null = searchTopResult && searchTopResult.videoId
    ? {
        videoId: searchTopResult.videoId,
        title: searchTopResult.title || searchTopResult.name || "Unknown",
        artist: searchTopResult.artists?.[0]?.name || searchTopResult.artist || "Unknown",
        artwork: hiResThumb(pickArtwork(searchTopResult.thumbnails), 900)
      }
    : null;

  const renderAlbumCard = (track: Track, context: Track[]) => (
    <div key={track.videoId} className="album-card glass-card" onClick={() => playTrack(track, context)} onContextMenu={(e) => openCtx(e, track, context)}>
      <div className="album-art-wrap">
        <img src={track.artwork} alt={track.title} className="album-artwork" loading="lazy" />
      </div>
      <div className="album-info">
        <div className="album-info-text"><h3>{track.title}</h3><p>{track.artist}</p></div>
        <div className="mini-play"><Play size={18} fill="currentColor" /></div>
      </div>
    </div>
  );

  const renderTrackRow = (track: Track, context: Track[], index: number) => {
    const playing = currentTrack?.videoId === track.videoId;
    return (
      <div key={track.videoId} className={`track-row ${playing ? "playing" : ""}`} onDoubleClick={() => playTrack(track, context)} onContextMenu={(e) => openCtx(e, track, context)}>
        <div className="track-row-index">
          <span className="track-num">{index + 1}</span>
          <Button className="track-row-play" onClick={() => playTrack(track, context)}>
            {playing && streamLoading ? <RefreshCw size={14} className="spin" /> : playing && isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          </Button>
        </div>
        <img src={track.artwork} alt="" className="track-row-art" loading="lazy" />
        <div className="track-row-text"><span className="track-row-title">{track.title}</span><span className="track-row-artist">{track.artist}</span></div>
        <Button className={`track-row-like ${isFavorite(track.videoId) ? "active" : ""}`} onClick={() => toggleFavorite(track)}><Heart size={16} fill={isFavorite(track.videoId) ? "currentColor" : "none"} /></Button>
        <Button className="track-row-more" onClick={(e) => openCtx(e, track, context)}><MoreHorizontal size={16} /></Button>
      </div>
    );
  };

  const renderShelf = (id: string, title: string, subtitle: string) => {
    const tracks = shelves[id] || [];
    return (
      <section key={id} className="shelf">
        <div className="shelf-head" onClick={() => { setActiveShelf(id); setActiveTab("shelf"); }}>
          <div><h2>{title} <ChevronRight size={20} /></h2><p>{subtitle}</p></div>
          <div className="shelf-nav">
            <Button onClick={(e) => { e.stopPropagation(); document.getElementById(`shelf-${id}`)?.scrollBy({ left: -600, behavior: "smooth" }); }}><ChevronLeft size={20} /></Button>
            <Button onClick={(e) => { e.stopPropagation(); document.getElementById(`shelf-${id}`)?.scrollBy({ left: 600, behavior: "smooth" }); }}><ChevronRight size={20} /></Button>
          </div>
        </div>
        <div id={`shelf-${id}`} className="shelf-scroll">
          {loading && !tracks.length ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="album-card skeleton"><div className="album-art-wrap sk" /></div>) : tracks.map((t) => renderAlbumCard(t, tracks))}
        </div>
      </section>
    );
  };

  return (
    <div className="app-container" onContextMenu={(e) => {
      // Suppress the native browser right-click menu on the main window
      // (track/album cards handle their own custom menu via openCtx).
      const target = e.target as HTMLElement;
      if (!target.closest('.track-row, .album-card, .queue-item, .top-result-card, .ctx-menu, .track-row-more, .top-result-more')) {
        e.preventDefault();
      }
    }}>
      {playerUrl && <audio key={playerUrl} ref={audioRef} src={playerUrl} onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)} onDurationChange={(e) => setDuration(e.currentTarget.duration)} onEnded={handleEnded} onError={handleAudioError} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} />}
      <aside className="sidebar">
        <div className="drag-region" onMouseDown={handleDrag} />
        <div className="sidebar-brand"><Sparkles size={20} /> Music Venue</div>
        <div className="sidebar-section">
          <div className={`nav-item ${activeTab === "home" ? "active" : ""}`} onClick={() => handleTabClick("home")}><Home size={20} /> Listen Now</div>
          <div className={`nav-item ${activeTab === "search" ? "active" : ""}`} onClick={() => setActiveTab("search")}><Search size={20} /> Search</div>
          <div className={`nav-item ${activeTab === "radio" ? "active" : ""}`} onClick={() => handleTabClick("radio")}><Radio size={20} /> Radio</div>
        </div>
        <div className="sidebar-section">
          <div className="sidebar-title">Library</div>
          <div className={`nav-item ${activeTab === "favorites" ? "active" : ""}`} onClick={() => setActiveTab("favorites")}><Heart size={20} /> Liked Music {favorites.length > 0 && <span className="nav-count">{favorites.length}</span>}</div>
          <div className="nav-item" onClick={() => setShowQueue(true)}><ListMusic size={20} /> Queue</div>
        </div>
        <div className="sidebar-bottom">
          <Button className={`sidebar-profile ${activeTab === "profile" ? "active" : ""}`} onClick={() => setActiveTab("profile")}>
            {profile.avatar ? <img src={profile.avatar} alt={profile.name} className="profile-avatar-img" /> : <span className="profile-avatar" style={{ background: profile.color }}>{(profile.name || "G").charAt(0).toUpperCase()}</span>}
            <div className="profile-brief"><span className="profile-name">{profile.name || "Guest"}</span><span className="profile-sub">Profile & Settings</span></div>
            <Settings size={16} />
          </Button>
        </div>
      </aside>
      <main className="main-content">
        <header className="header">
          <div className="header-drag" onMouseDown={handleDrag}><h1>{getPageTitle()}</h1></div>
          <div className="header-center">
            <div className="search-box-wrap" ref={searchBoxRef}>
              <form onSubmit={handleSearch} className="search-box">
                <Search size={16} />
                <Input type="text" placeholder="Artists, songs, or albums" value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); fetchSuggestions(e.target.value); setShowSuggest(true); }} onFocus={() => { setActiveTab("search"); setShowSuggest(true); }} />
                {searchQuery && <Button type="button" className="search-clear" onClick={() => { setSearchQuery(""); setSuggestions([]); }}><X size={14} /></Button>}
              </form>
              {showSuggest && (
                <div className="search-dropdown">
                  {searchQuery.trim() ? (suggestions.length ? suggestions.map((s) => <Button key={s} className="suggest-item" onMouseDown={(e) => { e.preventDefault(); setSearchQuery(s); runSearch(s); }}><Search size={15} /><span>{s}</span></Button>) : <div className="suggest-empty">Press Enter to search ...{searchQuery}...</div>) : searchHistory.length ? (
                    <>
                      <div className="suggest-head"><span>Recent searches</span><Button onMouseDown={(e) => { e.preventDefault(); setSearchHistory([]); }}>Clear all</Button></div>
                      {searchHistory.map((h) => <Button key={h} className="suggest-item" onMouseDown={(e) => { e.preventDefault(); setSearchQuery(h); runSearch(h); }}><Clock size={15} /><span>{h}</span><span className="suggest-remove" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setSearchHistory((prev) => prev.filter((x) => x !== h)); }}><X size={13} /></span></Button>)}
                    </>
                  ) : <div className="suggest-empty">No search history.</div>}
                </div>
              )}
            </div>
          </div>
          <div className="header-right">
            {isAuth ? (
              <Button className="win-btn" onClick={handleLogout} title="Logout"><User size={16} style={{ color: 'var(--accent)' }} /></Button>
            ) : (
              <Button className="win-btn" onClick={handleLoginClick} title="Login with YouTube"><User size={16} /></Button>
            )}
            {isTauri && (
              <div className="window-controls">
                <Button className="win-btn" onClick={handleMinimize}><Minus size={16} /></Button>
                <Button className="win-btn" onClick={handleMaximize}>{isMaximized ? <Square size={12} /> : <Maximize size={14} />}</Button>
                <Button className="win-btn win-btn-close" onClick={handleClose}><X size={16} /></Button>
              </div>
            )}
          </div>
        </header>
        {activeTab === "home" && (
          <div className="page">
            {quickPicks.length > 0 && (
              <section className="shelf">
                <div className="shelf-head"><div><h2>Quick Picks <ChevronRight size={20} /></h2><p>{history && Object.keys(history).length ? "Based on what you play frequently" : "Popular near you"}{region?.city ? ` ... ${region.city}` : ""}</p></div></div>
                <div className="track-grid">{quickPicks.map((t, i) => renderTrackRow(t, quickPicks, i))}</div>
              </section>
            )}
            {homeShelvesState.map((s) => renderShelf(s.id, s.title, s.subtitle))}
            <section className="shelf">
              <div className="shelf-head"><div><h2>Liked Music <ChevronRight size={20} /></h2><p>Songs you like</p></div></div>
              {favorites.length ? <div className="track-grid">{favorites.map((t, i) => renderTrackRow(t, favorites, i))}</div> : <div className="empty-state"><Heart size={34} /><p>No liked music yet</p><span>Press the ♥ icon on a song to save it here.</span></div>}
            </section>
          </div>
        )}
        {activeTab === "favorites" && (
          <div className="page">
            {favorites.length ? <div className="track-grid wide">{favorites.map((t, i) => renderTrackRow(t, favorites, i))}</div> : <div className="empty-state big"><Heart size={44} /><p>Liked Music is empty</p><span>All songs you mark with ♥ will appear here.</span></div>}
          </div>
        )}
        {activeTab === "artist" && (
          <div className="page">
            {artistLoading ? <div className="artist-page-head"><div className="artist-avatar sk-avatar" /><div className="artist-page-meta"><div className="sk-line" /><div className="sk-line short" /></div></div> : artistView?.artist ? (
              <>
                <div className="artist-page-head">
                  <img className="artist-avatar" src={pickArtwork(artistView.artist.thumbnails)} alt={artistView.artist.name} />
                  <div className="artist-page-meta">
                    <span className="artist-hero-label"><User size={13} /> Artist</span>
                    <h1>{artistView.artist.name}</h1>
                    {artistView.artist.subscribers && <p>{artistView.artist.subscribers} subscribers</p>}
                    <div className="artist-page-actions">
                      <Button variant="default" onClick={() => artistView.songs.length && playTrack(artistView.songs[0], artistView.songs)}><Play size={17} fill="currentColor" /> Play</Button>
                      <Button variant="ghost" onClick={() => { if (artistView.songs.length) { setShuffleMode("random"); playTrack(artistView.songs[0], artistView.songs); } }}><Shuffle size={17} /> Shuffle</Button>
                    </div>
                  </div>
                </div>
                <section className="search-section">
                  <div className="section-head"><h2>Songs</h2><span className="section-badge">{artistView.songs.length} lagu</span></div>
                  <div className="track-grid wide">{artistView.songs.map((t, i) => renderTrackRow(t, artistView.songs, i))}</div>
                </section>
              </>
            ) : <div className="empty-state big"><User size={44} /><p>Artist not found</p><span>Try searching for another artist.</span></div>}
          </div>
        )}
        {(activeTab === "search" || activeTab === "radio") && (
          <div className="page">
            {loading ? (
              <div className="grid-container">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="album-card skeleton"><div className="album-art-wrap sk" /></div>)}</div>
            ) : searchTopResult || searchSongsResults.length || searchVideos.length || searchAlbums.length ? (
              <>
                {searchTopResult && (
                  <div className={`top-result-card ${searchTopResult.resultType === 'artist' ? 'is-artist' : ''}`} onClick={() => {
                    if (searchTopResult.resultType === 'artist') {
                      openArtist({ artistId: searchTopResult.browseId || searchTopResult.artists?.[0]?.id, name: searchTopResult.artist });
                    } else if (topResultTrack) {
                      playTrack(topResultTrack, [topResultTrack]);
                    }
                  }} onContextMenu={(e) => {
                    if (topResultTrack) openCtx(e, topResultTrack, [topResultTrack]);
                  }}>
                    <div className="top-result-media">
                      <img src={hiResThumb(pickArtwork(searchTopResult.thumbnails), 900)} alt="Top Result" className="top-result-img" />
                    </div>
                    <div className="top-result-info">
                      <div className="top-result-text">
                        <span className="section-badge">Top Result</span>
                        <h2>{searchTopResult.title || searchTopResult.artist || searchTopResult.name || "Top Result"}</h2>
                        <p className="top-result-artist">{searchTopResult.artists?.[0]?.name || searchTopResult.artist || searchTopResult.resultType || "Result"}</p>
                      </div>
                      <div className="top-result-actions">
                        <Button className="top-result-more" onClick={(e) => { e.stopPropagation(); if (topResultTrack) openCtx(e, topResultTrack, [topResultTrack]); }}><MoreHorizontal size={18} /></Button>
                        <div className="top-result-play" onClick={(e) => { e.stopPropagation(); if (topResultTrack) playTrack(topResultTrack, [topResultTrack]); }}><Play size={18} fill="currentColor" /></div>
                      </div>
                    </div>
                  </div>
                )}
                
                {searchSongsResults.length > 0 && <section className="search-section"><div className="section-head"><h2>Songs</h2></div><div className="grid-container">{searchSongsResults.map((t) => renderAlbumCard(t, searchSongsResults))}</div></section>}
                
                {searchVideos.length > 0 && <section className="search-section"><div className="section-head"><h2>Videos</h2><span className="section-badge muted">Live, Covers &amp; Remixes</span></div><div className="grid-container">{searchVideos.map((t) => renderAlbumCard(t, searchVideos))}</div></section>}
              </>
            ) : <div className="empty-state big"><Search size={44} /><p>{activeTab === "radio" ? "Radio" : "Search for your favorite songs"}</p><span>Type an artist name or song title in the search box.</span></div>}
          </div>
        )}
        {activeTab === "shelf" && activeShelf && (
            <div className="page">
              <div className="section-head" style={{ marginTop: 20 }}>
                <h2>{homeShelvesState.find(s => s.id === activeShelf)?.title || "Playlist"}</h2>
                <span className="section-badge muted">{homeShelvesState.find(s => s.id === activeShelf)?.subtitle}</span>
              </div>
              <div className="grid-container">
                {shelves[activeShelf]?.map(t => renderAlbumCard(t, shelves[activeShelf]))}
              </div>
            </div>
          )}
          {activeTab === "profile" && (
          <div className="page profile-page">
            <div className="profile-hero" style={profile.banner ? { backgroundImage: `url(${profile.banner})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}>
              {profile.avatar ? <img src={profile.avatar} alt={profile.name} className="profile-hero-avatar-img" /> : <span className="profile-hero-avatar" style={{ background: profile.color }}>{(profile.name || "G").charAt(0).toUpperCase()}</span>}
                <div className="profile-hero-info">
                  <span className="artist-hero-label glass-text"><UserCircle size={13} /> Profile</span>
                  <h1 className="glass-text">{profile.name || "Guest"}</h1>
                  <p className="glass-text">Account connected : {accounts.length ? accounts.map(a => a.provider.charAt(0).toUpperCase() + a.provider.slice(1)).join(" - ") : "None"}</p>
                  <p className="glass-text">Theme : {theme.charAt(0).toUpperCase() + theme.slice(1)}</p>
                </div>
            </div>
            <motion.div className="profile-tabs" layout>
              {[
                { id: "appearance", label: "Themes", Icon: Palette },
                { id: "accounts", label: "Accounts", Icon: User },
                { id: "discord", label: "Discord RPC", Icon: Gamepad2, ChevronLeft },
                { id: "updates", label: "Updates", Icon: RefreshCw },
                { id: "about", label: "About", Icon: Sparkles },
              ].map((tb) => <Button key={tb.id} className={`ptab ${profileTab === tb.id ? "active" : ""}`} onClick={() => setProfileTab(tb.id)}><tb.Icon size={15} /> {tb.label}</Button>)}
            </motion.div>
            <AnimatePresence mode="wait">
              <motion.div key={profileTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="profile-content">
                {profileTab === "appearance" && (
                  <>
                    <div className="setting-block">
                      <h3>Profile Banner</h3><p className="setting-desc">Upload a custom banner for your profile. (GIF, PNG, JPG)</p>
                      <div className="setting-actions">
                        <label className="btn-primary file-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <Upload size={15} /> Add banner
                          <input type="file" accept="image/png, image/jpeg, image/gif, image/webp" hidden onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onload = (ev) => {
                                const b64 = ev.target?.result as string;
                                setProfile(p => ({ ...p, banner: b64 }));
                              };
                              reader.readAsDataURL(file);
                            }
                          }} />
                        </label>
                        {profile.banner && (
                          <Button variant="ghost" onClick={() => setProfile(p => ({ ...p, banner: null }))}>Remove</Button>
                        )}
                      </div>
                    </div>
                    <div className="setting-block">
                      <h3>Themes</h3><p className="setting-desc">Change application appearance.</p>
                      <div className="theme-grid">
                        {[{ id: "light", label: "Light", Icon: Sun }, { id: "dark", label: "Dark", Icon: Moon }, { id: "amoled", label: "Amoled", Icon: Monitor }].map((tOpt) => (
                          <Button key={tOpt.id} className={`theme-card ${theme === tOpt.id ? "active" : ""}`} onClick={() => setTheme(tOpt.id)}>
                            <span className={`theme-swatch th-${tOpt.id}`}><span className="tsw-bar" /></span>
                            <div className="theme-card-label"><tOpt.Icon size={15} /> {tOpt.label}</div>
                            {theme === tOpt.id && <Check size={16} className="theme-check" />}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div className="setting-block">
                      <h3>Custom CSS</h3><p className="setting-desc">Paste CSS or upload a .css file for your custom theme.</p>
                      <textarea className="css-editor" value={customCss} spellCheck={false} onChange={(e) => setCustomCss(e.target.value)} />
                      <div className="setting-actions">
                        <label className="btn-ghost file-btn"><Upload size={15} /> Upload .css<input type="file" accept=".css,text/css" hidden onChange={(e) => e.target.files?.[0] && uploadCss(e.target.files[0])} /></label>
                        <Button variant="ghost" onClick={() => { setCustomCss(""); flashToast("Custom CSS removed"); }}>Reset</Button>
                      </div>
                    </div>
                  </>
                )}
                {profileTab === "accounts" && (
                  <>
                    <div className="setting-block">
                      <h3>Accounts</h3>
                      <div className="provider-list">
                        {PROVIDERS.map((p) => {
                          const connected = accounts.find((a) => a.provider === p.id);
                          return (
                            <Button key={p.id} className={`provider-btn ${connected ? "connected" : ""}`} onClick={() => toggleAccount(p)}>
                              {connected?.avatar ? <img src={connected.avatar} alt="" style={{ width: 22, height: 22, borderRadius: '50%' }} /> : p.id === "discord" ? <DiscordIcon size={18} /> : <p.Icon size={18} />}
                              <span className="prov-name">{p.label}</span>
                              {connected ? <span className="prov-state"><Check size={14} /> {connected.label}</span> : <span className="prov-cta">Connect Account</span>}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="setting-block">
                      <h3>Configuration Backup</h3><p className="setting-desc">Save all settings to a file.</p>
                      <div className="setting-actions">
                        <Button variant="default" onClick={exportConfig}><Download size={15} /> Export</Button>
                        <label className="btn-ghost file-btn"><Upload size={15} /> Import<input type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importConfig(e.target.files[0])} /></label>
                      </div>
                    </div>
                  </>
                )}
                {profileTab === "discord" && (
                    <div className="setting-block">
                      <h3>Discord Rich Presence</h3>
                      <p className="setting-desc">Show the currently playing song on your Discord status.{!isTauri && " (only on desktop app)"}</p>

                      {(() => {
                        const dc = accounts.find(a => a.provider === "discord");
                        if (dc) {
                          return (
                            <div className="discord-profile-card" style={{ marginTop: 16, background: '#111', borderRadius: 12, overflow: 'hidden', border: '1px solid #222' }}>
                              <div style={{ height: 120, background: dc.banner ? `url(${dc.banner}) center/cover` : (profile.accent_color || '#5865F2'), position: 'relative' }}>
                                <div style={{ position: 'absolute', bottom: -40, left: 24 }}>
                                  <img src={dc.avatar || ''} alt="" style={{ width: 80, height: 80, borderRadius: '50%', border: '6px solid #111', objectFit: 'cover' }} />
                                </div>
                              </div>
                              <div style={{ padding: '46px 24px 20px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{dc.label}</span>
                                </div>
                                <span style={{ fontSize: 14, color: '#888' }}>@{dc.username} ... {dc.id}</span>
                                {dc.bio && <p style={{ fontSize: 13, color: '#aaa', marginTop: 12, lineHeight: 1.5 }}>{dc.bio}</p>}
                              </div>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    <div className="setting-actions" style={{ marginTop: 16 }}>
                      {accounts.some(a => a.provider === "discord") ? (
                        <>
                          {rpcStatus === "on" ? <Button variant="ghost" onClick={disconnectDiscord} style={{ background: '#5865F2', color: 'white', border: 'none', display: 'flex', alignItems: 'center', gap: 8 }}><DiscordIcon size={16} /> Disconnect RPC</Button> : <Button variant="default" onClick={connectDiscord} style={{ background: '#5865F2', color: 'white', border: 'none', display: 'flex', alignItems: 'center', gap: 8 }}><DiscordIcon size={16} /> Connect RPC</Button>}
                          <Button variant="ghost" onClick={() => toggleAccount({ id: 'discord', label: 'Discord' })} style={{ color: '#f87171', borderColor: 'transparent', background: 'rgba(248, 113, 113, 0.1)' }}>Disconnect Account</Button>
                        </>
                      ) : <Button variant="default" onClick={() => toggleAccount({ id: "discord", label: "Discord" })} style={{ background: '#5865F2', color: 'white', border: 'none', display: 'flex', alignItems: 'center', gap: 8 }}><DiscordIcon size={18} /> Login Discord</Button>}
                    </div>
                  </div>
                )}
                {profileTab === "updates" && (
                  <div className="setting-block">
                    <h3>Updates</h3>
                    <div className="setting-actions">
                      <Button variant="default" onClick={checkForUpdate} disabled={isCheckingUpdate} style={{ display: 'flex', alignItems: 'center', gap: 8 }}><RefreshCw size={15} className={isCheckingUpdate ? "spin" : ""} /> {isCheckingUpdate ? "Checking..." : "Check Updates"}</Button>
                    </div>
                    {updateStatus && <p className="setting-hint accent">{updateStatus}</p>}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </main>
      {ctxMenu && (
        <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={(e) => e.stopPropagation()}>
          <Button className="ctx-item" onClick={() => { startMix(ctxMenu.track); setCtxMenu(null); }}><Radio size={17} /> Start mix</Button>
          <Button className="ctx-item" onClick={() => { playNext(ctxMenu.track); setCtxMenu(null); }}><CornerDownRight size={17} /> Play next</Button>
          <Button className="ctx-item" onClick={() => { addToQueue(ctxMenu.track); setCtxMenu(null); }}><ListPlus size={17} /> Add to queue</Button>
          <div className="ctx-sep" />
          <Button className="ctx-item" onClick={() => { toggleFavorite(ctxMenu.track); setCtxMenu(null); }}><Heart size={17} fill={isFavorite(ctxMenu.track.videoId) ? "currentColor" : "none"} /> {isFavorite(ctxMenu.track.videoId) ? "Remove from liked music" : "Add to liked music"}</Button>
          <Button className="ctx-item" onClick={() => { downloadTrack(ctxMenu.track); setCtxMenu(null); }}><Download size={17} /> Download</Button>
          <Button className="ctx-item" onClick={() => { goToArtist(ctxMenu.track.artist); setCtxMenu(null); }}><User size={17} /> Open artist page</Button>
          <Button className="ctx-item" onClick={() => { shareTrack(ctxMenu.track); setCtxMenu(null); }}><Share2 size={17} /> Share</Button>
          <div className="ctx-sep" />
          <Button className="ctx-item danger" onClick={() => { notInterested(ctxMenu.track); setCtxMenu(null); }}><Ban size={17} /> Don't recommend artist</Button>
        </div>
      )}
      {justUpdatedChangelog && (
        <div className="update-modal-overlay" style={{ zIndex: 10000 }}>
          <motion.div className="update-modal" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
            <div className="update-modal-header">
              <RefreshCw size={24} color="var(--accent)" />
              <div>
                <h3>Update Successful!</h3>
                <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Music Venue has been updated to the latest version.</span>
              </div>
            </div>
            <div className="update-modal-body" style={{ whiteSpace: "pre-wrap" }}>
              {justUpdatedChangelog}
            </div>
            <div className="update-modal-actions">
              <Button variant="default" onClick={() => setJustUpdatedChangelog(null)} style={{ width: "100%" }}>Continue</Button>
            </div>
          </motion.div>
        </div>
      )}
      {updateInfo && !justUpdatedChangelog && (
        <div className="update-modal-overlay">
          <motion.div className="update-modal" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
            <div className="update-modal-header">
              <RefreshCw size={24} color="var(--accent)" />
              <div>
                <h3>Music Venue</h3>
                <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Version : 2.0 | Patch : {updateInfo.version}</span>
              </div>
            </div>
            <div className="update-modal-body" style={{ whiteSpace: "pre-wrap" }}>
              {updateInfo.obj.body || "No changelogs available."}
            </div>
            {updateProgress !== null ? (
              <div className="update-progress-container" style={{ padding: "0 24px 20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Downloading update...</span>
                  <span style={{ fontSize: 13, color: "var(--accent)", fontWeight: 600 }}>{updateProgress}%</span>
                </div>
                <div style={{ width: "100%", height: 6, background: "rgba(255,255,255,0.1)", borderRadius: 4, overflow: "hidden" }}>
                  <motion.div 
                    style={{ height: "100%", background: "var(--accent)", borderRadius: 4 }}
                    animate={{ width: `${updateProgress}%` }}
                    transition={{ type: "tween", duration: 0.2 }}
                  />
                </div>
              </div>
            ) : (
              <div className="update-modal-actions">
                <Button variant="ghost" onClick={() => setUpdateInfo(null)}>Later</Button>
                <Button variant="default" onClick={runUpdate}>Update Now</Button>
              </div>
            )}
          </motion.div>
        </div>
      )}
      {toast && <motion.div className="toast" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }}>{toast}</motion.div>}
      <AnimatePresence>
        {nowPlayingOpen && currentTrack && (
          <motion.div className="now-playing" initial={{ y: "100%", opacity: 1 }} animate={{ y: 0, opacity: 1 }} exit={{ y: "100%", opacity: 1 }} transition={{ type: "tween", ease: [0.22, 1, 0.36, 1], duration: 0.45 }}>
            <div className="np-bg" style={{ backgroundImage: `url(${currentTrack.artwork})` }} />
            <Button className="np-close" onClick={() => setNowPlayingOpen(false)}><ChevronDown size={26} /></Button>
            <div className="np-body">
              <div className="np-left">
                <img src={currentTrack.artwork} alt="" className="np-art" />
                <div className="np-meta"><h2>{currentTrack.artist}</h2><p>{currentTrack.title}</p></div>
                <div className="np-progress">
                  <span>{formatTime(currentTime)}</span>
                  <Slider value={[progressPct]} max={100} step={0.1} onValueChange={(val) => { if (audioRef.current) audioRef.current.currentTime = val[0] / 100 * duration; }} className="cursor-pointer" />
                  <span>{formatTime(duration)}</span>
                </div>
                <div className="np-controls">
                  <CtrlButton label="Shuffle" className={`btn-icon ${shuffleMode !== "off" ? "on" : ""}`} onClick={cycleShuffle} title={`Shuffle: ${shuffleMode}`}><Shuffle size={20} />{shuffleMode === "smart" && <span className="mode-dot" />}</CtrlButton>
                  <CtrlButton label="Previous" className="btn-icon" onClick={playPrev}><SkipBack size={26} fill="currentColor" /></CtrlButton>
                  <CtrlButton label={streamLoading ? "Loading" : isPlaying ? "Pause" : "Play"} className="btn-icon btn-play big" onClick={togglePlay}>{streamLoading ? <RefreshCw size={26} className="spin" /> : isPlaying ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" style={{ marginLeft: 3 }} />}</CtrlButton>
                  <CtrlButton label="Next" className="btn-icon" onClick={() => advance(true)}><SkipForward size={26} fill="currentColor" /></CtrlButton>
                  <CtrlButton label="Repeat" className={`btn-icon ${repeatMode !== "off" ? "on" : ""}`} onClick={cycleRepeat} title={`Repeat: ${repeatMode}`}>{repeatMode === "one" ? <Repeat1 size={20} /> : <Repeat size={20} />}</CtrlButton>
                </div>
              </div>
              <div className="np-lyrics" ref={lyricsContainerRef}>
                {lyricsLoading ? <p className="lyric-status">Memuat lirik...</p> : lyrics?.synced.length ? (
                  <>
                  <div className="lyric-sync-bar">
                    <button
                      className={`lyric-sync-btn ${lyricSync ? "on" : ""}`}
                      onClick={() => setLyricSync((s) => !s)}
                      title={lyricSync ? "Auto-scroll: ON — click to disable" : "Auto-scroll: OFF — click to enable"}
                    >
                      <RefreshCw size={13} className={lyricSync ? "spin" : ""} />
                      {lyricSync ? "Auto-scroll on" : "Auto-scroll off"}
                    </button>
                  </div>
                  <div className="lyric-lines">
                    {lyrics.synced.map((line, i) => {
                      const active = i === activeLyric;
                      const past = i < activeLyric;
                      return (
                        <div
                          key={i}
                          className={`blyrics--line ${active ? "blyrics--active" : ""} ${past ? "blyrics--past" : ""}`}
                          onClick={() => { if (audioRef.current) audioRef.current.currentTime = line.t; }}
                        >
                          <span className="blyrics-line-main">
                            {line.parts.map((p, j) => (
                              <span key={`${i}-${j}`} className="blyrics-word-group">
                                <span
                                  className={`blyrics--word${active && prefersReduced ? " blyrics--reduced-active" : ""}`}
                                  data-key={`L${i}W${j}`}
                                  data-time={p.t.toFixed(3)}
                                  data-duration={p.d.toFixed(3)}
                                  data-content={p.text}
                                >{p.text}</span>{" "}
                              </span>
                            ))}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  </>
                ) : lyrics?.plain ? <div className="lyric-plain">{lyrics.plain}</div> : <p className="lyric-status">Lyrics are not available for this song.</p>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showQueue && (
          <>
            <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowQueue(false)} />
            <motion.aside className="queue-panel" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "tween", ease: [0.22, 1, 0.36, 1], duration: 0.35 }}>
              <div className="queue-head"><h3>Playing Next</h3><Button variant="ghost" size="icon" className="" onClick={() => setShowQueue(false)}><X size={18} /></Button></div>
              {currentTrack && <div className="queue-now"><img src={currentTrack.artwork} alt="" /><div className="track-row-text"><span className="track-row-title">{currentTrack.title}</span><span className="track-row-artist">Now Playing</span></div></div>}
              <div className="queue-list">{upNext.length ? upNext.map((t, i) => <div key={t.videoId + i} className="queue-item" onClick={() => { const idx = orderRef.current.findIndex((x) => x.videoId === t.videoId); if (idx >= 0) { posRef.current = idx; loadAndPlay(t); } }} onContextMenu={(e) => openCtx(e, t, orderRef.current)}><img src={t.artwork} alt="" /><div className="track-row-text"><span className="track-row-title">{t.title}</span><span className="track-row-artist">{t.artist}</span></div></div>) : <p className="lyric-status">Antrean kosong.</p>}</div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
      <footer className="player-bar">
        <div className="player-info" onClick={() => currentTrack && setNowPlayingOpen(true)}>
          {currentTrack ? (
            <>
              <img src={currentTrack.artwork} alt="" className="player-artwork" />
              <div className="player-text"><span className="player-title">{currentTrack.artist}</span><span className="player-artist">{currentTrack.title}</span></div>
              <Button className={`player-like ${isFavorite(currentTrack.videoId) ? "active" : ""}`} onClick={(e) => { e.stopPropagation(); toggleFavorite(currentTrack); }}><Heart size={16} fill={isFavorite(currentTrack.videoId) ? "currentColor" : "none"} /></Button>
            </>
          ) : <div className="player-text idle">Not Playing</div>}
        </div>

        <div className="player-controls">
          <div className="control-buttons">
            <CtrlButton label="Shuffle" className={`btn-icon sm ${shuffleMode !== "off" ? "on" : ""}`} onClick={cycleShuffle} title={`Shuffle: ${shuffleMode}`}><Shuffle size={17} />{shuffleMode === "smart" && <span className="mode-dot" />}</CtrlButton>
            <CtrlButton label="Previous" className="btn-icon sm" onClick={playPrev}><SkipBack size={19} fill="currentColor" /></CtrlButton>
            <CtrlButton label={isPlaying ? "Pause" : "Play"} className="btn-icon sm btn-play" onClick={togglePlay}>{isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" style={{ marginLeft: 2 }} />}</CtrlButton>
            <CtrlButton label="Next" className="btn-icon sm" onClick={() => advance(true)}><SkipForward size={19} fill="currentColor" /></CtrlButton>
            <CtrlButton label="Repeat" className={`btn-icon sm ${repeatMode !== "off" ? "on" : ""}`} onClick={cycleRepeat} title={`Repeat: ${repeatMode}`}>{repeatMode === "one" ? <Repeat1 size={17} /> : <Repeat size={17} />}</CtrlButton>
          </div>
          <div className="progress-container">
            <span>{formatTime(currentTime)}</span>
            <Slider value={[progressPct]} max={100} step={0.1} onValueChange={(val) => { if (audioRef.current) audioRef.current.currentTime = val[0] / 100 * duration; }} className="cursor-pointer" />
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="player-extras">
          <CtrlButton label="Lyrics" className={`btn-icon sm ${nowPlayingOpen ? "on" : ""}`} onClick={() => currentTrack && setNowPlayingOpen(true)} title="Lyrics"><Mic2 size={18} /></CtrlButton>
          <CtrlButton label="Queue" className="btn-icon sm" onClick={() => setShowQueue(true)} title="Queue"><ListMusic size={18} /></CtrlButton>
          <CtrlButton label="Mute" className="btn-icon sm" onClick={() => setIsMuted((m) => !m)} title="Mute"><VolIcon size={18} /></CtrlButton>
          <Slider value={[isMuted ? 0 : volume * 100]} max={100} step={1} onValueChange={(val) => { setVolume(val[0] / 100); setIsMuted(false); }} className="w-24 cursor-pointer" />
        </div>
      </footer>

      {/* Login Modal */}
      {showLoginModal && (
        <div className="modal-overlay" onClick={() => setShowLoginModal(false)}>
          <div className="modal-content glass-card" onClick={e => e.stopPropagation()} style={{ width: 400, textAlign: 'center', padding: '2rem' }}>
            <h2 style={{ marginBottom: 10 }}>Login with Google</h2>
            <p style={{ color: '#aaa', marginBottom: 20 }}>Connect your YouTube Music account to get personalized recommendations.</p>
            
            {loginData ? (
              <div>
                <p style={{ marginBottom: 10 }}>Please go to:</p>
                <a href={loginData.verification_url} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginBottom: 20, color: 'var(--accent)', fontSize: '1.1rem', textDecoration: 'none' }}>
                  {loginData.verification_url}
                </a>
                <p style={{ marginBottom: 10 }}>And enter the code:</p>
                <div style={{ fontSize: '2rem', fontWeight: 'bold', letterSpacing: '4px', background: 'rgba(255,255,255,0.1)', padding: '10px', borderRadius: '8px', marginBottom: 20 }}>
                  {loginData.user_code}
                </div>
                {!isPolling ? (
                  <button onClick={startPolling} style={{ background: 'var(--accent)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '20px', cursor: 'pointer', fontSize: '1rem' }}>
                    I have entered the code
                  </button>
                ) : (
                  <button disabled style={{ background: '#555', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '20px', cursor: 'wait', fontSize: '1rem' }}>
                    Waiting for authorization...
                  </button>
                )}
              </div>
            ) : (
              <div>Loading code...</div>
            )}
            
            <button onClick={() => setShowLoginModal(false)} style={{ display: 'block', margin: '20px auto 0', background: 'transparent', color: '#aaa', border: 'none', cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}



