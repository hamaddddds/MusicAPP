<div align="center">

  <img src="https://raw.githubusercontent.com/hamaddddds/MusicAPP/main/Frontend/src-tauri/icons/icon.png" width="110" alt="Music Venue" />

# 🎵 Music Venue

**A modern YouTube Music player with the polish of Apple Music — built on Tauri for speed.**

<br/>

![Tauri](https://img.shields.io/badge/Tauri-v2-FFC131?style=for-the-badge&logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![License](https://img.shields.io/badge/License-Proprietary-lightgrey?style=for-the-badge)

**Latest release:** `v1.5.x (beta)`

</div>

---

## ✨ Highlights

Music Venue pairs the lightweight speed of **Tauri** with the rich metadata of **YouTube Music** to deliver a premium listening experience.

### 🎧 Playback & Controls
- **Premium glass UI** — a responsive *glassmorphism* interface inspired by modern Apple Music design.
- **Karaoke-synced lyrics** — time-coded lyrics with a *word-by-word* highlight that tracks the music in real time, powered by motion. Open them from the *Now Playing* view (**L**).
- **Smart Shuffle & Repeat** — a smart shuffle algorithm spreads an artist's tracks evenly, or loop your favorites on repeat.
- **Media Session support** — seamless integration with your OS lock screen and media keys.
- **Immersive Now Playing** — full-screen view with large artwork, blurred backdrop, and live lyrics.

### 🎮 Discord Rich Presence
- Show your friends what you're listening to — an internal Discord **Rich Presence** displays the current track in real time with a profile preview and progress bar.
- **State persistence** — your playback position and volume survive app restarts.

### 🎨 Customization
- **Themes** — Light, Dark, and Amoled to suit your eyes.
- **Custom CSS** — paste your own styles to reshape the app.
- **In-app auto-updater** — check for updates right from the app.
- **Favorites & Queue** — save tracks to a local list (`localStorage`) and manage your up-next queue with ease.

---

## 🚀 Desktop Streaming Architecture (Tauri)

Music Venue uses a unique approach for fast, block-proof audio extraction:

- **No paid API keys.** `yt-dlp` is bundled as a *sidecar* and runs locally on your own machine.
- Because it runs from your **residential IP**, the generated audio URLs play directly in a native `<audio>` element without the `403 Forbidden` blocks common to datacenter servers.
- `scripts/download-ytdlp.mjs` downloads the latest `yt-dlp` binary automatically at build time (`beforeDev`/`beforeBuild`), so it's always up to date.
- The Rust command `resolve_audio_url(video_id)` transparently launches the `yt-dlp -f bestaudio/best -g` sidecar to resolve audio URLs in milliseconds.

---

## 🧩 Project Structure

```
MusicAPP/
├── Backend/               # Local FastAPI server (search, metadata, lyrics, streaming)
│   └── app/
│       ├── main.py        # API routes
│       └── services/      # ytmusicapi + yt-dlp wrappers
├── Frontend/
│   ├── src/               # React + TypeScript UI
│   │   ├── App.tsx        # The full application
│   │   └── components/ui/ # Reusable UI components (shadcn-style)
│   ├── api/               # Vercel serverless functions (web build)
│   └── src-tauri/         # Rust shell (Tauri v2)
└── .github/workflows/     # CI: auto-builds & releases every push
```

---

## ⌨️ Keyboard Shortcuts

Navigate like a power user:

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `←` / `→` | Rewind / Forward ±5s |
| `↑` / `↓` | Volume up / down |
| `N` / `P` | Next / Previous track |
| `S` | Cycle shuffle mode |
| `R` | Cycle repeat mode |
| `M` | Mute / unmute |
| `L` | Toggle lyrics (Now Playing) |
| `Esc` | Close full-screen (Now Playing) |

---

## 🛠️ Development Setup

### Prerequisites
- [Node.js](https://nodejs.org/) 18+ and npm
- [Rust](https://rustup.rs/) toolchain
- [VS Code](https://code.visualstudio.com/) + [Tauri Extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

### Run locally
```bash
# 1. Start the backend (port 8000)
cd Backend
pip install -r requirements.txt
uvicorn app.main:app --port 8000

# 2. Run the desktop app (in another terminal)
cd Frontend
npm install
npm run tauri dev
```

---

<div align="center">
  <i>Crafted for distraction-free music listening — beautiful, fast, and yours.</i>
</div>
