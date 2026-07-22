import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Pause, SkipForward, SkipBack,
  Volume2, Volume1, VolumeX, Search, Home, Heart, Radio,
  X, Minus, Square, Maximize, Repeat, Repeat1, Shuffle,
  ListMusic, Mic2, ChevronRight, ChevronDown, MoreHorizontal, Sparkles
} from "lucide-react";

// ── Types ────────────────────────────────────────────────
interface Track {
  videoId: string;
  title: string;
  artist: string;
  artwork: string;
}
type RepeatMode = "off" | "all" | "one";
type ShuffleMode = "off" | "random" | "smart";
interface LyricLine { t: number; text: string; }
interface Lyrics { synced: LyricLine[]; plain: string; }

// Detect Tauri; pick API base (relative on web, absolute on desktop).
const isTauri = "__TAURI_INTERNALS__" in window;
const API_URL = isTauri ? "https://musicvenue.vercel.app/api" : "/api";
const prefersReduced =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Home shelves — each is one horizontal carousel fed by a distinct query.
const HOME_SHELVES = [
  { id: "new", title: "New Music", subtitle: "Rilisan terbaru buat kamu", query: "new music release 2026" },
  { id: "trend", title: "Trending Now", subtitle: "Yang lagi panas minggu ini", query: "trending songs 2026" },
  { id: "viral", title: "Viral Hits", subtitle: "Lagu viral yang wajib didengar", query: "viral hits 2026" },
];

// ── Helpers ──────────────────────────────────────────────
function mapTracks(data: any): Track[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((item: any) => item.videoId)
    .map((item: any) => ({
      videoId: item.videoId,
      title: item.name || item.title || "Unknown Title",
      artist:
        item.artist?.name ||
        (item.artists && item.artists[0]?.name) ||
        "Unknown Artist",
      artwork:
        item.thumbnails?.[item.thumbnails.length - 1]?.url ||
        item.thumbnails?.[0]?.url ||
        "https://picsum.photos/300",
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

// Smart shuffle: keep it varied by spreading same-artist tracks apart.
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

// Parse an LRC blob into timestamped lines.
function parseLRC(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of lrc.split("\n")) {
    const matches = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!matches.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of matches) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const frac = m[3] ? parseInt(m[3].padEnd(3, "0"), 10) / 1000 : 0;
      out.push({ t: min * 60 + sec + frac, text });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

function formatTime(seconds: number) {
  if (isNaN(seconds) || seconds <= 0) return "0:00";
  const mm = Math.floor(seconds / 60);
  const ss = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

export default function App() {
  const [coreVersion, setCoreVersion] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [activeTab, setActiveTab] = useState("home");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  // Content
  const [shelves, setShelves] = useState<Record<string, Track[]>>({});
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [favorites, setFavorites] = useState<Track[]>(() => {
    try { return JSON.parse(localStorage.getItem("mv:favorites") || "[]"); }
    catch { return []; }
  });

  // Audio
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [playerUrl, setPlayerUrl] = useState<string | null>(null);
  const [streamLoading, setStreamLoading] = useState(false);

  // Modes
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [shuffleMode, setShuffleMode] = useState<ShuffleMode>("off");

  // Panels
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  // Lyrics
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);

  // Refs (for event handlers that must read live values)
  const audioRef = useRef<HTMLAudioElement>(null);
  const orderRef = useRef<Track[]>([]);
  const posRef = useRef(0);
  const contextRef = useRef<Track[]>([]);
  const currentTrackRef = useRef<Track | null>(null);
  const isPlayingRef = useRef(false);
  const volumeRef = useRef(0.8);
  const durationRef = useRef(0);
  const repeatRef = useRef<RepeatMode>("off");
  const shuffleRef = useRef<ShuffleMode>("off");
  const triedDownloadRef = useRef(false);
  const playRequestRef = useRef(0);
  const activeLyricRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { durationRef.current = duration; }, [duration]);
  useEffect(() => { repeatRef.current = repeatMode; }, [repeatMode]);
  useEffect(() => {
    localStorage.setItem("mv:favorites", JSON.stringify(favorites));
  }, [favorites]);

  // ── Data ────────────────────────────────────────────────
  const searchTracks = useCallback(async (query: string): Promise<Track[]> => {
    const res = await fetch(`${API_URL}?action=search&query=${encodeURIComponent(query)}`);
    return mapTracks(await res.json());
  }, []);

  const loadHome = useCallback(async () => {
    setLoading(true);
    const results = await Promise.all(
      HOME_SHELVES.map((s) => searchTracks(s.query).catch(() => [] as Track[]))
    );
    const map: Record<string, Track[]> = {};
    HOME_SHELVES.forEach((s, i) => { map[s.id] = results[i]; });
    setShelves(map);
    setLoading(false);
  }, [searchTracks]);

  const runSearch = useCallback(async (query: string) => {
    setLoading(true);
    try { setSearchResults(await searchTracks(query)); }
    catch { setSearchResults([]); }
    setLoading(false);
  }, [searchTracks]);

  // ── Init ────────────────────────────────────────────────
  useEffect(() => {
    const initApp = async () => {
      if (isTauri) {
        try {
          const version = await invoke("get_core_version");
          setCoreVersion(version as string);
          await invoke("show_main_window");
        } catch (e) { console.error("Tauri invoke error", e); }
      }
    };
    setTimeout(initApp, 150);
    loadHome();
  }, [loadHome]);

  // ── Stream resolution ────────────────────────────────────
  const resolveStreamUrl = async (videoId: string, mode?: string): Promise<string> => {
    const modeParam = mode ? `&mode=${mode}` : "";
    let res = await fetch(`${API_URL}?action=stream&videoId=${videoId}${modeParam}`);
    let data = await res.json();
    for (let i = 0; i < 60 && data.pending && data.taskId; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      res = await fetch(`${API_URL}?action=stream_status&taskId=${encodeURIComponent(data.taskId)}`);
      data = await res.json();
    }
    if (!data.url) throw new Error(data.error || "No stream URL");
    return data.url;
  };

  const startStream = useCallback(async (track: Track, mode?: string) => {
    const requestId = ++playRequestRef.current;
    setStreamLoading(true);
    setPlayerUrl(null);
    setCurrentTime(0);
    setDuration(0);
    try {
      let url: string;
      if (isTauri) {
        // Desktop: resolve locally with bundled yt-dlp (free, user's IP).
        url = await invoke<string>("resolve_audio_url", { videoId: track.videoId });
      } else {
        url = await resolveStreamUrl(track.videoId, mode);
      }
      if (playRequestRef.current !== requestId) return;
      setPlayerUrl(url);
      setIsPlaying(true);
    } catch (e) {
      console.error("Failed to resolve stream", e);
      if (playRequestRef.current === requestId) setIsPlaying(false);
    } finally {
      if (playRequestRef.current === requestId) setStreamLoading(false);
    }
  }, []);

  const loadAndPlay = useCallback((track: Track) => {
    triedDownloadRef.current = false;
    setCurrentTrack(track);
    currentTrackRef.current = track;
    startStream(track);
  }, [startStream]);

  // Build the play order for a track within its context, honouring shuffle.
  const buildOrder = useCallback((context: Track[], start: Track) => {
    const base = context.length ? context : [start];
    contextRef.current = base;
    let order: Track[];
    if (shuffleRef.current === "random") {
      order = [start, ...shuffleArray(base.filter((t) => t.videoId !== start.videoId))];
    } else if (shuffleRef.current === "smart") {
      order = smartOrder(base, start);
    } else {
      order = [...base];
    }
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
      else { setIsPlaying(false); return; } // end of queue, no repeat
    }
    posRef.current = next;
    loadAndPlay(order[next]);
  }, [loadAndPlay]);

  const playPrev = useCallback(() => {
    const order = orderRef.current;
    if (!order.length) return;
    // Restart current track if we're more than 3s in (Apple Music behaviour).
    if (audioRef.current && audioRef.current.currentTime > 3) {
      audioRef.current.currentTime = 0;
      return;
    }
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
    if (repeatRef.current === "one" && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
      return;
    }
    advance(false);
  }, [advance]);

  const handleAudioError = useCallback(() => {
    // Web only: a direct googlevideo URL can be IP-locked → retry via mp3 path.
    if (!isTauri && currentTrackRef.current && !triedDownloadRef.current) {
      triedDownloadRef.current = true;
      startStream(currentTrackRef.current, "download");
    } else {
      setIsPlaying(false);
    }
  }, [startStream]);

  // ── Mode cycling ────────────────────────────────────────
  const cycleRepeat = useCallback(() => {
    setRepeatMode((m) => (m === "off" ? "all" : m === "all" ? "one" : "off"));
  }, []);

  const cycleShuffle = useCallback(() => {
    setShuffleMode((m) => (m === "off" ? "random" : m === "random" ? "smart" : "off"));
  }, []);

  // Rebuild the queue when shuffle mode changes mid-playback.
  useEffect(() => {
    shuffleRef.current = shuffleMode;
    const cur = currentTrackRef.current;
    if (cur && contextRef.current.length) buildOrder(contextRef.current, cur);
  }, [shuffleMode, buildOrder]);

  // ── Audio element sync ──────────────────────────────────
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

  // ── Favorites ───────────────────────────────────────────
  const isFavorite = useCallback(
    (videoId: string) => favorites.some((t) => t.videoId === videoId),
    [favorites]
  );
  const toggleFavorite = useCallback((track: Track) => {
    setFavorites((prev) =>
      prev.some((t) => t.videoId === track.videoId)
        ? prev.filter((t) => t.videoId !== track.videoId)
        : [track, ...prev]
    );
  }, []);

  // ── Lyrics ──────────────────────────────────────────────
  useEffect(() => {
    if (!currentTrack) { setLyrics(null); return; }
    let cancelled = false;
    setLyrics(null);
    setLyricsLoading(true);
    (async () => {
      try {
        const url = `${API_URL}?action=lyrics&title=${encodeURIComponent(currentTrack.title)}&artist=${encodeURIComponent(currentTrack.artist)}`;
        const res = await fetch(url);
        const d = await res.json();
        if (cancelled) return;
        setLyrics({
          synced: d.syncedLyrics ? parseLRC(d.syncedLyrics) : [],
          plain: d.plainLyrics || "",
        });
      } catch {
        if (!cancelled) setLyrics({ synced: [], plain: "" });
      } finally {
        if (!cancelled) setLyricsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentTrack]);

  const activeLyric = useMemo(() => {
    if (!lyrics?.synced.length) return -1;
    let idx = -1;
    for (let i = 0; i < lyrics.synced.length; i++) {
      if (lyrics.synced[i].t <= currentTime + 0.25) idx = i;
      else break;
    }
    return idx;
  }, [lyrics, currentTime]);

  useEffect(() => {
    if (nowPlayingOpen && activeLyricRef.current) {
      activeLyricRef.current.scrollIntoView({
        block: "center",
        behavior: prefersReduced ? "auto" : "smooth",
      });
    }
  }, [activeLyric, nowPlayingOpen]);

  // ── Media Session (OS media keys / lock screen) ─────────
  useEffect(() => {
    if (!("mediaSession" in navigator) || !currentTrack) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: "Music Venue",
      artwork: [{ src: currentTrack.artwork, sizes: "512x512", type: "image/jpeg" }],
    });
    navigator.mediaSession.setActionHandler("play", () => setIsPlaying(true));
    navigator.mediaSession.setActionHandler("pause", () => setIsPlaying(false));
    navigator.mediaSession.setActionHandler("previoustrack", () => playPrev());
    navigator.mediaSession.setActionHandler("nexttrack", () => advance(true));
  }, [currentTrack, playPrev, advance]);

  // ── Keyboard shortcuts ──────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      switch (e.code) {
        case "Space": e.preventDefault(); togglePlay(); break;
        case "ArrowRight":
          if (audioRef.current) audioRef.current.currentTime = Math.min(durationRef.current, audioRef.current.currentTime + 5);
          break;
        case "ArrowLeft":
          if (audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
          break;
        case "ArrowUp": e.preventDefault(); setVolume((v) => Math.min(1, +(v + 0.05).toFixed(2))); setIsMuted(false); break;
        case "ArrowDown": e.preventDefault(); setVolume((v) => Math.max(0, +(v - 0.05).toFixed(2))); break;
        case "KeyN": advance(true); break;
        case "KeyP": playPrev(); break;
        case "KeyS": cycleShuffle(); break;
        case "KeyR": cycleRepeat(); break;
        case "KeyM": setIsMuted((m) => !m); break;
        case "KeyL": if (currentTrackRef.current) setNowPlayingOpen((o) => !o); break;
        case "Escape": setNowPlayingOpen(false); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, advance, playPrev, cycleShuffle, cycleRepeat]);

  // ── Window controls (Tauri) ─────────────────────────────
  const win = () => getCurrentWindow();
  const handleMinimize = async () => { if (isTauri) await win().minimize(); };
  const handleMaximize = async () => {
    if (!isTauri) return;
    const w = win();
    if (await w.isMaximized()) { await w.unmaximize(); setIsMaximized(false); }
    else { await w.maximize(); setIsMaximized(true); }
  };
  const handleClose = async () => { if (isTauri) await win().close(); };
  const handleDrag = async (e: React.MouseEvent) => {
    if (isTauri && e.button === 0) await win().startDragging();
  };

  // ── Progress / volume interaction ───────────────────────
  const seekTo = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
  };

  const volumeBarRef = useRef<HTMLDivElement>(null);
  const handleVolumeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const update = (clientX: number) => {
      if (!volumeBarRef.current) return;
      const rect = volumeBarRef.current.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      setVolume(pos);
      setIsMuted(pos === 0);
    };
    update(e.clientX);
    const move = (ev: MouseEvent) => update(ev.clientX);
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  // ── Search / tabs ───────────────────────────────────────
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) { setActiveTab("search"); runSearch(searchQuery); }
  };

  const handleTabClick = (tab: string) => {
    setActiveTab(tab);
    if (tab === "home" && !Object.keys(shelves).length) loadHome();
    else if (tab === "radio") runSearch("Lo-fi radio chill");
  };

  const getPageTitle = () => {
    switch (activeTab) {
      case "home": return "Listen Now";
      case "favorites": return "Liked Music";
      case "radio": return "Radio";
      case "search": return "Search";
      default: return "Music Venue";
    }
  };

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const VolIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const upNext = orderRef.current.slice(posRef.current + 1);

  // ── Reusable renderers ──────────────────────────────────
  const AlbumCard = ({ track, context }: { track: Track; context: Track[] }) => (
    <div className="album-card" onClick={() => playTrack(track, context)}>
      <div className="album-art-wrap">
        <img src={track.artwork} alt={track.title} className="album-artwork" loading="lazy" />
        <div className="album-play-overlay">
          <div className="mini-play"><Play size={18} fill="currentColor" /></div>
        </div>
      </div>
      <div className="album-info">
        <h3>{track.title}</h3>
        <p>{track.artist}</p>
      </div>
    </div>
  );

  const TrackRow = ({ track, context, index }: { track: Track; context: Track[]; index: number }) => {
    const playing = currentTrack?.videoId === track.videoId;
    return (
      <div className={`track-row ${playing ? "playing" : ""}`} onDoubleClick={() => playTrack(track, context)}>
        <div className="track-row-index">
          <span className="track-num">{index + 1}</span>
          <button className="track-row-play" onClick={() => playTrack(track, context)} title="Play">
            {playing && isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          </button>
        </div>
        <img src={track.artwork} alt="" className="track-row-art" loading="lazy" />
        <div className="track-row-text">
          <span className="track-row-title">{track.title}</span>
          <span className="track-row-artist">{track.artist}</span>
        </div>
        <button
          className={`track-row-like ${isFavorite(track.videoId) ? "active" : ""}`}
          onClick={() => toggleFavorite(track)}
          title={isFavorite(track.videoId) ? "Remove from Liked" : "Add to Liked"}
        >
          <Heart size={16} fill={isFavorite(track.videoId) ? "currentColor" : "none"} />
        </button>
        <button className="track-row-more" title="More"><MoreHorizontal size={16} /></button>
      </div>
    );
  };

  const Shelf = ({ id, title, subtitle }: { id: string; title: string; subtitle: string }) => {
    const tracks = shelves[id] || [];
    return (
      <section className="shelf">
        <div className="shelf-head">
          <div>
            <h2>{title} <ChevronRight size={20} /></h2>
            <p>{subtitle}</p>
          </div>
        </div>
        <div className="shelf-scroll">
          {loading && !tracks.length
            ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="album-card skeleton"><div className="album-art-wrap sk" /></div>)
            : tracks.map((t) => <AlbumCard key={t.videoId} track={t} context={tracks} />)}
        </div>
      </section>
    );
  };

  // ── Render ──────────────────────────────────────────────
  return (
    <div className="app-container">
      {playerUrl && (
        <audio
          ref={audioRef}
          src={playerUrl}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onDurationChange={(e) => setDuration(e.currentTarget.duration)}
          onEnded={handleEnded}
          onError={handleAudioError}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="drag-region" onMouseDown={handleDrag} />
        <div className="sidebar-brand"><Sparkles size={20} /> Music Venue</div>
        <div className="sidebar-section">
          <div className={`nav-item ${activeTab === "home" ? "active" : ""}`} onClick={() => handleTabClick("home")}>
            <Home size={20} /> Listen Now
          </div>
          <div className={`nav-item ${activeTab === "search" ? "active" : ""}`} onClick={() => setActiveTab("search")}>
            <Search size={20} /> Search
          </div>
          <div className={`nav-item ${activeTab === "radio" ? "active" : ""}`} onClick={() => handleTabClick("radio")}>
            <Radio size={20} /> Radio
          </div>
        </div>
        <div className="sidebar-section">
          <div className="sidebar-title">Library</div>
          <div className={`nav-item ${activeTab === "favorites" ? "active" : ""}`} onClick={() => setActiveTab("favorites")}>
            <Heart size={20} /> Liked Music
            {favorites.length > 0 && <span className="nav-count">{favorites.length}</span>}
          </div>
          <div className="nav-item" onClick={() => setShowQueue(true)}>
            <ListMusic size={20} /> Queue
          </div>
        </div>
        {coreVersion && <div className="sidebar-foot">Core: {coreVersion}</div>}
      </aside>

      {/* ── Main ── */}
      <main className="main-content">
        <header className="header">
          <div className="header-drag" onMouseDown={handleDrag}>
            <h1>{getPageTitle()}</h1>
          </div>
          <div className="header-right">
            <form onSubmit={handleSearch} className="search-box">
              <Search size={16} />
              <input
                type="text"
                placeholder="Artists, Songs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setActiveTab("search")}
              />
            </form>
            {isTauri && (
              <div className="window-controls">
                <button className="win-btn" onClick={handleMinimize}><Minus size={16} /></button>
                <button className="win-btn" onClick={handleMaximize}>{isMaximized ? <Square size={12} /> : <Maximize size={14} />}</button>
                <button className="win-btn win-btn-close" onClick={handleClose}><X size={16} /></button>
              </div>
            )}
          </div>
        </header>

        {/* Home */}
        {activeTab === "home" && (
          <div className="page">
            {HOME_SHELVES.map((s) => <Shelf key={s.id} id={s.id} title={s.title} subtitle={s.subtitle} />)}
            <section className="shelf">
              <div className="shelf-head">
                <div><h2>Favourite Music <ChevronRight size={20} /></h2><p>Lagu yang kamu suka</p></div>
              </div>
              {favorites.length ? (
                <div className="track-grid">
                  {favorites.map((t, i) => <TrackRow key={t.videoId} track={t} context={favorites} index={i} />)}
                </div>
              ) : (
                <div className="empty-state">
                  <Heart size={34} />
                  <p>Belum ada lagu favorit</p>
                  <span>Tekan ikon ♥ pada lagu untuk menyimpannya di sini.</span>
                </div>
              )}
            </section>
          </div>
        )}

        {/* Favorites tab */}
        {activeTab === "favorites" && (
          <div className="page">
            {favorites.length ? (
              <div className="track-grid wide">
                {favorites.map((t, i) => <TrackRow key={t.videoId} track={t} context={favorites} index={i} />)}
              </div>
            ) : (
              <div className="empty-state big">
                <Heart size={44} />
                <p>Liked Music masih kosong</p>
                <span>Semua lagu yang kamu tandai ♥ akan muncul di sini.</span>
              </div>
            )}
          </div>
        )}

        {/* Search / Radio */}
        {(activeTab === "search" || activeTab === "radio") && (
          <div className="page">
            {loading ? (
              <div className="grid-container">
                {Array.from({ length: 10 }).map((_, i) => <div key={i} className="album-card skeleton"><div className="album-art-wrap sk" /></div>)}
              </div>
            ) : searchResults.length ? (
              <div className="grid-container">
                {searchResults.map((t) => <AlbumCard key={t.videoId} track={t} context={searchResults} />)}
              </div>
            ) : (
              <div className="empty-state big">
                <Search size={44} />
                <p>{activeTab === "radio" ? "Radio" : "Cari lagu favoritmu"}</p>
                <span>Ketik nama artis atau judul lagu di kotak pencarian.</span>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Now Playing overlay ── */}
      <AnimatePresence>
        {nowPlayingOpen && currentTrack && (
          <motion.div
            className="now-playing"
            initial={{ y: prefersReduced ? 0 : "100%", opacity: prefersReduced ? 0 : 1 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: prefersReduced ? 0 : "100%", opacity: prefersReduced ? 0 : 1 }}
            transition={{ type: "tween", ease: [0.22, 1, 0.36, 1], duration: 0.45 }}
          >
            <div className="np-bg" style={{ backgroundImage: `url(${currentTrack.artwork})` }} />
            <button className="np-close" onClick={() => setNowPlayingOpen(false)}><ChevronDown size={26} /></button>
            <div className="np-body">
              <div className="np-left">
                <img src={currentTrack.artwork} alt="" className={`np-art ${isPlaying ? "spinning" : ""}`} />
                <div className="np-meta">
                  <h2>{currentTrack.title}</h2>
                  <p>{currentTrack.artist}</p>
                </div>
                <div className="np-progress">
                  <span>{formatTime(currentTime)}</span>
                  <div className="progress-bar" onClick={seekTo}><div className="progress-fill" style={{ width: `${progressPct}%` }} /></div>
                  <span>{formatTime(duration)}</span>
                </div>
                <div className="np-controls">
                  <button className={`btn-icon ${shuffleMode !== "off" ? "on" : ""}`} onClick={cycleShuffle} title={`Shuffle: ${shuffleMode}`}>
                    <Shuffle size={20} />{shuffleMode === "smart" && <span className="mode-dot smart" />}
                  </button>
                  <button className="btn-icon" onClick={playPrev}><SkipBack size={26} fill="currentColor" /></button>
                  <button className="btn-icon btn-play big" onClick={togglePlay}>
                    {isPlaying ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" style={{ marginLeft: 3 }} />}
                  </button>
                  <button className="btn-icon" onClick={() => advance(true)}><SkipForward size={26} fill="currentColor" /></button>
                  <button className={`btn-icon ${repeatMode !== "off" ? "on" : ""}`} onClick={cycleRepeat} title={`Repeat: ${repeatMode}`}>
                    {repeatMode === "one" ? <Repeat1 size={20} /> : <Repeat size={20} />}
                  </button>
                </div>
              </div>
              <div className="np-lyrics">
                {lyricsLoading ? (
                  <p className="lyric-status">Memuat lirik…</p>
                ) : lyrics?.synced.length ? (
                  <div className="lyric-lines">
                    {lyrics.synced.map((line, i) => (
                      <p
                        key={i}
                        ref={i === activeLyric ? activeLyricRef : null}
                        className={`lyric-line ${i === activeLyric ? "active" : ""} ${i < activeLyric ? "past" : ""}`}
                        onClick={() => { if (audioRef.current) audioRef.current.currentTime = line.t; }}
                      >
                        {line.text || "♪"}
                      </p>
                    ))}
                  </div>
                ) : lyrics?.plain ? (
                  <div className="lyric-plain">{lyrics.plain}</div>
                ) : (
                  <p className="lyric-status">Lirik tidak tersedia untuk lagu ini.</p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Queue drawer ── */}
      <AnimatePresence>
        {showQueue && (
          <>
            <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowQueue(false)} />
            <motion.aside
              className="queue-panel"
              initial={{ x: prefersReduced ? 0 : "100%" }}
              animate={{ x: 0 }}
              exit={{ x: prefersReduced ? 0 : "100%" }}
              transition={{ type: "tween", ease: [0.22, 1, 0.36, 1], duration: 0.35 }}
            >
              <div className="queue-head"><h3>Playing Next</h3><button className="btn-icon" onClick={() => setShowQueue(false)}><X size={18} /></button></div>
              {currentTrack && (
                <div className="queue-now">
                  <img src={currentTrack.artwork} alt="" />
                  <div className="track-row-text"><span className="track-row-title">{currentTrack.title}</span><span className="track-row-artist">Now Playing</span></div>
                </div>
              )}
              <div className="queue-list">
                {upNext.length ? upNext.map((t, i) => (
                  <div key={t.videoId + i} className="queue-item" onClick={() => { const idx = orderRef.current.findIndex((x) => x.videoId === t.videoId); if (idx >= 0) { posRef.current = idx; loadAndPlay(t); } }}>
                    <img src={t.artwork} alt="" />
                    <div className="track-row-text"><span className="track-row-title">{t.title}</span><span className="track-row-artist">{t.artist}</span></div>
                  </div>
                )) : <p className="lyric-status">Antrean kosong.</p>}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ── Player bar ── */}
      <footer className="player-bar">
        <div className="player-info" onClick={() => currentTrack && setNowPlayingOpen(true)}>
          {currentTrack ? (
            <>
              <img src={currentTrack.artwork} alt="" className="player-artwork" />
              <div className="player-text">
                <span className="player-title">{currentTrack.title}</span>
                <span className="player-artist">{streamLoading ? "Loading audio…" : currentTrack.artist}</span>
              </div>
              <button className={`player-like ${isFavorite(currentTrack.videoId) ? "active" : ""}`} onClick={(e) => { e.stopPropagation(); toggleFavorite(currentTrack); }}>
                <Heart size={16} fill={isFavorite(currentTrack.videoId) ? "currentColor" : "none"} />
              </button>
            </>
          ) : (
            <div className="player-text idle">Not Playing</div>
          )}
        </div>

        <div className="player-controls">
          <div className="control-buttons">
            <button className={`btn-icon sm ${shuffleMode !== "off" ? "on" : ""}`} onClick={cycleShuffle} title={`Shuffle: ${shuffleMode}`}>
              <Shuffle size={17} />{shuffleMode === "smart" && <span className="mode-dot smart" />}
            </button>
            <button className="btn-icon" onClick={playPrev}><SkipBack size={19} fill="currentColor" /></button>
            <button className="btn-icon btn-play" onClick={togglePlay}>
              {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" style={{ marginLeft: 2 }} />}
            </button>
            <button className="btn-icon" onClick={() => advance(true)}><SkipForward size={19} fill="currentColor" /></button>
            <button className={`btn-icon sm ${repeatMode !== "off" ? "on" : ""}`} onClick={cycleRepeat} title={`Repeat: ${repeatMode}`}>
              {repeatMode === "one" ? <Repeat1 size={17} /> : <Repeat size={17} />}
            </button>
          </div>
          <div className="progress-container">
            <span>{formatTime(currentTime)}</span>
            <div className="progress-bar" onClick={seekTo}><div className="progress-fill" style={{ width: `${progressPct}%` }} /></div>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="player-extras">
          <button className={`btn-icon sm ${nowPlayingOpen ? "on" : ""}`} onClick={() => currentTrack && setNowPlayingOpen(true)} title="Lyrics"><Mic2 size={18} /></button>
          <button className="btn-icon sm" onClick={() => setShowQueue(true)} title="Queue"><ListMusic size={18} /></button>
          <button className="btn-icon sm" onClick={() => setIsMuted((m) => !m)} title="Mute"><VolIcon size={18} /></button>
          <div className="progress-bar volume-bar" ref={volumeBarRef} onMouseDown={handleVolumeMouseDown}>
            <div className="progress-fill" style={{ width: `${isMuted ? 0 : volume * 100}%` }} />
          </div>
        </div>
      </footer>
    </div>
  );
}
