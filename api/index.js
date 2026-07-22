import { Innertube, UniversalCache } from 'youtubei.js';
import Jintr from 'jintr';

let ytInstance = null;

async function getYT() {
  if (ytInstance) return ytInstance;
  ytInstance = await Innertube.create({
    generate_session_locally: true,
    js_evaluator: new Jintr(),
    cache: new UniversalCache(false)
  });
  return ytInstance;
}

// Map youtubei.js track object to our UI track format
function mapTrack(t) {
  if (!t.id && !t.video_id) return null;
  return {
    videoId: t.id || t.video_id,
    title: t.title?.text || t.title || "Unknown",
    artist: { name: (t.artists && t.artists[0]?.name) || (t.author?.name) || "Unknown" },
    thumbnails: t.thumbnails || [],
    duration: t.duration?.seconds || 0,
    isExplicit: t.is_explicit || false
  };
}

// Free synced lyrics from lrclib.net
async function fetchLyrics(title, artist, duration) {
  const clean = (s) => (s || "").replace(/\s*\(.*?\)\s*/g, " ").replace(/\s*\[.*?\]\s*/g, " ").trim();
  const t = clean(title);
  const a = clean(artist);
  const headers = { 'User-Agent': 'MusicVenue (https://github.com/hamaddddds/MusicAPP)' };

  try {
    let params = new URLSearchParams({ track_name: t, artist_name: a });
    if (duration) params.set('duration', String(Math.round(duration)));
    let res = await fetch(`https://lrclib.net/api/get?${params}`, { headers });
    let r = await res.json();
    if (res.ok && r && (r.syncedLyrics || r.plainLyrics)) {
      return { syncedLyrics: r.syncedLyrics || null, plainLyrics: r.plainLyrics || null };
    }

    res = await fetch(`https://lrclib.net/api/search?${new URLSearchParams({ track_name: t, artist_name: a })}`, { headers });
    r = await res.json();
    if (res.ok && Array.isArray(r) && r.length) {
      const withSynced = r.find(x => x.syncedLyrics) || r.find(x => x.plainLyrics) || r[0];
      return { syncedLyrics: withSynced.syncedLyrics || null, plainLyrics: withSynced.plainLyrics || null };
    }
  } catch (e) {
    console.error("Lyrics error:", e);
  }
  return { syncedLyrics: null, plainLyrics: null };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { query, action, videoId, title, artist, duration } = req.query;

  try {
    const yt = await getYT();

    // LYRICS
    if (action === 'lyrics' && (title || query)) {
      const lyrics = await fetchLyrics(title || query, artist, duration);
      res.status(200).json(lyrics);
      return;
    }

    // GEO
    if (action === 'geo') {
      const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      const ip = fwd || req.headers['x-real-ip'] || '';
      try {
        const geoRes = await fetch(`https://ipwho.is/${ip}`);
        const g = await geoRes.json();
        res.status(200).json({
          country: g.country || null,
          countryCode: g.country_code || null,
          city: g.city || null,
          region: g.region || null,
        });
      } catch (e) {
        res.status(200).json({});
      }
      return;
    }

    // SUGGEST
    if (action === 'suggest' && query) {
      try {
        const s = await yt.music.getSearchSuggestions(query);
        let suggestions = [];
        if (s && s.length > 0 && s[0].contents) {
          suggestions = s[0].contents.map(x => x.suggestion?.text || (x.suggestion?.runs && x.suggestion.runs.map(r=>r.text).join('')) || x.title?.text).filter(Boolean);
        }
        res.status(200).json({ suggestions });
      } catch (e) {
        res.status(200).json({ suggestions: [] });
      }
      return;
    }

    // STREAM
    if (action === 'stream' && videoId) {
      try {
        const info = await yt.getBasicInfo(videoId, 'WEB_REMIX');
        const format = info.chooseFormat({ type: 'audio', quality: 'best' });
        if (format) {
          const url = await yt.session.player.decipher(format.url, format.signature_cipher, format.cipher);
          if (url) {
            res.status(200).json({ url, provider: 'youtubei.js-webremix' });
            return;
          }
        }
      } catch (err) {
        console.warn("WEB_REMIX failed, falling back to standard WEB", err);
        try {
          const info = await yt.getBasicInfo(videoId, 'WEB');
          const format = info.chooseFormat({ type: 'audio', quality: 'best' });
          if (format) {
            const url = await yt.session.player.decipher(format.url, format.signature_cipher, format.cipher);
            if (url) {
              res.status(200).json({ url, provider: 'youtubei.js-web' });
              return;
            }
          }
        } catch (err2) {
          console.warn("WEB failed", err2);
        }
      }
      
      // Fallback to Piped if youtubei.js fails (due to Vercel IP blocks)
      const PIPED_INSTANCES = [
        'https://pipedapi.adminforge.de',
        'https://pipedapi.kavin.rocks',
        'https://api.piped.yt'
      ];
      for (const instance of PIPED_INSTANCES) {
        try {
          const r = await fetch(`${instance}/streams/${videoId}`);
          const d = await r.json();
          if (d && Array.isArray(d.audioStreams) && d.audioStreams.length > 0) {
            const sorted = d.audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
            if (sorted[0].url) {
              res.status(200).json({ url: sorted[0].url, provider: 'piped' });
              return;
            }
          }
        } catch (_e) { continue; }
      }

      res.status(404).json({ error: 'No audio stream found' });
      return;
    }

    const extractItems = (res) => {
      if (!res || !res.contents) return [];
      let items = [];
      for (const section of res.contents) {
        if (section.contents) items.push(...section.contents);
        else items.push(section);
      }
      return items;
    };

    // SEARCH (mixed videos/songs)
    if (action === 'search') {
      const results = await yt.music.search(query || 'Top hits');
      const tracks = extractItems(results).map(mapTrack).filter(Boolean);
      res.status(200).json(tracks);
      return;
    }

    // SEARCH SECTIONS (split by popular songs vs videos)
    if (action === 'search_sections' && query) {
      const [songRes, videoRes, artistRes] = await Promise.all([
        yt.music.search(query, { type: 'song' }).catch(() => ({ contents: [] })),
        yt.music.search(query, { type: 'video' }).catch(() => ({ contents: [] })),
        yt.music.search(query, { type: 'artist' }).catch(() => ({ contents: [] }))
      ]);

      const songs = extractItems(songRes).map(mapTrack).filter(Boolean);
      const videos = extractItems(videoRes).map(mapTrack).filter(Boolean);
      
      let artistObj = null;
      const topArtist = extractItems(artistRes)[0];
      if (topArtist && topArtist.name) {
        artistObj = {
          artistId: topArtist.id,
          name: topArtist.name,
          thumbnails: topArtist.thumbnails || []
        };
      }

      res.status(200).json({ artist: artistObj, popular: songs, other: videos });
      return;
    }

    // ARTIST
    if (action === 'artist') {
      let id = req.query.artistId;
      if (!id && query) {
        const search = await yt.music.search(query, { type: 'artist' });
        if (search.contents?.[0]) id = search.contents[0].id;
      }
      
      if (id) {
        try {
          const artistPage = await yt.music.getArtist(id);
          const songs = (artistPage.sections?.find(s => s.title?.text?.includes('Song') || s.title?.text?.includes('Lagu'))?.contents || []).map(mapTrack).filter(Boolean);
          
          let finalSongs = songs;
          if (!finalSongs.length) {
             const fallbackSearch = await yt.music.search(artistPage.header?.title?.text || query, { type: 'song' });
             finalSongs = extractItems(fallbackSearch).map(mapTrack).filter(Boolean);
          }

          res.status(200).json({
            artist: {
              artistId: id,
              name: artistPage.header?.title?.text || 'Unknown',
              thumbnails: artistPage.header?.thumbnails || []
            },
            songs: finalSongs
          });
          return;
        } catch (e) {
          console.error("Artist page failed", e);
        }
      }
      // ultimate fallback
      const fallbackSongsRes = await yt.music.search(query || id, { type: 'song' });
      res.status(200).json({ artist: null, songs: extractItems(fallbackSongsRes).map(mapTrack).filter(Boolean) });
      return;
    }

    // EXPLORE (Home sections for UI compatibility)
    if (action === 'explore' || action === 'home') {
      const home = await yt.music.getHome();
      const shelves = home.contents?.map(section => ({
        title: section.title?.text || 'Recommendations',
        contents: (section.contents || []).map(mapTrack).filter(Boolean)
      })) || [];
      res.status(200).json(shelves);
      return;
    }

    // RAW EXPLORE (Moods, Genres, etc)
    if (action === 'explore_raw') {
      const explore = await yt.music.getExplore();
      res.status(200).json(explore);
      return;
    }

    res.status(200).json({ message: "Music Venue API (youtubei.js)" });
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: error.message });
  }
}
