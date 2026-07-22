import YTMusicModule from "ytmusic-api";

// Handle ESM/CJS interop — the constructor could be on .default or directly
const YTMusicClass = YTMusicModule.default || YTMusicModule;

// ── Stream providers ─────────────────────────────────────────
// Primary: ytdlp.online (yt-dlp as a service, needs Developer plan API key).
// Set YTDLP_API_KEY in Vercel → Project → Settings → Environment Variables.
// Fallback: public Piped instances (mostly dead as of mid-2026, kept as last resort).

const YTDLP_BASE = process.env.YTDLP_API_BASE || "https://ytdlp.online/open/v1";
const YTDLP_KEY = process.env.YTDLP_API_KEY;

const PIPED_INSTANCES = [
  'https://pipedapi.adminforge.de',
  'https://pipedapi.kavin.rocks',
  'https://api.piped.yt'
];

async function fetchJson(url, opts = {}, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_e) { /* non-JSON body (nginx error page etc.) */ }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

// Fast path: direct audio format URL from /video/info.
// googlevideo URLs can be locked to the extractor's IP — the client falls
// back to mode=download if playback errors out.
async function ytdlpDirectUrl(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const { ok, data } = await fetchJson(
    `${YTDLP_BASE}/video/info?url=${encodeURIComponent(watchUrl)}&apikey=${YTDLP_KEY}`,
    {},
    15000
  );
  if (!ok || !data || !Array.isArray(data.formats)) return null;
  const audioOnly = data.formats
    .filter(f => f.url && f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none"))
    .sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0));
  return audioOnly[0]?.url || null;
}

// Reliable path: async mp3 conversion, file served by ytdlp.online (~1h retention).
async function ytdlpStartDownload(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const { ok, data } = await fetchJson(`${YTDLP_BASE}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: watchUrl, apikey: YTDLP_KEY, format: 'mp3' })
  }, 15000);
  return (ok && data && data.task_id) ? data.task_id : null;
}

async function ytdlpTaskStatus(taskId) {
  const { ok, data } = await fetchJson(
    `${YTDLP_BASE}/download/${encodeURIComponent(taskId)}?apikey=${YTDLP_KEY}`,
    {},
    8000
  );
  return (ok && data) ? data : { status: 'failed' };
}

async function pipedAudioUrl(videoId) {
  for (const instance of PIPED_INSTANCES) {
    try {
      const { ok, data } = await fetchJson(`${instance}/streams/${videoId}`, {}, 6000);
      if (!ok || !data || !Array.isArray(data.audioStreams) || data.audioStreams.length === 0) continue;
      const sorted = data.audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      if (sorted[0].url) return sorted[0].url;
    } catch (_e) {
      continue;
    }
  }
  return null;
}

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { query, action, videoId, taskId, mode } = req.query;

  try {
    // Action: stream — resolve a playable audio URL for a videoId.
    // Responds 200 {url, provider} when resolved, or 202 {pending, taskId}
    // when the mp3 conversion is still running (client polls stream_status).
    if (action === 'stream' && videoId) {
      if (YTDLP_KEY) {
        // mode=download skips the direct-URL attempt (used by the client
        // after an IP-locked direct URL fails to play)
        if (mode !== 'download') {
          const direct = await ytdlpDirectUrl(videoId).catch(() => null);
          if (direct) {
            res.status(200).json({ url: direct, provider: 'ytdlp-direct' });
            return;
          }
        }

        const newTaskId = await ytdlpStartDownload(videoId).catch(() => null);
        if (newTaskId) {
          // Wait briefly in-function, then hand off to client-side polling
          // before the serverless 10s limit hits
          const deadline = Date.now() + 6000;
          while (Date.now() < deadline) {
            const st = await ytdlpTaskStatus(newTaskId);
            if (st.status === 'completed' && st.download_url) {
              res.status(200).json({ url: st.download_url, provider: 'ytdlp-mp3' });
              return;
            }
            if (st.status === 'failed') break;
            await new Promise(r => setTimeout(r, 1500));
          }
          res.status(202).json({ pending: true, taskId: newTaskId });
          return;
        }
      }

      const piped = await pipedAudioUrl(videoId);
      if (piped) {
        res.status(200).json({ url: piped, provider: 'piped' });
        return;
      }

      res.status(404).json({
        error: YTDLP_KEY
          ? 'No audio stream found'
          : 'No audio stream found — set YTDLP_API_KEY (ytdlp.online Developer plan) to enable the yt-dlp provider'
      });
      return;
    }

    // Action: stream_status — poll a pending ytdlp.online conversion task
    if (action === 'stream_status' && taskId) {
      if (!YTDLP_KEY) {
        res.status(400).json({ error: 'YTDLP_API_KEY not configured' });
        return;
      }
      const st = await ytdlpTaskStatus(taskId);
      if (st.status === 'completed' && st.download_url) {
        res.status(200).json({ url: st.download_url, provider: 'ytdlp-mp3' });
      } else if (st.status === 'failed') {
        res.status(502).json({ error: 'Audio conversion failed' });
      } else {
        res.status(202).json({ pending: true, taskId });
      }
      return;
    }

    // Action: search / home — use ytmusic-api for metadata
    const ytmusic = new YTMusicClass();
    await ytmusic.initialize();

    if (action === 'search') {
      const results = await ytmusic.search(query || "New releases");
      res.status(200).json(results);
    } else if (action === 'home') {
      const results = await ytmusic.search("Top hits 2025");
      res.status(200).json(results);
    } else {
      res.status(200).json({ message: "Music Venue API. Use ?action=search&query=... or ?action=stream&videoId=..." });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
