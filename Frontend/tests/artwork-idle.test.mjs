import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function loadModule(path, overrides = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const scope = { exports: {}, require: createRequire(import.meta.url), ...overrides };
  vm.runInNewContext(code, scope);
  return scope.exports;
}

const { pickArtwork, videoArtwork, sanitizeStoredArtwork, ARTWORK_PLACEHOLDER } = loadModule('../src/lib/artwork.ts');
const thumbs = [{ url: 'https://yt3.googleusercontent.com/album=w60-h60-l90-rj', width: 60 }, { url: 'https://yt3.googleusercontent.com/album=w544-h544-l90-rj', width: 544 }];

test('search, autoplay queue and song details resolve the SAME song cover', () => {
  const cover = pickArtwork({ thumbnails: thumbs }, 'songA');
  assert.equal(pickArtwork({ thumbnail: thumbs }, 'songA'), cover);
  assert.equal(pickArtwork({ thumbnail: { thumbnails: thumbs } }, 'songA'), cover);
  assert.equal(pickArtwork(thumbs.slice().reverse(), 'songA'), cover);
});

test('missing/malformed thumbnails use the exact video ID, never a random photo', () => {
  for (const input of [null, {}, { thumbnail: {} }, [null], [{ url: '' }], [{ url: 'https://picsum.photos/300' }]]) {
    assert.equal(pickArtwork(input, 'songB'), 'https://i.ytimg.com/vi/songB/hqdefault.jpg');
  }
  assert.equal(pickArtwork([]), ARTWORK_PLACEHOLDER);
  assert.notEqual(videoArtwork('songA'), videoArtwork('songB'));
});

test('old saved queues, playlists and history repair random images without losing other state', () => {
  const source = { queue: [{ videoId: 'songA', artwork: 'https://picsum.photos/300', count: 7 }], history: { songB: { videoId: 'songB', artwork: thumbs[0].url } }, name: 'My playlist' };
  const restored = sanitizeStoredArtwork(source);
  assert.equal(restored.queue[0].artwork, videoArtwork('songA'));
  assert.equal(restored.queue[0].count, 7);
  assert.equal(restored.history.songB.artwork, thumbs[0].url);
  assert.equal(restored.name, source.name);
  assert.equal(source.queue[0].artwork, 'https://picsum.photos/300');
});

test('hero goes idle at 5 minutes, activity wakes it, and cleanup removes timers/listeners', () => {
  let now = 0, nextId = 0, state, cleanup;
  const timers = new Map(), listeners = new Map();
  const clock = {
    setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { at: now + delay, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  function tick(ms) {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
  }
  const { useIdle, HERO_IDLE_MS } = loadModule('../src/lib/useIdle.ts', {
    ...clock,
    require: () => ({ useState: initial => { state = initial; return [state, v => { state = v; }]; }, useEffect: effect => { cleanup = effect(); } }),
    window: { addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) },
  });
  assert.equal(HERO_IDLE_MS, 300000);
  useIdle();
  tick(299999); assert.equal(state, false);
  tick(1); assert.equal(state, true);
  for (const event of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) {
    listeners.get(event)(); assert.equal(state, false);
    tick(299999); assert.equal(state, false);
    tick(1); assert.equal(state, true);
  }
  listeners.get('keydown')();
  cleanup(); assert.equal(timers.size, 0); assert.equal(listeners.size, 0);
});
