"""
Vercel Python serverless function: /api/music

Drop this file at `api/music.py` in the MusicApp repo, alongside the
existing `api/index.js` (Vercel auto-detects each file in /api by its
extension and turns it into its own function — Python and JS can live
side by side with no extra config).

Why this file exists: the npm package `ytmusic-api` used for search/
artist metadata is a much lighter scraper than the Python `ytmusicapi`
library (sigma67) that was confirmed to find artists like "Hindia"
correctly. This function exposes the same `?action=` query-string style
already used by `api/index.js?action=stream`, but backed by `ytmusicapi`.

Endpoints (all GET):
  /api/music?action=search&q=hindia&filter=artists&limit=20
  /api/music?action=artist&channelId=UC...
  /api/music?action=charts&country=ID        (country='ZZ' = global)
  /api/music?action=album&browseId=MPRE...
  /api/music?action=playlist&playlistId=PL...&limit=100
  /api/music?action=lyrics&browseId=...
  /api/music?action=health

Note on caching: `_yt` and `_cache` are module-level, so they persist
across warm invocations of this same function (Vercel reuses the process
between requests for a while) but reset on cold start and are NOT shared
across other functions/regions. Fine as a cheap speed-up; swap for
Vercel KV/Upstash Redis if you need it to be reliable across instances.
"""

import json
import time
from http.server import BaseHTTPRequestHandler
from typing import Any, Callable, Optional
from urllib.parse import parse_qs, urlparse

from ytmusicapi import YTMusic

_yt: Optional[YTMusic] = None
_cache: dict[str, tuple[float, Any]] = {}
CACHE_TTL_SECONDS = 300


def get_yt() -> YTMusic:
    global _yt
    if _yt is None:
        _yt = YTMusic()
    return _yt


def cached(key: str, fn: Callable[[], Any]) -> Any:
    now = time.time()
    hit = _cache.get(key)
    if hit is not None and now - hit[0] < CACHE_TTL_SECONDS:
        return hit[1]
    result = fn()
    _cache[key] = (now, result)
    return result


def _param(params: dict, name: str, default: Optional[str] = None) -> Optional[str]:
    values = params.get(name)
    return values[0] if values else default


def handle_search(params: dict):
    q = _param(params, "q")
    if not q:
        return 400, {"error": "missing required query param 'q'"}
    filter_ = _param(params, "filter")  # songs|videos|albums|artists|playlists|...
    limit = int(_param(params, "limit", "20"))
    data = cached(
        f"search:{q}:{filter_}:{limit}",
        lambda: get_yt().search(q, filter=filter_, limit=limit),
    )
    return 200, data


def _get_artist(channel_id: str):
    data = get_yt().get_artist(channel_id)
    songs = data.get('songs')
    if songs:
        if songs.get('browseId'):
            try:
                full_songs = get_yt().get_playlist(songs['browseId'], limit=500)
                data['songs']['results'] = full_songs.get('tracks', [])
            except Exception as e:
                print(f"Error fetching full artist songs: {e}")
        else:
            try:
                search_songs = get_yt().search(data.get('name', ''), filter='songs', limit=50)
                if search_songs:
                    data['songs']['results'] = search_songs
            except Exception as e:
                print(f"Error fetching fallback songs: {e}")
            
            artist_info = [{"name": data.get("name"), "id": channel_id}]
            for song in data['songs'].get('results', []):
                song['artists'] = artist_info
    return data

def handle_artist(params: dict):
    channel_id = _param(params, "channelId")
    if not channel_id:
        return 400, {"error": "missing required query param 'channelId'"}
    data = cached(f"artist:{channel_id}", lambda: _get_artist(channel_id))
    return 200, data


def handle_charts(params: dict):
    country = _param(params, "country", "ZZ")  # 'ZZ' = global chart
    data = cached(f"charts:{country}", lambda: get_yt().get_charts(country=country))
    return 200, data


def handle_album(params: dict):
    browse_id = _param(params, "browseId")
    if not browse_id:
        return 400, {"error": "missing required query param 'browseId'"}
    data = cached(f"album:{browse_id}", lambda: get_yt().get_album(browse_id))
    return 200, data


def handle_playlist(params: dict):
    playlist_id = _param(params, "playlistId")
    if not playlist_id:
        return 400, {"error": "missing required query param 'playlistId'"}
    limit = int(_param(params, "limit", "100"))
    data = cached(
        f"playlist:{playlist_id}:{limit}",
        lambda: get_yt().get_playlist(playlist_id, limit=limit),
    )
    return 200, data


def handle_lyrics(params: dict):
    browse_id = _param(params, "browseId")
    if not browse_id:
        return 400, {"error": "missing required query param 'browseId'"}
    data = cached(f"lyrics:{browse_id}", lambda: get_yt().get_lyrics(browse_id))
    return 200, data


def handle_health(_params: dict):
    return 200, {"status": "ok"}


ACTIONS: dict[str, Callable[[dict], tuple[int, Any]]] = {
    "search": handle_search,
    "artist": handle_artist,
    "charts": handle_charts,
    "album": handle_album,
    "playlist": handle_playlist,
    "lyrics": handle_lyrics,
    "health": handle_health,
}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        action = _param(params, "action")

        fn = ACTIONS.get(action or "")
        if fn is None:
            self._respond(400, {
                "error": "unknown or missing 'action'",
                "valid_actions": sorted(ACTIONS.keys()),
            })
            return

        try:
            status, data = fn(params)
        except Exception as exc:  # ytmusicapi raises plain Exceptions
            self._respond(502, {"error": str(exc)})
            return

        self._respond(status, data)

    def _respond(self, status: int, data: Any):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header(
            "Cache-Control", "public, max-age=60, stale-while-revalidate=300"
        )
        self.end_headers()
        self.wfile.write(body)
