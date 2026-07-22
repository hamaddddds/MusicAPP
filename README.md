# Music Venue (Tauri + React + Typescript)

Music player berbasis YouTube Music. Metadata (search/home) via `ytmusic-api`. Cara memutar audio **berbeda per platform**:

- **🖥️ Desktop (Tauri) — gratis, tanpa API key.** Meng-*bundle* `yt-dlp` sebagai sidecar dan menjalankannya **lokal di mesin user**. Karena jalan di IP residential user, URL audio yang dihasilkan bisa langsung diputar `<audio>` (URL googlevideo terkunci ke IP pengekstrak — makanya ekstraksi dari server datacenter selalu kena 403, tapi dari mesin user aman).
- **🌐 Web (Vercel) — server datacenter, butuh provider berbayar.** YouTube memblok IP datacenter, jadi web memakai [ytdlp.online](https://ytdlp.online) (berbayar, set `YTDLP_API_KEY`) dengan fallback Piped. Tanpa key, web hanya untuk browse/search.

## Desktop: sidecar yt-dlp

- `scripts/download-ytdlp.mjs` mengunduh binary `yt-dlp` terbaru ke `src-tauri/binaries/yt-dlp-<target-triple>[.exe]` (binary di-*gitignore*, diunduh otomatis lewat hook `beforeDev`/`beforeBuild`).
- Command Rust `resolve_audio_url(video_id)` di `src-tauri/src/lib.rs` menjalankan sidecar `yt-dlp -f bestaudio/best -g` dan mengembalikan URL audio langsung.
- Frontend (`src/App.tsx`) memanggil command itu via `invoke` saat berjalan di Tauri; di web memakai `/api`.
- yt-dlp perlu update berkala (YouTube sering berubah). Karena binary diunduh saat build, tiap rilis baru otomatis dapat yt-dlp terbaru. Untuk paksa update lokal: `FORCE_YTDLP=1 node scripts/download-ytdlp.mjs`.

## Web: arsitektur streaming

1. Frontend memanggil `/api?action=stream&videoId=...`
2. Backend (Vercel serverless, `api/index.js`) mencoba provider berurutan:
   - **ytdlp.online `/video/info`** — ambil URL format audio langsung (cepat, tapi URL googlevideo bisa terkunci ke IP server; kalau gagal diputar, frontend otomatis retry dengan `mode=download`)
   - **ytdlp.online `/download` (mp3)** — konversi async di server mereka; backend menunggu ±6 detik, kalau belum selesai frontend polling `?action=stream_status&taskId=...` sampai `download_url` siap (file disimpan ±1 jam)
   - **Piped instances** — fallback terakhir (mayoritas instance publik sudah mati per 2026)
3. Frontend memutar URL hasilnya lewat elemen `<audio>` native.

## Setup wajib: API key ytdlp.online

Endpoint stream **tidak akan jalan tanpa API key** ytdlp.online (butuh Developer Plan — ambil key dari halaman Profile setelah subscribe).

Di Vercel: **Project → Settings → Environment Variables**, tambahkan:

| Name | Value |
|------|-------|
| `YTDLP_API_KEY` | API key kamu |
| `YTDLP_API_BASE` | *(opsional)* default `https://ytdlp.online/open/v1` |

Lalu redeploy. Tanpa key, `?action=stream` mengembalikan 404 dengan pesan error yang menjelaskan ini.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
