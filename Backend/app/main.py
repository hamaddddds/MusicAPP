from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.config import settings
from app.services import metadata
from app.services import stream as stream_service

app = FastAPI(
    title="YT Music Backend",
    description=(
        "Unofficial backend combining ytmusicapi (search/charts/metadata) "
        "with yt-dlp (audio resolving/streaming) to power a YouTube-based "
        "music app. Reverse-engineered / unofficial — not affiliated with "
        "or endorsed by Google or YouTube."
    ),
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except Exception as exc:  # ytmusicapi / yt-dlp raise plain Exceptions
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/health")
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------
# Search & discovery
# ---------------------------------------------------------------------

@app.get("/search")
def search(
    q: str = Query(..., min_length=1),
    filter: Optional[str] = Query(
        None,
        description="songs | videos | albums | artists | playlists | community_playlists",
    ),
    limit: int = Query(20, ge=1, le=75),
):
    return _call(metadata.search, q, filter=filter, limit=limit)


@app.get("/suggest")
def suggest(q: str = Query(..., min_length=1)):
    suggestions = _call(metadata.get_search_suggestions, q)
    # the frontend expects { suggestions: [...] }
    return {"suggestions": suggestions}


@app.get("/charts")
def charts(
    country: str = Query("ZZ", description="ISO country code, e.g. 'US', 'ID'. 'ZZ' = global"),
):
    return _call(metadata.get_charts, country)


@app.get("/moods")
def moods():
    return _call(metadata.get_mood_categories)


@app.get("/moods/playlists")
def mood_playlists(params: str = Query(..., description="'params' value returned by /moods")):
    return _call(metadata.get_mood_playlists, params)


@app.get("/home")
def home(limit: int = Query(20, ge=1, le=50)):
    return _call(metadata.get_home, limit)


# ---------------------------------------------------------------------
# Songs / albums / artists / playlists / lyrics
# ---------------------------------------------------------------------

@app.get("/song/{video_id}")
def song(video_id: str):
    return _call(metadata.get_song, video_id)


@app.get("/watch/{video_id}")
def watch(video_id: str, radio: bool = False, limit: int = Query(25, ge=1, le=100)):
    """Up-next / radio queue for a video — good for autoplay."""
    return _call(metadata.get_watch_playlist, video_id, radio=radio, limit=limit)


@app.get("/lyrics/{video_id}/auto")
def auto_lyrics(video_id: str):
    return _call(metadata.get_lyrics_by_video_id, video_id)


@app.get("/lyrics/{browse_id}")
def lyrics(browse_id: str, timestamps: bool = False):
    return _call(metadata.get_lyrics, browse_id, timestamps=timestamps)


@app.get("/artist/{channel_id}")
def artist(channel_id: str):
    return _call(metadata.get_artist, channel_id)


@app.get("/album/{browse_id}")
def album(browse_id: str):
    return _call(metadata.get_album, browse_id)


@app.get("/playlist/{playlist_id}")
def playlist(playlist_id: str, limit: int = Query(100, ge=1, le=500)):
    return _call(metadata.get_playlist, playlist_id, limit=limit)


# ---------------------------------------------------------------------
# Audio streaming
# ---------------------------------------------------------------------

@app.get("/stream/{video_id}/info")
async def stream_info(video_id: str):
    """Resolved direct CDN URL, without proxying bytes. The URL can be
    IP-locked to whichever server resolved it — prefer GET /stream/{id}
    unless your client shares an egress IP with this server.
    """
    fmt = await stream_service.resolver.resolve(video_id)
    return {
        "url": fmt.url,
        "ext": fmt.ext,
        "abr": fmt.abr,
        "filesize": fmt.filesize,
    }


@app.get("/stream/{video_id}")
async def stream_audio(video_id: str, request: Request):
    range_header = request.headers.get("range")
    status_code, upstream_headers, ext, body = await stream_service.open_audio_stream(
        video_id, range_header
    )

    if status_code not in (200, 206):
        raise HTTPException(status_code=502, detail="Upstream audio source unavailable")

    passthrough = {"content-type", "content-length", "content-range", "accept-ranges"}
    headers = {k: v for k, v in upstream_headers.items() if k.lower() in passthrough}
    headers.setdefault("accept-ranges", "bytes")
    headers.setdefault("content-type", f"audio/{ext}")

    return StreamingResponse(body, status_code=status_code, headers=headers)


@app.post("/stream/{video_id}/refresh")
async def refresh_stream(video_id: str):
    fmt = await stream_service.resolver.resolve(video_id, force_refresh=True)
    return {"refreshed": True, "resolved_at": fmt.resolved_at}
