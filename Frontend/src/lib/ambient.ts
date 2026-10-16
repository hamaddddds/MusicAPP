export type RGB = [number, number, number];

/** Colours the ambient theme lifts from the playing song's cover. */
export interface Palette {
  /** Readable on the dark UI: active nav, sliders, play buttons. */
  accent: RGB;
  /** The light the cover throws: the bloom behind the player. */
  glow: RGB;
  /** A deep version of the cover's average colour that tints the glass panels. */
  base: RGB;
}

type HSL = [number, number, number];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function rgbToHsl([r, g, b]: RGB): HSL {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

export function hslToRgb([h, s, l]: HSL): RGB {
  if (!s) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const channel = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map(v => Math.round(v * 255)) as RGB;
}

export const cssRgb = ([r, g, b]: RGB) => `rgb(${r} ${g} ${b})`;

const NEUTRAL_ACCENT: RGB = [232, 232, 236];
const HUE_BINS = 24;
/** A hue must cover this share of the cover to colour the UI; less is a stray detail. */
const MIN_SHARE = 0.04;

/**
 * Picks the cover's colours from RGBA pixels (a small downscaled copy is plenty).
 * Vivid pixels are grouped by hue; the hue with the most (saturation-weighted) area wins,
 * so a grey sleeve with an orange title lights up orange, but a few stray pixels do not.
 */
export function extractPalette(pixels: ArrayLike<number>): Palette | null {
  const bins = Array.from({ length: HUE_BINS }, () => ({ h: 0, s: 0, l: 0, n: 0 }));
  let r = 0, g = 0, b = 0, total = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 125) continue;
    const rgb: RGB = [pixels[i], pixels[i + 1], pixels[i + 2]];
    r += rgb[0]; g += rgb[1]; b += rgb[2]; total++;
    const [h, s, l] = rgbToHsl(rgb);
    // Greys, near-black and near-white say nothing about the cover's colour.
    if (s < 0.2 || l < 0.12 || l > 0.9) continue;
    const bin = bins[Math.min(HUE_BINS - 1, Math.floor(h * HUE_BINS))];
    bin.h += h; bin.s += s; bin.l += l; bin.n++;
  }
  if (!total) return null;

  let best: (typeof bins)[number] | null = null, bestScore = 0;
  for (const bin of bins) {
    if (bin.n / total < MIN_SHARE) continue;
    const score = bin.n * (bin.s / bin.n);
    if (score > bestScore) { bestScore = score; best = bin; }
  }

  const [bh, bs, bl] = rgbToHsl([r / total, g / total, b / total]);
  const base = hslToRgb([bh, Math.min(bs, 0.55), clamp(bl * 0.6, 0.07, 0.16)]);
  if (!best) {
    // Black-and-white artwork: stay neutral instead of inventing a hue.
    return { accent: NEUTRAL_ACCENT, glow: hslToRgb([bh, Math.min(bs, 0.12), clamp(bl, 0.42, 0.6)]), base };
  }
  const h = best.h / best.n, s = best.s / best.n, l = best.l / best.n;
  return {
    accent: hslToRgb([h, clamp(s, 0.45, 0.85), clamp(l, 0.62, 0.74)]),
    glow: hslToRgb([h, clamp(s, 0.5, 0.95), clamp(l, 0.45, 0.6)]),
    base,
  };
}
