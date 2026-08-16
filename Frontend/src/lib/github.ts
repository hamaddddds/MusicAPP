const GIST_FILENAME = "musicvenue-state.json";
const GIST_DESCRIPTION = "Music Venue App State (Do not delete)";

// Backward-compatible: the gist previously held subscriptions and playlists in
// separate files. We keep those filenames around and never delete them so an
// older build of the app can still read them; the new app reads the single
// all-state file below.
const LEGACY_SUB_FILENAME = "musicvenue-subscriptions.json";
const LEGACY_PLAYLIST_FILENAME = "musicvenue-playlists.json";

export interface AppState {
  schema: number;
  writtenAt: string;
  /** Flat map of every localStorage key the app touches (mv:*) -> raw string. */
  data: Record<string, string>;
}

async function listGists(token: string): Promise<any[]> {
  const res = await fetch("https://api.github.com/gists", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to list gists: ${res.status}`);
  return res.json();
}

function findFileGist(gists: any[], filename: string): any | null {
  return gists.find((g: any) => g.files && g.files[filename]) || null;
}

async function readGistContent(rawUrl: string): Promise<any> {
  const res = await fetch(rawUrl);
  if (!res.ok) throw new Error("Failed to fetch gist content");
  return res.json();
}

async function writeOrUpdate(token: string, gist: any | null, files: Record<string, { content: string }>) {
  if (gist) {
    const res = await fetch(`https://api.github.com/gists/${gist.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github.v3+json",
      },
      body: JSON.stringify({ files }),
    });
    if (!res.ok) throw new Error(`Failed to update gist: ${res.status}`);
  } else {
    const res = await fetch("https://api.github.com/gists", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github.v3+json",
      },
      body: JSON.stringify({
        description: GIST_DESCRIPTION,
        public: false,
        files,
      }),
    });
    if (!res.ok) throw new Error(`Failed to create gist: ${res.status}`);
  }
}

/** Read the full app state ({schema, data}) from our gist, or null if none yet. */
export async function fetchAppStateFromGist(token: string): Promise<AppState | null> {
  try {
    const gists = await listGists(token);
    const ourGist = findFileGist(gists, GIST_FILENAME);
    if (!ourGist) return null;
    const raw = await readGistContent(ourGist.files[GIST_FILENAME].raw_url);
    if (!raw || typeof raw !== "object" || typeof raw.data !== "object") return null;
    return raw as AppState;
  } catch (error) {
    console.error("Error fetching app state from GitHub Gist:", error);
    return null;
  }
}

/**
 * Snapshot the entire app state ({data} flat) into the gist. Existing legacy
 * files (subscriptions/playlists) are left untouched so old builds keep working.
 */
export async function syncAppStateToGist(token: string, allMvState: Record<string, string>): Promise<void> {
  try {
    const gists = await listGists(token);
    const ourGist = findFileGist(gists, GIST_FILENAME);
    const payload: AppState = {
      schema: 1,
      writtenAt: new Date().toISOString(),
      data: allMvState,
    };
    await writeOrUpdate(token, ourGist, { [GIST_FILENAME]: { content: JSON.stringify(payload, null, 2) } });
  } catch (error) {
    console.error("Error syncing app state to GitHub Gist:", error);
  }
}

// --- Backward-compatible legacy readers (old list-scoped API) -------------
// Kept so existing callers that only want subscriptions or playlists can still
// use them; the new app-state flow supersedes these.

export interface SubscribedArtist {
  artistId: string;
  name: string;
  thumbnails: any[];
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  image?: string;
  banner?: string;
  tracks: any[];
}

export async function fetchSubscriptionsFromGist(token: string): Promise<SubscribedArtist[]> {
  try {
    const gists = await listGists(token);
    const ourGist = findFileGist(gists, GIST_FILENAME);
    if (ourGist) {
      const all = await readGistContent(ourGist.files[GIST_FILENAME].raw_url);
      const data = all?.data?.["mv:subscribedArtists"];
      if (data) return JSON.parse(data);
    }
    const legacy = findFileGist(gists, LEGACY_SUB_FILENAME);
    if (!legacy) return [];
    const d = await readGistContent(legacy.files[LEGACY_SUB_FILENAME].raw_url);
    return Array.isArray(d) ? d : [];
  } catch (error) {
    console.error("Error fetching subscriptions from GitHub Gist:", error);
    return [];
  }
}

export async function fetchPlaylistsFromGist(token: string): Promise<Playlist[]> {
  try {
    const gists = await listGists(token);
    const ourGist = findFileGist(gists, GIST_FILENAME);
    if (ourGist) {
      const all = await readGistContent(ourGist.files[GIST_FILENAME].raw_url);
      const data = all?.data?.["mv:custom-playlists"];
      if (data) return JSON.parse(data);
    }
    const legacy = findFileGist(gists, LEGACY_PLAYLIST_FILENAME);
    if (!legacy) return [];
    const d = await readGistContent(legacy.files[LEGACY_PLAYLIST_FILENAME].raw_url);
    return Array.isArray(d) ? d : [];
  } catch (error) {
    console.error("Error fetching playlists from GitHub Gist:", error);
    return [];
  }
}

export async function syncSubscriptionsToGist(token: string, subscriptions: SubscribedArtist[]): Promise<void> {
  try {
    const gists = await listGists(token);
    const legacy = findFileGist(gists, LEGACY_SUB_FILENAME);
    await writeOrUpdate(token, legacy, {
      [LEGACY_SUB_FILENAME]: { content: JSON.stringify(subscriptions, null, 2) },
    });
  } catch (error) {
    console.error("Error syncing subscriptions to GitHub Gist:", error);
  }
}

export async function syncPlaylistsToGist(token: string, playlists: Playlist[]): Promise<void> {
  try {
    const gists = await listGists(token);
    const legacy = findFileGist(gists, LEGACY_PLAYLIST_FILENAME);
    await writeOrUpdate(token, legacy, {
      [LEGACY_PLAYLIST_FILENAME]: { content: JSON.stringify(playlists, null, 2) },
    });
  } catch (error) {
    console.error("Error syncing playlists to GitHub Gist:", error);
  }
}