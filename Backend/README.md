# YT Music Backend

A backend for a music app built on YouTube/YouTube Music, combining two
unofficial libraries:

- **[ytmusicapi](https://github.com/sigma67/ytmusicapi)** — metadata:
  search, global/local charts, artist & album info, lyrics, mood/genre
  playlists, thumbnails, recommendations ("watch playlist" / radio).
- **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** — resolves the direct
  audio-only stream for a given video ID and proxies it to your client.

Neither is an official Google product. There is no official "YouTube
Music API" — YouTube Data API v3 (the only one Google Cloud offers) is
metadata-only and has never served audio/video streams.

## Why this fixes the mp4 -> mp3 problem

yt-dlp doesn't need to download a full video and convert it. YouTube
already serves separate **audio-only adaptive streams** (e.g. opus/m4a).
Asking for `format=bestaudio` gets you a direct URL to just the audio —
no video, no ffmpeg re-encode. See `app/services/stream.py`.

## Architecture

```
Mobile/Web App
      │
      ▼
FastAPI backend (this repo)
  ├── /search, /charts, /artist, /album, /playlist, /lyrics, /home
  │     → ytmusicapi (metadata + thumbnails, JSON)
  │
  └── /stream/{video_id}
        → yt-dlp resolves best audio-only format
        → backend proxies the bytes to the client (with Range support)
```

**Why proxy instead of just returning the raw googlevideo.com URL:**
that URL is often locked to the IP/session that resolved it. If the
backend resolves it and a mobile client on a different network requests
it directly, YouTube can return 403. Proxying through this server avoids
that and lets clients seek via Range requests. `/stream/{id}/info` is
provided anyway in case you want the raw URL (e.g. server and client are
guaranteed to share an egress IP).

## Setup

```bash
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

No ffmpeg required for the streaming path used here (we don't re-encode).

### Optional: ytmusicapi auth (for personalized features only)

Search, charts, artist/album/playlist/lyrics, and generic `/home` all work
with **zero auth**. Only your own library, likes, history, and a
*personalized* home feed need it:

```bash
python -m ytmusicapi oauth
```

Point `YTMUSIC_AUTH_FILE` in `.env` at the resulting file.

### Optional: cookies for yt-dlp

If you hit age-restricted videos or throttling, export a `cookies.txt`
(Netscape format, e.g. via a browser extension) from a logged-in YouTube
session and point `COOKIES_FILE` at it.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /search?q=&filter=&limit=` | Search songs/albums/artists/playlists |
| `GET /charts?country=` | Global (`ZZ`) or per-country chart |
| `GET /moods` / `/moods/playlists?params=` | Mood & genre playlists |
| `GET /home` | Home feed / recommendations |
| `GET /song/{video_id}` | Song metadata + thumbnails |
| `GET /watch/{video_id}?radio=` | Up-next / radio queue (autoplay source) |
| `GET /lyrics/{browse_id}` | Lyrics |
| `GET /artist/{channel_id}` | Artist info, releases, related artists |
| `GET /album/{browse_id}` | Album info + tracklist |
| `GET /playlist/{playlist_id}` | Playlist contents |
| `GET /stream/{video_id}` | **Proxied audio bytes**, Range-aware |
| `GET /stream/{video_id}/info` | Resolved URL only, no proxy |
| `POST /stream/{video_id}/refresh` | Force re-resolve a stream |

All metadata responses are ytmusicapi's raw JSON shape (thumbnails
included as arrays of `{url, width, height}` — pick the resolution you
need).

## Important caveats

- **Unofficial & ToS:** both libraries reverse-engineer YouTube's internal
  API. This violates YouTube's Terms of Service. Endpoints can break
  without warning when Google changes something, and there's copyright/
  legal exposure if you ship this for public or commercial use with
  music you don't have rights to distribute.
- **No auth/rate-limiting on this scaffold.** Add your own app-level
  auth and per-user rate limits before exposing this publicly, or your
  server's IP will get flagged for abuse quickly.
- **Stream URLs expire** (roughly a few hours) — that's what
  `STREAM_CACHE_TTL` and the automatic 403-refresh in `stream.py` handle.
- **`ytmusicapi`/`yt-dlp` versions matter.** Pin and update them
  regularly; YouTube-side changes are usually fixed within days upstream.

## Suggested next steps (good tasks to hand to Claude Code)

- Add a persistent cache (Redis/SQLite) for search/chart results to cut
  down on repeated calls to YouTube.
- Add your own user accounts + favorites/playlists database, separate
  from YouTube's.
- Add pagination/continuation-token support for long lists (search,
  playlists, artist discography use continuation tokens upstream).
- Add structured error handling for region-locked / age-restricted /
  deleted videos.
- Add tests and a docker-compose setup (Dockerfile is included) for
  deployment.
- Consider a self-hosted Piped/Invidious instance as a fallback source
  if yt-dlp resolution starts getting blocked from your server's IP.
