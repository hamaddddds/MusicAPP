<div align="center">
  <img src="https://raw.githubusercontent.com/hamaddddds/MusicAPP/main/public/icon.png" width="120" alt="Music Venue Logo" />
  <h1>🎵 Music Venue</h1>
  <p><strong>Aplikasi pemutar musik modern berbasis YouTube Music dengan estetika Apple Music dan performa super kilat.</strong></p>
  
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
- **Lirik Real-Time Tersinkron (LRC):** Integrasi lirik dari `lrclib.net` dengan visual baris yang sinkron dan bisa diklik untuk melompat ke waktu (*seek*) tersebut. Buka lewat tampilan *Now Playing* (**L**).
- **Smart Shuffle & Repeat Mode:** Mainkan lagumu secara acak dengan algoritma cerdas yang menyebar lagu artis secara merata, atau putar ulang lagu kesayanganmu.
- **Dukungan Media Keys:** Integrasi mulus dengan *Media Session API* dan *lock screen* sistem operasi kamu.
- **Now Playing:** Tampilan penuh yang imersif dengan *artwork* besar, *background blur*, dan lirik tersinkron.

### 🎮 Integrasi Discord RPC (BARU!)
- Pamerkan selera musikmu ke teman-teman di Discord! Fitur *Discord Rich Presence* internal akan menampilkan lagu yang sedang kamu putar secara *real-time* lengkap dengan pratinjau profil dan *progress bar*. 
- **Persistensi State:** Posisi durasi dan level volumemu selalu tersimpan walau aplikasi di-*restart*!

### 🎨 Kostumisasi & Fitur Lainnya
- **Dukungan Tema:** Pilih antara *Light*, *Dark*, dan *Amoled* untuk kenyamanan mata.
- **Custom CSS:** Sisipkan gaya CSS buatanmu sendiri untuk mengubah nuansa aplikasi.
- **Auto-Update Internal:** Pemeriksa pembaruan langsung dari dalam aplikasi.
- **Favorit & Antrean (Queue):** Simpan lagu ke daftar putar lokal (`localStorage`) dan lihat serta kelola antrean lagu berikutnya dengan mudah.

---

## 🚀 Arsitektur Pemutaran Desktop (Tauri)

Aplikasi ini menggunakan pendekatan unik untuk melakukan ekstraksi audio yang cepat dan anti-blokir:

- **Tanpa API Key Berbayar!** Meng-*bundle* `yt-dlp` sebagai *sidecar* dan menjalankannya secara lokal di mesin komputermu sendiri.
- Karena berjalan dari IP koneksi rumahmu (*residential*), URL audio yang dihasilkan bisa langsung diputar pada elemen `<audio>` native tanpa khawatir terkena blokir 403 Forbidden yang biasa terjadi pada server *datacenter*.
- `scripts/download-ytdlp.mjs` akan mengunduh *binary* `yt-dlp` secara otomatis pada saat proses *build* (`beforeDev`/`beforeBuild`), sehingga *binary* selalu dalam versi yang paling mutakhir.
- Pemanggilan Rust Command `resolve_audio_url(video_id)` secara transparan meluncurkan sidecar `yt-dlp -f bestaudio/best -g` untuk menembak URL audio super cepat.

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
