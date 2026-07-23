import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()


def _split_origins(raw: str) -> list[str]:
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


@dataclass
class Settings:
    host: str = os.getenv("HOST", "0.0.0.0")
    port: int = int(os.getenv("PORT", "8000"))
    cors_origins: list[str] = field(
        default_factory=lambda: _split_origins(os.getenv("CORS_ORIGINS", "*"))
    )
    # Optional path to an oauth.json / headers_auth.json produced by
    # `ytmusicapi oauth` or the browser-header setup flow. Only needed for
    # personalized/library endpoints (home feed personalization, your
    # playlists, likes, history). Search/charts/artist/album work without it.
    ytmusic_auth_file: str = os.getenv("YTMUSIC_AUTH_FILE", "")
    # Optional cookies.txt (Netscape format) passed to yt-dlp. Helps with
    # age-restricted videos and reduces bot-check throttling.
    cookies_file: str = os.getenv("COOKIES_FILE", "")
    # How long a resolved audio stream URL is cached before re-resolving.
    stream_cache_ttl: int = int(os.getenv("STREAM_CACHE_TTL", "3600"))


settings = Settings()
