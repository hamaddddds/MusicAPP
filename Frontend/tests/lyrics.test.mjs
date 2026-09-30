import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('');
Object.assign(globalThis, { DOMParser: window.DOMParser, Node: window.Node, Element: window.Element });
const source = await readFile(new URL('../src/lib/lyrics.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { parseTimestamp, parseTTML, normalizeLyrics, activeLineAt, fetchLyrics } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div>
<p begin="1.5" end="4"><span begin="1.5" end="2">Sun</span><span begin="2" end="2.5">rise</span> <span begin="2.5" end="4">again</span><span ttm:role="x-bg">(again)</span></p>
<p begin="00:05.000" end="00:07.000">Line timing only</p>
<p begin="bad">Invalid</p></div></body></tt>`;

test('TTML accepts clocks and explicit units; rejects missing or invalid timestamps', () => {
  assert.equal(parseTimestamp('1:02.350'), 62.35);
  assert.equal(parseTimestamp('01:02:03.5'), 3723.5);
  assert.equal(parseTimestamp('1250ms'), 1.25);
  assert.equal(parseTimestamp('1.25s'), 1.25);
  assert.ok(Number.isNaN(parseTimestamp(null)));
  assert.ok(Number.isNaN(parseTimestamp('nonsense')));
});

test('preserves syllable spacing, real timing and secondary vocals', () => {
  const lyrics = parseTTML(ttml);
  assert.equal(lyrics.synced.length, 2);
  assert.equal(lyrics.synced[0].text, 'Sunrise again');
  assert.equal(lyrics.synced[0].parts.map(p => p.text).join(''), 'Sunrise again');
  assert.equal(lyrics.synced[0].parts[1].t, 2);
  assert.equal(lyrics.synced[0].parts[1].d, .5);
  assert.equal(lyrics.synced[0].background, '(again)');
  assert.deepEqual(lyrics.synced[1].parts, []);
  assert.throws(() => parseTTML('<tt><broken>'));
});

test('active line follows exact audio time and backward seeks without forced lead', () => {
  const { synced } = parseTTML(ttml);
  assert.equal(activeLineAt(synced, 1.499), -1);
  assert.equal(activeLineAt(synced, 1.5), 0);
  assert.equal(activeLineAt(synced, 4.999), 0);
  assert.equal(activeLineAt(synced, 5), 1);
  assert.equal(activeLineAt(synced, 2), 0);
  assert.equal(activeLineAt([], 100), -1);
});

test('legacy fallback retains line timing without inventing word timing', () => {
  const data = normalizeLyrics({ synced: '[00:05.2]Next\n[00:01.050][00:03.500]Again' });
  assert.deepEqual(data.synced.map(l => l.t), [1.05, 3.5, 5.2]);
  assert.ok(data.synced.every(l => l.parts.length === 0));
  assert.equal(normalizeLyrics({ lines: [{ t: null }, { t: NaN }, { t: 1, text: 'Valid', parts: [] }] }).synced.length, 1);
});

test('Better Lyrics requests matching metadata and caches successful results', async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async url => { calls.push(String(url)); return Response.json({ ttml }); };
  try {
    const track = { videoId: 'test-success', title: 'Sunrise & Moon', artist: 'Test Artist' };
    const lyrics = await fetchLyrics(track, 'http://localhost:8000', new AbortController().signal, 201.4);
    assert.equal(lyrics.source, 'Better Lyrics');
    const query = new URL(calls[0]).searchParams;
    assert.equal(new URL(calls[0]).pathname, '/lyrics/better');
    assert.equal(query.get('title'), track.title);
    assert.equal(query.get('artist'), track.artist);
    assert.equal(query.get('duration'), '201');
    await fetchLyrics(track, 'http://localhost:8000', new AbortController().signal, 201.4);
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = original; }
});

test('provider failures and low-confidence results fall back with honest attribution', async () => {
  const original = globalThis.fetch;
  try {
    for (const [id, reply] of [['401', new Response('', { status: 401 })], ['match', Response.json({ ttml, score: .3 })]]) {
      let count = 0;
      globalThis.fetch = async () => ++count === 1 ? reply : Response.json({ lines: [{ t: 3, text: 'Fallback', parts: [] }] });
      const result = await fetchLyrics({ videoId: id, title: 'Test', artist: 'Artist' }, 'http://localhost:8000', new AbortController().signal);
      assert.equal(result.source, 'YouTube Music');
      assert.equal(result.synced[0].text, 'Fallback');
      assert.match(result.notice, /Better Lyrics unavailable/);
    }
  } finally { globalThis.fetch = original; }
});

test('cancelled track requests never fall back to the previous song', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async () => { calls++; controller.abort(); throw new DOMException('Aborted', 'AbortError'); };
  try {
    await assert.rejects(fetchLyrics({ videoId: 'cancel', title: 'Test', artist: 'Artist' }, 'http://localhost:8000', controller.signal), { name: 'AbortError' });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
