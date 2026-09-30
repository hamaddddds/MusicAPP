import { LRCParser, parseTTMLContent, PlainParser, TTMLParser, type Lyric, type LyricPart } from "@braccato/parsers";

export type { Lyric };
export interface Lyrics { lines: Lyric[]; source: string; synced: boolean; language?: string; songwriters?: string[] }

type Track = { videoId: string; title: string; artist: string };

/** YouTube Music lines from the backend ({t, end?, text, parts:[{t,d,text}]}) in the renderer's shape. */
function fromYtm(data: any, durationMs: number): Lyric[] {
  const lines = (Array.isArray(data?.lines) ? data.lines : []).filter((l: any) => Number.isFinite(l?.t) && l.t >= 0);
  if (!lines.length) return typeof data?.plain === "string" && data.plain.trim() ? PlainParser.parse(data.plain) : [];
  return lines.map((line: any, i: number): Lyric => {
    const start = line.t * 1000;
    const next = lines[i + 1]?.t * 1000 || durationMs || start + 5000;
    const end = Number.isFinite(line.end) && line.end > line.t ? line.end * 1000 : next;
    const words = (Array.isArray(line.parts) ? line.parts : []).filter((p: any) => Number.isFinite(p?.t) && Number.isFinite(p?.d) && typeof p.text === "string");
    const parts: LyricPart[] = words.flatMap((p: any, j: number) => {
      const part = { startTimeMs: p.t * 1000, durationMs: Math.max(0, p.d * 1000), words: p.text.trim() };
      return j < words.length - 1 ? [part, { startTimeMs: (p.t + p.d) * 1000, durationMs: 0, words: " " }] : [part];
    });
    return { startTimeMs: start, durationMs: Math.max(0, end - start), words: String(line.text ?? ""), ...(parts.length ? { parts } : {}) };
  });
}

const isSynced = (lines: Lyric[]) => lines.some(line => line.startTimeMs > 0);
const cache = new Map<string, Lyrics>();

/** Better Lyrics' provider order: rich (syllable) TTML, then word/line synced, then unsynced. */
export async function fetchLyrics(track: Track, api: string, signal: AbortSignal, duration?: number): Promise<Lyrics | null> {
  const seconds = duration && Number.isFinite(duration) ? Math.max(1, Math.round(duration)) : 0;
  const key = `${track.videoId}:${seconds}`;
  if (cache.has(key)) return cache.get(key)!;
  const get = (url: string) => fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) });
  const attempt = async <T,>(load: () => Promise<T | null>): Promise<T | null> => {
    try { return await load(); } catch (error) { if (signal.aborted) throw error; return null; }
  };

  const better = await attempt(async () => {
    const query = new URLSearchParams({ title: track.title, artist: track.artist });
    if (seconds) query.set("duration", String(seconds));
    const response = await get(`${api}/lyrics/better?${query}`);
    if (!response.ok) return null;
    const data = await response.json();
    if (typeof data.score === "number" && data.score < 0.7) return null;
    const parsed = parseTTMLContent(data.ttml, { songDurationMs: seconds * 1000 || undefined });
    return parsed.lyrics.length ? { lines: parsed.lyrics, source: "Better Lyrics", synced: true, language: parsed.language, songwriters: TTMLParser.metadata(data.ttml).songwriters } : null;
  });

  const ytm = better ?? await attempt(async () => {
    const response = await get(`${api}/lyrics/${encodeURIComponent(track.videoId)}/auto`);
    if (!response.ok) return null;
    const lines = fromYtm(await response.json(), seconds * 1000);
    return lines.length ? { lines, source: "YouTube Music", synced: isSynced(lines) } : null;
  });

  const lrclib = ytm?.synced || !seconds ? null : await attempt(async () => {
    const query = new URLSearchParams({ track_name: track.title, artist_name: track.artist, duration: String(seconds) });
    const response = await get(`https://lrclib.net/api/get?${query}`);
    if (!response.ok) return null;
    const data = await response.json();
    const lines = typeof data.syncedLyrics === "string" ? LRCParser.parse(data.syncedLyrics, seconds * 1000) : [];
    return lines.length ? { lines, source: "LRCLib", synced: true } : null;
  });

  const result = lrclib ?? ytm;
  if (result) {
    if (cache.size >= 50) cache.delete(cache.keys().next().value!);
    cache.set(key, result);
  }
  return result;
}

const translations = new Map<string, string | null>();

/** Google's Chrome-extension endpoint: keyless, CORS-open, many lines per request. */
export async function translateLines(lines: string[], target: string, signal: AbortSignal): Promise<(string | null)[]> {
  const pending = [...new Set(lines.map(line => line.trim()).filter(line => line && !translations.has(`${target}:${line}`)))];
  for (let i = 0; i < pending.length; i += 100) {
    const batch = pending.slice(i, i + 100);
    const body = new URLSearchParams();
    batch.forEach(line => body.append("q", line));
    const response = await fetch(`https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${encodeURIComponent(target)}`, { method: "POST", body, signal });
    if (!response.ok) throw new Error(`Translate ${response.status}`);
    const data = await response.json();
    batch.forEach((line, j) => {
      const text = Array.isArray(data[j]) ? data[j][0] : data[j];
      translations.set(`${target}:${line}`, typeof text === "string" && text.trim().toLowerCase() !== line.toLowerCase() ? text.trim() : null);
    });
  }
  return lines.map(line => translations.get(`${target}:${line.trim()}`) ?? null);
}
