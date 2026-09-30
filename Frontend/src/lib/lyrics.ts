export interface WordPart { t: number; d: number; text: string }
export interface SyncedLine { t: number; end?: number; text: string; parts: WordPart[]; background?: string }
export interface Lyrics { synced: SyncedLine[]; plain: string; source?: string; notice?: string }

/** TTML clocks are seconds, milliseconds, or hh:mm:ss.fraction. */
export function parseTimestamp(value: string | null): number {
  if (!value?.trim()) return NaN;
  const clock = value.trim();
  if (/^\d+(\.\d+)?ms$/.test(clock)) return parseFloat(clock) / 1000;
  if (/^\d+(\.\d+)?s$/.test(clock)) return parseFloat(clock);
  if (!/^\d+(?::\d+){0,2}(\.\d+)?$/.test(clock)) return NaN;
  return clock.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

export function parseTTML(ttml: string): Lyrics {
  const doc = new DOMParser().parseFromString(ttml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Invalid lyrics document");
  const role = (el: Element) => el.getAttributeNS("http://www.w3.org/ns/ttml#metadata", "role") || el.getAttribute("ttm:role");
  const synced: SyncedLine[] = [];
  for (const p of Array.from(doc.getElementsByTagNameNS("*", "p"))) {
    const t = parseTimestamp(p.getAttribute("begin"));
    const end = parseTimestamp(p.getAttribute("end"));
    if (!Number.isFinite(t) || t < 0) continue;
    const parts: WordPart[] = [];
    let text = "", background = "";
    // Keep whitespace exactly: adjacent spans can be syllables of ONE word.
    const walk = (node: Node, timing?: { t: number; d: number }) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const content = node.textContent?.replace(/\s+/g, " ") || "";
        text += content;
        if (content) parts.push({ t: timing?.t ?? t, d: timing?.d ?? 0, text: content });
        return;
      }
      if (!(node instanceof Element)) return;
      if (role(node) === "x-bg") { background += node.textContent || ""; return; }
      if (["x-translation", "x-roman"].includes(role(node) || "")) return;
      const start = parseTimestamp(node.getAttribute("begin"));
      const finish = parseTimestamp(node.getAttribute("end"));
      const own = Number.isFinite(start) && Number.isFinite(finish) && finish >= start
        ? { t: start, d: finish - start } : timing;
      node.childNodes.forEach(child => walk(child, own));
    };
    p.childNodes.forEach(child => walk(child));
    synced.push({ t, end: Number.isFinite(end) && end >= t ? end : undefined,
      text: text.trim(), parts: parts.some(part => part.d > 0) ? parts : [], background: background.trim() || undefined });
  }
  synced.sort((a, b) => a.t - b.t);
  return { synced, plain: synced.map(line => line.text).join("\n"), source: "Better Lyrics" };
}

export function normalizeLyrics(data: any): Lyrics {
  const synced: SyncedLine[] = [];
  if (Array.isArray(data?.lines)) {
    for (const line of data.lines) {
      if (!Number.isFinite(line?.t) || line.t < 0) continue;
      const parts: WordPart[] = Array.isArray(line.parts) ? line.parts
        .filter((part: any) => Number.isFinite(part?.t) && Number.isFinite(part?.d) && part.d >= 0 && typeof part.text === "string")
        .map((part: WordPart, i: number, all: WordPart[]) => ({ ...part, text: part.text + (i < all.length - 1 ? " " : "") })) : [];
      synced.push({ t: line.t, end: Number.isFinite(line.end) && line.end >= line.t ? line.end : undefined, text: String(line.text ?? ""), parts });
    }
  } else if (typeof data?.synced === "string") {
    for (const raw of data.synced.split("\n")) {
      for (const match of raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)) {
        synced.push({ t: Number(match[1]) * 60 + Number(match[2]) + Number((match[3] || "0").padEnd(3, "0")) / 1000,
          text: raw.replace(/\[[^\]]*\]/g, "").trim(), parts: [] });
      }
    }
  }
  return { synced: synced.sort((a, b) => a.t - b.t), plain: typeof data?.plain === "string" ? data.plain : "", source: "YouTube Music" };
}

export function activeLineAt(lines: SyncedLine[], time: number): number {
  let lo = 0, hi = lines.length - 1, index = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (lines[mid].t <= time) { index = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return index;
}

const cache = new Map<string, Lyrics>();
export async function fetchLyrics(track: { videoId: string; title: string; artist: string }, api: string, signal: AbortSignal, duration?: number): Promise<Lyrics> {
  const key = `${track.videoId}:${Math.round(duration || 0)}`;
  if (cache.has(key)) return cache.get(key)!;
  const query = new URLSearchParams({ title: track.title, artist: track.artist });
  if (duration && Number.isFinite(duration)) query.set("duration", String(Math.max(1, Math.round(duration))));
  let notice = "";
  try {
    const response = await fetch(`${api}/lyrics/better?${query}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) });
    if (!response.ok) throw new Error(`Better Lyrics ${response.status}`);
    const data = await response.json();
    if (typeof data.score === "number" && data.score < 0.7) throw new Error("Low confidence match");
    const result = parseTTML(data.ttml || "");
    if (!result.synced.length) throw new Error("No timed lyrics");
    if (cache.size >= 50) cache.delete(cache.keys().next().value!);
    cache.set(key, result);
    return result;
  } catch {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    notice = "Better Lyrics unavailable for this track. Using YouTube Music lyrics.";
  }
  const response = await fetch(`${api}/lyrics/${encodeURIComponent(track.videoId)}/auto`, { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) });
  if (!response.ok) throw new Error("Lyrics unavailable");
  return { ...normalizeLyrics(await response.json()), notice };
}
