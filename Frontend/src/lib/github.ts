const GIST_FILENAME = "musicvenue-subscriptions.json";
const GIST_DESCRIPTION = "Music Venue Subscriptions (Do not delete)";

export interface SubscribedArtist {
  artistId: string;
  name: string;
  thumbnails: any[];
}

export async function fetchSubscriptionsFromGist(token: string): Promise<SubscribedArtist[]> {
  try {
    const res = await fetch("https://api.github.com/gists", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error("Failed to fetch gists");
    const gists = await res.json();
    
    // Find our specific gist
    const ourGist = gists.find((g: any) => g.files && g.files[GIST_FILENAME]);
    if (!ourGist) return [];
    
    // Fetch gist content
    const fileRes = await fetch(ourGist.files[GIST_FILENAME].raw_url);
    if (!fileRes.ok) throw new Error("Failed to fetch gist content");
    
    const data = await fileRes.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("Error fetching subscriptions from GitHub Gist:", error);
    return [];
  }
}

export async function syncSubscriptionsToGist(token: string, subscriptions: SubscribedArtist[]): Promise<void> {
  try {
    const res = await fetch("https://api.github.com/gists", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error("Failed to fetch gists");
    const gists = await res.json();
    
    let ourGist = gists.find((g: any) => g.files && g.files[GIST_FILENAME]);
    const content = JSON.stringify(subscriptions, null, 2);
    
    if (ourGist) {
      // Update existing gist
      await fetch(`https://api.github.com/gists/${ourGist.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github.v3+json"
        },
        body: JSON.stringify({
          files: { [GIST_FILENAME]: { content } }
        })
      });
    } else {
      // Create new gist
      await fetch("https://api.github.com/gists", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github.v3+json"
        },
        body: JSON.stringify({
          description: GIST_DESCRIPTION,
          public: false,
          files: { [GIST_FILENAME]: { content } }
        })
      });
    }
  } catch (error) {
    console.error("Error syncing subscriptions to GitHub Gist:", error);
  }
}
