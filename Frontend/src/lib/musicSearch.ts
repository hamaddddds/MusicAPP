type SearchItem = {
  resultType?: string;
  videoType?: string;
  videoId?: string;
  browseId?: string;
  title?: string;
  artist?: string;
  name?: string;
  artists?: { name?: string }[];
};

const normalize = (value: string) => value.trim().normalize('NFKC').toLocaleLowerCase();

export function selectMusicResults(query: string, songResults: unknown, artistResults: unknown) {
  const seen = new Set<string>();
  const songs: SearchItem[] = (Array.isArray(songResults) ? songResults : []).filter(item => {
    if (!item || item.resultType !== 'song' || !item.videoId ||
      (item.videoType && item.videoType !== 'MUSIC_VIDEO_TYPE_ATV') || seen.has(item.videoId)) return false;
    seen.add(item.videoId);
    return true;
  });
  const artist = (Array.isArray(artistResults) ? artistResults : []).find(item =>
    item?.resultType === 'artist' && item.browseId &&
    normalize(item.artist || item.name || item.title || item.artists?.[0]?.name || '') === normalize(query));
  return { topResult: artist || songs[0] || null, songs };
}

export async function searchMusic(apiUrl: string, query: string, fetcher = fetch) {
  const load = async (filter: string) => {
    const response = await fetcher(`${apiUrl}/search?q=${encodeURIComponent(query.trim())}&filter=${filter}`);
    if (!response.ok) throw new Error('Music search failed');
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Invalid search results');
    return data;
  };
  // Artist discovery is optional; an unavailable artist endpoint must not hide songs.
  const [songs, artists] = await Promise.all([load('songs'), load('artists').catch(() => [])]);
  return selectMusicResults(query, songs, artists);
}
