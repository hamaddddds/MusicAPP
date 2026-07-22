import YTMusicModule from "ytmusic-api";

// Handle ESM/CJS interop — the constructor could be on .default or directly
const YTMusicClass = YTMusicModule.default || YTMusicModule;

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

  const { query, action, videoId } = req.query;

  try {
    // Action: stream — get audio URL from Piped API
    if (action === 'stream' && videoId) {
      const pipedInstances = [
        'https://pipedapi.kavin.rocks',
        'https://pipedapi.adminforge.de',
        'https://api.piped.yt'
      ];
      
      let audioUrl = null;
      for (const instance of pipedInstances) {
        try {
          const pipedRes = await fetch(`${instance}/streams/${videoId}`);
          if (!pipedRes.ok) continue;
          const data = await pipedRes.json();
          if (data.audioStreams && data.audioStreams.length > 0) {
            // Sort by bitrate descending
            const sorted = data.audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
            audioUrl = sorted[0].url;
            break;
          }
        } catch (_e) {
          continue; // Try next instance
        }
      }

      if (audioUrl) {
        res.status(200).json({ url: audioUrl });
      } else {
        res.status(404).json({ error: "No audio stream found" });
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
