import play from 'play-dl';

async function test() {
  try {
    const stream = await play.stream('RiDw1x-EJnA');
    console.log("SUCCESS:", stream.url);
  } catch (e) {
    console.error("ERROR:", e);
  }
}

test();
