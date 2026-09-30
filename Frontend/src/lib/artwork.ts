export const ARTWORK_PLACEHOLDER = '/music-venue-mark.svg';

export function hiResThumb(url: string, size = 512): string {
  if (!url) return ARTWORK_PLACEHOLDER;
  const video = url.match(/i\.ytimg\.com\/vi\/([^/]+)\//);
  if (video) return `https://i.ytimg.com/vi/${video[1]}/hqdefault.jpg`;
  if (/googleusercontent\.com|ggpht\.com/.test(url)) {
    if (/=w\d+-h\d+/.test(url)) return url.replace(/=w\d+-h\d+[^=]*$/i, `=w${size}-h${size}-l90-rj`);
    if (/=s\d+/.test(url)) return url.replace(/=s\d+[^=]*$/i, `=s${size}`);
    return url + `=w${size}-h${size}-l90-rj`;
  }
  return url;
}

export function videoArtwork(videoId?: string): string {
  return videoId ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg` : ARTWORK_PLACEHOLDER;
}

// Search uses `thumbnails`; watch/radio uses `thumbnail`; /song nests it again.
export function pickArtwork(source: any, videoId?: string): string {
  const candidates = Array.isArray(source) ? source : source?.thumbnails ?? source?.thumbnail?.thumbnails ?? source?.thumbnail ?? [];
  const valid = (Array.isArray(candidates) ? candidates : []).filter(t => typeof t?.url === 'string' && t.url && !/picsum\.photos/.test(t.url));
  const best = valid.reduce((a, b) => !a || (Number(b.width) || 0) >= (Number(a.width) || 0) ? b : a, null);
  return best ? hiResThumb(best.url) : videoArtwork(videoId);
}

// Repair persisted queues/history too; the old random-photo fallback is never a cover.
export function sanitizeStoredArtwork<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sanitizeStoredArtwork) as T;
  if (!value || typeof value !== 'object') return value;
  const result: any = Object.fromEntries(Object.entries(value).map(([key, v]) => [key, sanitizeStoredArtwork(v)]));
  if (result.videoId && (!result.artwork || /picsum\.photos/.test(result.artwork))) result.artwork = videoArtwork(result.videoId);
  return result;
}
