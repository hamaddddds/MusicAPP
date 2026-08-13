import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { toPng } from 'html-to-image';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { X, Download, Image as ImageIcon } from 'lucide-react';
import { Button } from './ui/button';

interface ShareLyricModalProps {
  isOpen: boolean;
  onClose: () => void;
  track: any | null;
  lyrics: any | null;
}

export default function ShareLyricModal({ isOpen, onClose, track, lyrics }: ShareLyricModalProps) {
  const [theme, setTheme] = useState<'glass' | 'base' | 'cover'>('glass');
  const [selectedLines, setSelectedLines] = useState<number[]>([]);
  const cardRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);

  const lines = lyrics?.synced 
    ? lyrics.synced.map((s: any) => s.text) 
    : lyrics?.plain?.split('\n').filter((l: string) => l.trim().length > 0) || [];

  const toggleLine = (index: number) => {
    setSelectedLines(prev => {
      if (prev.includes(index)) return prev.filter(i => i !== index);
      if (prev.length >= 6) return prev; 
      return [...prev, index].sort((a, b) => a - b);
    });
  };

  const handleDownload = async () => {
    if (!cardRef.current || !track) return;
    setIsExporting(true);
    try {
      const dataUrl = await toPng(cardRef.current, { cacheBust: true, pixelRatio: 3, style: { transform: 'scale(1)' } });
      const b64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
      const binaryStr = atob(b64Data);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const filePath = await save({
        filters: [{ name: 'Image', extensions: ['png'] }],
        defaultPath: `${track.title} - Share Lyric.png`
      });

      if (filePath) {
        await writeFile(filePath, bytes);
      }
    } catch (error) {
      console.error("Error exporting image:", error);
    } finally {
      setIsExporting(false);
    }
  };

  if (!isOpen || !track) return null;

  return (
    <div className="share-lyric-overlay" onClick={onClose}>
      <motion.div className="share-lyric-modal" onClick={e => e.stopPropagation()} initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}>
        <div className="slm-header">
          <h3>Share Lyric</h3>
          <Button variant="ghost" size="icon" onClick={onClose}><X size={20} /></Button>
        </div>

        <div className="slm-body">
          <div className="slm-preview-zone">
            <div ref={cardRef} className={`slm-card theme-${theme}`}>
              {theme === 'cover' && <div className="slm-card-bg" style={{ backgroundImage: `url(${track.artwork})` }} />}
              
              <div className="slm-card-content">
                <img src={track.artwork} alt="" className="slm-card-art" />
                <div className="slm-card-text">
                  <div className="slm-card-meta">
                    <h2>{track.title}</h2>
                    <p>{track.artist}</p>
                  </div>
                  
                  <div className="slm-card-lyrics">
                    {selectedLines.length > 0 ? (
                      selectedLines.map(idx => (
                        <p key={idx} className="slm-lyric-line">{lines[idx]}</p>
                      ))
                    ) : (
                      <p className="slm-lyric-line placeholder">Select lyrics to share...</p>
                    )}
                  </div>
                </div>
              </div>
              <div className="slm-card-footer">
                <span>MusicVenue</span>
              </div>
            </div>
          </div>

          <div className="slm-controls-zone">
            <div className="slm-theme-selector">
              <h4>Background Theme</h4>
              <div className="slm-theme-btns">
                <Button className={`theme-btn ${theme === 'glass' ? 'active' : ''}`} onClick={() => setTheme('glass')}>Glass</Button>
                <Button className={`theme-btn ${theme === 'base' ? 'active' : ''}`} onClick={() => setTheme('base')}>Base Color</Button>
                <Button className={`theme-btn ${theme === 'cover' ? 'active' : ''}`} onClick={() => setTheme('cover')}>Cover</Button>
              </div>
            </div>

            <div className="slm-lyrics-list">
              <h4>Select Lyrics (Max 6)</h4>
              <div className="slm-lines">
                {lines.length > 0 ? lines.map((line: any, idx: number) => (
                  <div key={idx} className={`slm-line-item ${selectedLines.includes(idx) ? 'selected' : ''}`} onClick={() => toggleLine(idx)}>
                    {line}
                  </div>
                )) : <p className="muted">No lyrics available.</p>}
              </div>
            </div>

            <Button className="slm-export-btn btn-primary" onClick={handleDownload} disabled={isExporting || selectedLines.length === 0}>
              {isExporting ? <span className="spin"><ImageIcon size={18} /></span> : <Download size={18} />}
              {isExporting ? 'Exporting...' : 'Save Image'}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
