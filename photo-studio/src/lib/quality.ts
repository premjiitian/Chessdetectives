/**
 * Test photos with known problems, and ways to measure whether an edit fixed them.
 * Used by unit tests and the improvement loop's scorecard.
 */
import { srgbToLinear, linearToSrgb, luma } from './develop';

export interface Img { data: Uint8ClampedArray; w: number; h: number }

function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

/**
 * A well-exposed "scene": blue sky gradient, grey card ramp, skin, foliage,
 * red object, deep shade and a bright cloud, with fine texture.
 */
export function scene(w = 240, h = 160, seed = 7): Img {
  const rand = rng(seed);
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h;
    let r: number, g: number, b: number;
    if (v < 0.35) { // sky, brighter near horizon, with a cloud
      r = 0.45 + v * 0.6; g = 0.62 + v * 0.5; b = 0.88;
      const cd = Math.hypot(u - 0.7, v - 0.15);
      if (cd < 0.12) { const k = 1 - cd / 0.12; r += (0.97 - r) * k; g += (0.97 - g) * k; b += (0.98 - b) * k; }
    } else if (v < 0.5) { // grey ramp: black → white
      r = g = b = 0.04 + u * 0.92;
    } else if (u < 0.33) { // skin
      r = 0.85; g = 0.64; b = 0.52;
      if (v > 0.8) { r = 0.2; g = 0.16; b = 0.14; } // hair / shade
    } else if (u < 0.66) { // foliage with deep shade
      r = 0.28; g = 0.48; b = 0.2;
      if (v > 0.82) { r = 0.06; g = 0.08; b = 0.05; }
    } else { // red object on a mid-grey wall
      r = 0.5; g = 0.5; b = 0.5;
      if (Math.hypot(u - 0.83, v - 0.72) < 0.1) { r = 0.78; g = 0.16; b = 0.14; }
    }
    const tex = (rand() - 0.5) * 0.04 + Math.sin(x * 0.9) * 0.01;
    const p = (y * w + x) * 4;
    d[p] = (r + tex) * 255; d[p + 1] = (g + tex) * 255; d[p + 2] = (b + tex) * 255; d[p + 3] = 255;
  }
  return { data: d, w, h };
}

/** Degrade a photo in a way cameras and phones really do. */
export function degrade(img: Img, kind: 'dark' | 'bright' | 'blue' | 'warm' | 'flat' | 'dark+blue'): Img {
  const d = new Uint8ClampedArray(img.data.length);
  for (let p = 0; p < d.length; p += 4) {
    let rgb = [img.data[p], img.data[p + 1], img.data[p + 2]].map((v) => srgbToLinear(v / 255));
    const k = (m: number[]) => { rgb = rgb.map((v, i) => v * m[i]); };
    if (kind === 'dark' || kind === 'dark+blue') k([0.33, 0.33, 0.33]);      // −1.6 stops
    if (kind === 'bright') k([1.55, 1.55, 1.55]);                           // +0.6 stops
    if (kind === 'blue' || kind === 'dark+blue') k([0.78, 0.95, 1.25]);     // shade / LED cast
    if (kind === 'warm') k([1.22, 1.0, 0.72]);                              // tungsten cast
    let enc = rgb.map((v) => linearToSrgb(Math.min(1, v)));
    if (kind === 'flat') enc = enc.map((v) => 0.22 + v * 0.55);             // haze / low contrast
    d[p] = enc[0] * 255 + 0.5; d[p + 1] = enc[1] * 255 + 0.5; d[p + 2] = enc[2] * 255 + 0.5; d[p + 3] = 255;
  }
  return { data: d, w: img.w, h: img.h };
}

/** Average difference from a reference, 0 (identical) … 1. */
export function meanDiff(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let s = 0, n = 0;
  for (let p = 0; p < a.length; p += 4) { for (let c = 0; c < 3; c++) s += Math.abs(a[p + c] - b[p + c]); n += 3; }
  return s / n / 255;
}

export interface Metrics { median: number; clippedHi: number; crushedLo: number; greyCast: number }

/** Simple measurements a photo editor checks by eye with the histogram. */
export function metrics(img: Img): Metrics {
  const n = img.w * img.h, Ls = new Float32Array(n);
  let hi = 0, lo = 0, castR = 0, castB = 0, castG = 0, greys = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = img.data[p] / 255, g = img.data[p + 1] / 255, b = img.data[p + 2] / 255;
    const l = luma(r, g, b); Ls[i] = l;
    if (Math.max(r, g, b) >= 0.995) hi++;
    if (Math.max(r, g, b) <= 0.005) lo++;
    // the grey-ramp band in our scene (rows 35 %–50 %)
    const y = Math.floor(i / img.w) / img.h;
    if (y > 0.37 && y < 0.48 && l > 0.15 && l < 0.85) { castR += r; castG += g; castB += b; greys++; }
  }
  Ls.sort();
  const gc = greys ? Math.max(Math.abs(castR - castG), Math.abs(castB - castG), Math.abs(castR - castB)) / greys : 0;
  return { median: Ls[n >> 1], clippedHi: hi / n, crushedLo: lo / n, greyCast: gc };
}
