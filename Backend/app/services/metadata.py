"""
Thin wrapper around ytmusicapi.

ytmusicapi emulates YouTube Music's own web client requests. It is
unofficial (reverse-engineered), not supported or endorsed by Google, and
YouTube can change its internal API at any time. Pin a known-good version
in requirements.txt and keep it updated.

Search / charts / artist / album / song / lyrics / mood browsing all work
WITHOUT authentication. Only personalized endpoints (your library, liked
songs, listening history, a personalized /home feed) need an auth file
generated via `ytmusicapi oauth` or the browser-header flow — see the
README for setup instructions.
"""

from functools import lru_cache
from typing import Optional

from ytmusicapi import YTMusic

from app.config import settings

_yt_instance: Optional[YTMusic] = None


def get_yt() -> YTMusic:
    """Return a shared YTMusic client, created lazily on first use."""
    global _yt_instance
    if _yt_instance is None:
        import os
        auth_file = "oauth.json" if os.path.exists("oauth.json") else (settings.ytmusic_auth_file or None)
        _yt_instance = YTMusic(auth_file) if auth_file else YTMusic()
    return _yt_instance

def reset_yt():
    global _yt_instance
    _yt_instance = None

def reset_yt():
    global _yt_instance
    _yt_instance = None


def search(query: str, filter: Optional[str] = None, limit: int = 20):
    """filter: songs | videos | albums | artists | playlists |
    community_playlists | featured_playlists | uploads (uploads needs auth)
    """
    return get_yt().search(query, filter=filter, limit=limit)


def get_search_suggestions(query: str):
    """Returns a list of search suggestions for the given query."""
    return get_yt().get_search_suggestions(query)


def get_charts(country: str = "ZZ"):
    """country: ISO 3166-1 alpha-2 code (e.g. 'US', 'ID', 'KR').
    'ZZ' returns the global chart. This is the 'global vs local' data
    the user asked for.
    """
    return get_yt().get_charts(country=country)


def get_artist(channel_id: str):
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
            artist_info = [{"name": data.get("name"), "id": channel_id}]
            for song in data['songs'].get('results', []):
                song['artists'] = artist_info
    return data


def get_album(browse_id: str):
    return get_yt().get_album(browse_id)


def get_album_browse_id(playlist_id: str):
    return get_yt().get_album_browse_id(playlist_id)


def get_song(video_id: str):
    """Song metadata (title, artists, thumbnails, etc). Not the audio itself
    — pair with /stream/{video_id} for playback.
    """
    return get_yt().get_song(video_id)


def get_song_related(browse_id: str):
    return get_yt().get_song_related(browse_id)


def get_lyrics(browse_id: str, timestamps: bool = False):
    return get_yt().get_lyrics(browse_id, timestamps=timestamps)


def _deep_get(raw, key):
    """Recursively find `key` in a ytmusicapi raw response (dict/list).
    The browse payload nesting varies by client/version, so walk defensively."""
    if isinstance(raw, dict):
        if key in raw:
            return raw[key]
        for v in raw.values():
            found = _deep_get(v, key)
            if found is not None:
                return found
    elif isinstance(raw, list):
        for v in raw:
            found = _deep_get(v, key)
            if found is not None:
                return found
    return None


def _extract_richsync_tokens(raw):
    """Best-effort word-level (richsync) extraction from the raw WEB-client
    lyrics browse response. ytmusicapi >= 1.8 no longer exposes word parts via
    the public get_lyrics (that returns line-level TimedLyrics from the mobile
    client), so we reach into the private _send_request to read the 'synced'
    key the web client returns for richsync songs.

    'synced' is a list of {startTimeMs, durationMs, text} tokens (words,
    spaces and newlines). Returns a flat token list or None.
    """
    synced = _deep_get(raw, "synced")
    if synced is None:
        synced = _deep_get(raw, "synchronizedLines")
    if not isinstance(synced, list):
        return None
    tokens = []
    for item in synced:
        if not isinstance(item, dict):
            continue
        try:
            t = int(item.get("startTimeMs") or 0)
            d = int(item.get("durationMs") or 0)
        except (TypeError, ValueError):
            continue
        text = str(item.get("text") or "")
        if not text:
            continue
        tokens.append({"t": t / 1000.0, "d": d / 1000.0, "text": text})
    return tokens or None


def _group_parts_into_lines(tokens, timed_lines):
    """Bucket richsync word tokens into lyric lines.

    Prefers line windows from TimedLyrics (authoritative [start, end)). Falls
    back to splitting the token stream on newline tokens. Spaces/newlines are
    dropped from parts (the frontend inserts spacing between word spans).
    """
    def make_line(start_t, text, line_parts):
        return {
            "t": round(start_t, 3),
            "text": text,
            "parts": [
                {"t": round(p["t"], 3), "d": round(p["d"], 3), "text": p["text"]}
                for p in line_parts
            ],
        }

    if timed_lines:
        lines = []
        for tl in timed_lines:
            start = getattr(tl, "start_time", 0) / 1000
            end = getattr(tl, "end_time", 0) / 1000
            hi = end if end > start else start + 10.0
            bucket = [p for p in tokens if start <= p["t"] < hi and p["text"].strip()]
            lines.append(make_line(start, getattr(tl, "text", ""), bucket))
        return lines

    lines = []
    buf = []
    for p in tokens:
        if p["text"] in ("\n", "\r\n"):
            if buf:
                lines.append(make_line(buf[0]["t"], "".join(x["text"] for x in buf), buf))
                buf = []
        else:
            buf.append(p)
    if buf:
        lines.append(make_line(buf[0]["t"], "".join(x["text"] for x in buf), buf))
    return lines


def get_lyrics_by_video_id(video_id: str):
    """Normalized lyrics for a video: { error?, lines, plain, source }.

    lines is a list of { t, text, parts: [{t,d,text}] }. parts carries word-level
    richsync when available; an empty parts list tells the frontend to synthesize
    per-word timings from the line.
    """
    watch = get_yt().get_watch_playlist(videoId=video_id)
    lyrics_id = watch.get("lyrics")
    if not lyrics_id:
        return {"error": "No lyrics found", "lines": [], "plain": None, "source": None}

    result = {"error": None, "lines": [], "plain": None, "source": None}

    # 1) Word-level richsync from the raw WEB-client response (best effort).
    rich_tokens = None
    try:
        raw = get_yt()._send_request("browse", {"browseId": lyrics_id})
        rich_tokens = _extract_richsync_tokens(raw)
    except Exception as exc:
        print(f"Richsync extraction failed ({exc}); falling back to timed lyrics.")

    # 2) Line-level timed lyrics from the public API (mobile client).
    # Always request timestamps so we get line-level {t,text} (the frontend
    # synthesizes per-word timings); timestamps=False would only yield plain text.
    timed = None
    try:
        timed = get_yt().get_lyrics(lyrics_id, timestamps=True)
    except Exception as exc:
        print(f"Timed lyrics failed ({exc}); falling back to plain text.")

    timed_lines = timed.get("lyrics") if timed and isinstance(timed.get("lyrics"), list) else []

    if rich_tokens:
        lines = _group_parts_into_lines(rich_tokens, timed_lines)
        result["lines"] = lines
        result["plain"] = "\n".join(l["text"] for l in lines) or None
    elif timed_lines:
        # Line-level only: parts:[] tells the frontend to synthesize words.
        result["lines"] = [
            {
                "t": round(getattr(l, "start_time", 0) / 1000, 3),
                "end": round(getattr(l, "end_time", 0) / 1000, 3),
                "text": getattr(l, "text", ""),
                "parts": [],
            }
            for l in timed_lines
        ]
        result["plain"] = "\n".join(getattr(l, "text", "") for l in timed_lines) or None
    else:
        # 3) Plain-text fallback.
        try:
            bare = get_yt().get_lyrics(lyrics_id)  # timestamps=False
            result["plain"] = bare.get("lyrics") if bare else None
        except Exception as exc:
            print(f"Plain lyrics failed ({exc}).")
            result["plain"] = None
        if not result["plain"]:
            result["error"] = "No lyrics found"

    if timed:
        result["source"] = timed.get("source")
    return result


def get_playlist(playlist_id: str, limit: int = 100):
    return get_yt().get_playlist(playlist_id, limit=limit)


def get_watch_playlist(video_id: str, radio: bool = False, limit: int = 25):
    """The 'up next' / radio queue YouTube Music shows when you hit play.
    Good source for autoplay/recommendation features.
    """
    return get_yt().get_watch_playlist(videoId=video_id, radio=radio, limit=limit)


def get_mood_categories():
    return get_yt().get_mood_categories()


def get_mood_playlists(params: str):
    return get_yt().get_mood_playlists(params)


def get_home(limit: int = 20):
    """Works unauthenticated (generic recommendations) or authenticated
    (personalized to the logged-in account) depending on whether an auth
    file was provided.
    """
    return get_yt().get_home(limit=limit)
