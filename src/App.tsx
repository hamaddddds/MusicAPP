import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Window } from "@tauri-apps/api/window";
import { motion } from "framer-motion";
import { 
  Play, Pause, SkipForward, SkipBack, 
  Volume2, Search, Home, Library, Radio, 
  Menu, Maximize2
} from "lucide-react";

// Types
interface Track {
  id: string;
  title: string;
  artist: string;
  artwork: string;
}

export default function App() {
  const [coreVersion, setCoreVersion] = useState("Loading...");
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Mock data for UI
  const mockAlbums: Track[] = Array(12).fill(null).map((_, i) => ({
    id: `album-${i}`,
    title: `Amazing Album ${i + 1}`,
    artist: `Artist Name`,
    artwork: `https://picsum.photos/seed/${i + 10}/300/300`
  }));

  useEffect(() => {
    // Reveal window after a short delay to ensure React has mounted
    // and CSS has been applied to avoid black screen flash.
    const initApp = async () => {
      try {
        const version = await invoke("get_core_version");
        setCoreVersion(version as string);
        
        // Show window
        const appWindow = new Window("main");
        await invoke("show_window", { window: appWindow });
      } catch (e) {
        console.error("Tauri invoke error", e);
      }
    };
    
    // Give it a tiny delay just to be safe for rendering
    setTimeout(initApp, 100);
  }, []);

  return (
    <div className="app-container">
      {/* Sidebar */}
      <motion.div 
        className="sidebar glass"
        initial={{ x: -260 }}
        animate={{ x: 0 }}
        transition={{ type: "spring", stiffness: 100, damping: 20 }}
      >
        <div className="sidebar-section">
          <div className="sidebar-title">Apple Music Clone</div>
          <div className="nav-item active">
            <Home /> Listen Now
          </div>
          <div className="nav-item">
            <Menu /> Browse
          </div>
          <div className="nav-item">
            <Radio /> Radio
          </div>
        </div>

        <div className="sidebar-section" style={{ marginTop: '20px' }}>
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
        <div className="header">
          <h1>Listen Now</h1>
          <div className="nav-item" style={{ width: '200px', backgroundColor: 'rgba(255,255,255,0.1)' }}>
            <Search size={16} /> Search
          </div>
        </div>

        <div className="grid-container">
          {mockAlbums.map((album, index) => (
            <motion.div 
              key={album.id}
              className="album-card"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <img src={album.artwork} alt={album.title} className="album-artwork" />
              <div className="album-info">
                <h3>{album.title}</h3>
                <p>{album.artist}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Bottom Player Bar */}
      <motion.div 
        className="player-bar glass"
        initial={{ y: 90 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 100, damping: 20, delay: 0.2 }}
      >
        <div className="player-info">
          <img src="https://picsum.photos/seed/50/100/100" alt="Current playing" className="player-artwork" />
          <div className="player-text">
            <span className="player-title">Mockingbird</span>
            <span className="player-artist">Eminem</span>
          </div>
        </div>

        <div className="player-controls">
          <div className="control-buttons">
            <button className="btn-icon"><SkipBack size={20} fill="currentColor" /></button>
            <button className="btn-icon btn-play" onClick={() => setIsPlaying(!isPlaying)}>
              {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" style={{ marginLeft: '2px' }} />}
            </button>
            <button className="btn-icon"><SkipForward size={20} fill="currentColor" /></button>
          </div>
          <div className="progress-container">
            <span>1:23</span>
            <div className="progress-bar">
              <div className="progress-fill"></div>
            </div>
            <span>4:11</span>
          </div>
        </div>

        <div className="player-extras">
          <Volume2 size={20} />
          <div className="progress-bar" style={{ width: '100px' }}>
            <div className="progress-fill" style={{ width: '70%' }}></div>
          </div>
          <Maximize2 size={16} style={{ marginLeft: '8px' }} />
        </div>
      </motion.div>
    </div>
  );
}
