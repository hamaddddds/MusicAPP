# Music Venue (Tauri + React + Typescript)

Music player berbasis YouTube Music: metadata via `ytmusic-api`, audio stream via [ytdlp.online](https://ytdlp.online) (yt-dlp as a service), dengan fallback instance Piped publik.

## Arsitektur streaming

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
