import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const { window } = new JSDOM('<div id="root"></div><audio></audio>', { url: 'http://localhost' });
let nextFrame = 0;
const frames = new Map();
Object.assign(globalThis, {
  window, document: window.document, Element: window.Element, Node: window.Node,
  DOMParser: window.DOMParser, IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class { observe() {} disconnect() {} },
  requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
  cancelAnimationFrame: id => frames.delete(id),
});
window.matchMedia = () => ({ matches: false });
window.HTMLElement.prototype.scrollTo = function ({ top }) { this.scrollTop = top; };
const toModule = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const lyricsModule = toModule(compile(await readFile(new URL('../src/lib/lyrics.ts', import.meta.url), 'utf8')));
const componentSource = compile(await readFile(new URL('../src/components/SyncedLyrics.tsx', import.meta.url), 'utf8'))
  .replaceAll('"react"', JSON.stringify(import.meta.resolve('react')))
  .replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve('react/jsx-runtime')))
  .replaceAll('"lucide-react"', JSON.stringify(toModule('export const Mic2 = () => null; export const RefreshCw = () => null;')))
  .replaceAll('"../lib/lyrics"', JSON.stringify(lyricsModule));
const { default: SyncedLyrics } = await import(toModule(componentSource));
const audio = document.querySelector('audio');
let paused = true;
Object.defineProperties(audio, { paused: { get: () => paused }, duration: { get: () => 30 }, readyState: { get: () => 4 } });
const audioRef = { current: audio };
const lyrics = { source: 'Better Lyrics', plain: '', synced: [
  { t: 1, end: 5, text: 'First line', parts: [{ t: 1, d: 4, text: 'First line' }] },
  { t: 6, end: 10, text: 'Second line', parts: [{ t: 6, d: 4, text: 'Second line' }] },
] };
let root = createRoot(document.getElementById('root'));
const render = offset => act(() => root.render(React.createElement(SyncedLyrics, { lyrics, loading: false, audioRef, offset })));
const event = type => act(() => audio.dispatchEvent(new window.Event(type)));
const frame = () => act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); });
const active = () => document.querySelector('.lyric-line.is-active');
after(async () => { await act(() => root.unmount()); window.close(); });

test('pause/resume and seeking repaint words without waiting for a new line', async () => {
  audio.currentTime = 2;
  await render(0);
  assert.equal(active().textContent, 'First line');
  assert.equal(active().querySelector('.lyric-word').style.getPropertyValue('--word-progress'), '25%');
  paused = false;
  await event('play');
  audio.currentTime = 3;
  await frame();
  assert.equal(active().querySelector('.lyric-word').style.getPropertyValue('--word-progress'), '50%');
  paused = true;
  await event('pause');
  assert.equal(frames.size, 0);
  paused = false;
  await event('play');
  audio.currentTime = 4;
  await frame();
  assert.equal(active().querySelector('.lyric-word').style.getPropertyValue('--word-progress'), '75%');
  audio.currentTime = 7;
  await event('seeked');
  assert.equal(active().textContent, 'Second line');
  audio.currentTime = 0;
  await event('seeked');
  assert.equal(active(), null);
});

test('offset, tap-to-seek and reopening use the same audio clock', async () => {
  paused = true;
  audio.currentTime = 5;
  await render(1);
  assert.equal(active().textContent, 'Second line');
  await act(() => document.querySelector('.lyric-line').click());
  assert.equal(audio.currentTime, 0); // timestamp 1 minus offset 1
  audio.currentTime = 7;
  await act(() => root.unmount());
  assert.equal(frames.size, 0);
  root = createRoot(document.getElementById('root'));
  await render(0);
  assert.equal(active().textContent, 'Second line');
});
