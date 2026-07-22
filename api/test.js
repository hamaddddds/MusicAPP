import ytdl from '@distube/ytdl-core';

async function test() {
  try {
    const info = await ytdl.getInfo('RiDw1x-EJnA');
    const format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio' });
    console.log("SUCCESS:", format.url);
  } catch (e) {
    console.error("ERROR:", e);
  }
}

test();
