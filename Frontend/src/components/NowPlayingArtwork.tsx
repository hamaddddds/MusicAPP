import { motion } from 'framer-motion';
import { Heart, ListMusic, Share2 } from 'lucide-react';

export default function NowPlayingArtwork({ artwork, title, liked, queueOpen, onLike, onShare, onQueue }: {
  artwork: string; title: string; liked: boolean; queueOpen: boolean;
  onLike: () => void; onShare: () => void; onQueue: () => void;
}) {
  return <div className="np-art-card">
    <motion.div className="np-art-frame" initial={{ opacity: 0, scale: .94 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 180, damping: 24 }}>
      <img src={artwork} alt={`${title} cover`} className="np-art" />
      <div className="np-art-shine" aria-hidden="true" />
    </motion.div>
    <div className="np-action-dock" aria-label="Song actions">
      <motion.button className={`np-action ${liked ? 'is-liked' : ''}`} onClick={onLike} aria-pressed={liked} aria-label={liked ? 'Remove from liked music' : 'Like this song'} whileTap={{ scale: .9 }}>
        <motion.span key={String(liked)} initial={{ scale: .75 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 450, damping: 14 }}><Heart size={19} fill={liked ? 'currentColor' : 'none'} /></motion.span><span>{liked ? 'Liked' : 'Like'}</span>
      </motion.button>
      <motion.button className="np-action" onClick={onShare} aria-label="Share lyrics" whileTap={{ scale: .9 }}><Share2 size={18} /><span>Share lyrics</span></motion.button>
      <motion.button className="np-action" onClick={onQueue} aria-label="Show queue" aria-pressed={queueOpen} whileTap={{ scale: .9 }}><ListMusic size={20} /><span>Queue</span></motion.button>
    </div>
  </div>;
}
