import { useEffect, useState, useRef, useCallback, memo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Pause, SkipForward, SkipBack,
  Volume2, Volume1, VolumeX, Search, Home, Heart, Radio, Clock,
  X, Minus, Square, Maximize, Repeat, Repeat1, Shuffle,
  ListMusic, Mic2, ChevronRight, ChevronDown, MoreHorizontal, Sparkles,
  ListPlus, CornerDownRight, Download, Share2, User, Ban, RefreshCw,
  Settings, Sun, Moon, Monitor, Upload, Check,
  UserCircle, ChevronLeft, UserPlus, UserMinus, Trash2, SlidersHorizontal
} from "lucide-react";
import { SubscribedArtist, syncAppStateToGist, Playlist } from "./lib/github";
import SplashIntro from "./components/SplashIntro";
import ShareLyricModal from "./components/ShareLyricModal";
import SyncedLyrics from "./components/SyncedLyrics";
import { fetchLyrics, type Lyrics } from "./lib/lyrics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";


const CustomSelect = ({ value, onChange, options }: { value: string | number, onChange: (v: string) => void, options: { label: string, value: string | number }[] }) => {
  const selectedLabel = options.find(o => o.value == value)?.label || "Select...";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center justify-between rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-white/20">
          {selectedLabel}
          <ChevronDown className="h-4 w-4 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="z-[9999] w-full min-w-[200px] bg-[#1a1a1a] text-white border-white/10 shadow-xl" align="start">
        {options.map(opt => (
          <DropdownMenuItem key={opt.value} onClick={() => onChange(String(opt.value))} className="text-left cursor-pointer focus:bg-white/10">
            {opt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

// ... Types ...
interface Track { videoId: string; title: string; artist: string; artwork: string; duration?: number; }
type RepeatMode = "off" | "all" | "one";
type ShuffleMode = "off" | "random" | "smart";
interface HistEntry extends Track { count: number; last: number; }
interface Region { country: string | null; countryCode: string | null; city: string | null; }
interface CtxMenu { x: number; y: number; track: Track; context: Track[]; playlistId?: string; }
interface UpdateInfo { version: string; obj: any; }
interface ArtistHead { artistId?: string; channelId?: string; name: string; thumbnails: any[]; subscribers?: string | null; }
interface ArtistPage { artist: ArtistHead | null; songs: Track[]; albums: any[]; singles: any[]; }

const isTauri = "__TAURI_INTERNALS__" in window;
const API_URL = "http://127.0.0.1:8000";
const getJson = (path: string) => fetch(`${API_URL}${path}`).then(r => r.ok ? r.json() : null).catch(() => null);

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
      artist: item.artists?.map((a: any) => a.name).filter(Boolean).join(", ") || item.artist || item.author?.name || "Unknown Artist",
      duration: Number.isFinite(item.duration_seconds) ? item.duration_seconds : undefined,
      artwork: pickArtwork(item.thumbnails),
    }));
}

// Recommendations keep official releases (YTM "ATV" audio / "OMV" music video) and drop
// user uploads, compilations and loops such as "Top Hits 2026 Best Of".
const JUNK_TITLE = /\b(top \d+|top hits|best of|playlist|full album|non ?stop|compilation|kumpulan|mashup|karaoke|8d|slowed|sped up|1 hour)\b/i;
const parseCount = (v?: string) => {
  const m = /^([\d.]+)\s*([KMB])?/i.exec(v || "");
  return m ? parseFloat(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase() as "K" | "M" | "B"] ?? 1) : 0;
};
const parseLength = (v?: string) => (v || "").split(":").reduce((total, part) => total * 60 + Number(part), 0);
/** Charts omit view counts (they are popular by definition); radio and search must prove ≥1M plays. */
function popularTracks(items: any, fromChart = false): Track[] {
  return mapTracks((Array.isArray(items) ? items : []).filter((it: any) =>
    (it.videoType === "MUSIC_VIDEO_TYPE_ATV" || it.videoType === "MUSIC_VIDEO_TYPE_OMV")
    && !JUNK_TITLE.test(it.title || "")
    && (it.duration_seconds ?? parseLength(it.length ?? it.duration)) <= 480
    && (fromChart && !it.views ? true : parseCount(it.views) >= 1e6)));
}
/** One entry per song: the audio and music-video uploads of a song share a title and lead artist. */
const songKey = (t: Track) => `${t.title.toLowerCase().replace(/\s*[([].*?[)\]]/g, "").trim()}|${t.artist.split(",")[0].trim().toLowerCase()}`;

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

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
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
        aria-label={label}
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

/** Animated % label — replays the eqPop animation on gain change WITHOUT unmounting. */
const EqPctLabel = memo(({ gain }: { gain: number }) => {
  const spanRef = useRef<HTMLSpanElement>(null);
  const prevGain = useRef(gain);
  useEffect(() => {
    if (prevGain.current !== gain && spanRef.current) {
      const el = spanRef.current;
      el.classList.remove('animate-eqPop');
      void el.offsetWidth;          // force reflow to restart animation
      el.classList.add('animate-eqPop');
    }
    prevGain.current = gain;
  }, [gain]);
  return (
    <span ref={spanRef} className="eq-pct" style={{ fontSize: '10px', fontWeight: 600, color: 'rgba(255,255,255,0.85)', display: 'inline-block' }}>
      {Math.round(((gain + 12) / 24) * 100)}%
    </span>
  );
});
EqPctLabel.displayName = 'EqPctLabel';

const pageVariants = {
  initial: (transition: string) => {
    if (transition === "slide") return { opacity: 0, x: 20 };
    if (transition === "zoom") return { opacity: 0, scale: 0.95 };
    return { opacity: 0 };
  },
  in: {
    opacity: 1,
    x: 0,
    scale: 1
  },
  out: (transition: string) => {
    if (transition === "slide") return { opacity: 0, x: -20 };
    if (transition === "zoom") return { opacity: 0, scale: 1.05 };
    return { opacity: 0 };
  }
};

export default function App() {
  const [showIntro, setShowIntro] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(() => load("mv:last-track", null));
  const [activeTab, setActiveTab] = useState("home");
  const [activeShelf, setActiveShelf] = useState<string | null>(null);
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [homeShelvesState, setHomeShelvesState] = useState<{ id: string, title: string, subtitle: string, query?: string }[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>(() => load("mv:custom-playlists", [] as Playlist[]));
  const [isPlaylistDialogOpen, setIsPlaylistDialogOpen] = useState(false);
  const [playlistDialogTrack, setPlaylistDialogTrack] = useState<Track | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [newPlaylistDesc, setNewPlaylistDesc] = useState("");
  const [newPlaylistImg, setNewPlaylistImg] = useState("");
  const [newPlaylistBanner, setNewPlaylistBanner] = useState("");
  const [isEditPlaylistOpen, setIsEditPlaylistOpen] = useState(false);
  const [editingPlaylistId, setEditingPlaylistId] = useState<string | null>(null);


  // Hover and Share Lyric states
  const [isHoveringArt, setIsHoveringArt] = useState(false);
  const [shareLyricOpen, setShareLyricOpen] = useState(false);
  
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
  const [pageTransition, setPageTransition] = useState<string>(() => load("mv:page-transition", "fade"));
  const [profile, setProfile] = useState<{ name: string; color: string; avatar?: string | null; banner?: string | null; username?: string | null; bio?: string | null; accent_color?: string | null }>(() => load("mv:profile", { name: "Guest", color: "#fa243c" }));
  // Account UI is gone (private app); an already-linked GitHub token keeps backing up state to its gist.
  const [accounts] = useState<{ provider: string; label: string; id: string; avatar?: string | null; username?: string | null; bio?: string | null; banner?: string | null; access_token?: string }[]>(() => load("mv:accounts", []));
  const [subscribedArtists, setSubscribedArtists] = useState<SubscribedArtist[]>(() => load("mv:subscribedArtists", []));

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
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [followingOpen, setFollowingOpen] = useState(true);

  const [lyrics, setLyrics] = useState<Lyrics[] | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const eqBandsRef = useRef<BiquadFilterNode[]>([]);
  const visualizerCanvasRef = useRef<HTMLCanvasElement>(null);
  const reqFrameRef = useRef<number>(0);

  const eqPresets: Record<string, number[]> = {
    "Flat": [0, 0, 0, 0, 0],
    "Bass Boost": [6, 4, 0, -2, -4],
    "Acoustic": [2, 1, 3, 2, 1],
    "Electronic": [4, 2, -2, 3, 4],
    "Vocal": [-2, -1, 4, 3, 1]
  };
  const [showEQ, setShowEQ] = useState(false);
  const [eqGains, setEqGains] = useState([0, 0, 0, 0, 0]);
  const [activeEqPreset, setActiveEqPreset] = useState("Flat");
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
  const [lyricOffset, setLyricOffset] = useState<number>(() => {
    const saved = load("mv:lyric-offset", 0);
    return Number.isFinite(saved) ? Math.max(-10, Math.min(10, saved)) : 0;
  });
  const pendingResume = useRef(0);
  useEffect(() => { localStorage.setItem("mv:lyric-offset", JSON.stringify(lyricOffset)); }, [lyricOffset]);
  const toastTimer = useRef<number | undefined>(undefined);
  const suggestTimer = useRef<number | undefined>(undefined);
  const searchBoxRef = useRef<HTMLDivElement>(null);

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
  useEffect(() => { localStorage.setItem("mv:subscribedArtists", JSON.stringify(subscribedArtists)); }, [subscribedArtists]);
  useEffect(() => { localStorage.setItem("mv:custom-playlists", JSON.stringify(playlists)); }, [playlists]);

  // Tracks saved before the backend filled in artist top-result cards carry "Unknown Artist".
  // Look each one up once so history, likes, playlists and lyrics lookups get the real artist.
  useEffect(() => {
    const unknown = (t?: Track | null) => t?.artist === "Unknown Artist";
    const ids = [...new Set([...Object.values(history), ...favorites, ...playlists.flatMap(p => p.tracks as Track[]), currentTrack, ...orderRef.current]
      .filter(unknown).map(t => t!.videoId))];
    if (!ids.length) return;
    (async () => {
      const found: Record<string, string> = {};
      for (const id of ids) {
        const name = (await getJson(`/watch/${id}?limit=1`))?.tracks?.[0]?.artists?.map((a: any) => a.name).filter(Boolean).join(", ");
        if (name) found[id] = name;
      }
      if (!Object.keys(found).length) return;
      const fix = <T extends Track>(t: T): T => unknown(t) && found[t.videoId] ? { ...t, artist: found[t.videoId] } : t;
      setHistory(prev => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, fix(v)])));
      setFavorites(prev => prev.map(fix));
      setPlaylists(prev => prev.map(p => ({ ...p, tracks: p.tracks.map(fix) })));
      setCurrentTrack(prev => prev && fix(prev));
      orderRef.current = orderRef.current.map(fix);
      contextRef.current = contextRef.current.map(fix);
    })();
  }, []); // once per launch; the backend no longer produces these

  // Snapshot every mv:* local key into the GitHub gist (debounced) so a
  // reinstall + GitHub login restores the entire app state (home personalization,
  // likes, blocked artists, playlists, subscriptions).
  const syncAllState = useCallback(() => {
    const github = accounts.find(a => a.provider === "github");
    if (!github?.access_token) return;
    const cfg: Record<string, string> = {};
    for (const k of Object.keys(localStorage)) if (k.startsWith("mv:")) cfg[k] = localStorage.getItem(k) || "";
    syncAppStateToGist(github.access_token, cfg);
  }, [accounts]);

  useEffect(() => {
    const timer = window.setTimeout(syncAllState, 1500);
    return () => window.clearTimeout(timer);
  }, [favorites, history, blocked, searchHistory, subscribedArtists, playlists, accounts, syncAllState]);

  const toggleSubscribe = useCallback((artistId: string, name: string, thumbnails: any[]) => {
    setSubscribedArtists(prev => {
      const isSubbed = prev.some(a => a.artistId === artistId);
      return isSubbed ? prev.filter(a => a.artistId !== artistId) : [...prev, { artistId, name, thumbnails }];
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("mv:theme", JSON.stringify(theme));
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("mv:page-transition", JSON.stringify(pageTransition));
  }, [pageTransition]);

  // "System" theme follows the OS color scheme.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      if (theme === "system") document.documentElement.dataset.theme = mq.matches ? "dark" : "light";
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  const flashToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const bannerInput = useRef<HTMLInputElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const pickProfileImage = (field: "avatar" | "banner") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // picking the same file again should still fire
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { flashToast("Choose an image smaller than 2 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => setProfile(p => ({ ...p, [field]: String(reader.result) }));
    reader.readAsDataURL(file);
  };

  const searchSongs = useCallback(async (query: string): Promise<Track[]> => {
    const res = await fetch(`${API_URL}/search?q=${encodeURIComponent(query)}&filter=songs`);
    return mapTracks(await res.json());
  }, []);


  const loadHome = useCallback(async () => {
    setLoading(true);
    const blockedSet = new Set(blocked);

    // history is Record<string, HistEntry>
    const historyList = Object.values(history).sort((a, b) => b.last - a.last);
    const recentHistory = historyList.slice(0, 15);
    const olderHistory = historyList.slice(15, 30);

    let similarArtist = "The Weeknd";
    let seed: HistEntry | undefined;
    if (historyList.length > 0) {
      const validHistory = historyList.filter(h => h.artist && h.artist !== "Unknown Artist" && !blockedSet.has(h.artist));
      if (validHistory.length > 0) {
        seed = validHistory[Math.floor(Math.random() * Math.min(validHistory.length, 10))];
        similarArtist = seed.artist;
      }
    }

    // YouTube Music's radio for a song you played: popular songs in the same lane. Radio
    // seeded from "Topic" audio carries no play counts, so fall back to the artist's biggest songs.
    let similar = seed ? popularTracks((await getJson(`/watch/${seed.videoId}?radio=true&limit=30`))?.tracks) : [];
    if (similar.length < 6) {
      const lead = similarArtist.split(",")[0].trim();
      similar = popularTracks(await getJson(`/search?q=${encodeURIComponent(lead)}&filter=songs&limit=20`)).filter(t => t.artist.split(",")[0].trim() === lead);
    }
    const keys = new Set<string>();
    const filteredSimilar = similar.filter(t => t.videoId !== seed?.videoId && !blockedSet.has(t.artist) && !keys.has(songKey(t)) && !!keys.add(songKey(t)));

    const dynamicShelves = [];
    const map: Record<string, Track[]> = {};

    const filteredRecent = recentHistory.filter(t => !blockedSet.has(t.artist));
    if (filteredRecent.length > 0) {
      dynamicShelves.push({ id: "keep_listening", title: "Keep listening", subtitle: "Pick up where you left off" });
      map["keep_listening"] = filteredRecent;
    }

    if (filteredSimilar.length > 0) {
      dynamicShelves.push({ id: "similar", title: `Similar to ${similarArtist}`, subtitle: "Based on your taste" });
      map["similar"] = filteredSimilar;
    }

    const filteredOlder = olderHistory.filter(t => !blockedSet.has(t.artist));
    const fallbackListen = [...historyList].filter(t => !blockedSet.has(t.artist)).sort(() => Math.random() - 0.5).slice(0, 10);

    if (filteredOlder.length > 0) {
      dynamicShelves.push({ id: "listen_again", title: "Listen again", subtitle: "Your past favorites" });
      map["listen_again"] = filteredOlder;
    } else if (filteredRecent.length > 0 && historyList.length > 5 && fallbackListen.length > 0) {
      dynamicShelves.push({ id: "listen_again", title: "Listen again", subtitle: "Your past favorites" });
      map["listen_again"] = fallbackListen;
    }

    setHomeShelvesState(dynamicShelves);
    setShelves(map);
    setLoading(false);
  }, [history, blocked]);

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
    const fresh = cache && cache.v === 3 && Date.now() - cache.at < 3 * 3600_000 && cache.tracks?.length;
    if (fresh) { setQuickPicks(cache.tracks); return; }
    const blockedSet = new Set(blocked);
    // What's popular where you are (YouTube Music's daily chart), mixed with the biggest songs of your most-played artists.
    const charts = await getJson(`/charts?country=${reg?.countryCode || "ZZ"}`) ?? await getJson("/charts?country=ZZ");
    const daily = charts?.videos?.find((v: any) => /daily/i.test(v.title)) ?? charts?.videos?.[0];
    const chart = daily?.playlistId ? (await getJson(`/playlist/${daily.playlistId}?limit=50`))?.tracks : null;
    const artists = artistScores(history).filter(([artist]) => artist !== "Unknown Artist").slice(0, 3).map(([artist]) => artist.split(",")[0].trim());
    const searches = await Promise.all(artists.map((a) => getJson(`/search?q=${encodeURIComponent(a)}&filter=songs&limit=20`)));
    const groups = [popularTracks(chart, true), ...searches.map((s, i) => popularTracks(s).filter(t => t.artist.split(",")[0].trim() === artists[i]))];
    const merged: Track[] = [];
    const seen = new Set<string>();
    for (let round = 0; round < 12 && merged.length < 12; round++) {
      for (const g of groups) {
        const t = g[round];
        if (t && !seen.has(songKey(t)) && !blockedSet.has(t.artist)) { seen.add(songKey(t)); merged.push(t); }
      }
    }
    const picks = merged.slice(0, 12);
    setQuickPicks(picks);
    localStorage.setItem("mv:quickpicks", JSON.stringify({ v: 3, at: Date.now(), tracks: picks }));
  }, [history, blocked]);

  const reshuffleHome = useCallback(async () => {
    flashToast("Menyusun ulang...");
    setShelves((prev) => { const n: Record<string, Track[]> = {}; for (const k in prev) n[k] = shuffleArray(prev[k]); return n; });
    localStorage.removeItem("mv:quickpicks");
    await loadHome();
    buildQuickPicks(region);
  }, [loadHome, buildQuickPicks, region, flashToast]);

  const checkForUpdate = useCallback(async () => {
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update?.available) setUpdateInfo({ version: update.version, obj: update });
    } catch (e) { console.error("update check failed", e); }
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
  }, [loadHome, buildQuickPicks]);

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

  const resolveStreamUrl = async (videoId: string): Promise<string> => `${API_URL}/stream/${videoId}?t=${Date.now()}`;

  const startStream = useCallback(async (track: Track, resumeTime?: number) => {
    const requestId = ++playRequestRef.current;
    setStreamLoading(true);
    pendingResume.current = Number.isFinite(resumeTime) ? Math.max(0, resumeTime || 0) : 0;
    setPlayerUrl(null);
    if (resumeTime) { setCurrentTime(resumeTime); setDuration(0); }
    else { setCurrentTime(0); setDuration(0); }
    try {
      let url: string;
      url = await resolveStreamUrl(track.videoId);
      if (playRequestRef.current !== requestId) return;
      setPlayerUrl(url);
      setIsPlaying(true);
      // Warm the backend's resolve cache so auto-next starts instantly.
      const next = orderRef.current[posRef.current + 1];
      if (next && next.videoId !== track.videoId) fetch(`${API_URL}/stream/${next.videoId}/info`).catch(() => {});

    } catch (e) {
      console.error("Failed to resolve stream", e);
      if (playRequestRef.current === requestId) { setIsPlaying(false); flashToast("Failed to load audio."); }
    } finally {
      if (playRequestRef.current === requestId) {
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

  const startVisualizer = useCallback(() => {
    if (!analyserRef.current) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      reqFrameRef.current = requestAnimationFrame(draw);

      const canvas = visualizerCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = 3;
      const barGap = 2;
      const numBars = Math.floor(canvas.width / (barWidth + barGap));

      // Focus on the lower/mid frequencies for better visual movement
      const step = Math.floor((bufferLength * 0.5) / numBars);

      let x = 0;
      for (let i = 0; i < numBars; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) {
          sum += dataArray[i * step + j];
        }
        const avg = sum / step;

        // Scale height smoothly
        const barHeight = Math.max(2, (avg / 255) * canvas.height);

        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";

        // Center the bars vertically
        const y = (canvas.height - barHeight) / 2;

        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(x, y, barWidth, barHeight, 2);
        } else {
          ctx.rect(x, y, barWidth, barHeight);
        }
        ctx.fill();

        x += barWidth + barGap;
      }
    };
    draw();
  }, []);

  const initAudioContext = useCallback(() => {
    if (!audioRef.current || audioContextRef.current) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = ctx.createMediaElementSource(audioRef.current);

      const frequencies = [60, 230, 910, 3600, 14000];
      const bands = frequencies.map((freq, i) => {
        const filter = ctx.createBiquadFilter();
        if (i === 0) filter.type = "lowshelf";
        else if (i === frequencies.length - 1) filter.type = "highshelf";
        else filter.type = "peaking";
        filter.frequency.value = freq;
        filter.gain.value = eqGains[i];
        return filter;
      });

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;

      source.connect(bands[0]);
      for (let i = 0; i < bands.length - 1; i++) {
        bands[i].connect(bands[i + 1]);
      }
      bands[bands.length - 1].connect(analyser);
      analyser.connect(ctx.destination);

      audioContextRef.current = ctx;
      analyserRef.current = analyser;
      eqBandsRef.current = bands;

      startVisualizer();
    } catch (e) {
      console.warn("Failed to init Web Audio API", e);
    }
  }, [eqGains, startVisualizer]);

  useEffect(() => {
    if (eqBandsRef.current.length === 5) {
      eqGains.forEach((gain, i) => {
        eqBandsRef.current[i].gain.value = gain;
      });
    }
  }, [eqGains]);

  const handleAudioError = useCallback(() => {
    if (currentTrackRef.current && !triedDownloadRef.current) {
      triedDownloadRef.current = true;
      startStream(currentTrackRef.current, audioRef.current?.currentTime); // resume where it dropped, not from 0
    } else { setIsPlaying(false); setStreamLoading(false); flashToast("Audio could not be loaded. Try another song or play again."); }
  }, [startStream, flashToast]);

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
  const subscribeFromCtx = useCallback(async (track: Track) => {
    try {
      const res = await fetch(`${API_URL}/search?q=${encodeURIComponent(track.artist)}&filter=artists`);
      const hits = await res.json();
      const firstArtist = hits.find((h: any) => h.resultType === "artist");
      if (firstArtist && firstArtist.browseId) {
        toggleSubscribe(firstArtist.browseId, firstArtist.artist, firstArtist.thumbnails);
        flashToast(`Subscribed to ${firstArtist.artist}`);
      } else {
        flashToast("Artist not found");
      }
    } catch (e) {
      console.error(e);
      flashToast("Error subscribing");
    }
  }, [toggleSubscribe, flashToast]);
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
    setBlocked((prev) => {
      const newBlocked = prev.includes(track.artist) ? prev : [...prev, track.artist];
      const blockedSet = new Set(newBlocked);

      setShelves((shelvesPrev) => {
        const newShelves: Record<string, Track[]> = {};
        for (const k in shelvesPrev) {
          newShelves[k] = shelvesPrev[k].filter(t => !blockedSet.has(t.artist));
        }
        return newShelves;
      });
      return newBlocked;
    });
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
    let cancelled = false;
    if (isPlaying) {
      audioContextRef.current?.resume().catch(() => {});
      audio.play().catch(error => {
        if (!cancelled && error.name !== "AbortError") { setIsPlaying(false); setStreamLoading(false); }
      });
    } else audio.pause();
    return () => { cancelled = true; };
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
    const controller = new AbortController();
    setLyrics(null);
    setLyricsLoading(true);
    fetchLyrics(currentTrack, API_URL, controller.signal, duration || currentTrack.duration)
      .then(result => { if (!controller.signal.aborted) setLyrics(result); })
      .catch(() => { if (!controller.signal.aborted) setLyrics(null); })
      .finally(() => { if (!controller.signal.aborted) setLyricsLoading(false); });
    return () => controller.abort();
  }, [currentTrack?.videoId, currentTrack?.title, currentTrack?.artist, currentTrack?.duration, duration]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !currentTrack) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: currentTrack.title, artist: currentTrack.artist, album: "Music Venue", artwork: [{ src: currentTrack.artwork, sizes: "512x512", type: "image/jpeg" }] });
    navigator.mediaSession.setActionHandler("play", () => setIsPlaying(true));
    navigator.mediaSession.setActionHandler("pause", () => setIsPlaying(false));
    navigator.mediaSession.setActionHandler("previoustrack", () => playPrev());
    navigator.mediaSession.setActionHandler("nexttrack", () => advance(true));
  }, [currentTrack, playPrev, advance]);

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

  const openCtx = (e: React.MouseEvent, track: Track, context: Track[], playlistId?: string) => {
    e.preventDefault();
    const menuW = 232, menuH = 372;
    const x = Math.min(e.clientX, window.innerWidth - menuW - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuH - 8);
    setCtxMenu({ x: Math.max(8, x), y: Math.max(8, y), track, context, playlistId });
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


  const handleAddToPlaylist = (playlistId: string) => {
    if (!playlistDialogTrack) return;
    setPlaylists(prev => {
      const p = prev.find(x => x.id === playlistId);
      if (!p) return prev;
      if (p.tracks.some(t => t.videoId === playlistDialogTrack.videoId)) return prev;
      const newPlaylists = prev.map(x => x.id === playlistId ? { ...x, tracks: [...x.tracks, playlistDialogTrack] } : x);
      return newPlaylists;
    });
    setIsPlaylistDialogOpen(false);
    setPlaylistDialogTrack(null);
  };

  const handleCreateAndAddToPlaylist = () => {
    if (!playlistDialogTrack || !newPlaylistName.trim()) return;
    const newPlaylist: Playlist = {
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
      name: newPlaylistName.trim(),
      description: newPlaylistDesc.trim(),
      image: newPlaylistImg.trim(),
      banner: newPlaylistBanner.trim(),
      tracks: [playlistDialogTrack]
    };
    setPlaylists(prev => {
      const newPlaylists = [...prev, newPlaylist];
      return newPlaylists;
    });
    setNewPlaylistName("");
    setNewPlaylistDesc("");
    setNewPlaylistImg("");
    setIsPlaylistDialogOpen(false);
    setPlaylistDialogTrack(null);
  };

  const handleEditPlaylist = () => {
    if (!editingPlaylistId || !newPlaylistName.trim()) return;
    setPlaylists(prev => {
      const newPlaylists = prev.map(p => p.id === editingPlaylistId ? { ...p, name: newPlaylistName.trim(), description: newPlaylistDesc.trim(), image: newPlaylistImg.trim(), banner: newPlaylistBanner.trim() } : p);
      return newPlaylists;
    });
    setNewPlaylistName("");
    setNewPlaylistDesc("");
    setNewPlaylistImg("");
    setNewPlaylistBanner("");
    setIsEditPlaylistOpen(false);
    setEditingPlaylistId(null);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      setNewPlaylistImg(result);
    };
    reader.readAsDataURL(file);
  };

  const handleBannerUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      setNewPlaylistBanner(result);
    };
    reader.readAsDataURL(file);
  };

  const handleDeletePlaylist = () => {
    if (!editingPlaylistId) return;
    setPlaylists(prev => {
      const newPlaylists = prev.filter(p => p.id !== editingPlaylistId);
      return newPlaylists;
    });
    if (activePlaylistId === editingPlaylistId) {
      setActiveTab("home");
      setActivePlaylistId(null);
    }
    setNewPlaylistName("");
    setNewPlaylistDesc("");
    setNewPlaylistImg("");
    setNewPlaylistBanner("");
    setIsEditPlaylistOpen(false);
    setEditingPlaylistId(null);
  };

  const handleRemoveFromPlaylist = (playlistId: string, videoId: string) => {
    setPlaylists(prev => {
      const newPlaylists = prev.map(p => {
        if (p.id === playlistId) {
          return { ...p, tracks: p.tracks.filter(t => t.videoId !== videoId) };
        }
        return p;
      });
      return newPlaylists;
    });
  };

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

  const progressPct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
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

  const renderTrackRow = (track: Track, context: Track[], index: number, playlistId?: string) => {
    const playing = currentTrack?.videoId === track.videoId;
    return (
      <div key={track.videoId} className={`track-row ${playing ? "playing" : ""}`} onDoubleClick={() => playTrack(track, context)} onContextMenu={(e) => openCtx(e, track, context, playlistId)}>
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
    <>
      <AnimatePresence>
        {showIntro && <SplashIntro onComplete={() => setShowIntro(false)} />}
      </AnimatePresence>
      <motion.div 
        className="app-container" 
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: showIntro ? 0 : 1, scale: showIntro ? 0.97 : 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        style={{ pointerEvents: showIntro ? 'none' : 'auto' }}
        onContextMenu={(e) => {
      // Suppress the native browser right-click menu on the main window
      // (track/album cards handle their own custom menu via openCtx).
      const target = e.target as HTMLElement;
      if (!target.closest('.track-row, .album-card, .queue-item, .top-result-card, .ctx-menu, .track-row-more, .top-result-more')) {
        e.preventDefault();
      }
    }}>
      <audio ref={audioRef} src={playerUrl || undefined} crossOrigin="anonymous" onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)} onDurationChange={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)} onLoadedMetadata={(e) => {
        if (pendingResume.current > 0) { e.currentTarget.currentTime = Math.min(pendingResume.current, Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : pendingResume.current); pendingResume.current = 0; }
      }} onSeeked={(e) => setCurrentTime(e.currentTarget.currentTime)} onEnded={handleEnded} onError={handleAudioError} onPlay={() => { setIsPlaying(true); initAudioContext(); }} onWaiting={() => setStreamLoading(true)} onCanPlay={() => setStreamLoading(false)} onPlaying={() => setStreamLoading(false)} onPause={(e) => { if (e.currentTarget.readyState >= 2 && !streamLoading) setIsPlaying(false); }} />
      <aside className="sidebar">
        <div className="drag-region" onMouseDown={handleDrag} />
        <div className="sidebar-brand"><Sparkles size={20} /> Music Venue</div>
        <div className="sidebar-section">
          <div className={`nav-item ${activeTab === "home" ? "active" : ""}`} onClick={() => handleTabClick("home")}><Home size={20} /> Listen Now</div>
          <div className={`nav-item ${activeTab === "search" ? "active" : ""}`} onClick={() => setActiveTab("search")}><Search size={20} /> Search</div>
          <div className={`nav-item ${activeTab === "radio" ? "active" : ""}`} onClick={() => handleTabClick("radio")}><Radio size={20} /> Radio</div>
        </div>
        <div className="sidebar-section">
          <div className="nav-item" onClick={() => setLibraryOpen(!libraryOpen)} style={{ fontWeight: 600 }}>
            <ListMusic size={20} /> Library
            <ChevronDown size={16} style={{ marginLeft: 'auto', transition: 'transform 0.2s', transform: libraryOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} />
          </div>
          {libraryOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 8 }}>
              <div className={`nav-item ${activeTab === "favorites" ? "active" : ""}`} onClick={() => setActiveTab("favorites")}><Heart size={18} /> Liked Music {favorites.length > 0 && <span className="nav-count">{favorites.length}</span>}</div>
              {playlists.map(pl => (
                <div key={pl.id} className={`nav-item ${activeTab === "playlistDetail" && activePlaylistId === pl.id ? "active" : ""}`} onClick={() => { setActivePlaylistId(pl.id); setActiveTab("playlistDetail"); }}>
                  <ListMusic size={18} /> {pl.name}
                </div>
              ))}
              <div className="nav-item" onClick={() => setShowQueue(true)}><ListMusic size={18} /> Queue</div>
            </div>
          )}
        </div>
        {subscribedArtists.length > 0 && (
          <div className="sidebar-section">
            <div className="nav-item" onClick={() => setFollowingOpen(!followingOpen)} style={{ fontWeight: 600 }}>
              <UserPlus size={20} /> Following
              <span className="nav-count" style={{ marginLeft: 'auto', marginRight: 8 }}>{subscribedArtists.length}</span>
              <ChevronDown size={16} style={{ transition: 'transform 0.2s', transform: followingOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} />
            </div>
            {followingOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 8 }}>
                {subscribedArtists.map(a => (
                  <div key={a.artistId} className={`nav-item ${activeTab === "artist" && artistView?.artist?.artistId === a.artistId ? "active" : ""}`} onClick={() => openArtist({ artistId: a.artistId, name: a.name })}>
                    <img src={a.thumbnails?.[0]?.url || ""} alt="" style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover' }} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="sidebar-bottom">
          <Button className={`sidebar-profile ${activeTab === "profile" ? "active" : ""}`} onClick={() => setActiveTab("profile")}>
            {profile.avatar ? <img src={profile.avatar} alt={profile.name} className="profile-avatar-img" /> : <span className="profile-avatar" style={{ background: profile.color }}>{(profile.name || "G").charAt(0).toUpperCase()}</span>}
            <div className="profile-brief"><span className="profile-name">{profile.name || "Guest"}</span><span className="profile-sub">Settings</span></div>
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
            {isTauri && (
              <div className="window-controls">
                <Button className="win-btn" onClick={handleMinimize}><Minus size={16} /></Button>
                <Button className="win-btn" onClick={handleMaximize}>{isMaximized ? <Square size={12} /> : <Maximize size={14} />}</Button>
                <Button className="win-btn win-btn-close" onClick={handleClose}><X size={16} /></Button>
              </div>
            )}
          </div>
        </header>
        <AnimatePresence mode="wait" custom={pageTransition}>
        {activeTab === "home" && (
          <motion.div key="home" custom={pageTransition} variants={pageVariants} initial="initial" animate="in" exit="out" transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className="page">
            <section className="listen-hero">
              <div className="listen-hero-copy">
                <span className="eyebrow"><Sparkles size={13} /> YOUR DAILY SOUNDTRACK</span>
                <h2>A little more<br />you. A lot more music.</h2>
                <p>Old favorites. New obsessions. All in one place.</p>
                <div className="hero-actions">
                  <button className="hero-play" onClick={() => quickPicks.length ? playTrack(quickPicks[0], quickPicks) : setActiveTab("search")}><Play size={16} fill="currentColor" /> {quickPicks.length ? "Play your mix" : "Find your music"}</button>
                  <button className="hero-secondary" onClick={() => setActiveTab("favorites")}><Heart size={16} /> Your collection</button>
                </div>
              </div>
              <div className="hero-art-stack" aria-hidden="true">
                {quickPicks.slice(0, 3).map((track, i) => <img key={track.videoId} src={track.artwork} alt="" className={`hero-cover hero-cover-${i}`} />)}
                {!quickPicks.length && <div className="hero-art-placeholder"><ListMusic size={90} strokeWidth={1} /></div>}
                <span className="hero-glass-tag"><span className="live-dot" /> Made for your everyday</span>
              </div>
            </section>
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
          </motion.div>
        )}
        {activeTab === "favorites" && (
          <motion.div key="favorites" custom={pageTransition} variants={pageVariants} initial="initial" animate="in" exit="out" transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className="page">
            {favorites.length ? <div className="track-grid wide">{favorites.map((t, i) => renderTrackRow(t, favorites, i))}</div> : <div className="empty-state big"><Heart size={44} /><p>Liked Music is empty</p><span>All songs you mark with ♥ will appear here.</span></div>}
          </motion.div>
        )}
        {activeTab === "playlistDetail" && activePlaylistId && (
          <motion.div key="playlistDetail" custom={pageTransition} variants={pageVariants} initial="initial" animate="in" exit="out" transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className="page">
            {(() => {
              const pl = playlists.find(p => p.id === activePlaylistId);
              if (!pl) return <div className="empty-state big"><p>Playlist not found</p></div>;
              return (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div className="artist-page-head" style={pl.banner ? { background: `linear-gradient(to right, rgba(0,0,0,0.85), rgba(0,0,0,0.4)), url(${pl.banner}) center/cover no-repeat`, border: 'none' } : {}}>
                    {pl.image ? (
                      <img src={pl.image} alt={pl.name} style={{ width: 168, height: 168, borderRadius: 16, objectFit: 'cover', boxShadow: '0 16px 40px rgba(0,0,0,0.6)', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 168, height: 168, borderRadius: 16, background: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 16px 40px rgba(0,0,0,0.6)', flexShrink: 0 }}>
                        <ListMusic size={64} opacity={0.5} />
                      </div>
                    )}
                    <div className="artist-page-meta">
                      <span className="artist-hero-label"><ListMusic size={13} /> Playlist</span>
                      <h1 style={{ fontSize: 36, margin: 0, lineHeight: 1.2 }}>{pl.name}</h1>
                      <p style={{ color: 'var(--text-secondary)', fontSize: 16 }}>{pl.description || "No description provided."}</p>
                      <div className="artist-page-actions">
                        <Button variant="outline" className="glass-btn" onClick={() => { if (pl.tracks.length) playTrack(pl.tracks[0], pl.tracks); }}>
                          <Play size={17} fill="currentColor" /> Play All
                        </Button>
                        <Button variant="outline" className="glass-btn" onClick={() => {
                          setNewPlaylistName(pl.name);
                          setNewPlaylistDesc(pl.description || "");
                          setNewPlaylistImg(pl.image || "");
                          setNewPlaylistBanner(pl.banner || "");
                          setEditingPlaylistId(pl.id);
                          setIsEditPlaylistOpen(true);
                        }}>
                          Edit Details
                        </Button>
                      </div>
                    </div>
                  </div>
                  <section className="search-section">
                    <div className="section-head"><h2>Songs</h2><span className="section-badge">{pl.tracks.length} lagu</span></div>
                    {pl.tracks.length ? (
                      <div className="track-grid wide">
                        {pl.tracks.map((t, i) => renderTrackRow(t, pl.tracks, i, pl.id))}
                      </div>
                    ) : (
                      <div className="empty-state big" style={{ padding: '40px 0' }}>
                        <ListMusic size={44} />
                        <p>This playlist is empty</p>
                        <span>Add songs using the context menu on any track.</span>
                      </div>
                    )}
                  </section>
                </div>
              );
            })()}
          </motion.div>
        )}
        {activeTab === "artist" && (
          <motion.div key="artist" custom={pageTransition} variants={pageVariants} initial="initial" animate="in" exit="out" transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className="page">
            {artistLoading ? <div className="artist-page-head"><div className="artist-avatar sk-avatar" /><div className="artist-page-meta"><div className="sk-line" /><div className="sk-line short" /></div></div> : artistView?.artist ? (
              <>
                <div className="artist-page-head">
                  <img className="artist-avatar" src={pickArtwork(artistView.artist.thumbnails)} alt={artistView.artist.name} />
                  <div className="artist-page-meta">
                    <span className="artist-hero-label"><User size={13} /> Artist</span>
                    <h1>{artistView.artist.name}</h1>
                    {artistView.artist.subscribers && <p>{artistView.artist.subscribers} subscribers</p>}
                    <div className="artist-page-actions">
                      <Button variant="outline" className="glass-btn" onClick={() => artistView.songs.length && playTrack(artistView.songs[0], artistView.songs)}><Play size={17} fill="currentColor" /> Play</Button>
                      <Button variant="outline" className="glass-btn" onClick={() => { if (artistView.songs.length) { setShuffleMode("random"); playTrack(artistView.songs[0], artistView.songs); } }}><Shuffle size={17} /> Shuffle</Button>
                      <Button variant="outline" className="glass-btn" onClick={() => artistView.artist && toggleSubscribe(artistView.artist.channelId || artistView.artist.artistId || "", artistView.artist.name, artistView.artist.thumbnails)} style={{ gap: 8 }}>
                        {artistView.artist && subscribedArtists.some(s => s.artistId === (artistView.artist?.channelId || artistView.artist?.artistId)) ? <><UserMinus size={16} /> Unsubscribe</> : <><UserPlus size={16} /> Subscribe</>}
                      </Button>
                    </div>
                  </div>
                </div>
                <section className="search-section">
                  <div className="section-head"><h2>Songs</h2><span className="section-badge">{artistView.songs.length} lagu</span></div>
                  <div className="track-grid wide">{artistView.songs.map((t, i) => renderTrackRow(t, artistView.songs, i))}</div>
                </section>
              </>
            ) : <div className="empty-state big"><User size={44} /><p>Artist not found</p><span>Try searching for another artist.</span></div>}
          </motion.div>
        )}
        {(activeTab === "search" || activeTab === "radio") && (
          <motion.div key={activeTab} custom={pageTransition} variants={pageVariants} initial="initial" animate="in" exit="out" transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className="page">
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
          </motion.div>
        )}
        {activeTab === "shelf" && activeShelf && (
          <motion.div key="shelf" custom={pageTransition} variants={pageVariants} initial="initial" animate="in" exit="out" transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className="page">
            <div className="section-head" style={{ marginTop: 20 }}>
              <h2>{homeShelvesState.find(s => s.id === activeShelf)?.title || "Playlist"}</h2>
              <span className="section-badge muted">{homeShelvesState.find(s => s.id === activeShelf)?.subtitle}</span>
            </div>
            <div className="grid-container">
              {shelves[activeShelf]?.map(t => renderAlbumCard(t, shelves[activeShelf]))}
            </div>
            </motion.div>
          )}
        {activeTab === "profile" && (
          <motion.div key="profile" custom={pageTransition} variants={pageVariants} initial="initial" animate="in" exit="out" transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className="page profile-page">
            <div className="profile-hero" style={profile.banner ? { backgroundImage: `url(${profile.banner})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}>
              <input ref={bannerInput} hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={pickProfileImage("banner")} />
              <input ref={avatarInput} hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={pickProfileImage("avatar")} />
              <button type="button" className="profile-banner-btn" onClick={() => bannerInput.current?.click()}><span><Upload size={13} /> Change banner</span></button>
              <button type="button" className="profile-avatar-edit" aria-label="Change photo" onClick={() => avatarInput.current?.click()}>
                {profile.avatar ? <img src={profile.avatar} alt="" className="profile-hero-avatar-img" /> : <span className="profile-hero-avatar" style={{ background: profile.color }}>{(profile.name || "G").charAt(0).toUpperCase()}</span>}
                <span className="profile-avatar-hint"><Upload size={20} /></span>
              </button>
              <div className="profile-hero-info">
                <span className="artist-hero-label glass-text"><UserCircle size={13} /> Profile</span>
                <input className="profile-name-input" aria-label="Display name" maxLength={40} value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} />
                <p className="glass-text">{favorites.length} liked songs · {subscribedArtists.length} artists followed</p>
              </div>
            </div>

            <div className="profile-content">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24 }}>
                <div className="setting-block">
                  <h3>Themes</h3><p className="setting-desc">Change application appearance.</p>
                  <div className="theme-grid">
                    {[{ id: "system", label: "System", Icon: Monitor }, { id: "light", label: "Light", Icon: Sun }, { id: "dark", label: "Dark", Icon: Moon }].map((tOpt) => (
                      <Button key={tOpt.id} className={`theme-card ${theme === tOpt.id ? "active" : ""}`} onClick={() => setTheme(tOpt.id)}>
                        <span className={`theme-swatch th-${tOpt.id}`}><span className="tsw-bar" /></span>
                        <div className="theme-card-label"><tOpt.Icon size={15} /> {tOpt.label}</div>
                        {theme === tOpt.id && <Check size={16} className="theme-check" />}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="setting-block">
                  <h3>Page Transition</h3><p className="setting-desc">Animation when switching tabs.</p>
                  <div className="theme-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                    {[{ id: "fade", label: "Fade" }, { id: "slide", label: "Slide" }, { id: "zoom", label: "Zoom" }].map((tOpt) => (
                      <Button key={tOpt.id} className={`theme-card ${pageTransition === tOpt.id ? "active" : ""}`} onClick={() => setPageTransition(tOpt.id)} style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div className="theme-card-label" style={{ marginTop: 0 }}>{tOpt.label}</div>
                        {pageTransition === tOpt.id && <Check size={16} className="theme-check" />}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
          </AnimatePresence>
      </main>
      {ctxMenu && (
        <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={(e) => e.stopPropagation()}>
          {ctxMenu.playlistId ? (
            <>
              <Button className="ctx-item" onClick={() => { playTrack(ctxMenu.track, ctxMenu.context); setCtxMenu(null); }}><Play size={17} /> Start from here</Button>
              <Button className="ctx-item" onClick={() => { playNext(ctxMenu.track); setCtxMenu(null); }}><CornerDownRight size={17} /> Play next</Button>
              <div className="ctx-sep" />
              <Button className="ctx-item" onClick={() => { goToArtist(ctxMenu.track.artist); setCtxMenu(null); }}><User size={17} /> Open artist page</Button>
              <Button className="ctx-item" onClick={() => { subscribeFromCtx(ctxMenu.track); setCtxMenu(null); }}><UserPlus size={17} /> Subscribe to artist</Button>
              <Button className="ctx-item" onClick={() => { shareTrack(ctxMenu.track); setCtxMenu(null); }}><Share2 size={17} /> Share</Button>
              <Button className="ctx-item" onClick={() => { downloadTrack(ctxMenu.track); setCtxMenu(null); }}><Download size={17} /> Download</Button>
              <div className="ctx-sep" />
              <Button className="ctx-item danger" onClick={() => { handleRemoveFromPlaylist(ctxMenu.playlistId!, ctxMenu.track.videoId); setCtxMenu(null); }}><Trash2 size={17} /> Delete from playlist</Button>
            </>
          ) : (
            <>
              <Button className="ctx-item" onClick={() => { startMix(ctxMenu.track); setCtxMenu(null); }}><Radio size={17} /> Start mix</Button>
              <Button className="ctx-item" onClick={() => { playNext(ctxMenu.track); setCtxMenu(null); }}><CornerDownRight size={17} /> Play next</Button>
              <Button className="ctx-item" onClick={() => { addToQueue(ctxMenu.track); setCtxMenu(null); }}><ListPlus size={17} /> Add to queue</Button>
              <div className="ctx-sep" />
              <Button className="ctx-item" onClick={() => { toggleFavorite(ctxMenu.track); setCtxMenu(null); }}><Heart size={17} fill={isFavorite(ctxMenu.track.videoId) ? "currentColor" : "none"} /> {isFavorite(ctxMenu.track.videoId) ? "Remove from liked music" : "Add to liked music"}</Button>
              <Button className="ctx-item" onClick={() => { downloadTrack(ctxMenu.track); setCtxMenu(null); }}><Download size={17} /> Download</Button>
              <Button className="ctx-item" onClick={() => { goToArtist(ctxMenu.track.artist); setCtxMenu(null); }}><User size={17} /> Open artist page</Button>
              <Button className="ctx-item" onClick={() => { subscribeFromCtx(ctxMenu.track); setCtxMenu(null); }}><UserPlus size={17} /> Subscribe to artist</Button>
              <Button className="ctx-item" onClick={() => { setPlaylistDialogTrack(ctxMenu.track); setIsPlaylistDialogOpen(true); setCtxMenu(null); }}><ListMusic size={17} /> Add to playlist</Button>
              <Button className="ctx-item" onClick={() => { shareTrack(ctxMenu.track); setCtxMenu(null); }}><Share2 size={17} /> Share</Button>
              <div className="ctx-sep" />
              <Button className="ctx-item danger" onClick={() => { notInterested(ctxMenu.track); setCtxMenu(null); }}><Ban size={17} /> Don't recommend artist</Button>
            </>
          )}
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
            <Button aria-label="Close now playing" className="np-close" onClick={() => setNowPlayingOpen(false)}><ChevronDown size={26} /></Button>
            <div className="np-body">
              <div className="np-left">
                <div className="np-art-wrapper" onMouseEnter={() => setIsHoveringArt(true)} onMouseLeave={() => setIsHoveringArt(false)}>
                  <img src={currentTrack.artwork} alt="" className="np-art" />
                  <AnimatePresence>
                    {isHoveringArt && (
                      <motion.div className="np-art-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <div className="np-overlay-top">
                          <Button className="overlay-btn" onClick={() => setShareLyricOpen(true)}><Share2 size={24} /></Button>
                          <Button className="overlay-btn" onClick={() => setShowQueue(!showQueue)}><ListMusic size={24} /></Button>
                        </div>
                        <motion.button className="overlay-btn heart-btn" onClick={() => toggleFavorite(currentTrack)} whileTap={{ scale: 0.8 }} animate={{ scale: isFavorite(currentTrack.videoId) ? [1, 1.2, 1] : 1 }}>
                          <Heart size={48} fill={isFavorite(currentTrack.videoId) ? "var(--primary)" : "none"} color={isFavorite(currentTrack.videoId) ? "var(--primary)" : "currentColor"} />
                        </motion.button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <div className="np-meta"><span className="np-eyebrow">NOW PLAYING</span><h2>{currentTrack.title}</h2><p>{currentTrack.artist}</p></div>
                <div className="np-progress">
                  <span>{formatTime(currentTime)}</span>
                  <Slider value={[progressPct]} max={100} step={0.1} onValueChange={(val) => { if (audioRef.current && duration > 0) audioRef.current.currentTime = val[0] / 100 * duration; }} className="cursor-pointer" />
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
              <SyncedLyrics sources={lyrics} loading={lyricsLoading} audioRef={audioRef} offset={lyricOffset} onOffsetChange={setLyricOffset} />
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
              <div className="player-text"><span className="player-title">{currentTrack.title}</span><span className="player-artist">{currentTrack.artist}</span></div>
              <Button className={`player-like ${isFavorite(currentTrack.videoId) ? "active" : ""}`} onClick={(e) => { e.stopPropagation(); toggleFavorite(currentTrack); }}><Heart size={16} fill={isFavorite(currentTrack.videoId) ? "currentColor" : "none"} /></Button>
            </>
          ) : <div className="player-text idle">Not Playing</div>}
        </div>

        <div className="player-controls">
          <div className="control-buttons">
            <CtrlButton label="Shuffle" className={`btn-icon sm ${shuffleMode !== "off" ? "on" : ""}`} onClick={cycleShuffle} title={`Shuffle: ${shuffleMode}`}><Shuffle size={17} />{shuffleMode === "smart" && <span className="mode-dot" />}</CtrlButton>
            <CtrlButton label="Previous" className="btn-icon sm" onClick={playPrev}><SkipBack size={19} fill="currentColor" /></CtrlButton>
            <CtrlButton label={streamLoading ? "Loading" : isPlaying ? "Pause" : "Play"} className="btn-icon sm btn-play" onClick={togglePlay}>{streamLoading ? <RefreshCw size={18} className="spin" /> : isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" style={{ marginLeft: 2 }} />}</CtrlButton>
            <CtrlButton label="Next" className="btn-icon sm" onClick={() => advance(true)}><SkipForward size={19} fill="currentColor" /></CtrlButton>
            <CtrlButton label="Repeat" className={`btn-icon sm ${repeatMode !== "off" ? "on" : ""}`} onClick={cycleRepeat} title={`Repeat: ${repeatMode}`}>{repeatMode === "one" ? <Repeat1 size={17} /> : <Repeat size={17} />}</CtrlButton>
          </div>
          <div className="progress-container">
            <span>{formatTime(currentTime)}</span>
            <Slider value={[progressPct]} max={100} step={0.1} onValueChange={(val) => { if (audioRef.current && duration > 0) audioRef.current.currentTime = val[0] / 100 * duration; }} className="cursor-pointer" />
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="player-extras">
          <CtrlButton label="Lyrics" className={`btn-icon sm ${nowPlayingOpen ? "on" : ""}`} onClick={() => currentTrack && setNowPlayingOpen(true)} title="Lyrics"><Mic2 size={18} /></CtrlButton>
          <div className="relative" style={{ position: 'relative' }}>
            <CtrlButton label="Equalizer" className={`btn-icon sm ${showEQ ? "on" : ""}`} onClick={() => setShowEQ(!showEQ)} title="Equalizer"><SlidersHorizontal size={18} /></CtrlButton>
          </div>
          <CtrlButton label="Mute" className="btn-icon sm" onClick={() => setIsMuted((m) => !m)} title="Mute"><VolIcon size={18} /></CtrlButton>
          <Slider value={[isMuted ? 0 : volume * 100]} max={100} step={1} onValueChange={(val) => { setVolume(val[0] / 100); setIsMuted(false); }} className="w-24 cursor-pointer" />
        </div>
      </footer>

      <AnimatePresence>
        {showEQ && (
          <motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }} transition={{ duration: 0.2, ease: "easeOut" }} className="eq-popover glass" onClick={(e) => e.stopPropagation()} style={{ position: 'fixed', transformOrigin: 'bottom right', bottom: '110px', right: '30px', zIndex: 9999, background: 'rgba(25, 25, 25, 0.45)', backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)', border: '1px solid rgba(255,255,255,0.15)', padding: '24px', borderRadius: '24px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', width: 320 }}>
            <div className="eq-header" style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
              <span style={{ fontWeight: 600, fontSize: '15px' }}>Equalizer</span>
              <div style={{ flex: 1 }}>
                <CustomSelect value={activeEqPreset} onChange={(v) => { setActiveEqPreset(v); setEqGains(eqPresets[v] || eqPresets["Flat"]); }} options={Object.keys(eqPresets).map(k => ({ label: k, value: k }))} />
              </div>
            </div>
            <div className="eq-sliders" style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '0 16px' }}>
              {eqGains.map((gain, i) => (
                <div key={i} className="eq-band" style={{ background: 'rgba(255, 255, 255, 0.08)', borderRadius: '24px', padding: '12px 8px', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', flex: '1 1 0', minWidth: 0, flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                  <EqPctLabel gain={gain} />
                  <Slider orientation="vertical" value={[gain]} min={-12} max={12} step={1} onValueChange={(val) => { const newGains = [...eqGains]; newGains[i] = val[0]; setEqGains(newGains); setActiveEqPreset("Custom"); }} className="h-28 cursor-pointer" />
                  <span className="eq-freq" style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}>{["60", "230", "910", "3.6k", "14k"][i]}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isPlaylistDialogOpen && (
        <div className="modal-overlay" onClick={() => setIsPlaylistDialogOpen(false)}>
          <motion.div className="modal-content glass-card" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} onClick={e => e.stopPropagation()} style={{ width: 425, padding: '24px' }}>
            <div style={{ marginBottom: '20px', textAlign: 'center' }}>
              <h2 style={{ fontSize: '1.5rem', marginBottom: '8px', fontWeight: 600 }}>Add to Playlist</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
                {playlists.length > 0 ? "Select a playlist to add this song to, or create a new one." : "Create a new playlist to add this song to."}
              </p>
            </div>
            <div className="grid gap-4">
              {playlists.length > 0 && (
                <div className="flex flex-col gap-2">
                  {playlists.map(pl => (
                    <Button key={pl.id} variant="secondary" onClick={() => handleAddToPlaylist(pl.id)} className="w-full justify-start bg-white/5 hover:bg-white/10 text-white border-0">
                      <ListMusic className="mr-2 h-4 w-4" /> {pl.name}
                    </Button>
                  ))}
                  <div className="text-center my-2 text-xs text-white/50">OR</div>
                </div>
              )}
              <div className="grid gap-2">
                <Input id="name" placeholder="Playlist Name" value={newPlaylistName} onChange={(e) => setNewPlaylistName(e.target.value)} className="bg-white/5 border-white/10 text-white placeholder:text-white/40" />
                <Input id="desc" placeholder="Description (Optional)" value={newPlaylistDesc} onChange={(e) => setNewPlaylistDesc(e.target.value)} className="bg-white/5 border-white/10 text-white placeholder:text-white/40" />
                <div style={{ display: 'flex', gap: 8 }}>
                  <Input id="img" placeholder="Custom Image URL (Optional)" value={newPlaylistImg} onChange={(e) => setNewPlaylistImg(e.target.value)} className="bg-white/5 border-white/10 text-white placeholder:text-white/40" style={{ flex: 1 }} />
                  <label title="Upload custom image" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'} onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}>
                    <Upload size={18} />
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Input id="banner" placeholder="Custom Banner URL (Optional)" value={newPlaylistBanner} onChange={(e) => setNewPlaylistBanner(e.target.value)} className="bg-white/5 border-white/10 text-white placeholder:text-white/40" style={{ flex: 1 }} />
                  <label title="Upload custom banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'} onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}>
                    <Upload size={18} />
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleBannerUpload} />
                  </label>
                </div>
                <Button onClick={handleCreateAndAddToPlaylist} className="mt-2 bg-white text-black hover:bg-white/90">
                  + Create New Playlist
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {isEditPlaylistOpen && (
        <div className="modal-overlay" onClick={() => setIsEditPlaylistOpen(false)}>
          <motion.div className="modal-content glass-card" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} onClick={e => e.stopPropagation()} style={{ width: 425, padding: '24px' }}>
            <div style={{ marginBottom: '20px', textAlign: 'center' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Edit Playlist</h2>
            </div>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Input placeholder="Playlist Name" value={newPlaylistName} onChange={(e) => setNewPlaylistName(e.target.value)} className="bg-white/5 border-white/10 text-white placeholder:text-white/40" />
                <Input placeholder="Description (Optional)" value={newPlaylistDesc} onChange={(e) => setNewPlaylistDesc(e.target.value)} className="bg-white/5 border-white/10 text-white placeholder:text-white/40" />
                <div style={{ display: 'flex', gap: 8 }}>
                  <Input placeholder="Custom Image URL (Optional)" value={newPlaylistImg} onChange={(e) => setNewPlaylistImg(e.target.value)} className="bg-white/5 border-white/10 text-white placeholder:text-white/40" style={{ flex: 1 }} />
                  <label title="Upload custom image" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'} onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}>
                    <Upload size={18} />
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Input placeholder="Custom Banner URL (Optional)" value={newPlaylistBanner} onChange={(e) => setNewPlaylistBanner(e.target.value)} className="bg-white/5 border-white/10 text-white placeholder:text-white/40" style={{ flex: 1 }} />
                  <label title="Upload custom banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'} onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}>
                    <Upload size={18} />
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleBannerUpload} />
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button onClick={handleEditPlaylist} className="mt-2 bg-white text-black hover:bg-white/90" style={{ flex: 1 }}>
                    Save Changes
                  </Button>
                  <Button onClick={handleDeletePlaylist} className="mt-2" variant="destructive" style={{ flex: 'none', padding: '0 16px' }} title="Delete Playlist">
                    <Trash2 size={18} />
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      <AnimatePresence>
        {isPlaying && currentTrack && !nowPlayingOpen && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="glass"
            onClick={() => setNowPlayingOpen(true)}
            style={{
              position: 'fixed',
              top: isTauri ? '90px' : '24px',
              right: '24px',
              zIndex: 9999,
              background: 'rgba(25, 25, 25, 0.45)',
              backdropFilter: 'blur(40px)',
              WebkitBackdropFilter: 'blur(40px)',
              border: '1px solid rgba(255,255,255,0.15)',
              padding: '12px 16px',
              borderRadius: '20px',
              boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              cursor: 'pointer'
            }}
          >
            <img src={currentTrack.artwork || ""} style={{ width: 44, height: 44, borderRadius: '12px', objectFit: 'cover', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }} alt="" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: 14, fontWeight: 600, maxWidth: 160, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'rgba(255,255,255,0.9)' }}>
                  {currentTrack.title}
                </span>
                <canvas ref={visualizerCanvasRef} width={80} height={16} className="visualizer-canvas" style={{ display: 'block', opacity: 0.8 }} />
              </div>
              {orderRef.current[posRef.current + 1] && (
                <span style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.5)', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  Next: {orderRef.current[posRef.current + 1].title}
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {shareLyricOpen && (
          <ShareLyricModal
            isOpen={shareLyricOpen}
            onClose={() => setShareLyricOpen(false)}
            track={currentTrack}
            lyrics={lyrics?.[0] ?? null}
          />
        )}
      </AnimatePresence>
    </motion.div>
    </>
  );
}




