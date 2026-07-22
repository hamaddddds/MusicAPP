const YTMusic = require("ytmusic-api");

module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { query, action } = req.query;

  try {
    const ytmusic = new YTMusic.default();
    await ytmusic.initialize();
    
    if (action === 'search') {
      const results = await ytmusic.search(query || "New releases");
      res.status(200).json(results);
    } else if (action === 'home') {
      // Simulate fetching charts/home feed by searching a generic popular term
      const results = await ytmusic.search("Top hits 2024");
      // Filter out non-songs if possible, but search returns mixed (songs, videos)
      res.status(200).json(results);
    } else {
      res.status(200).json({ message: "Vercel API running for MusicAPP. Use ?action=search&query=..." });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
