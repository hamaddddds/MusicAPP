// fetch is available globally in Node 18+ on Vercel

// Hardcode production host so OAuth callbacks always match the registered Redirect URI
const HOST = 'https://musicvenue.vercel.app';
const REDIRECT_URI = `${HOST}/api/auth`;

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { action, provider, code, state, error, port } = req.query;

  // 1. LOGIN REDIRECT
  if (action === 'login') {
    const stateParam = port ? `${provider}:${port}` : provider;
    
    if (provider === 'discord' && (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET)) {
      return renderInstructionPage(res, 'Discord');
    }
    if (provider === 'github' && (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET)) {
      return renderInstructionPage(res, 'GitHub');
    }
    if (provider === 'google' && (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET)) {
      return renderInstructionPage(res, 'Google');
    }

    let authUrl = '';
    if (provider === 'discord') {
      authUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify&state=${stateParam}`;
    } else if (provider === 'github') {
      authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=read:user&state=${stateParam}`;
    } else if (provider === 'google') {
      authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=profile+email&state=${stateParam}`;
    } else {
      return res.status(400).send('Invalid provider');
    }

    res.redirect(authUrl);
    return;
  }

  // 2. CALLBACK HANDLING
  // state might be "discord:14562"
  let actualProvider = provider || state;
  let devPort = null;
  if (actualProvider && actualProvider.includes(':')) {
    const parts = actualProvider.split(':');
    actualProvider = parts[0];
    devPort = parts[1];
  }

  if (error) {
    const html = buildCallbackPage(null, error, devPort);
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(html);
  }

  if (code && actualProvider) {
    try {
      let profile = {};

      if (actualProvider === 'discord') {
        const tokenParams = new URLSearchParams({
          client_id: DISCORD_CLIENT_ID,
          client_secret: DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: REDIRECT_URI
        });
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: tokenParams
        });
        const tokenData = await tokenRes.json();
        
        if (tokenData.access_token) {
          const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
          });
          const userData = await userRes.json();

          profile = {
            id: userData.id,
            name: userData.global_name || userData.username,
            email: userData.email,
            avatar: userData.avatar ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.${userData.avatar.startsWith('a_') ? 'gif' : 'png'}?size=1024` : null,
            banner: userData.banner ? `https://cdn.discordapp.com/banners/${userData.id}/${userData.banner}.${userData.banner.startsWith('a_') ? 'gif' : 'png'}?size=2048` : null,
            username: userData.username,
            bio: userData.bio || null,
            accent_color: userData.accent_color ? `#${userData.accent_color.toString(16).padStart(6, '0')}` : null,
            provider: 'discord'
          };
        }
      } else if (actualProvider === 'github') {
        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            client_id: GITHUB_CLIENT_ID,
            client_secret: GITHUB_CLIENT_SECRET,
            code: code,
            redirect_uri: REDIRECT_URI
          })
        });
        const tokenData = await tokenRes.json();
        
        if (tokenData.access_token) {
          const userRes = await fetch('https://api.github.com/user', {
            headers: { 
              Authorization: `Bearer ${tokenData.access_token}`,
              'User-Agent': 'MusicVenue'
            }
          });
          const userData = await userRes.json();
          profile = {
            provider: 'github',
            id: String(userData.id),
            name: userData.name || userData.login,
            username: userData.login,
            avatar: userData.avatar_url,
            banner: null,
            bio: userData.bio || null,
          };
        }
      } else if (actualProvider === 'google') {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: REDIRECT_URI
          })
        });
        const tokenData = await tokenRes.json();
        
        if (tokenData.access_token) {
          const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
          });
          const userData = await userRes.json();
          profile = {
            provider: 'google',
            id: userData.id,
            name: userData.name,
            username: userData.email,
            avatar: userData.picture,
            banner: null,
            bio: null,
          };
        }
      }

      const payload = Buffer.from(JSON.stringify(profile)).toString('base64');
      const html = buildCallbackPage(payload, null, devPort);
      res.setHeader('Content-Type', 'text/html');
      return res.status(200).send(html);
    } catch (e) {
      console.error(e);
      const html = buildCallbackPage(null, 'server_error', devPort);
      res.setHeader('Content-Type', 'text/html');
      return res.status(200).send(html);
    }
  }
  
  res.status(400).send('Bad Request');
}

function buildCallbackPage(payload, error, devPort) {
  const providerName = payload ? (() => {
    try { return JSON.parse(Buffer.from(payload, 'base64').toString()).provider || ''; } catch { return ''; }
  })() : '';

  // If a devPort is provided, we instantly redirect to the localhost dev server!
  const devRedirectScript = devPort && payload && !error ? `
    // Localhost Dev Redirect
    window.location.href = "http://127.0.0.1:${devPort}/?payload=${payload}";
  ` : '';

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${error ? 'Autentikasi Gagal' : 'Autentikasi Berhasil'}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0a0a; color: #e0e0e0; font-family: 'Segoe UI', system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 16px; padding: 48px; text-align: center; max-width: 420px; width: 90%; }
    .icon { width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; font-size: 28px; }
    .icon.success { background: #1a3a1a; color: #4ade80; }
    .icon.error { background: #3a1a1a; color: #f87171; }
    h2 { font-size: 22px; margin-bottom: 8px; }
    p { color: #888; font-size: 14px; margin-top: 8px; }
    .provider { color: #a78bfa; font-weight: 600; text-transform: capitalize; }
    .spinner { width: 20px; height: 20px; border: 2px solid #333; border-top-color: #a78bfa; border-radius: 50%; animation: spin 0.8s linear infinite; display: inline-block; vertical-align: middle; margin-left: 8px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .hint { margin-top: 16px; font-size: 12px; color: #555; }
  </style>
  <script>
    (function() {
      ${devRedirectScript}
      ${error ? `
        // Error case
        if (window.opener) {
          window.opener.postMessage({ type: "MUSICVENUE_AUTH", error: "${error}" }, "*");
          setTimeout(function() { window.close(); }, 2000);
        }
      ` : `
        // Success case
        var payload = "${payload}";
        if (window.opener) {
          window.opener.postMessage({ type: "MUSICVENUE_AUTH", payload: payload }, "*");
          setTimeout(function() { window.close(); }, 1500);
        } else {
          // Not a popup — try deep link for desktop app (fallback)
          setTimeout(function() {
            window.location.href = "musicvenue://auth?payload=" + payload;
          }, 500);
        }
      `}
    })();
    function copyManualToken() {
      navigator.clipboard.writeText("${payload}").then(() => {
        var btn = document.getElementById('copyBtn');
        btn.innerText = 'Tersalin!';
        btn.style.background = '#4ade80';
        btn.style.color = '#111';
      });
    }
  </script>
</head>
<body>
  <div class="card">
    <div class="icon ${error ? 'error' : 'success'}">${error ? '✕' : '✓'}</div>
    <h2>${error ? 'Autentikasi Gagal' : 'Autentikasi Berhasil!'}</h2>
    ${error 
      ? `<p>Terjadi kesalahan: <strong>${error}</strong></p><p class="hint">Silakan coba lagi.</p>` 
      : `<p>Terhubung dengan <span class="provider">${providerName}</span></p>
         <p>Menutup jendela ini<span class="spinner"></span></p>
         <div class="hint" style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #333;">
           <p style="margin-bottom: 12px;">Jika aplikasi tidak merespons otomatis (karena mode Dev), gunakan sinkronisasi manual:</p>
           <button id="copyBtn" onclick="copyManualToken()" style="background: #333; color: #fff; border: 1px solid #444; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-family: inherit; font-weight: 500;">Salin Token Manual</button>
           <p style="font-size: 11px; margin-top: 8px;">Paste token ini di tab Akun pada aplikasi.</p>
         </div>`}
  </div>
</body>
</html>`;
}

function renderInstructionPage(res, provider) {
  const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Kredensial ${provider} Belum Diatur</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0a0a; color: #e0e0e0; font-family: 'Segoe UI', system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 16px; padding: 40px; max-width: 520px; width: 100%; }
    h2 { color: #f59e0b; margin-bottom: 12px; }
    p { color: #888; line-height: 1.6; margin-bottom: 16px; }
    code { background: #2a2a2a; padding: 2px 8px; border-radius: 4px; font-size: 13px; color: #a78bfa; }
    ol { padding-left: 20px; color: #ccc; line-height: 2; }
  </style>
</head>
<body>
  <div class="card">
    <h2>⚠️ Kredensial ${provider} Belum Diatur</h2>
    <p>Tambahkan environment variable berikut di <strong>Vercel → Settings → Environment Variables</strong>:</p>
    <ol>
      <li><code>${provider.toUpperCase()}_CLIENT_ID</code></li>
      <li><code>${provider.toUpperCase()}_CLIENT_SECRET</code></li>
    </ol>
    <p>Setelah ditambahkan, lakukan <strong>Redeploy</strong> di Vercel.</p>
  </div>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
}
