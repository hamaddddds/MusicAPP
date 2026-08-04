// Fetch the latest yt-dlp binary for the current build platform and place it
// where Tauri expects a sidecar: src-tauri/binaries/yt-dlp-<target-triple>[.exe].
// The binary is git-ignored — CI and local dev download it on demand so the
// repo stays lean and yt-dlp is always current (YouTube breaks it often).
//
// Run automatically via tauri's beforeDev/beforeBuild hooks. Set FORCE_YTDLP=1
// to re-download an existing binary.

import { existsSync, mkdirSync, chmodSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const binDir = join(__dirname, '..', 'src-tauri', 'binaries');

// Map Node's platform/arch to the Rust target triple + the matching GitHub asset.
const TARGETS = {
  'win32-x64':   { triple: 'x86_64-pc-windows-msvc',    asset: 'yt-dlp.exe',   ext: '.exe' },
  'darwin-x64':  { triple: 'x86_64-apple-darwin',       asset: 'yt-dlp_macos', ext: ''     },
  'darwin-arm64':{ triple: 'aarch64-apple-darwin',      asset: 'yt-dlp_macos', ext: ''     },
  'linux-x64':   { triple: 'x86_64-unknown-linux-gnu',  asset: 'yt-dlp_linux', ext: ''     },
  'linux-arm64': { triple: 'aarch64-unknown-linux-gnu', asset: 'yt-dlp_linux_aarch64', ext: '' },
};

const key = `${process.platform}-${process.arch}`;
const cfg = TARGETS[key];
if (!cfg) {
  console.error(`[yt-dlp] Unsupported build platform: ${key}`);
  process.exit(1);
}

const dest = join(binDir, `yt-dlp-${cfg.triple}${cfg.ext}`);

if (existsSync(dest) && !process.env.FORCE_YTDLP) {
  console.log(`[yt-dlp] Already present (${statSync(dest).size} bytes): ${dest}`);
  process.exit(0);
}

mkdirSync(binDir, { recursive: true });

const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${cfg.asset}`;
console.log(`[yt-dlp] Downloading ${url}`);

const res = await fetch(url, { redirect: 'follow' });
if (!res.ok) {
  console.error(`[yt-dlp] Download failed: HTTP ${res.status}`);
  process.exit(1);
}

const buf = Buffer.from(await res.arrayBuffer());
await writeFile(dest, buf);
if (cfg.ext === '') chmodSync(dest, 0o755); // make executable on macOS/Linux

console.log(`[yt-dlp] Saved ${dest} (${buf.length} bytes)`);
