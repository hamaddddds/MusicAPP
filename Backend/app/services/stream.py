"""
Resolves and proxies the actual audio for a video using yt-dlp.

Key point the user was missing: yt-dlp does NOT need to download a full
mp4 and then convert it to mp3. YouTube serves separate adaptive
audio-only streams (e.g. itag 251/opus, 140/m4a). Asking yt-dlp for
`bestaudio` returns a direct URL to that audio-only stream — no video,
no ffmpeg, no re-encoding required.

Why we PROXY the bytes instead of just handing the client the raw
googlevideo.com URL: that URL is frequently locked to the IP/session that
resolved it. If your backend resolves it and your mobile client fetches it
from a different network, YouTube can return 403. Proxying through this
server sidesteps that, and also lets us forward Range requests so players
can seek.
"""

import asyncio
import time
from dataclasses import dataclass
from typing import AsyncGenerator, Optional

import httpx
import yt_dlp

from app.config import settings


@dataclass
class AudioFormat:
    url: str
    ext: str
    abr: Optional[float]
    filesize: Optional[int]
    http_headers: dict
    resolved_at: float


class StreamResolver:
    """Resolves best-audio format via yt-dlp and caches it in memory,
    since a resolve takes ~1-2s and the URL stays valid for a while.
    """

    def __init__(self, ttl_seconds: int = 3600):
        self._cache: dict[str, AudioFormat] = {}
        self._ttl = ttl_seconds
        self._locks: dict[str, asyncio.Lock] = {}

    def _ydl_opts(self) -> dict:
        opts = {
            "format": "bestaudio/best",
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "skip_download": True,
        }
        if settings.cookies_file:
            opts["cookiefile"] = settings.cookies_file
        return opts

    def _extract(self, video_id: str) -> AudioFormat:
        url = f"https://www.youtube.com/watch?v={video_id}"
        with yt_dlp.YoutubeDL(self._ydl_opts()) as ydl:
            info = ydl.extract_info(url, download=False)

        return AudioFormat(
            url=info["url"],
            ext=info.get("ext", "webm"),
            abr=info.get("abr"),
            filesize=info.get("filesize") or info.get("filesize_approx"),
            http_headers=info.get("http_headers", {}) or {},
            resolved_at=time.time(),
        )

    def _is_fresh(self, fmt: Optional[AudioFormat]) -> bool:
        return fmt is not None and (time.time() - fmt.resolved_at) < self._ttl

    async def resolve(self, video_id: str, force_refresh: bool = False) -> AudioFormat:
        cached = self._cache.get(video_id)
        if not force_refresh and self._is_fresh(cached):
            return cached

        lock = self._locks.setdefault(video_id, asyncio.Lock())
        async with lock:
            cached = self._cache.get(video_id)
            if not force_refresh and self._is_fresh(cached):
                return cached

            loop = asyncio.get_event_loop()
            fmt = await loop.run_in_executor(None, self._extract, video_id)
            self._cache[video_id] = fmt
            return fmt


resolver = StreamResolver(ttl_seconds=settings.stream_cache_ttl)


async def open_audio_stream(video_id: str, range_header: Optional[str] = None):
    """Opens an upstream connection to the resolved audio URL and returns
    (status_code, headers, ext, byte_generator) so the caller can build a
    matching HTTP response before any bytes are read.
    """
    fmt = await resolver.resolve(video_id)
    headers = dict(fmt.http_headers)
    if range_header:
        headers["Range"] = range_header

    client = httpx.AsyncClient(follow_redirects=True, timeout=None)
    request = client.build_request("GET", fmt.url, headers=headers)
    response = await client.send(request, stream=True)

    # Expired/IP-mismatched URL -> refresh once and retry transparently.
    if response.status_code == 403:
        await response.aclose()
        await client.aclose()

        fmt = await resolver.resolve(video_id, force_refresh=True)
        headers = dict(fmt.http_headers)
        if range_header:
            headers["Range"] = range_header

        client = httpx.AsyncClient(follow_redirects=True, timeout=None)
        request = client.build_request("GET", fmt.url, headers=headers)
        response = await client.send(request, stream=True)

    async def body() -> AsyncGenerator[bytes, None]:
        try:
            async for chunk in response.aiter_bytes():
                yield chunk
        finally:
            await response.aclose()
            await client.aclose()

    return response.status_code, response.headers, fmt.ext, body()
