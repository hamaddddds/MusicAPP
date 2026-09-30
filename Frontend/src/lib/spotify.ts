// "Login with Spotify" via Authorization Code + PKCE: no client secret, so it is safe in a desktop app.
// Spotify redirects to the backend sidecar's loopback page, which hands the code back to us once.
const ACCOUNTS = "https://accounts.spotify.com";
export const SPOTIFY_REDIRECT = "http://127.0.0.1:8000/spotify/callback";
const SCOPES = "user-top-read user-read-recently-played user-library-read playlist-read-private user-follow-read";

export interface SpotifySession { clientId: string; access: string; refresh: string; expires: number }

const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randomString = (size: number) => b64url(crypto.getRandomValues(new Uint8Array(size)).buffer);

async function requestToken(clientId: string, params: Record<string, string>): Promise<SpotifySession> {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error_description || body.error || `Spotify token error ${res.status}`);
  return {
    clientId,
    access: body.access_token,
    refresh: body.refresh_token ?? params.refresh_token, // refreshes may reuse the old one
    expires: Date.now() + (body.expires_in - 60) * 1000,
  };
}

/** Opens Spotify's consent page, then waits (up to 3 minutes) for the loopback page to receive the code. */
export async function connectSpotify(clientId: string, api: string, open: (url: string) => Promise<unknown>): Promise<SpotifySession> {
  const verifier = randomString(64);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = randomString(16);
  await open(`${ACCOUNTS}/authorize?${new URLSearchParams({
    client_id: clientId, response_type: "code", redirect_uri: SPOTIFY_REDIRECT,
    code_challenge_method: "S256", code_challenge: challenge, state, scope: SCOPES,
  })}`);
  for (let i = 0; i < 180; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const got = await fetch(`${api}/spotify/pending/${state}`).then(r => r.json()).catch(() => ({}));
    if (got.error) throw new Error(got.error === "access_denied" ? "Login was cancelled." : got.error);
    if (got.code) return requestToken(clientId, { grant_type: "authorization_code", code: got.code, redirect_uri: SPOTIFY_REDIRECT, code_verifier: verifier });
  }
  throw new Error("Spotify login timed out.");
}

/** GET a Web API path, refreshing an expired token first (the new session goes to `save`). */
export async function spotifyGet(session: SpotifySession, path: string, save: (s: SpotifySession) => void) {
  let s = session;
  if (Date.now() > s.expires) { s = await requestToken(s.clientId, { grant_type: "refresh_token", refresh_token: s.refresh }); save(s); }
  const res = await fetch(`https://api.spotify.com/v1${path}`, { headers: { Authorization: `Bearer ${s.access}` } });
  if (res.status === 403) throw new Error("This Spotify account isn't on the app's allowlist (Dashboard → User Management).");
  if (!res.ok) throw new Error(`Spotify error ${res.status}`);
  return res.json();
}

export interface SpotifyTaste { at: number; name: string; image?: string; tracks: { title: string; artist: string }[]; artists: string[] }

/** What the listener plays most: this month's top tracks, then recent plays, plus their top artists. */
export async function fetchTaste(session: SpotifySession, save: (s: SpotifySession) => void): Promise<SpotifyTaste> {
  const get = (path: string) => spotifyGet(session, path, s => { session = s; save(s); });
  const me = await get("/me");
  const [shortTop, recent, topArtists] = await Promise.all([
    get("/me/top/tracks?time_range=short_term&limit=30"),
    get("/me/player/recently-played?limit=30"),
    get("/me/top/artists?time_range=medium_term&limit=10"),
  ]);
  const seen = new Set<string>();
  const tracks = [...(shortTop.items ?? []), ...(recent.items ?? []).map((i: any) => i.track)]
    .filter(t => t?.name && !seen.has(t.id) && seen.add(t.id))
    .map(t => ({ title: t.name as string, artist: t.artists?.[0]?.name as string }));
  return { at: Date.now(), name: me.display_name || me.id, image: me.images?.[0]?.url, tracks, artists: (topArtists.items ?? []).map((a: any) => a.name) };
}
