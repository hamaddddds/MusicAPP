import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Pause, SkipForward, SkipBack,
  Volume2, Volume1, VolumeX, Search, Home, Heart, Radio, Clock,
  X, Minus, Square, Maximize, Repeat, Repeat1, Shuffle,
  ListMusic, Mic2, ChevronRight, ChevronDown, MoreHorizontal, Sparkles,
  ListPlus, CornerDownRight, Download, Share2, User, Ban, RefreshCw,
  Settings, Palette, Sun, Moon, Monitor, Upload, Check, LogIn, Mail,
  UserCircle, Gamepad2
} from "lucide-react";

// ── Types ────────────────────────────────────────────────
interface Track { videoId: string; title: string; artist: string; artwork: string; }
type RepeatMode = "off" | "all" | "one";
type ShuffleMode = "off" | "random" | "smart";
interface LyricLine { t: number; text: string; }
interface Lyrics { synced: LyricLine[]; plain: string; }
interface HistEntry extends Track { count: number; last: number; }
interface Region { country: string | null; countryCode: string | null; city: string | null; }
interface CtxMenu { x: number; y: number; track: Track; context: Track[]; }
interface UpdateInfo { version: string; obj: any; }
interface ArtistHead { artistId: string; name: string; thumbnails: any[]; subscribers?: string | null; }
interface ArtistPage { artist: ArtistHead | null; songs: Track[]; }

const isTauri = "__TAURI_INTERNALS__" in window;
const API_URL = isTauri ? "https://musicvenue.vercel.app/api" : "/api";
const prefersReduced =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const HOME_SHELVES = [
  { id: "new", title: "New Music", subtitle: "Rilisan terbaru buat kamu", query: "new music release 2026" },
  { id: "trend", title: "Trending Now", subtitle: "Yang lagi panas minggu ini", query: "trending songs 2026" },
  { id: "viral", title: "Viral Hits", subtitle: "Lagu viral yang wajib didengar", query: "viral hits 2026" },
];

const PROFILE_TABS = [
  { id: "appearance", label: "Tampilan", Icon: Palette },
  { id: "accounts", label: "Akun", Icon: User },
  { id: "discord", label: "Discord RPC", Icon: Gamepad2 },
  { id: "updates", label: "Update", Icon: RefreshCw },
  { id: "about", label: "Tentang", Icon: Sparkles },
];
const PROVIDERS = [
  { id: "google", label: "Google", Icon: LogIn },
  { id: "github", label: "GitHub", Icon: LogIn },
  { id: "email", label: "Email", Icon: Mail },
  { id: "discord", label: "Discord", Icon: Gamepad2 },
];
const THEME_OPTIONS = [
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark (Abu-abu)", Icon: Moon },
  { id: "amoled", label: "AMOLED", Icon: Monitor },
];

// ── localStorage helpers ─────────────────────────────────
const load = <T,>(k: string, fallback: T): T => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
};

// ── Track mapping / algorithms ───────────────────────────
// YouTube Music serves tiny thumbnails (60–120px). Google's image CDN lets us
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
      title: item.name || item.title || "Unknown Title",
      artist: item.artist?.name || (item.artists && item.artists[0]?.name) || "Unknown Artist",
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

// Rank artists by frequency × recency. Half-life ≈ 14 days.
function artistScores(history: Record<string, HistEntry>): [string, number][] {
  const now = Date.now();
  const scores: Record<string, number> = {};
  for (const h of Object.values(history)) {
    const days = (now - h.last) / 86400000;
    const recency = Math.pow(0.5, days / 14); // 1.0 today → 0.5 after 14d
    scores[h.artist] = (scores[h.artist] || 0) + h.count * (0.4 + 0.6 * recency);
  }
  return Object.entries(scores).sort((a, b) => b[1] - a[1]);
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
  const [quickPicks, setQuickPicks] = useState<Track[]>(() => load("mv:quickpicks", { tracks: [] } as any).tracks || []);
  const [searchPopular, setSearchPopular] = useState<Track[]>([]);
  const [searchOther, setSearchOther] = useState<Track[]>([]);
  const [searchArtist, setSearchArtist] = useState<ArtistHead | null>(null);
  const [artistView, setArtistView] = useState<ArtistPage | null>(null);
  const [artistLoading, setArtistLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>(() => load("mv:searches", []));
  const [favorites, setFavorites] = useState<Track[]>(() => load("mv:favorites", []));
  const [history, setHistory] = useState<Record<string, HistEntry>>(() => load("mv:history", {}));
  const [blocked, setBlocked] = useState<string[]>(() => load("mv:blocked", []));
  const [region, setRegion] = useState<Region | null>(() => load("mv:region", null));

  // Appearance / profile / accounts / RPC
  const [theme, setTheme] = useState<string>(() => load("mv:theme", "dark"));
  const [customCss, setCustomCss] = useState<string>(() => load("mv:customcss", ""));
  const [profileTab, setProfileTab] = useState("appearance");
  const [profile, setProfile] = useState<{ name: string; color: string }>(() => load("mv:profile", { name: "Guest", color: "#fa243c" }));
  const [accounts, setAccounts] = useState<{ provider: string; label: string }[]>(() => load("mv:accounts", []));
  const [rpcClientId, setRpcClientId] = useState<string>(() => load("mv:rpc-clientid", ""));
  const [rpcEnabled, setRpcEnabled] = useState<boolean>(() => load("mv:rpc-enabled", false));
  const [rpcStatus, setRpcStatus] = useState<"off" | "connecting" | "on" | "error">("off");
  const [updateStatus, setUpdateStatus] = useState<string>("");

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

  // Panels & overlays
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);

  // Lyrics
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);

  // Refs
  const audioRef = useRef<HTMLAudioElement>(null);
  const orderRef = useRef<Track[]>([]);
  const posRef = useRef(0);
  const contextRef = useRef<Track[]>([]);
  const currentTrackRef = useRef<Track | null>(null);
  const durationRef = useRef(0);
  const repeatRef = useRef<RepeatMode>("off");
  const shuffleRef = useRef<ShuffleMode>("off");
  const triedDownloadRef = useRef(false);
  const playRequestRef = useRef(0);
  const activeLyricRef = useRef<HTMLParagraphElement | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const suggestTimer = useRef<number | undefined>(undefined);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const rpcStatusRef = useRef<"off" | "connecting" | "on" | "error">("off");

  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { durationRef.current = duration; }, [duration]);
  useEffect(() => { repeatRef.current = repeatMode; }, [repeatMode]);
  useEffect(() => { localStorage.setItem("mv:favorites", JSON.stringify(favorites)); }, [favorites]);
  useEffect(() => { localStorage.setItem("mv:history", JSON.stringify(history)); }, [history]);
  useEffect(() => { localStorage.setItem("mv:blocked", JSON.stringify(blocked)); }, [blocked]);
  useEffect(() => { localStorage.setItem("mv:searches", JSON.stringify(searchHistory)); }, [searchHistory]);
  useEffect(() => { localStorage.setItem("mv:profile", JSON.stringify(profile)); }, [profile]);
  useEffect(() => { localStorage.setItem("mv:accounts", JSON.stringify(accounts)); }, [accounts]);
  useEffect(() => { rpcStatusRef.current = rpcStatus; }, [rpcStatus]);

  // Apply theme to the document root.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("mv:theme", JSON.stringify(theme));
  }, [theme]);

  // Inject user's custom CSS (client-uploaded theme).
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

  // ── Data ────────────────────────────────────────────────
  const searchTracks = useCallback(async (query: string): Promise<Track[]> => {
    const res = await fetch(`${API_URL}?action=search&query=${encodeURIComponent(query)}`);
    return mapTracks(await res.json());
  }, []);

  const searchSongs = useCallback(async (query: string): Promise<Track[]> => {
    const res = await fetch(`${API_URL}?action=search_sections&query=${encodeURIComponent(query)}`);
    const d = await res.json();
    return mapTracks(d.popular || []);
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
    setShowSuggest(false);
    setSearchHistory((prev) => [query, ...prev.filter((x) => x !== query)].slice(0, 8));
    try {
      const res = await fetch(`${API_URL}?action=search_sections&query=${encodeURIComponent(query)}`);
      const d = await res.json();
      setSearchArtist(d.artist && d.artist.artistId ? d.artist : null);
      setSearchPopular(mapTracks(d.popular || []));
      setSearchOther(mapTracks(d.other || []));
    } catch {
      setSearchArtist(null); setSearchPopular([]); setSearchOther([]);
    }
    setLoading(false);
  }, []);

  // Debounced autocomplete suggestions.
  const fetchSuggestions = useCallback((q: string) => {
    window.clearTimeout(suggestTimer.current);
    if (!q.trim()) { setSuggestions([]); return; }
    suggestTimer.current = window.setTimeout(async () => {
      try {
        const d = await (await fetch(`${API_URL}?action=suggest&query=${encodeURIComponent(q)}`)).json();
        setSuggestions(d.suggestions || []);
      } catch { setSuggestions([]); }
    }, 180);
  }, []);

  // Open the dedicated artist page (all of that artist's songs, nothing else).
  const openArtist = useCallback(async (opts: { artistId?: string; name?: string }) => {
    setActiveTab("artist");
    setShowSuggest(false);
    setArtistLoading(true);
    setArtistView(null);
    try {
      const param = opts.artistId
        ? `artistId=${encodeURIComponent(opts.artistId)}`
        : `query=${encodeURIComponent(opts.name || "")}`;
      const d = await (await fetch(`${API_URL}?action=artist&${param}`)).json();
      setArtistView({ artist: d.artist || null, songs: mapTracks(d.songs || []) });
    } catch {
      setArtistView({ artist: null, songs: [] });
    }
    setArtistLoading(false);
  }, []);

  // Quick Picks: weighted play history × region-popular, minus blocklist.
  const buildQuickPicks = useCallback(async (reg: Region | null) => {
    const cache = load("mv:quickpicks", null as any);
    const fresh = cache && Date.now() - cache.at < 3 * 3600_000 && cache.tracks?.length;
    if (fresh) { setQuickPicks(cache.tracks); return; }

    const blockedSet = new Set(blocked);
    const topArtists = artistScores(history).slice(0, 4).map((a) => a[0]);
    const regionQuery = reg?.country ? `top songs ${reg.country}` : "top songs 2026";

    const queries = topArtists.length
      ? [...topArtists, regionQuery]
      : [regionQuery, "popular songs 2026", "top hits 2026"];

    const groups = await Promise.all(queries.map((q) => searchSongs(q).catch(() => [] as Track[])));

    // Interleave one from each group at a time so the mix stays varied.
    const merged: Track[] = [];
    const seen = new Set<string>();
    for (let round = 0; round < 4; round++) {
      for (const g of groups) {
        const t = g[round];
        if (t && !seen.has(t.videoId) && !blockedSet.has(t.artist)) {
          seen.add(t.videoId);
          merged.push(t);
        }
      }
    }
    const picks = merged.slice(0, 12);
    setQuickPicks(picks);
    localStorage.setItem("mv:quickpicks", JSON.stringify({ at: Date.now(), tracks: picks }));
  }, [history, blocked, searchSongs]);

  // Reshuffle + refresh the home page (triggered by re-clicking Listen Now).
  const reshuffleHome = useCallback(async () => {
    flashToast("Menyusun ulang…");
    setShelves((prev) => {
      const n: Record<string, Track[]> = {};
      for (const k in prev) n[k] = shuffleArray(prev[k]);
      return n;
    });
    localStorage.removeItem("mv:quickpicks");
    await loadHome();
    buildQuickPicks(region);
  }, [loadHome, buildQuickPicks, region, flashToast]);

  // ── Discord RPC ─────────────────────────────────────────
  // The native IPC bridge ships in a follow-up build; the settings + live
  // preview are active now. pushRpc is a guarded no-op until then.
  const pushRpc = useCallback(async (_track: Track) => {
    if (rpcStatusRef.current !== "on") return;
    // native invoke wired in a later build
  }, []);

  const connectDiscord = useCallback(async () => {
    if (!rpcClientId.trim()) { flashToast("Isi Discord Application ID dulu."); return; }
    flashToast("Discord RPC native sedang difinalisasi untuk build desktop. Preview & setelan sudah tersimpan.");
  }, [rpcClientId, flashToast]);

  const disconnectDiscord = useCallback(async () => {
    setRpcStatus("off"); rpcStatusRef.current = "off"; setRpcEnabled(false);
  }, []);

  // ── Manual update check ─────────────────────────────────
  const checkUpdateManually = useCallback(async () => {
    if (!isTauri) { setUpdateStatus("Update otomatis hanya tersedia di aplikasi desktop."); return; }
    setUpdateStatus("Memeriksa pembaruan…");
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update?.available) {
        setUpdateInfo({ version: update.version, obj: update });
        setUpdateStatus(`Versi ${update.version} tersedia!`);
      } else setUpdateStatus("Kamu sudah memakai versi terbaru.");
    } catch (e) { console.error(e); setUpdateStatus("Gagal memeriksa pembaruan."); }
  }, []);

  // ── Config export / import (portable settings) ──────────
  const exportConfig = useCallback(() => {
    const cfg: Record<string, any> = {};
    for (const k of Object.keys(localStorage)) if (k.startsWith("mv:")) cfg[k] = localStorage.getItem(k);
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "musicvenue-config.json";
    a.click();
    URL.revokeObjectURL(a.href);
    flashToast("Konfigurasi diekspor");
  }, [flashToast]);

  const importConfig = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const cfg = JSON.parse(String(reader.result));
        for (const k in cfg) if (k.startsWith("mv:")) localStorage.setItem(k, cfg[k]);
        flashToast("Konfigurasi diimpor — memuat ulang…");
        setTimeout(() => location.reload(), 800);
      } catch { flashToast("File konfigurasi tidak valid."); }
    };
    reader.readAsText(file);
  }, [flashToast]);

  const uploadCss = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => { setCustomCss(String(reader.result)); flashToast("Custom CSS diterapkan"); };
    reader.readAsText(file);
  }, [flashToast]);

  const toggleAccount = useCallback((p: { id: string; label: string }) => {
    setAccounts((prev) =>
      prev.find((a) => a.provider === p.id)
        ? prev.filter((a) => a.provider !== p.id)
        : [...prev, { provider: p.id, label: "Lokal" }]
    );
    flashToast(`${p.label} ditandai (lokal). Login OAuth asli perlu backend.`);
  }, [flashToast]);

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

    // Region (for Quick Picks), then build the picks.
    (async () => {
      let reg = load<Region | null>("mv:region", null);
      try {
        if (!reg) {
          const res = await fetch(`${API_URL}?action=geo`);
          reg = await res.json();
          localStorage.setItem("mv:region", JSON.stringify(reg));
          setRegion(reg);
        }
      } catch { /* region optional */ }
      buildQuickPicks(reg);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-update (Tauri) ─────────────────────────────────
  useEffect(() => {
    if (!isTauri) return;
    (async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (update?.available) {
          const dismissed = localStorage.getItem("mv:update-dismissed");
          // Persist the latest known version for the client.
          localStorage.setItem("mv:update-latest", update.version);
          if (dismissed !== update.version) setUpdateInfo({ version: update.version, obj: update });
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
      flashToast("Gagal memperbarui. Coba lagi nanti.");
      setUpdateProgress(null);
    }
  }, [updateInfo, flashToast]);

  const dismissUpdate = useCallback(() => {
    if (updateInfo) localStorage.setItem("mv:update-dismissed", updateInfo.version);
    setUpdateInfo(null);
  }, [updateInfo]);

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
      if (isTauri) url = await invoke<string>("resolve_audio_url", { videoId: track.videoId });
      else url = await resolveStreamUrl(track.videoId, mode);
      if (playRequestRef.current !== requestId) return;
      setPlayerUrl(url);
      setIsPlaying(true);
    } catch (e) {
      console.error("Failed to resolve stream", e);
      if (playRequestRef.current === requestId) { setIsPlaying(false); flashToast("Gagal memuat audio."); }
    } finally {
      if (playRequestRef.current === requestId) setStreamLoading(false);
    }
  }, [flashToast]);

  const recordPlay = useCallback((track: Track) => {
    setHistory((prev) => {
      const cur = prev[track.videoId];
      return {
        ...prev,
        [track.videoId]: { ...track, count: (cur?.count || 0) + 1, last: Date.now() },
      };
    });
  }, []);

  const loadAndPlay = useCallback((track: Track) => {
    triedDownloadRef.current = false;
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
    if (repeatRef.current === "one" && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
      return;
    }
    advance(false);
  }, [advance]);

  const handleAudioError = useCallback(() => {
    if (!isTauri && currentTrackRef.current && !triedDownloadRef.current) {
      triedDownloadRef.current = true;
      startStream(currentTrackRef.current, "download");
    } else setIsPlaying(false);
  }, [startStream]);

  // ── Queue operations ────────────────────────────────────
  const playNext = useCallback((track: Track) => {
    if (!currentTrackRef.current) { playTrack(track, [track]); return; }
    const order = [...orderRef.current];
    order.splice(posRef.current + 1, 0, track);
    orderRef.current = order;
    flashToast("Diputar setelah ini");
  }, [playTrack, flashToast]);

  const addToQueue = useCallback((track: Track) => {
    if (!currentTrackRef.current) { playTrack(track, [track]); return; }
    orderRef.current = [...orderRef.current, track];
    flashToast("Ditambahkan ke antrean");
  }, [playTrack, flashToast]);

  const startMix = useCallback(async (track: Track) => {
    playTrack(track, [track]);
    flashToast("Memulai mix…");
    try {
      const related = (await searchSongs(track.artist)).filter((t) => t.videoId !== track.videoId);
      const order = [track, ...shuffleArray(related)];
      orderRef.current = order;
      contextRef.current = order;
      posRef.current = 0;
    } catch { /* keep single track */ }
  }, [playTrack, searchSongs, flashToast]);

  const goToArtist = useCallback((artist: string) => {
    openArtist({ name: artist });
  }, [openArtist]);

  const shareTrack = useCallback(async (track: Track) => {
    const link = `https://music.youtube.com/watch?v=${track.videoId}`;
    try { await navigator.clipboard.writeText(link); flashToast("Link disalin ke clipboard"); }
    catch { flashToast(link); }
  }, [flashToast]);

  const downloadTrack = useCallback(async (track: Track) => {
    if (isTauri) {
      flashToast("Mengunduh…");
      try {
        const dir = await invoke<string>("download_track", { videoId: track.videoId });
        flashToast(`Tersimpan di ${dir}`);
      } catch { flashToast("Gagal mengunduh."); }
    } else {
      window.open(`https://music.youtube.com/watch?v=${track.videoId}`, "_blank");
    }
  }, [flashToast]);

  const notInterested = useCallback((track: Track) => {
    setBlocked((prev) => (prev.includes(track.artist) ? prev : [...prev, track.artist]));
    setQuickPicks((prev) => prev.filter((t) => t.artist !== track.artist));
    localStorage.removeItem("mv:quickpicks");
    flashToast(`Tidak merekomendasikan ${track.artist}`);
  }, [flashToast]);

  // ── Mode cycling ────────────────────────────────────────
  const cycleRepeat = useCallback(() => setRepeatMode((m) => (m === "off" ? "all" : m === "all" ? "one" : "off")), []);
  const cycleShuffle = useCallback(() => setShuffleMode((m) => (m === "off" ? "random" : m === "random" ? "smart" : "off")), []);

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
  const isFavorite = useCallback((videoId: string) => favorites.some((t) => t.videoId === videoId), [favorites]);
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
    setLyrics(null); setLyricsLoading(true);
    (async () => {
      try {
        const url = `${API_URL}?action=lyrics&title=${encodeURIComponent(currentTrack.title)}&artist=${encodeURIComponent(currentTrack.artist)}`;
        const d = await (await fetch(url)).json();
        if (cancelled) return;
        setLyrics({ synced: d.syncedLyrics ? parseLRC(d.syncedLyrics) : [], plain: d.plainLyrics || "" });
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

  useEffect(() => {
    if (nowPlayingOpen && activeLyricRef.current) {
      activeLyricRef.current.scrollIntoView({ block: "center", behavior: prefersReduced ? "auto" : "smooth" });
    }
  }, [activeLyric, nowPlayingOpen]);

  // ── Media Session ───────────────────────────────────────
  useEffect(() => {
    if (!("mediaSession" in navigator) || !currentTrack) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title, artist: currentTrack.artist, album: "Music Venue",
      artwork: [{ src: currentTrack.artwork, sizes: "512x512", type: "image/jpeg" }],
    });
    navigator.mediaSession.setActionHandler("play", () => setIsPlaying(true));
    navigator.mediaSession.setActionHandler("pause", () => setIsPlaying(false));
    navigator.mediaSession.setActionHandler("previoustrack", () => playPrev());
    navigator.mediaSession.setActionHandler("nexttrack", () => advance(true));
  }, [currentTrack, playPrev, advance]);

  // Push the current track to Discord Rich Presence (no-op until native lands).
  useEffect(() => { if (currentTrack) pushRpc(currentTrack); }, [currentTrack, pushRpc]);

  // ── Keyboard shortcuts ──────────────────────────────────
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

  // ── Close context menu on any outside interaction ───────
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [ctxMenu]);

  // Close the search dropdown on outside click.
  useEffect(() => {
    if (!showSuggest) return;
    const onDown = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) setShowSuggest(false);
    };
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

  // ── Window controls ─────────────────────────────────────
  const win = () => getCurrentWindow();
  const handleMinimize = async () => { if (isTauri) await win().minimize(); };
  const handleMaximize = async () => {
    if (!isTauri) return;
    const w = win();
    if (await w.isMaximized()) { await w.unmaximize(); setIsMaximized(false); }
    else { await w.maximize(); setIsMaximized(true); }
  };
  const handleClose = async () => { if (isTauri) await win().close(); };
  const handleDrag = async (e: React.MouseEvent) => { if (isTauri && e.button === 0) await win().startDragging(); };

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
      setVolume(pos); setIsMuted(pos === 0);
    };
    update(e.clientX);
    const move = (ev: MouseEvent) => update(ev.clientX);
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) { setActiveTab("search"); runSearch(searchQuery); }
  };

  const handleTabClick = (tab: string) => {
    // Re-clicking Listen Now while already there reshuffles the page.
    if (tab === "home" && activeTab === "home") { reshuffleHome(); return; }
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
      case "artist": return artistView?.artist?.name || "Artist";
      case "profile": return "Profile";
      default: return "Music Venue";
    }
  };

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const VolIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const upNext = orderRef.current.slice(posRef.current + 1);

  // ── Reusable renderers ──────────────────────────────────
  const AlbumCard = ({ track, context }: { track: Track; context: Track[] }) => (
    <div className="album-card" onClick={() => playTrack(track, context)} onContextMenu={(e) => openCtx(e, track, context)}>
      <div className="album-art-wrap">
        <img src={track.artwork} alt={track.title} className="album-artwork" loading="lazy" />
        <div className="album-play-overlay"><div className="mini-play"><Play size={18} fill="currentColor" /></div></div>
      </div>
      <div className="album-info"><h3>{track.title}</h3><p>{track.artist}</p></div>
    </div>
  );

  const TrackRow = ({ track, context, index }: { track: Track; context: Track[]; index: number }) => {
    const playing = currentTrack?.videoId === track.videoId;
    return (
      <div className={`track-row ${playing ? "playing" : ""}`}
        onDoubleClick={() => playTrack(track, context)}
        onContextMenu={(e) => openCtx(e, track, context)}>
        <div className="track-row-index">
          <span className="track-num">{index + 1}</span>
          <button className="track-row-play" onClick={() => playTrack(track, context)}>
            {playing && isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          </button>
        </div>
        <img src={track.artwork} alt="" className="track-row-art" loading="lazy" />
        <div className="track-row-text">
          <span className="track-row-title">{track.title}</span>
          <span className="track-row-artist">{track.artist}</span>
        </div>
        <button className={`track-row-like ${isFavorite(track.videoId) ? "active" : ""}`} onClick={() => toggleFavorite(track)}>
          <Heart size={16} fill={isFavorite(track.videoId) ? "currentColor" : "none"} />
        </button>
        <button className="track-row-more" onClick={(e) => openCtx(e, track, context)}><MoreHorizontal size={16} /></button>
      </div>
    );
  };

  const Shelf = ({ id, title, subtitle }: { id: string; title: string; subtitle: string }) => {
    const tracks = shelves[id] || [];
    return (
      <section className="shelf">
        <div className="shelf-head"><div><h2>{title} <ChevronRight size={20} /></h2><p>{subtitle}</p></div></div>
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
        <audio ref={audioRef} src={playerUrl}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onDurationChange={(e) => setDuration(e.currentTarget.duration)}
          onEnded={handleEnded} onError={handleAudioError}
          onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} />
      )}

      {/* Sidebar */}
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
          <div className={`nav-item ${activeTab === "favorites" ? "active" : ""}`} onClick={() => setActiveTab("favorites")}>
            <Heart size={20} /> Liked Music {favorites.length > 0 && <span className="nav-count">{favorites.length}</span>}
          </div>
          <div className="nav-item" onClick={() => setShowQueue(true)}><ListMusic size={20} /> Queue</div>
        </div>
        <div className="sidebar-bottom">
          <button className={`sidebar-profile ${activeTab === "profile" ? "active" : ""}`} onClick={() => setActiveTab("profile")}>
            <span className="profile-avatar" style={{ background: profile.color }}>{(profile.name || "G").charAt(0).toUpperCase()}</span>
            <div className="profile-brief"><span className="profile-name">{profile.name || "Guest"}</span><span className="profile-sub">Profil &amp; Setelan</span></div>
            <Settings size={16} />
          </button>
          {coreVersion && <div className="sidebar-foot">Core {coreVersion}{region?.countryCode ? ` · ${region.countryCode}` : ""}</div>}
        </div>
      </aside>

      {/* Main */}
      <main className="main-content">
        <header className="header">
          <div className="header-drag" onMouseDown={handleDrag}><h1>{getPageTitle()}</h1></div>
          <div className="header-right">
            <div className="search-box-wrap" ref={searchBoxRef}>
              <form onSubmit={handleSearch} className="search-box">
                <Search size={16} />
                <input type="text" placeholder="Artists, Songs..." value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); fetchSuggestions(e.target.value); setShowSuggest(true); }}
                  onFocus={() => { setActiveTab("search"); setShowSuggest(true); }} />
                {searchQuery && <button type="button" className="search-clear" onClick={() => { setSearchQuery(""); setSuggestions([]); }}><X size={14} /></button>}
              </form>
              {showSuggest && (
                <div className="search-dropdown">
                  {searchQuery.trim() ? (
                    suggestions.length ? suggestions.map((s) => (
                      <button key={s} className="suggest-item" onMouseDown={(e) => { e.preventDefault(); setSearchQuery(s); runSearch(s); }}>
                        <Search size={15} /><span>{s}</span>
                      </button>
                    )) : <div className="suggest-empty">Tekan Enter untuk mencari “{searchQuery}”</div>
                  ) : searchHistory.length ? (
                    <>
                      <div className="suggest-head"><span>Terakhir dicari</span><button onMouseDown={(e) => { e.preventDefault(); setSearchHistory([]); }}>Hapus semua</button></div>
                      {searchHistory.map((h) => (
                        <button key={h} className="suggest-item" onMouseDown={(e) => { e.preventDefault(); setSearchQuery(h); runSearch(h); }}>
                          <Clock size={15} /><span>{h}</span>
                          <span className="suggest-remove" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setSearchHistory((prev) => prev.filter((x) => x !== h)); }}><X size={13} /></span>
                        </button>
                      ))}
                    </>
                  ) : <div className="suggest-empty">Belum ada riwayat pencarian.</div>}
                </div>
              )}
            </div>
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
            {quickPicks.length > 0 && (
              <section className="shelf">
                <div className="shelf-head"><div><h2>Pilihan cepat <ChevronRight size={20} /></h2><p>{history && Object.keys(history).length ? "Berdasarkan yang sering kamu putar" : "Populer di sekitarmu"}{region?.city ? ` · ${region.city}` : ""}</p></div></div>
                <div className="track-grid">
                  {quickPicks.map((t, i) => <TrackRow key={t.videoId} track={t} context={quickPicks} index={i} />)}
                </div>
              </section>
            )}
            {HOME_SHELVES.map((s) => <Shelf key={s.id} id={s.id} title={s.title} subtitle={s.subtitle} />)}
            <section className="shelf">
              <div className="shelf-head"><div><h2>Favourite Music <ChevronRight size={20} /></h2><p>Lagu yang kamu suka</p></div></div>
              {favorites.length ? (
                <div className="track-grid">{favorites.map((t, i) => <TrackRow key={t.videoId} track={t} context={favorites} index={i} />)}</div>
              ) : (
                <div className="empty-state"><Heart size={34} /><p>Belum ada lagu favorit</p><span>Tekan ikon ♥ pada lagu untuk menyimpannya di sini.</span></div>
              )}
            </section>
          </div>
        )}

        {/* Favorites */}
        {activeTab === "favorites" && (
          <div className="page">
            {favorites.length ? (
              <div className="track-grid wide">{favorites.map((t, i) => <TrackRow key={t.videoId} track={t} context={favorites} index={i} />)}</div>
            ) : (
              <div className="empty-state big"><Heart size={44} /><p>Liked Music masih kosong</p><span>Semua lagu yang kamu tandai ♥ akan muncul di sini.</span></div>
            )}
          </div>
        )}

        {/* Artist page */}
        {activeTab === "artist" && (
          <div className="page">
            {artistLoading ? (
              <div className="artist-page-head"><div className="artist-avatar sk-avatar" /><div className="artist-page-meta"><div className="sk-line" /><div className="sk-line short" /></div></div>
            ) : artistView?.artist ? (
              <>
                <div className="artist-page-head">
                  <img className="artist-avatar" src={pickArtwork(artistView.artist.thumbnails)} alt={artistView.artist.name} />
                  <div className="artist-page-meta">
                    <span className="artist-hero-label"><User size={13} /> Artist</span>
                    <h1>{artistView.artist.name}</h1>
                    {artistView.artist.subscribers && <p>{artistView.artist.subscribers} subscribers</p>}
                    <div className="artist-page-actions">
                      <button className="btn-primary" onClick={() => artistView.songs.length && playTrack(artistView.songs[0], artistView.songs)}><Play size={17} fill="currentColor" /> Play</button>
                      <button className="btn-ghost" onClick={() => { if (artistView.songs.length) { setShuffleMode("random"); playTrack(artistView.songs[0], artistView.songs); } }}><Shuffle size={17} /> Shuffle</button>
                    </div>
                  </div>
                </div>
                <section className="search-section">
                  <div className="section-head"><h2>Songs</h2><span className="section-badge">{artistView.songs.length} lagu</span></div>
                  <div className="track-grid wide">{artistView.songs.map((t, i) => <TrackRow key={t.videoId} track={t} context={artistView.songs} index={i} />)}</div>
                </section>
              </>
            ) : (
              <div className="empty-state big"><User size={44} /><p>Artis tidak ditemukan</p><span>Coba cari nama artis yang lain.</span></div>
            )}
          </div>
        )}

        {/* Search / Radio */}
        {(activeTab === "search" || activeTab === "radio") && (
          <div className="page">
            {loading ? (
              <div className="grid-container">
                {Array.from({ length: 8 }).map((_, i) => <div key={i} className="album-card skeleton"><div className="album-art-wrap sk" /></div>)}
              </div>
            ) : searchPopular.length || searchOther.length ? (
              <>
                {searchArtist && (
                  <div className="artist-hero" onClick={() => openArtist({ artistId: searchArtist.artistId })}>
                    <img src={pickArtwork(searchArtist.thumbnails)} alt={searchArtist.name} className="artist-hero-img" />
                    <div className="artist-hero-info">
                      <span className="artist-hero-label"><User size={13} /> Artist</span>
                      <h2>{searchArtist.name}</h2>
                      <button className="btn-primary sm">Buka halaman artis</button>
                    </div>
                  </div>
                )}
                {searchPopular.length > 0 && (
                  <section className="search-section">
                    <div className="section-head"><h2>Popular</h2><span className="section-badge">Paling banyak diputar</span></div>
                    <div className="grid-container">{searchPopular.map((t) => <AlbumCard key={t.videoId} track={t} context={searchPopular} />)}</div>
                  </section>
                )}
                {searchOther.length > 0 && (
                  <section className="search-section">
                    <div className="section-head"><h2>Other</h2><span className="section-badge muted">Cover, live &amp; remix</span></div>
                    <div className="grid-container">{searchOther.map((t) => <AlbumCard key={t.videoId} track={t} context={searchOther} />)}</div>
                  </section>
                )}
              </>
            ) : (
              <div className="empty-state big"><Search size={44} /><p>{activeTab === "radio" ? "Radio" : "Cari lagu favoritmu"}</p><span>Ketik nama artis atau judul lagu di kotak pencarian.</span></div>
            )}
          </div>
        )}

        {/* Profile & Settings */}
        {activeTab === "profile" && (
          <div className="page profile-page">
            <div className="profile-hero">
              <span className="profile-hero-avatar" style={{ background: profile.color }}>{(profile.name || "G").charAt(0).toUpperCase()}</span>
              <div className="profile-hero-info">
                <span className="artist-hero-label"><UserCircle size={13} /> Profil</span>
                <h1>{profile.name || "Guest"}</h1>
                <p>{accounts.length ? `${accounts.length} akun terhubung` : "Belum ada akun terhubung"} · Tema {theme}</p>
              </div>
            </div>

            <div className="profile-tabs">
              {PROFILE_TABS.map((t) => (
                <button key={t.id} className={`ptab ${profileTab === t.id ? "active" : ""}`} onClick={() => setProfileTab(t.id)}>
                  <t.Icon size={15} /> {t.label}
                </button>
              ))}
            </div>

            <div className="profile-content">
              {profileTab === "appearance" && (
                <>
                  <div className="setting-block">
                    <h3>Tema</h3><p className="setting-desc">Ubah tampilan aplikasi. Dark abu-abu bikin efek kaca player lebih terlihat.</p>
                    <div className="theme-grid">
                      {THEME_OPTIONS.map((t) => (
                        <button key={t.id} className={`theme-card ${theme === t.id ? "active" : ""}`} onClick={() => setTheme(t.id)}>
                          <span className={`theme-swatch th-${t.id}`}><span className="tsw-bar" /></span>
                          <div className="theme-card-label"><t.Icon size={15} /> {t.label}</div>
                          {theme === t.id && <Check size={16} className="theme-check" />}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="setting-block">
                    <h3>Custom CSS</h3><p className="setting-desc">Tempel CSS atau unggah file .css untuk tema buatanmu. Langsung diterapkan & tersimpan.</p>
                    <textarea className="css-editor" value={customCss} spellCheck={false} placeholder={":root { --accent: #7c3aed; }"} onChange={(e) => setCustomCss(e.target.value)} />
                    <div className="setting-actions">
                      <label className="btn-ghost file-btn"><Upload size={15} /> Unggah .css<input type="file" accept=".css,text/css" hidden onChange={(e) => e.target.files?.[0] && uploadCss(e.target.files[0])} /></label>
                      <button className="btn-ghost" onClick={() => { setCustomCss(""); flashToast("Custom CSS dihapus"); }}>Reset</button>
                    </div>
                  </div>
                </>
              )}

              {profileTab === "accounts" && (
                <>
                  <div className="setting-block">
                    <h3>Profil</h3>
                    <div className="field-row"><label>Nama</label><input className="text-input" value={profile.name} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} /></div>
                    <div className="field-row"><label>Warna</label><input className="color-input" type="color" value={profile.color} onChange={(e) => setProfile((p) => ({ ...p, color: e.target.value }))} /></div>
                  </div>
                  <div className="setting-block">
                    <h3>Hubungkan Akun</h3>
                    <p className="setting-desc">Login untuk menyimpan & sinkron konfigurasi. <span className="badge-warn">OAuth asli perlu backend</span></p>
                    <div className="provider-list">
                      {PROVIDERS.map((p) => {
                        const connected = accounts.find((a) => a.provider === p.id);
                        return (
                          <button key={p.id} className={`provider-btn ${connected ? "connected" : ""}`} onClick={() => toggleAccount(p)}>
                            <p.Icon size={18} /><span className="prov-name">{p.label}</span>
                            {connected ? <span className="prov-state"><Check size={14} /> {connected.label}</span> : <span className="prov-cta">Hubungkan</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="setting-block">
                    <h3>Cadangan Konfigurasi</h3><p className="setting-desc">Simpan semua setelan (tema, CSS, liked music, RPC) ke file dan pulihkan kapan saja — berfungsi penuh tanpa backend.</p>
                    <div className="setting-actions">
                      <button className="btn-primary" onClick={exportConfig}><Download size={15} /> Ekspor</button>
                      <label className="btn-ghost file-btn"><Upload size={15} /> Impor<input type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importConfig(e.target.files[0])} /></label>
                    </div>
                  </div>
                </>
              )}

              {profileTab === "discord" && (
                <div className="setting-block">
                  <h3>Discord Rich Presence</h3>
                  <p className="setting-desc">Tampilkan lagu yang sedang diputar di status Discord-mu.{!isTauri && " (hanya di aplikasi desktop)"}</p>
                  <div className="field-row"><label>Application ID</label><input className="text-input" value={rpcClientId} placeholder="123456789012345678" onChange={(e) => setRpcClientId(e.target.value)} /></div>
                  <p className="setting-hint">Buat aplikasi di <b>discord.com/developers/applications</b> → salin <b>Application ID</b>. Discord desktop harus terbuka.</p>
                  <div className="setting-actions">
                    {rpcStatus === "on"
                      ? <button className="btn-ghost" onClick={disconnectDiscord}>Putuskan</button>
                      : <button className="btn-primary" onClick={connectDiscord}>{rpcStatus === "connecting" ? "Menghubungkan…" : "Hubungkan"}</button>}
                    <span className={`rpc-dot ${rpcStatus}`} />
                    <span className="rpc-status-text">{rpcStatus === "on" ? "Terhubung" : rpcStatus === "connecting" ? "Menghubungkan" : rpcStatus === "error" ? "Gagal" : "Tidak aktif"}</span>
                  </div>
                  <div className="rpc-preview">
                    <div className="rpc-preview-head">Preview</div>
                    <div className="rpc-card">
                      <img src={currentTrack?.artwork || "https://picsum.photos/120"} className="rpc-img" alt="" />
                      <div className="rpc-lines">
                        <span className="rpc-app">MUSIC VENUE</span>
                        <span className="rpc-details">{currentTrack?.title || "Belum ada lagu diputar"}</span>
                        <span className="rpc-state">{currentTrack?.artist || "—"}</span>
                        <span className="rpc-time">{isPlaying ? "sedang diputar" : "dijeda"}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {profileTab === "updates" && (
                <div className="setting-block">
                  <h3>Pembaruan</h3>
                  <p className="setting-desc">Versi saat ini: <b>{coreVersion || "web"}</b></p>
                  <div className="setting-actions">
                    <button className="btn-primary" onClick={checkUpdateManually}><RefreshCw size={15} /> Periksa Update</button>
                    {updateInfo && <button className="btn-ghost" onClick={runUpdate}>Perbarui ke {updateInfo.version}</button>}
                  </div>
                  {updateStatus && <p className="setting-hint accent">{updateStatus}</p>}
                  <p className="setting-hint">Aplikasi memeriksa update otomatis saat dibuka. Tombol ini untuk memeriksa manual jika auto-update gagal.</p>
                </div>
              )}

              {profileTab === "about" && (
                <div className="setting-block">
                  <h3>Music Venue</h3>
                  <p className="setting-desc">Pemutar musik bergaya Apple Music berbasis YouTube Music. Metadata via ytmusic-api, audio via yt-dlp (desktop), lirik via lrclib.net.</p>
                  <p className="setting-hint">Dibuat dengan Tauri + React. Auto-update aktif untuk versi desktop.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Context menu */}
      {ctxMenu && (
        <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button className="ctx-item" onClick={() => { startMix(ctxMenu.track); setCtxMenu(null); }}><Radio size={17} /> Mulai mix</button>
          <button className="ctx-item" onClick={() => { playNext(ctxMenu.track); setCtxMenu(null); }}><CornerDownRight size={17} /> Putar setelah ini</button>
          <button className="ctx-item" onClick={() => { addToQueue(ctxMenu.track); setCtxMenu(null); }}><ListPlus size={17} /> Tambahkan ke antrean</button>
          <div className="ctx-sep" />
          <button className="ctx-item" onClick={() => { toggleFavorite(ctxMenu.track); setCtxMenu(null); }}>
            <Heart size={17} fill={isFavorite(ctxMenu.track.videoId) ? "currentColor" : "none"} />
            {isFavorite(ctxMenu.track.videoId) ? "Hapus dari lagu disukai" : "Tambahkan ke lagu disukai"}
          </button>
          <button className="ctx-item" onClick={() => { downloadTrack(ctxMenu.track); setCtxMenu(null); }}><Download size={17} /> Download</button>
          <button className="ctx-item" onClick={() => { goToArtist(ctxMenu.track.artist); setCtxMenu(null); }}><User size={17} /> Buka halaman artis</button>
          <button className="ctx-item" onClick={() => { shareTrack(ctxMenu.track); setCtxMenu(null); }}><Share2 size={17} /> Bagikan</button>
          <div className="ctx-sep" />
          <button className="ctx-item danger" onClick={() => { notInterested(ctxMenu.track); setCtxMenu(null); }}><Ban size={17} /> Jangan rekomendasikan artis</button>
        </div>
      )}

      {/* Update banner */}
      <AnimatePresence>
        {updateInfo && (
          <motion.div className="update-banner"
            initial={{ y: prefersReduced ? 0 : 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
            transition={{ type: "tween", ease: [0.22, 1, 0.36, 1], duration: 0.35 }}>
            <div className="update-icon"><RefreshCw size={18} /></div>
            <div className="update-text">
              <strong>Versi baru {updateInfo.version} tersedia</strong>
              <span>{updateProgress !== null ? `Mengunduh… ${updateProgress}%` : "Perbarui untuk fitur & perbaikan terbaru."}</span>
            </div>
            {updateProgress === null && (
              <div className="update-actions">
                <button className="btn-ghost" onClick={dismissUpdate}>Nanti</button>
                <button className="btn-primary" onClick={runUpdate}>Perbarui</button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div className="toast" initial={{ y: prefersReduced ? 0 : 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Now Playing */}
      <AnimatePresence>
        {nowPlayingOpen && currentTrack && (
          <motion.div className="now-playing"
            initial={{ y: prefersReduced ? 0 : "100%", opacity: prefersReduced ? 0 : 1 }} animate={{ y: 0, opacity: 1 }}
            exit={{ y: prefersReduced ? 0 : "100%", opacity: prefersReduced ? 0 : 1 }}
            transition={{ type: "tween", ease: [0.22, 1, 0.36, 1], duration: 0.45 }}>
            <div className="np-bg" style={{ backgroundImage: `url(${currentTrack.artwork})` }} />
            <button className="np-close" onClick={() => setNowPlayingOpen(false)}><ChevronDown size={26} /></button>
            <div className="np-body">
              <div className="np-left">
                <img src={currentTrack.artwork} alt="" className="np-art" />
                <div className="np-meta"><h2>{currentTrack.title}</h2><p>{currentTrack.artist}</p></div>
                <div className="np-progress">
                  <span>{formatTime(currentTime)}</span>
                  <div className="progress-bar" onClick={seekTo}><div className="progress-fill" style={{ width: `${progressPct}%` }} /></div>
                  <span>{formatTime(duration)}</span>
                </div>
                <div className="np-controls">
                  <button className={`btn-icon ${shuffleMode !== "off" ? "on" : ""}`} onClick={cycleShuffle} title={`Shuffle: ${shuffleMode}`}><Shuffle size={20} />{shuffleMode === "smart" && <span className="mode-dot" />}</button>
                  <button className="btn-icon" onClick={playPrev}><SkipBack size={26} fill="currentColor" /></button>
                  <button className="btn-icon btn-play big" onClick={togglePlay}>{isPlaying ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" style={{ marginLeft: 3 }} />}</button>
                  <button className="btn-icon" onClick={() => advance(true)}><SkipForward size={26} fill="currentColor" /></button>
                  <button className={`btn-icon ${repeatMode !== "off" ? "on" : ""}`} onClick={cycleRepeat} title={`Repeat: ${repeatMode}`}>{repeatMode === "one" ? <Repeat1 size={20} /> : <Repeat size={20} />}</button>
                </div>
              </div>
              <div className="np-lyrics">
                {lyricsLoading ? <p className="lyric-status">Memuat lirik…</p>
                  : lyrics?.synced.length ? (
                    <div className="lyric-lines">
                      {lyrics.synced.map((line, i) => (
                        <p key={i} ref={i === activeLyric ? activeLyricRef : null}
                          className={`lyric-line ${i === activeLyric ? "active" : ""} ${i < activeLyric ? "past" : ""}`}
                          onClick={() => { if (audioRef.current) audioRef.current.currentTime = line.t; }}>
                          {line.text || "♪"}
                        </p>
                      ))}
                    </div>
                  ) : lyrics?.plain ? <div className="lyric-plain">{lyrics.plain}</div>
                    : <p className="lyric-status">Lirik tidak tersedia untuk lagu ini.</p>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Queue drawer */}
      <AnimatePresence>
        {showQueue && (
          <>
            <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowQueue(false)} />
            <motion.aside className="queue-panel"
              initial={{ x: prefersReduced ? 0 : "100%" }} animate={{ x: 0 }} exit={{ x: prefersReduced ? 0 : "100%" }}
              transition={{ type: "tween", ease: [0.22, 1, 0.36, 1], duration: 0.35 }}>
              <div className="queue-head"><h3>Playing Next</h3><button className="btn-icon" onClick={() => setShowQueue(false)}><X size={18} /></button></div>
              {currentTrack && (
                <div className="queue-now"><img src={currentTrack.artwork} alt="" /><div className="track-row-text"><span className="track-row-title">{currentTrack.title}</span><span className="track-row-artist">Now Playing</span></div></div>
              )}
              <div className="queue-list">
                {upNext.length ? upNext.map((t, i) => (
                  <div key={t.videoId + i} className="queue-item"
                    onClick={() => { const idx = orderRef.current.findIndex((x) => x.videoId === t.videoId); if (idx >= 0) { posRef.current = idx; loadAndPlay(t); } }}
                    onContextMenu={(e) => openCtx(e, t, orderRef.current)}>
                    <img src={t.artwork} alt="" /><div className="track-row-text"><span className="track-row-title">{t.title}</span><span className="track-row-artist">{t.artist}</span></div>
                  </div>
                )) : <p className="lyric-status">Antrean kosong.</p>}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Player bar */}
      <footer className="player-bar">
        <div className="player-info" onClick={() => currentTrack && setNowPlayingOpen(true)}>
          {currentTrack ? (
            <>
              <img src={currentTrack.artwork} alt="" className="player-artwork" />
              <div className="player-text"><span className="player-title">{currentTrack.title}</span><span className="player-artist">{streamLoading ? "Loading audio…" : currentTrack.artist}</span></div>
              <button className={`player-like ${isFavorite(currentTrack.videoId) ? "active" : ""}`} onClick={(e) => { e.stopPropagation(); toggleFavorite(currentTrack); }}>
                <Heart size={16} fill={isFavorite(currentTrack.videoId) ? "currentColor" : "none"} />
              </button>
            </>
          ) : <div className="player-text idle">Not Playing</div>}
        </div>

        <div className="player-controls">
          <div className="control-buttons">
            <button className={`btn-icon sm ${shuffleMode !== "off" ? "on" : ""}`} onClick={cycleShuffle} title={`Shuffle: ${shuffleMode}`}><Shuffle size={17} />{shuffleMode === "smart" && <span className="mode-dot" />}</button>
            <button className="btn-icon" onClick={playPrev}><SkipBack size={19} fill="currentColor" /></button>
            <button className="btn-icon btn-play" onClick={togglePlay}>{isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" style={{ marginLeft: 2 }} />}</button>
            <button className="btn-icon" onClick={() => advance(true)}><SkipForward size={19} fill="currentColor" /></button>
            <button className={`btn-icon sm ${repeatMode !== "off" ? "on" : ""}`} onClick={cycleRepeat} title={`Repeat: ${repeatMode}`}>{repeatMode === "one" ? <Repeat1 size={17} /> : <Repeat size={17} />}</button>
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
          <div className="progress-bar volume-bar" ref={volumeBarRef} onMouseDown={handleVolumeMouseDown}><div className="progress-fill" style={{ width: `${isMuted ? 0 : volume * 100}%` }} /></div>
        </div>
      </footer>
    </div>
  );
}
