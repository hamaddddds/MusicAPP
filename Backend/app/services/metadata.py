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
        auth_file = settings.ytmusic_auth_file or None
        _yt_instance = YTMusic(auth_file) if auth_file else YTMusic()
    return _yt_instance


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


def get_lyrics_by_video_id(video_id: str, timestamps: bool = False):
    watch = get_yt().get_watch_playlist(videoId=video_id)
    lyrics_id = watch.get("lyrics")
    if not lyrics_id:
        return {"error": "No lyrics found", "lyrics": None, "plain": None, "synced": None}
    
    # get_lyrics returns dict with 'lyrics' (plain) or 'synced' depending on availability, but wait!
    # actually ytmusicapi's get_lyrics just returns a dict with 'lyrics' and 'source' etc.
    res = get_yt().get_lyrics(lyrics_id)
    return {
        "plain": res.get("lyrics"),
        "source": res.get("source"),
    }


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
