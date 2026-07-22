const fetch = require('node-fetch'); // Use node-fetch for serverless

// Fallback host if not provided by Vercel
const HOST = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://musicvenue.vercel.app';
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

  const { action, provider, code, state, error } = req.query;

  // 1. LOGIN REDIRECT
  if (action === 'login') {
    let authUrl = '';
    const stateParam = provider; // Use state to pass the provider name back to callback

    if (provider === 'discord') {
      authUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify&state=${stateParam}`;
    } else if (provider === 'github') {
      authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${stateParam}`;
    } else if (provider === 'google') {
      authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=profile&state=${stateParam}`;
    } else {
      return res.status(400).send('Invalid provider');
    }

    res.redirect(authUrl);
    return;
  }

  // 2. CALLBACK HANDLING
  // The provider is usually passed back in 'state' parameter (as we set it above)
  const actualProvider = provider || state;

  if (error) {
    res.redirect(`musicvenue://auth?error=${error}`);
    return;
  }

  if (code && actualProvider) {
    try {
      let profile = {};

      if (actualProvider === 'discord') {
        // Exchange code for token
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
          // Fetch Profile
          const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
          });
          const userData = await userRes.json();
          profile = {
            provider: 'discord',
            id: userData.id,
            name: userData.global_name || userData.username,
            avatar: userData.avatar ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png` : null,
            banner: userData.banner ? `https://cdn.discordapp.com/banners/${userData.id}/${userData.banner}.png?size=512` : (userData.accent_color ? `#${userData.accent_color.toString(16)}` : null)
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
            id: userData.id,
            name: userData.name || userData.login,
            avatar: userData.avatar_url,
            banner: null
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
            avatar: userData.picture,
            banner: null
          };
        }
      }

      // Convert profile to base64 for safe transport
      const payload = Buffer.from(JSON.stringify(profile)).toString('base64');
      
      // Attempt to deep link back to desktop app, or fallback to web interface
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Autentikasi Berhasil</title>
          <style>
            body { background: #121212; color: #fff; font-family: system-ui, sans-serif; text-align: center; padding-top: 50px; }
            a { color: #24c8db; }
          </style>
          <script>
            // 1. Try redirecting to Desktop App via Deep Link
            window.location.href = "musicvenue://auth?payload=${payload}";
            
            // 2. If it's a web browser that spawned a popup, message the opener
            if (window.opener) {
              window.opener.postMessage({ type: "MUSICVENUE_AUTH", payload: "${payload}" }, "*");
              setTimeout(() => window.close(), 1000);
            }
          </script>
        </head>
        <body>
          <h2>Autentikasi Berhasil!</h2>
          <p>Jika aplikasi tidak terbuka otomatis, <a href="musicvenue://auth?payload=${payload}">Klik di sini</a>.</p>
          <p>Atau kembali ke halaman web Music Venue jika Anda tidak memakai aplikasi desktop.</p>
        </body>
        </html>
      `;
      res.setHeader('Content-Type', 'text/html');
      res.status(200).send(html);
      return;
    } catch (e) {
      console.error(e);
      res.status(500).send('OAuth Error');
      return;
    }
  }
  
  res.status(400).send('Bad Request');
}
