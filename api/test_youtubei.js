import { Innertube, UniversalCache } from 'youtubei.js';
import util from 'util';

async function test() {
  const yt = await Innertube.create({ cache: new UniversalCache(false) });
  
  const info = await yt.getBasicInfo('RiDw1x-EJnA');
  const format = info.chooseFormat({ type: 'audio', quality: 'best' });
  console.log(util.inspect(format, { depth: null, colors: true }));
}

test();
