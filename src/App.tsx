import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Pause, SkipForward, SkipBack,
  Volume2, VolumeX, Search, Home, Heart, Clock, Radio,
  Menu, X, Minus, Square, Maximize
} from "lucide-react";
// Types
interface Track {
  videoId: string;
  title: string;
  artist: string;
  artwork: string;
}

// Detect if running inside Tauri
const isTauri = '__TAURI_INTERNALS__' in window;

// API URL: relative for web (Vercel), absolute for desktop
const API_URL = isTauri ? "https://musicvenue.vercel.app/api" : "/api";

export default function App() {
  const [coreVersion, setCoreVersion] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("home");
  const [searchQuery, setSearchQuery] = useState("");

  // Audio state
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [playerUrl, setPlayerUrl] = useState<string | null>(null);
  const [streamLoading, setStreamLoading] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const trackListRef = useRef<Track[]>([]);
  const currentIndexRef = useRef(0);
  const playRequestRef = useRef(0);
  const triedDownloadModeRef = useRef(false);

  // ── Data Fetching ──────────────────────────────────────

  const fetchTracks = useCallback(async (action: string, query: string = "") => {
    setLoading(true);
    try {
      const url = query
        ? `${API_URL}?action=${action}&query=${encodeURIComponent(query)}`
        : `${API_URL}?action=${action}`;
      const response = await fetch(url);
      const data = await response.json();

      if (Array.isArray(data)) {
        const mappedTracks: Track[] = data
          .filter((item: any) => item.videoId)
          .map((item: any) => ({
            videoId: item.videoId,
            title: item.name || item.title || "Unknown Title",
            artist: item.artist?.name || (item.artists && item.artists[0]?.name) || "Unknown Artist",
            artwork: item.thumbnails?.[0]?.url || item.thumbnails?.[item.thumbnails.length - 1]?.url || "https://picsum.photos/300"
          }));
        setTracks(mappedTracks);
        trackListRef.current = mappedTracks;
      }
    } catch (e) {
      console.error("Failed to fetch tracks", e);
    }
    setLoading(false);
  }, []);

  // ── Init ────────────────────────────────────────────────

  useEffect(() => {
    const initApp = async () => {
      if (isTauri) {
        try {
          const version = await invoke("get_core_version");
          setCoreVersion(version as string);
          await invoke("show_main_window");
        } catch (e) {
          console.error("Tauri invoke error", e);
        }
      }
    };
    setTimeout(initApp, 150);
    fetchTracks("home");
  }, [fetchTracks]);

  // ── Audio Playback (native <audio> + /api?action=stream) ─

  // Resolve a playable audio URL from the backend. The mp3 conversion can
  // take a while, so a 202 {pending, taskId} response is polled until done.
  const resolveStreamUrl = async (videoId: string, mode?: string): Promise<{ url: string; provider?: string }> => {
    const modeParam = mode ? `&mode=${mode}` : "";
    let res = await fetch(`${API_URL}?action=stream&videoId=${videoId}${modeParam}`);
    let data = await res.json();

    for (let i = 0; i < 60 && data.pending && data.taskId; i++) {
      await new Promise(r => setTimeout(r, 2000));
      res = await fetch(`${API_URL}?action=stream_status&taskId=${encodeURIComponent(data.taskId)}`);
      data = await res.json();
    }

    if (!data.url) throw new Error(data.error || "No stream URL");
    return data;
  };

  const startStream = async (track: Track, mode?: string) => {
    const requestId = ++playRequestRef.current;
    setStreamLoading(true);
    setPlayerUrl(null);
    setCurrentTime(0);
    setDuration(0);
    try {
      const { url } = await resolveStreamUrl(track.videoId, mode);
      // Ignore stale responses if the user already picked another track
      if (playRequestRef.current !== requestId) return;
      setPlayerUrl(url);
      setIsPlaying(true);
    } catch (e) {
      console.error("Failed to resolve stream", e);
      if (playRequestRef.current === requestId) setIsPlaying(false);
    } finally {
      if (playRequestRef.current === requestId) setStreamLoading(false);
    }
  };

  const playTrack = async (track: Track) => {
    setCurrentTrack(track);
    triedDownloadModeRef.current = false;

    const idx = trackListRef.current.findIndex(t => t.videoId === track.videoId);
    if (idx !== -1) currentIndexRef.current = idx;

    await startStream(track);
  };

  // Direct googlevideo URLs can be IP-locked and fail with 403 — retry once
  // through the server-side mp3 conversion path
  const handleAudioError = () => {
    if (currentTrack && !triedDownloadModeRef.current) {
      triedDownloadModeRef.current = true;
      startStream(currentTrack, "download");
    } else {
      setIsPlaying(false);
    }
  };

  const togglePlay = () => {
    if (!currentTrack) return;
    setIsPlaying(!isPlaying);
  };

  const playNext = () => {
    const list = trackListRef.current;
    if (list.length === 0) return;
    currentIndexRef.current = (currentIndexRef.current + 1) % list.length;
    playTrack(list[currentIndexRef.current]);
  };

  const playPrev = () => {
    const list = trackListRef.current;
    if (list.length === 0) return;
    currentIndexRef.current = (currentIndexRef.current - 1 + list.length) % list.length;
    playTrack(list[currentIndexRef.current]);
  };

  const seekTo = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pos * duration;
  };

  // Sync play/pause state with the audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !playerUrl) return;
    if (isPlaying) {
      audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  }, [isPlaying, playerUrl]);

  // Sync volume/mute with the audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = isMuted ? 0 : volume;
  }, [volume, isMuted, playerUrl]);

  const volumeBarRef = useRef<HTMLDivElement>(null);
  const isDraggingVolume = useRef(false);

  const updateVolumeFromEvent = (clientX: number) => {
    if (!volumeBarRef.current) return;
    const rect = volumeBarRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setVolume(pos);
    setIsMuted(pos === 0);
  };

  const handleVolumeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    isDraggingVolume.current = true;
    updateVolumeFromEvent(e.clientX);

    const onMouseMove = (ev: MouseEvent) => {
      if (isDraggingVolume.current) updateVolumeFromEvent(ev.clientX);
    };
    const onMouseUp = () => {
      isDraggingVolume.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds === 0) return "0:00";
    const mm = Math.floor(seconds / 60);
    const ss = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  };

  // ── Window Controls (Tauri only) ────────────────────────

  const handleMinimize = async () => {
    if (!isTauri) return;
    const win = getCurrentWindow();
    await win.minimize();
  };

  const handleMaximize = async () => {
    if (!isTauri) return;
    const win = getCurrentWindow();
    const max = await win.isMaximized();
    if (max) {
      await win.unmaximize();
      setIsMaximized(false);
    } else {
      await win.maximize();
      setIsMaximized(true);
    }
  };

  const handleClose = async () => {
    if (!isTauri) return;
    const win = getCurrentWindow();
    await win.close();
  };

  const handleDrag = async (e: React.MouseEvent) => {
    if (!isTauri) return;
    // Only drag on left mouse button
    if (e.button !== 0) return;
    const win = getCurrentWindow();
    await win.startDragging();
  };

  // ── Search ──────────────────────────────────────────────

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setActiveTab("search");
      fetchTracks("search", searchQuery);
    }
  };

  // ── Tab Navigation ──────────────────────────────────────

  const handleTabClick = (tab: string, query?: string) => {
    setActiveTab(tab);
    if (tab === "home") fetchTracks("home");
    else if (tab === "browse") fetchTracks("search", query || "Trending music 2025");
    else if (tab === "radio") fetchTracks("search", query || "Lo-fi radio chill");
  };

  const getPageTitle = () => {
    switch (activeTab) {
      case "home": return "Listen Now";
      case "browse": return "Browse";
      case "radio": return "Radio";
      case "search": return "Search Results";
      default: return "Music Venue";
    }
  };

  // ── Render ──────────────────────────────────────────────

  return (
    <div className="app-container">
      {/* Hidden audio element */}
      {playerUrl && (
        <audio
          ref={audioRef}
          src={playerUrl}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onDurationChange={(e) => setDuration(e.currentTarget.duration)}
          onEnded={playNext}
          onError={handleAudioError}
        />
      )}

      {/* Sidebar */}
      <motion.div
        className="sidebar glass"
        initial={{ x: -260 }}
        animate={{ x: 0 }}
        transition={{ type: "spring", stiffness: 100, damping: 20 }}
      >
        {/* Draggable area at top of sidebar */}
        <div className="drag-region" onMouseDown={handleDrag}></div>

        <div className="sidebar-section">
          <div className="sidebar-title">Music Venue</div>
          <div className={`nav-item ${activeTab === 'home' ? 'active' : ''}`} onClick={() => handleTabClick('home')}>
            <Home size={20} /> Listen Now
          </div>
          <div className={`nav-item ${activeTab === 'browse' ? 'active' : ''}`} onClick={() => handleTabClick('browse')}>
            <Menu size={20} /> Browse
          </div>
          <div className={`nav-item ${activeTab === 'radio' ? 'active' : ''}`} onClick={() => handleTabClick('radio')}>
            <Radio size={20} /> Radio
          </div>
        </div>

        <div className="sidebar-section" style={{ marginTop: '20px' }}>
          <div className="sidebar-title">Library</div>
          <div className="nav-item">
            <Heart size={20} /> Liked Music
          </div>
          <div className="nav-item">
            <Clock size={20} /> Recent Play
          </div>
        </div>

        {coreVersion && (
          <div style={{ marginTop: 'auto', fontSize: '10px', color: '#555', padding: '0 8px' }}>
            Core: {coreVersion}
          </div>
        )}
      </motion.div>

      {/* Main Content Area */}
      <div className="main-content">
        {/* Header with drag region and window controls */}
        <div className="header">
          {/* Left side - draggable title area */}
          <div className="header-drag" onMouseDown={handleDrag}>
            <h1>{getPageTitle()}</h1>
          </div>

          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            {/* Search */}
            <form onSubmit={handleSearch} className="search-box">
              <Search size={16} />
              <input
                type="text"
                placeholder="Search songs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </form>

            {/* Window Controls (only shown in Tauri) */}
            {isTauri && (
              <div className="window-controls">
                <button className="win-btn" onClick={handleMinimize} title="Minimize"><Minus size={16} /></button>
                <button className="win-btn" onClick={handleMaximize} title="Maximize">
                  {isMaximized ? <Square size={12} /> : <Maximize size={14} />}
                </button>
                <button className="win-btn win-btn-close" onClick={handleClose} title="Close"><X size={16} /></button>
              </div>
            )}
          </div>
        </div>

        {/* Grid Content */}
        <div className="grid-container">
          {loading ? (
            <div style={{ padding: '40px', color: '#666', gridColumn: '1 / -1' }}>Loading tracks...</div>
          ) : tracks.length > 0 ? (
            <AnimatePresence>
              {tracks.map((track, index) => (
                <motion.div
                  key={track.videoId + index}
                  className="album-card"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ delay: index * 0.04, duration: 0.3 }}
                  onClick={() => playTrack(track)}
                >
                  <img src={track.artwork} alt={track.title} className="album-artwork" loading="lazy" />
                  <div className="album-info">
                    <h3>{track.title}</h3>
                    <p>{track.artist}</p>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          ) : (
            <div style={{ padding: '40px', color: '#666', gridColumn: '1 / -1' }}>No results found. Try searching for something.</div>
          )}
        </div>
      </div>

      {/* Bottom Player Bar */}
      <motion.div
        className="player-bar glass"
        initial={{ y: 90 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 100, damping: 20, delay: 0.2 }}
      >
        {/* Track Info */}
        <div className="player-info">
          {currentTrack ? (
            <>
              <img src={currentTrack.artwork} alt={currentTrack.title} className="player-artwork" />
              <div className="player-text">
                <span className="player-title">{currentTrack.title}</span>
                <span className="player-artist">{streamLoading ? "Loading audio…" : currentTrack.artist}</span>
              </div>
            </>
          ) : (
            <div className="player-text" style={{ color: '#555' }}>Not Playing</div>
          )}
        </div>

        {/* Playback Controls */}
        <div className="player-controls">
          <div className="control-buttons">
            <button className="btn-icon" onClick={playPrev}><SkipBack size={20} fill="currentColor" /></button>
            <button className="btn-icon btn-play" onClick={togglePlay}>
              {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" style={{ marginLeft: '2px' }} />}
            </button>
            <button className="btn-icon" onClick={playNext}><SkipForward size={20} fill="currentColor" /></button>
          </div>
          <div className="progress-container">
            <span>{formatTime(currentTime)}</span>
            <div className="progress-bar" onClick={seekTo}>
              <div className="progress-fill" style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' }}></div>
            </div>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Volume Controls */}
        <div className="player-extras">
          <button className="btn-icon" onClick={toggleMute} style={{ color: 'white' }}>
            {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
          <div className="progress-bar volume-bar" ref={volumeBarRef} onMouseDown={handleVolumeMouseDown}>
            <div className="progress-fill" style={{ width: `${isMuted ? 0 : volume * 100}%` }}></div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
