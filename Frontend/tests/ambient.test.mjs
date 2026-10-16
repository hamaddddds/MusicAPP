import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../src/lib/ambient.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const scope = { exports: {} };
vm.runInNewContext(code, scope);
const { extractPalette, rgbToHsl, hslToRgb, cssRgb } = scope.exports;

/** RGBA pixels: `count` copies of each [r, g, b] (alpha defaults to opaque). */
function pixels(...runs) {
  const out = [];
  for (const [[r, g, b, a = 255], count] of runs) for (let i = 0; i < count; i++) out.push(r, g, b, a);
  return out;
}

test('hsl conversion round-trips', () => {
  for (const rgb of [[250, 36, 60], [12, 200, 90], [40, 40, 40], [255, 255, 255]]) {
    assert.deepEqual([...hslToRgb(rgbToHsl(rgb))], rgb);
  }
});

test('a transparent cover has no palette', () => {
  assert.equal(extractPalette(pixels([[255, 0, 0, 0], 50])), null);
});

const isNeutral = (rgb) => rgbToHsl(rgb)[1] < 0.1;

test('black-and-white artwork keeps a neutral accent', () => {
  const { accent } = extractPalette(pixels([[20, 20, 20], 60], [[200, 200, 200], 40]));
  assert.ok(isNeutral(accent));
});

test('a vivid title on a grey sleeve wins the accent', () => {
  const { accent, glow } = extractPalette(pixels([[110, 112, 118], 90], [[240, 120, 20], 10]));
  const [h, s] = rgbToHsl(accent);
  assert.ok(h > 0.04 && h < 0.12, `expected an orange hue, got ${h}`);
  assert.ok(s >= 0.45);
  assert.ok(rgbToHsl(glow)[0] > 0.04 && rgbToHsl(glow)[0] < 0.12);
});

test('a few stray pixels do not colour a grey cover', () => {
  const { accent } = extractPalette(pixels([[110, 112, 118], 98], [[240, 120, 20], 2]));
  assert.ok(isNeutral(accent));
});

test('the bigger vivid area beats a smaller, slightly more saturated one', () => {
  const { accent } = extractPalette(pixels([[30, 90, 200], 60], [[250, 20, 40], 15], [[10, 10, 10], 25]));
  const [h] = rgbToHsl(accent);
  assert.ok(h > 0.55 && h < 0.7, `expected blue, got ${h}`);
});

test('the accent stays readable on the dark UI however dark the cover is', () => {
  const { accent, base } = extractPalette(pixels([[100, 8, 22], 80], [[5, 5, 5], 20]));
  const [, , l] = rgbToHsl(accent);
  assert.ok(l >= 0.6 && l <= 0.75, `accent lightness ${l}`);
  assert.ok(rgbToHsl(base)[2] <= 0.17, 'panels tint stays deep');
});

test('cssRgb formats space-separated rgb()', () => {
  assert.equal(cssRgb([1, 2, 3]), 'rgb(1 2 3)');
});
