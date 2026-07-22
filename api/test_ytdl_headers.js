import ytdl from '@distube/ytdl-core';
import https from 'https';

async function test() {
  try {
    const info = await ytdl.getInfo('RiDw1x-EJnA');
    const format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio' });
    console.log("Extracted URL:", format.url);
    
    // Now request it
    const req = https.get(format.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, (res) => {
      console.log("Status Code:", res.statusCode);
      if (res.statusCode === 200) console.log("SUCCESS! Audio stream works.");
    });
    req.on('error', console.error);
  } catch (e) {
    console.error("ERROR:", e);
  }
}

test();
