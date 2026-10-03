import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../src/lib/musicSearch.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const scope = { exports: {} };
vm.runInNewContext(code, scope);
const { selectMusicResults, searchMusic } = scope.exports;
const song = { resultType: 'song', videoType: 'MUSIC_VIDEO_TYPE_ATV', videoId: 'audio', title: 'All Too Well' };

test('short films and music videos cannot become the top result or enter Songs', () => {
  const results = selectMusicResults('all to well', [
    { resultType: 'video', category: 'Top result', videoId: 'film', title: 'All Too Well: The Short Film' },
    { ...song, videoId: 'music-video', videoType: 'MUSIC_VIDEO_TYPE_OMV' },
    null, song, song, { ...song, videoId: 'ten-minute-version' },
  ], []);
  assert.equal(results.topResult, song);
  assert.equal(results.songs.length, 2);
  assert.equal(results.songs[1].videoId, 'ten-minute-version');
});

test('exact artist searches preserve the artist header; song searches keep the first song', () => {
  const artist = { resultType: 'artist', artist: 'Taylor Swift', browseId: 'artist-id' };
  assert.equal(selectMusicResults(' Taylor Swift ', [song], [artist]).topResult, artist);
  assert.equal(selectMusicResults('all to well', [song], [artist]).topResult, song);
  assert.equal(selectMusicResults('unknown', null, {}).topResult, null);
});

test('requests use music filters and still return songs if artist lookup fails', async () => {
  const requests = [];
  const result = await searchMusic('http://localhost:8000', 'All & Well', async url => {
    requests.push(new URL(url));
    if (url.endsWith('artists')) throw new Error('offline');
    return { ok: true, json: async () => [song] };
  });
  assert.equal(result.topResult.videoId, 'audio');
  assert.equal(requests.map(url => url.searchParams.get('filter')).join(','), 'songs,artists');
  assert.ok(requests.every(url => url.searchParams.get('q') === 'All & Well'));
});

test('song endpoint errors are surfaced instead of falling back to video search', async () => {
  await assert.rejects(searchMusic('', 'song', async () => ({ ok: false })), /Music search failed/);
});
