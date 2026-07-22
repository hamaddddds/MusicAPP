import fetch from 'node-fetch';

async function testCobalt() {
  try {
    const res = await fetch('https://cobalt.wukko.me/api/json', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: 'https://www.youtube.com/watch?v=RiDw1x-EJnA',
        isAudioOnly: true
      })
    });
    const data = await res.json();
    console.log(data);
  } catch (e) {
    console.error(e);
  }
}
testCobalt();
