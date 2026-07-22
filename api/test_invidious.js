import https from 'https';

const url = "https://invidious.jing.rocks/api/v1/videos/RiDw1x-EJnA";
https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      if (json.formatStreams) {
        const audioStreams = json.formatStreams.filter(f => f.type.startsWith('audio'));
        console.log("Audio found:", audioStreams.length > 0);
        console.log("URL:", audioStreams[0].url);
      } else {
        console.log("No formatStreams in Invidious", json);
      }
    } catch(e) {
      console.log(data);
    }
  });
}).on('error', console.error);
