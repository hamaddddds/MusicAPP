import https from 'https';

const instances = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.smnz.de',
  'https://pipedapi.drgns.space',
  'https://api.piped.yt',
  'https://pipedapi.tokhmi.xyz',
  'https://pipedapi.ytmous.com',
  'https://piped-api.garudalinux.org',
  'https://pipedapi.ngn.tf',
  'https://pipedapi.moomoo.me',
  'https://pipedapi.lunar.icu'
];

async function testInstances() {
  for (const instance of instances) {
    try {
      const url = `${instance}/streams/RiDw1x-EJnA`;
      console.log(`Testing ${url}`);
      
      const res = await new Promise((resolve, reject) => {
        const req = https.get(url, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const json = JSON.parse(data);
                if (json.audioStreams && json.audioStreams.length > 0) {
                  resolve(true);
                } else {
                  resolve(false);
                }
              } catch(e) { resolve(false); }
            } else {
              resolve(false);
            }
          });
        });
        req.on('error', reject);
        req.setTimeout(3000, () => { req.abort(); resolve(false); });
      });
      
      if (res) {
        console.log(`✅ SUCCESS: ${instance}`);
      } else {
        console.log(`❌ FAILED: ${instance}`);
      }
    } catch (e) {
      console.log(`❌ FAILED (error): ${instance}`);
    }
  }
}

testInstances();
