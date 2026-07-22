import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { motion, AnimatePresence } from "framer-motion";
import ReactPlayer from 'react-player/youtube';
import { 
  Play, Pause, SkipForward, SkipBack, 
  Volume2, Search, Home, Library, Radio, 
  Menu, Maximize2, X, Minus, Square
} from "lucide-react";

// Types
interface Track {
  videoId: string;
  title: string;
  artist: string;
  artwork: string;
}

export default function App() {
  const [coreVersion, setCoreVersion] = useState("Loading...");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("home");
  const [searchQuery, setSearchQuery] = useState("");
  
  const [played, setPlayed] = useState(0);
  const [duration, setDuration] = useState(0);
  const playerRef = useRef<ReactPlayer>(null);
  
  const appWindow = getCurrentWindow();

  // Vercel API URL (Local or deployed)
  // For local testing: http://localhost:3000/api
  // We will assume the Vercel API is running on localhost:3000 during dev.
  const API_URL = "http://localhost:3000/api";

  const fetchTracks = async (action: string, query: string = "") => {
    setLoading(true);
    try {
      const url = query ? `${API_URL}?action=${action}&query=${encodeURIComponent(query)}` : `${API_URL}?action=${action}`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (Array.isArray(data)) {
        const mappedTracks = data
          .filter(item => item.videoId) // Ensure it's playable
          .map(item => ({
            videoId: item.videoId,
            title: item.name || item.title || "Unknown Title",
            artist: item.artist?.name || (item.artists && item.artists[0]?.name) || "Unknown Artist",
            artwork: item.thumbnails?.[0]?.url || item.thumbnails?.[item.thumbnails.length - 1]?.url || "https://picsum.photos/300"
          }));
        setTracks(mappedTracks);
      }
    } catch (e) {
      console.error("Failed to fetch tracks", e);
    }
    setLoading(false);
  };

  useEffect(() => {
    const initApp = async () => {
      try {
        const version = await invoke("get_core_version");
        setCoreVersion(version as string);
        await invoke("show_window", { window: appWindow });
      } catch (e) {
        console.error("Tauri invoke error", e);
      }
    };
    setTimeout(initApp, 100);
    
    // Initial fetch for home
    fetchTracks("home");
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setActiveTab("search");
      fetchTracks("search", searchQuery);
    }
  };

  const playTrack = (track: Track) => {
    setCurrentTrack(track);
    setIsPlaying(true);
  };

  const handleProgress = (state: { played: number }) => {
    setPlayed(state.played);
  };

  const formatTime = (seconds: number) => {
    const date = new Date(seconds * 1000);
    const hh = date.getUTCHours();
    const mm = date.getUTCMinutes();
    const ss = date.getUTCSeconds().toString().padStart(2, '0');
    if (hh) {
      return `${hh}:${mm.toString().padStart(2, '0')}:${ss}`;
    }
    return `${mm}:${ss}`;
  };

  // Window controls
  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = async () => {
    const isMax = await appWindow.isMaximized();
    if (isMax) appWindow.unmaximize();
    else appWindow.maximize();
  };
  const handleClose = () => appWindow.close();

  return (
    <div className="app-container">
      {/* Hidden YouTube Player for Audio Streaming */}
      {currentTrack && (
        <div style={{ display: 'none' }}>
          <ReactPlayer 
            ref={playerRef}
            url={`https://www.youtube.com/watch?v=${currentTrack.videoId}`}
            playing={isPlaying}
            onProgress={handleProgress}
            onDuration={(d) => setDuration(d)}
            onEnded={() => setIsPlaying(false)}
            volume={1}
          />
        </div>
      )}

      {/* Sidebar - Made draggable by data-tauri-drag-region */}
      <motion.div 
        className="sidebar glass"
        initial={{ x: -260 }}
        animate={{ x: 0 }}
        transition={{ type: "spring", stiffness: 100, damping: 20 }}
        data-tauri-drag-region
      >
        <div className="sidebar-section" data-tauri-drag-region>
          <div className="sidebar-title" data-tauri-drag-region>Music Venue</div>
          <div className={`nav-item ${activeTab === 'home' ? 'active' : ''}`} onClick={() => { setActiveTab('home'); fetchTracks('home'); }}>
            <Home /> Listen Now
          </div>
          <div className={`nav-item ${activeTab === 'browse' ? 'active' : ''}`} onClick={() => { setActiveTab('browse'); fetchTracks('search', 'Top Tracks'); }}>
            <Menu /> Browse
          </div>
          <div className={`nav-item ${activeTab === 'radio' ? 'active' : ''}`} onClick={() => { setActiveTab('radio'); fetchTracks('search', 'Radio Mix'); }}>
            <Radio /> Radio
          </div>
        </div>

        <div className="sidebar-section" style={{ marginTop: '20px' }} data-tauri-drag-region>
          <div className="sidebar-title">Library</div>
          <div className="nav-item">
            <Library /> Recently Added
          </div>
          <div className="nav-item">
            <Play /> Songs
          </div>
        </div>
        
        <div style={{ marginTop: 'auto', fontSize: '10px', color: 'gray', padding: '0 8px' }}>
          Core: {coreVersion}
        </div>
      </motion.div>

      {/* Main Content Area */}
      <div className="main-content">
        {/* Header - Made draggable */}
        <div className="header" data-tauri-drag-region>
          <h1 data-tauri-drag-region>
            {activeTab === 'home' ? 'Listen Now' : activeTab === 'browse' ? 'Browse' : activeTab === 'radio' ? 'Radio' : 'Search Results'}
          </h1>
          
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
            <form onSubmit={handleSearch} className="nav-item" style={{ width: '240px', backgroundColor: 'rgba(255,255,255,0.1)' }}>
              <Search size={16} /> 
              <input 
                type="text" 
                placeholder="Search songs..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ background: 'transparent', border: 'none', color: 'white', outline: 'none', width: '100%' }}
              />
            </form>

            {/* Custom Window Controls */}
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={handleMinimize} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}><Minus size={18} /></button>
              <button onClick={handleMaximize} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}><Square size={14} /></button>
              <button onClick={handleClose} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}><X size={18} /></button>
            </div>
          </div>
        </div>

        <div className="grid-container">
          {loading ? (
            <div style={{ padding: '40px', color: 'gray' }}>Loading tracks...</div>
          ) : tracks.length > 0 ? (
            <AnimatePresence>
              {tracks.map((track, index) => (
                <motion.div 
                  key={track.videoId + index}
                  className="album-card"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => playTrack(track)}
                >
                  <img src={track.artwork} alt={track.title} className="album-artwork" />
                  <div className="album-info">
                    <h3>{track.title}</h3>
                    <p>{track.artist}</p>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          ) : (
            <div style={{ padding: '40px', color: 'gray' }}>No results found.</div>
          )}
        </div>
      </div>

      {/* Bottom Player Bar */}
      <motion.div 
        className="player-bar glass"
        initial={{ y: 90 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 100, damping: 20, delay: 0.2 }}
        data-tauri-drag-region
      >
        <div className="player-info" data-tauri-drag-region>
          {currentTrack ? (
            <>
              <img src={currentTrack.artwork} alt={currentTrack.title} className="player-artwork" />
              <div className="player-text">
                <span className="player-title">{currentTrack.title}</span>
                <span className="player-artist">{currentTrack.artist}</span>
              </div>
            </>
          ) : (
            <div className="player-text" style={{ color: 'gray' }}>Not Playing</div>
          )}
        </div>

        <div className="player-controls">
          <div className="control-buttons">
            <button className="btn-icon"><SkipBack size={20} fill="currentColor" /></button>
            <button className="btn-icon btn-play" onClick={() => currentTrack && setIsPlaying(!isPlaying)}>
              {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" style={{ marginLeft: '2px' }} />}
            </button>
            <button className="btn-icon"><SkipForward size={20} fill="currentColor" /></button>
          </div>
          <div className="progress-container">
            <span>{formatTime(played * duration)}</span>
            <div className="progress-bar" onClick={(e) => {
              if (playerRef.current) {
                const rect = e.currentTarget.getBoundingClientRect();
                const pos = (e.clientX - rect.left) / rect.width;
                playerRef.current.seekTo(pos);
              }
            }}>
              <div className="progress-fill" style={{ width: `${played * 100}%` }}></div>
            </div>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="player-extras" data-tauri-drag-region>
          <Volume2 size={20} />
          <div className="progress-bar" style={{ width: '100px' }}>
            <div className="progress-fill" style={{ width: '100%' }}></div>
          </div>
          <Maximize2 size={16} style={{ marginLeft: '8px' }} />
        </div>
      </motion.div>
    </div>
  );
}
