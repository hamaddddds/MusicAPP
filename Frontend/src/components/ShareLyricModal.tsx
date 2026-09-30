import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import * as Dialog from '@radix-ui/react-dialog';
import { toPng } from 'html-to-image';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { X, Download, LoaderCircle, Check, Bold, Italic, Underline, Music2, Quote, Sparkles } from 'lucide-react';
import type { Lyrics } from '../lib/lyrics';
import MusicVenueMark from './MusicVenueMark';

interface LineStyle { bold?: boolean; italic?: boolean; underline?: boolean; }
interface ShareLyricModalProps {
  isOpen: boolean; onClose: () => void;
  track: { videoId: string; title: string; artist: string; artwork: string } | null;
  lyrics: Lyrics | null;
}

export default function ShareLyricModal({ isOpen, onClose, track, lyrics }: ShareLyricModalProps) {
  const [theme, setTheme] = useState<'glass' | 'base' | 'cover'>('glass');
  const [selectedLines, setSelectedLines] = useState<number[]>([]);
  const [customText, setCustomText] = useState('');
  const [lineStyles, setLineStyles] = useState<Record<number, LineStyle>>({});
  const [status, setStatus] = useState<'idle' | 'rendering' | 'done'>('idle');
  const [error, setError] = useState('');
  const cardRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const lines = lyrics?.lines.map(line => line.words).filter(words => words.trim()) || [];
  // Source changes must never reuse selected indices from the previous song.
  useEffect(() => { setSelectedLines([]); setLineStyles({}); setStatus('idle'); setError(''); }, [track?.videoId, lyrics]);
  useEffect(() => {
    if (status !== 'done') return;
    const timer = window.setTimeout(() => setStatus('idle'), 2200);
    return () => window.clearTimeout(timer);
  }, [status]);
  const toggleLine = (index: number) => setSelectedLines(prev => prev.includes(index)
    ? prev.filter(i => i !== index) : prev.length < 6 ? [...prev, index].sort((a, b) => a - b) : prev);
  const toggleStyle = (index: number, style: keyof LineStyle) => setLineStyles(prev => ({ ...prev, [index]: { ...prev[index], [style]: !prev[index]?.[style] } }));

  const handleDownload = async () => {
    if (!cardRef.current || !track || !selectedLines.length || busyRef.current) return;
    busyRef.current = true;
    setStatus('rendering'); setError('');
    try {
      await document.fonts.ready;
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 3, style: { transform: 'none', boxShadow: 'none' } });
      const filename = `${track.artist} - ${track.title} Lyrics.png`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
      if ('__TAURI_INTERNALS__' in window) {
        const path = await save({ filters: [{ name: 'PNG image', extensions: ['png'] }], defaultPath: filename });
        if (!path) { setStatus('idle'); return; }
        const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0));
        await invoke('save_image_to_disk', { path, bytes: Array.from(bytes) });
      } else {
        const link = document.createElement('a');
        link.download = filename; link.href = dataUrl;
        document.body.appendChild(link); link.click(); link.remove();
      }
      setStatus('done');
    } catch (cause) {
      console.error('Lyric export failed:', cause);
      setError('Could not save this image. Please try again.'); setStatus('idle');
    } finally { busyRef.current = false; }
  };

  if (!track) return null;
  return <Dialog.Root open={isOpen} onOpenChange={open => { if (!open && !busyRef.current) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="lyric-studio-scrim" />
      <Dialog.Content asChild onEscapeKeyDown={e => { if (busyRef.current) e.preventDefault(); }}>
        <motion.div className="lyric-studio" initial={{ opacity: 0, y: 24, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
          <header className="studio-header">
            <div className="studio-title-icon"><Quote size={21} /></div>
            <div><Dialog.Title>Share a feeling.</Dialog.Title><Dialog.Description>Turn your favorite lyrics into something worth keeping.</Dialog.Description></div>
            <Dialog.Close className="studio-close" aria-label="Close share lyrics" disabled={status === 'rendering'}><X size={19} /></Dialog.Close>
          </header>
          <div className="studio-body">
            <section className="studio-preview" aria-label="Lyric card preview">
              <div className="studio-preview-label"><Sparkles size={13} /> LIVE PREVIEW</div>
              <div ref={cardRef} className={`lyric-poster poster-${theme}`}>
                {theme !== 'base' && <div className="poster-art-bg" style={{ backgroundImage: `url("${track.artwork}")` }} />}
                <div className="poster-content">
                  <div className="poster-kicker"><Music2 size={15} /><span>ON REPEAT</span><span className="poster-kicker-line" /></div>
                  <div className="poster-track"><img src={track.artwork} alt="" /><div><h2>{track.title}</h2><p>{track.artist}</p></div></div>
                  <Quote className="poster-quote" size={30} fill="currentColor" strokeWidth={0} />
                  <div className={`poster-lyrics ${selectedLines.length > 4 ? 'poster-lyrics-long' : ''}`}>
                    {selectedLines.length ? selectedLines.map(index => <p key={index} style={{ fontWeight: lineStyles[index]?.bold ? 850 : 650, fontStyle: lineStyles[index]?.italic ? 'italic' : 'normal', textDecoration: lineStyles[index]?.underline ? 'underline' : 'none' }}>{lines[index]}</p>) : <p className="poster-placeholder">Some lyrics say<br />it better.</p>}
                  </div>
                  <footer className="poster-footer"><span>{customText || 'A little piece of this song.'}</span><strong><MusicVenueMark />music venue</strong></footer>
                </div>
              </div>
              <p className="studio-preview-hint">Your song. Your words. Your moment.</p>
            </section>
            <section className="studio-controls" aria-label="Customize lyric card">
              <fieldset className="studio-themes"><legend>Make it yours</legend><div className="studio-theme-options">
                {(['glass', 'base', 'cover'] as const).map(t => <button key={t} className={`studio-theme ${theme === t ? 'selected' : ''}`} aria-pressed={theme === t} onClick={() => setTheme(t)}><span className={`theme-swatch swatch-${t}`} style={t === 'cover' ? { backgroundImage: `url("${track.artwork}")` } : undefined}>{theme === t && <Check size={16} />}</span>{t === 'glass' ? 'Dot Glass' : t === 'base' ? 'Midnight' : 'Artwork'}</button>)}
              </div></fieldset>
              <div className="studio-lines-heading"><h3>Pick your lines <span>{selectedLines.length}/6</span></h3><button onClick={() => setSelectedLines([])} disabled={!selectedLines.length}>Clear</button></div>
              <p className="studio-help">Choose up to six lines to tell your story.</p>
              <div className="studio-lines">
                {lines.length ? lines.map((line, index) => {
                  const selected = selectedLines.includes(index);
                  return <div key={index} className={`studio-line ${selected ? 'selected' : ''}`}>
                    <button className="studio-line-select" aria-pressed={selected} disabled={!selected && selectedLines.length === 6} onClick={() => toggleLine(index)}><span className="studio-line-check">{selected ? <Check size={13} /> : String(index + 1).padStart(2, '0')}</span><span>{line}</span></button>
                    {selected && <div className="studio-line-style" aria-label={`Format line ${index + 1}`}>
                      {([{ key: 'bold', Icon: Bold }, { key: 'italic', Icon: Italic }, { key: 'underline', Icon: Underline }] as const).map(({ key, Icon }) => <button key={key} aria-label={`${key} line ${index + 1}`} aria-pressed={!!lineStyles[index]?.[key]} onClick={() => toggleStyle(index, key)}><Icon size={13} /></button>)}
                    </div>}
                  </div>;
                }) : <div className="studio-empty"><Music2 size={26} /><p>No lyrics for this song yet.</p><span>Try another track to create your card.</span></div>}
              </div>
              <label className="studio-caption">A personal touch <span>optional</span><input placeholder="Add a little note…" maxLength={60} value={customText} onChange={e => setCustomText(e.target.value)} /></label>
              {error && <p className="studio-error" role="alert">{error}</p>}
              <button className="studio-save" onClick={handleDownload} disabled={status !== 'idle' || !selectedLines.length}>
                {status === 'rendering' ? <LoaderCircle size={18} className="spin" /> : status === 'done' ? <Check size={18} /> : <Download size={18} />}
                {status === 'rendering' ? 'Creating your image…' : status === 'done' ? 'Image saved' : 'Save lyric card'}
              </button>
              <span className="studio-save-note" role="status">{selectedLines.length ? 'High-resolution PNG · Ready to share' : 'Select a lyric to get started'}</span>
            </section>
          </div>
        </motion.div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
