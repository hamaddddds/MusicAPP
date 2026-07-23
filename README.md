<div align="center">
  <img src="https://raw.githubusercontent.com/hamaddddds/MusicAPP/main/public/icon.png" width="120" alt="Music Venue Logo" />
  <h1>🎵 Music Venue</h1>
  <p><strong>Aplikasi pemutar musik modern berbasis YouTube Music dengan estetika Apple Music dan fitur personalisasi mutakhir.</strong></p>
  
  <p>
    <img src="https://img.shields.io/badge/Tauri-v2-FFC131?style=for-the-badge&logo=tauri&logoColor=white" alt="Tauri" />
    <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React" />
    <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  </p>
</div>

---

## ✨ Fitur Unggulan

Music Venue menggabungkan kecepatan Tauri dan kekuatan metadata YouTube Music untuk menghadirkan pengalaman mendengarkan yang premium:

### 🎧 Playback & Kontrol Superior
- **Desain UI Premium:** Estetika cantik nan responsif dengan *glassmorphism*, terinspirasi dari antarmuka modern Apple Music.
- **Lirik Real-Time Tersinkron (LRC):** Integrasi lirik dari `lrclib.net` dengan visual baris yang sinkron dan bisa diklik untuk melompat ke waktu (*seek*) tersebut.
- **Smart Shuffle & Repeat Mode:** Mainkan lagumu secara acak dengan algoritma cerdas, atau putar ulang lagu kesayanganmu.
- **Dukungan Media Keys:** Integrasi mulus dengan *Media Session API* dan *lock screen* sistem operasi kamu.

### 🤖 Rekomendasi Cerdas "For You" (BARU!)
- Beranda yang dipersonalisasi! Melalui algoritma **"Mix buat kamu"**, Music Venue mempelajari *top played history* lokal kamu dan mengambil data *Radio* asli dari YouTube Music untuk menyajikan trek yang benar-benar kamu nikmati.
- **Tangga Lagu Akurat:** Selalu *up-to-date* dengan Chart Lokal berdasarkan wilayah (Geo-IP) dan Chart Global dari YouTube Music.

### 🎮 Integrasi Discord RPC (BARU!)
- Pamerkan selera musikmu ke teman-teman di Discord! Fitur *Discord Rich Presence* internal akan menampilkan lagu yang sedang kamu putar secara *real-time* lengkap dengan pratinjau profil dan *progress bar*. 
- **Persistensi State:** Posisi durasi dan level volumemu selalu tersimpan walau aplikasi di-*restart*!

### 🎨 Kostumisasi & Fitur Lainnya
- **Dukungan Tema:** Pilih antara *Light*, *Dark*, dan *Amoled* untuk kenyamanan mata.
- **Custom CSS:** Sisipkan gaya CSS buatanmu sendiri untuk mengubah nuansa aplikasi.
- **Auto-Update Internal:** Pemeriksa pembaruan langsung dari dalam aplikasi (Desktop only).
- **Favorit & Antrean (Queue):** Simpan lagu ke daftar putar lokal (`localStorage`) dan kontrol antrean dengan mudah.

---

## 🚀 Streaming per Platform

Aplikasi ini menggunakan kombinasi *API* lokal dan `ytmusicapi` untuk meta data. Cara pemutaran audio **berbeda bergantung pada platform**:

### 🖥️ Desktop (Tauri) — *Lancar, Gratis, Tanpa API Key*
Berjalan langsung di mesinmu! Aplikasi mem-*bundle* `yt-dlp` sebagai *sidecar* lokal untuk mengambil *stream audio* murni tanpa hambatan pemblokiran *datacenter*.
- URL audio bisa langsung diputar karena menggunakan IP *residential* kamu (aman dari 403 Forbidden).
- Binary `yt-dlp` akan otomatis diperbarui setiap kamu mem-*build* aplikasi lewat *hook* `beforeDev`/`beforeBuild`.

### 🌐 Web (Vercel) — *Server Datacenter, Membutuhkan API Key*
Karena IP *datacenter* Vercel diblokir oleh YouTube, web menggunakan layanan pihak ketiga berbayar (seperti [ytdlp.online](https://ytdlp.online)) dengan *fallback* Piped. 
- Tanpa *API Key*, versi Web hanya dapat digunakan untuk melakukan *browse* dan pencarian metadata, namun audio tidak bisa diputar.
- Proses konversi dilakukan secara *asynchronous* melalui `api/index.js`.

---

## ⚙️ Setup Wajib: API Key YTDLP (Khusus Web)

Bila Anda berencana melakukan *deploy* aplikasi ini ke Vercel untuk digunakan via *Web Browser*, pemutaran lagu tidak akan berjalan tanpa API Key ytdlp.online.

Di halaman **Project → Settings → Environment Variables** Vercel, tambahkan:

| Name | Keterangan |
|------|-------|
| `YTDLP_API_KEY` | API key aktif kamu (wajib Developer Plan) |
| `YTDLP_API_BASE` | *(Opsional)* default: `https://ytdlp.online/open/v1` |

*(Abaikan langkah ini jika kamu hanya akan menggunakan aplikasi versi Desktop / Tauri).*

---

## ⌨️ Shortcut Keyboard

Bernavigasi bagaikan *power-user*:
- `Spasi` : Play / Pause
- `←` / `→` : Mundur / Maju ±5 detik
- `↑` / `↓` : Naikkan / Turunkan Volume
- `N` / `P` : Lagu Selanjutnya / Sebelumnya
- `S` : Ganti mode Shuffle
- `R` : Ganti mode Repeat
- `M` : Mute / Unmute
- `L` : Tampilkan Lirik
- `Esc` : Tutup layar penuh (Now Playing)

---

## 🛠️ Recommended IDE Setup

Bagi kamu yang ingin berkontribusi atau melakukan kustomisasi kode:
- [VS Code](https://code.visualstudio.com/) 
- [Tauri Extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) 
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) 

---
<div align="center">
  <i>Dibuat untuk pengalaman mendengarkan musik terbaik tanpa distraksi.</i>
</div>
