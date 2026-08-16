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

Why multiple player clients: the default `web` client is the most
bot-guarded (nsig/liveness checks). Two back-to-back extractions without
cookies get throttled, which is exactly what caused the 502 on auto-next.
The android/tv families are far more lenient, so we try those first and
only fall back as needed. Every candidate URL is probed (2-byte Range)
before it is cached, so a dead 403 URL never becomes a 502 for the client.
"""

import asyncio
import logging
import random
import time
from dataclasses import dataclass
from typing import AsyncGenerator, Optional

import httpx
import yt_dlp
from fastapi import HTTPException

from app.config import settings

logger = logging.getLogger(__name__)

# Player clients tried in order when resolving a stream. `bestaudio` still
# yields the same adaptive audio-only streams regardless of client.
PLAYER_CLIENTS = [
    {"player_client": "android_vr"},
    {"player_client": "android"},
    {"player_client": "tv"},
]

_PROBE_TIMEOUT = httpx.Timeout(15.0, connect=6.0)
# Brief pause between client attempts to dodge YouTube rate limits.
_BACKOFF_RANGE = (0.5, 1.5)


class _UpstreamBlocked(Exception):
    """A resolved URL failed its liveness probe — try another client."""

    def __init__(self, status: Optional[int], detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


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
    Only probe-validated URLs are cached.
    """

    def __init__(self, ttl_seconds: int = 3600):
        self._cache: dict[str, AudioFormat] = {}
        self._ttl = ttl_seconds
        self._locks: dict[str, asyncio.Lock] = {}

    def _ydl_opts(self, client: dict) -> dict:
        opts = {
            "format": "bestaudio/best",
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "skip_download": True,
            **client,
        }
        if settings.cookies_file:
            opts["cookiefile"] = settings.cookies_file
        return opts

    def _probe(self, url: str, headers: dict) -> None:
        """Verify the resolved URL is actually servable before caching it.

        YouTube can hand us a URL that 403s the instant it is fetched
        (bot-check / nsig failure). Probing with a 2-byte range keeps the
        cost near zero and catches that here instead of as a 502 for the
        client.
        """
        try:
            resp = httpx.get(
                url,
                headers={**headers, "Range": "bytes=0-1"},
                follow_redirects=True,
                timeout=_PROBE_TIMEOUT,
            )
        except httpx.HTTPError as exc:
            raise _UpstreamBlocked(status=None, detail=str(exc)) from exc
        if resp.status_code not in (200, 206):
            raise _UpstreamBlocked(
                status=resp.status_code, detail="upstream rejected stream"
            )

    def _extract(self, video_id: str, client: dict) -> AudioFormat:
        url = f"https://www.youtube.com/watch?v={video_id}"
        with yt_dlp.YoutubeDL(self._ydl_opts(client)) as ydl:
            info = ydl.extract_info(url, download=False)

        fmt = AudioFormat(
            url=info["url"],
            ext=info.get("ext", "webm"),
            abr=info.get("abr"),
            filesize=info.get("filesize") or info.get("filesize_approx"),
            http_headers=info.get("http_headers", {}) or {},
            resolved_at=time.time(),
        )
        self._probe(fmt.url, fmt.http_headers)
        return fmt

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
            last_error: Optional[str] = None
            for client in PLAYER_CLIENTS:
                try:
                    fmt = await loop.run_in_executor(
                        None, self._extract, video_id, client
                    )
                except _UpstreamBlocked as exc:
                    status = "network error" if exc.status is None else f"HTTP {exc.status}"
                    last_error = f"{client['player_client']}: {status}"
                    logger.warning(
                        "Stream resolve blocked for %s via %s: %s",
                        video_id, client["player_client"], exc.detail,
                    )
                except Exception as exc:  # yt-dlp rejects this client entirely
                    last_error = f"{client['player_client']}: {exc}"
                    logger.warning(
                        "Stream resolve failed for %s via %s: %s",
                        video_id, client["player_client"], exc,
                    )
                else:
                    self._cache[video_id] = fmt
                    return fmt

                await asyncio.sleep(random.uniform(*_BACKOFF_RANGE))

            raise HTTPException(
                status_code=502,
                detail=f"Upstream audio source unavailable (tried: {last_error})",
            )


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
    if response.status_code not in (200, 206):
        logger.warning(f"Audio stream failed with status {response.status_code}. Retrying...")
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
