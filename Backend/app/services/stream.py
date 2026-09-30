"""
Resolves and proxies the actual audio for a video using yt-dlp.

Why we PROXY the bytes instead of handing the client the raw googlevideo
URL: that URL is locked to the IP/session that resolved it. Proxying also
forwards Range requests so the player can seek.

What YouTube enforces (measured, yt-dlp 2026.8):
- android_vr / ios / mweb / web audio-only URLs need a GVS PO token. Without
  one YouTube serves the first ~1 MB, then 403s — playback dies after a few
  seconds and `<audio>`'s open-ended `Range: bytes=0-` gets a 403 up front.
- tv_simply / web_music serve full files without a PO token, but their URLs
  carry a JS challenge (n/sig) that yt-dlp solves with an external JS runtime.
  We use a system deno/node/bun when present, else the QuickJS bundled next to
  this app (Backend/bin/qjs.exe, packed into the exe by backend.spec).

Every candidate URL is probed in the MIDDLE of the file before it is cached:
a PO-token-gated URL passes a probe at byte 0 and only fails later.
"""

import asyncio
import logging
import os
import random
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncGenerator, Optional
from urllib.parse import parse_qs, urlparse

import httpx
import yt_dlp
from fastapi import HTTPException

from app.config import settings
from app.services import metadata

logger = logging.getLogger(__name__)

_BASE_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2]))
_QJS = _BASE_DIR / "bin" / "qjs.exe"
JS_RUNTIMES: dict = {"deno": {}, "node": {}, "bun": {}}
if _QJS.exists():
    JS_RUNTIMES["quickjs"] = {"path": str(_QJS)}

try:
    # ponytail: private yt-dlp flag. Caches the preprocessed player on disk so
    # QuickJS solves in ~2s instead of ~11s. Harmless if yt-dlp renames it.
    from yt_dlp.extractor.youtube.jsc._builtin.ejs import EJSBaseJCP
    EJSBaseJCP._ENABLE_PREPROCESSED_PLAYER_CACHE = True
except ImportError:
    pass

# Tried in order. "default" lets yt-dlp pick its own client set as a last resort.
PLAYER_CLIENTS = ["tv_simply", "web_music", "default"]

# Progressive http(s) only: HLS/DASH manifests can't be byte-proxied to <audio>.
_FORMAT = "bestaudio[protocol^=http]/best[protocol^=http][acodec!=none]"
_PROBE_TIMEOUT = httpx.Timeout(15.0, connect=6.0)
_BACKOFF_RANGE = (0.3, 0.8)
_http = httpx.AsyncClient(follow_redirects=True, timeout=httpx.Timeout(30.0, connect=10.0))


class _UpstreamBlocked(Exception):
    """A resolved URL failed its liveness probe — try another client."""


@dataclass
class AudioFormat:
    url: str
    ext: str
    abr: Optional[float]
    filesize: Optional[int]
    http_headers: dict
    resolved_at: float


def _content_length(url: str, fallback: Optional[int]) -> int:
    clen = parse_qs(urlparse(url).query).get("clen", ["0"])[0]
    return int(clen) if clen.isdigit() and int(clen) else (fallback or 0)


class StreamResolver:
    """Resolves the best playable format via yt-dlp and caches it in memory.
    Only probe-validated URLs are cached.
    """

    def __init__(self, ttl_seconds: int = 3600):
        self._cache: dict[str, AudioFormat] = {}
        self._ttl = ttl_seconds
        self._locks: dict[str, asyncio.Lock] = {}

    def _ydl_opts(self, client: str) -> dict:
        opts = {
            "format": _FORMAT,
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "skip_download": True,
            "js_runtimes": JS_RUNTIMES,
        }
        if client != "default":
            opts["extractor_args"] = {"youtube": {"player_client": [client]}}
        if settings.cookies_file:
            opts["cookiefile"] = settings.cookies_file
        return opts

    def _probe(self, fmt: AudioFormat) -> None:
        size = _content_length(fmt.url, fmt.filesize)
        start = size // 2 if size > 2 else 0
        try:
            resp = httpx.get(
                fmt.url,
                headers={**fmt.http_headers, "Range": f"bytes={start}-{start + 1}"},
                follow_redirects=True,
                timeout=_PROBE_TIMEOUT,
            )
        except httpx.HTTPError as exc:
            raise _UpstreamBlocked(f"probe network error: {exc}") from exc
        if resp.status_code not in (200, 206):
            raise _UpstreamBlocked(f"probe HTTP {resp.status_code}")

    def _extract(self, video_id: str, client: str) -> AudioFormat:
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
        self._probe(fmt)
        return fmt

    def _is_fresh(self, fmt: Optional[AudioFormat]) -> bool:
        return fmt is not None and (time.time() - fmt.resolved_at) < self._ttl

    def forget(self, video_id: str) -> None:
        self._cache.pop(video_id, None)

    async def resolve(self, video_id: str, force_refresh: bool = False) -> AudioFormat:
        cached = self._cache.get(video_id)
        if not force_refresh and self._is_fresh(cached):
            return cached

        lock = self._locks.setdefault(video_id, asyncio.Lock())
        async with lock:
            cached = self._cache.get(video_id)
            if not force_refresh and self._is_fresh(cached):
                return cached

            errors: list[str] = []
            fmt = await self._try_clients(video_id, errors)
            if fmt is None:
                # This upload is refused for logged-out users (e.g. LOGIN_REQUIRED on
                # some "Topic" tracks). Play the same song from another upload instead.
                try:
                    alt = await asyncio.get_running_loop().run_in_executor(None, _alternate_upload, video_id)
                except Exception as exc:
                    alt = None
                    logger.warning("Alternate lookup failed for %s: %s", video_id, exc)
                if alt:
                    logger.warning("Falling back from %s to alternate upload %s", video_id, alt)
                    fmt = await self._try_clients(alt, errors)
            if fmt is None:
                raise HTTPException(
                    status_code=502,
                    detail="Upstream audio source unavailable (" + " | ".join(errors) + ")",
                )
            self._cache[video_id] = fmt
            return fmt

    async def _try_clients(self, video_id: str, errors: list[str]) -> Optional[AudioFormat]:
        loop = asyncio.get_running_loop()
        for client in PLAYER_CLIENTS:
            try:
                return await loop.run_in_executor(None, self._extract, video_id, client)
            except Exception as exc:  # yt-dlp DownloadError, probe failure, ...
                errors.append(f"{video_id} via {client}: {str(exc)[:160]}")
                logger.warning("Stream resolve failed for %s via %s: %s", video_id, client, exc)
                if "please sign in" in str(exc).lower():
                    return None  # same answer on every client; don't burn ~20s confirming it
                await asyncio.sleep(random.uniform(*_BACKOFF_RANGE))
        return None


def _alternate_upload(video_id: str) -> Optional[str]:
    """Another upload of the same song by the same artist (official video, etc.)."""
    track = metadata.get_watch_playlist(video_id, limit=1)["tracks"][0]
    artists = {a["name"].lower() for a in track.get("artists") or []}
    if not artists:
        return None
    title = track["title"].lower()
    query = f'{track["title"]} {track["artists"][0]["name"]}'
    for hit in metadata.search(query, filter="videos", limit=5):
        hit_artists = {a["name"].lower() for a in hit.get("artists") or []}
        if hit.get("videoId") not in (None, video_id) and title in (hit.get("title") or "").lower() and artists & hit_artists:
            return hit["videoId"]
    return None


resolver = StreamResolver(ttl_seconds=settings.stream_cache_ttl)


async def _open(fmt: AudioFormat, range_header: Optional[str]) -> Optional[httpx.Response]:
    headers = dict(fmt.http_headers)
    if range_header:
        headers["Range"] = range_header
    try:
        resp = await _http.send(_http.build_request("GET", fmt.url, headers=headers), stream=True)
    except httpx.HTTPError as exc:
        logger.warning("Audio upstream connect failed: %r", exc)
        return None
    # 416 = seek past the end; the player handles it, so pass it through.
    if resp.status_code in (200, 206, 416):
        return resp
    logger.warning("Audio upstream returned HTTP %s", resp.status_code)
    await resp.aclose()
    return None


async def open_audio_stream(video_id: str, range_header: Optional[str] = None):
    """Opens the upstream audio and returns (status_code, headers, ext, byte_generator)
    so the caller can build a matching HTTP response before any bytes are read.
    """
    fmt = await resolver.resolve(video_id)
    response = await _open(fmt, range_header)
    if response is None:
        # Expired / IP changed (VPN toggle) / newly gated URL: re-resolve once.
        fmt = await resolver.resolve(video_id, force_refresh=True)
        response = await _open(fmt, range_header)
    if response is None:
        resolver.forget(video_id)
        raise HTTPException(status_code=502, detail="Upstream audio source unavailable")

    async def body() -> AsyncGenerator[bytes, None]:
        try:
            async for chunk in response.aiter_bytes():
                yield chunk
        except httpx.HTTPError as exc:
            # Upstream dropped mid-song (long pause, network blip). Ending the
            # body lets the player re-request the remaining Range.
            logger.warning("Audio upstream dropped for %s: %r", video_id, exc)
        finally:
            await response.aclose()

    return response.status_code, response.headers, fmt.ext, body()
