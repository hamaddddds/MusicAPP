export function getTopPlayedIds(n = 3) {
  try {
    const raw = localStorage.getItem("mv:history");
    if (!raw) return [];
    
    const history = JSON.parse(raw);
    
    // Convert to array and sort by count descending
    const sorted = Object.values(history).sort((a: any, b: any) => {
      // If counts are equal, sort by last played (most recent first)
      if (b.count === a.count) {
        return (b.last || 0) - (a.last || 0);
      }
      return b.count - a.count;
    });
    
    return sorted.slice(0, n).map((item: any) => item.videoId);
  } catch (e) {
    console.error("Error reading play history:", e);
    return [];
  }
}

export function clearPlayHistory() {
  localStorage.removeItem("mv:history");
}
