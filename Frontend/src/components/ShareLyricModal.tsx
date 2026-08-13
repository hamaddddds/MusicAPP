import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { toPng } from 'html-to-image';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { X, Download, Image as ImageIcon, Check, Bold, Italic, Underline } from 'lucide-react';
import { Button } from './ui/button';

interface LineStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

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
  const [exportStatus, setExportStatus] = useState<'idle' | 'rendering' | 'downloading' | 'done'>('idle');
  const [customText, setCustomText] = useState("");
  const [lineStyles, setLineStyles] = useState<Record<number, LineStyle>>({});

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

  const toggleStyle = (index: number, styleType: keyof LineStyle) => {
    setLineStyles(prev => ({
      ...prev,
      [index]: {
        ...prev[index],
        [styleType]: !prev[index]?.[styleType]
      }
    }));
  };

  const handleDownload = async () => {
    if (!cardRef.current || !track) return;
    setExportStatus('rendering');
    try {
      // Small delay to allow UI to update
      await new Promise(r => setTimeout(r, 100));
      const dataUrl = await toPng(cardRef.current, { cacheBust: true, pixelRatio: 3, style: { transform: 'scale(1)' } });
      
      setExportStatus('downloading');
      
      // @ts-ignore - Check if running in Tauri
      if (window.__TAURI_INTERNALS__) {
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
      } else {
        // Use native HTML5 download which triggers OS Save As dialog natively in Web
        const link = document.createElement('a');
        link.download = `${track.artist} - ${track.title} Lyric.png`;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }

      setExportStatus('done');
      setTimeout(() => {
        setExportStatus(prev => prev !== 'idle' ? 'idle' : prev);
      }, 2000);
    } catch (error) {
      console.error("Error exporting image:", error);
      setExportStatus('idle');
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
                    selectedLines.map(idx => {
                      const st = lineStyles[idx] || {};
                      return (
                        <p key={idx} className="slm-lyric-line" style={{
                          fontWeight: st.bold ? 900 : 700,
                          fontStyle: st.italic ? 'italic' : 'normal',
                          textDecoration: st.underline ? 'underline' : 'none'
                        }}>
                          {lines[idx]}
                        </p>
                      );
                    })
                  ) : (
                      <p className="slm-lyric-line placeholder">Select lyrics to share...</p>
                    )}
                  </div>
                </div>
              </div>
              <div className="slm-card-footer">
                <input 
                  type="text" 
                  className="slm-custom-text-input" 
                  placeholder="Add custom text..." 
                  maxLength={40} 
                  value={customText} 
                  onChange={e => setCustomText(e.target.value)} 
                />
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
              <div className="slm-lines glass-panel">
                {lines.length > 0 ? lines.map((line: any, idx: number) => {
                  const isSelected = selectedLines.includes(idx);
                  const st = lineStyles[idx] || {};
                  return (
                    <div key={idx} className={`slm-line-item-wrapper ${isSelected ? 'selected' : ''}`}>
                      <div className="slm-line-item" onClick={() => toggleLine(idx)}>
                        {line}
                      </div>
                      {isSelected && (
                        <div className="slm-line-toolbar">
                          <button className={st.bold ? 'active' : ''} onClick={() => toggleStyle(idx, 'bold')}><Bold size={14}/></button>
                          <button className={st.italic ? 'active' : ''} onClick={() => toggleStyle(idx, 'italic')}><Italic size={14}/></button>
                          <button className={st.underline ? 'active' : ''} onClick={() => toggleStyle(idx, 'underline')}><Underline size={14}/></button>
                        </div>
                      )}
                    </div>
                  );
                }) : <p className="muted">No lyrics available.</p>}
              </div>
            </div>

            <Button className="slm-export-btn" onClick={handleDownload} disabled={exportStatus !== 'idle' || selectedLines.length === 0}>
              {exportStatus === 'rendering' || exportStatus === 'downloading' ? <span className="spin"><ImageIcon size={18} /></span> : exportStatus === 'done' ? <Check size={18} /> : <Download size={18} />}
              {exportStatus === 'rendering' ? 'Rendering Image...' : exportStatus === 'downloading' ? 'Downloading...' : exportStatus === 'done' ? 'Done!' : 'Save Image'}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
