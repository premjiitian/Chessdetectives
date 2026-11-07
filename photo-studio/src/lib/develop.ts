/**
 * The develop pipeline — the same order Lightroom's Basic panel uses:
 *   white balance → exposure → tone (contrast, highlights, shadows, whites, blacks)
 *   → presence (clarity, vibrance, saturation) → detail (sharpening).
 *
 * Pure functions on RGBA pixel arrays, so they run the same in the browser,
 * in a Web Worker and in unit tests. Nothing here touches the network.
 */

/** Slider values use Lightroom's ranges: -100…100 (exposure in stops, -5…5). */
export interface Settings {
  temp: number;
  tint: number;
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  clarity: number;
  vibrance: number;
  saturation: number;
  sharpening: number; // 0…100
}

export const NEUTRAL: Settings = {
  temp: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0,
  whites: 0, blacks: 0, clarity: 0, vibrance: 0, saturation: 0, sharpening: 0,
};

export const RANGES: Record<keyof Settings, [number, number]> = {
  temp: [-100, 100], tint: [-100, 100], exposure: [-5, 5], contrast: [-100, 100],
  highlights: [-100, 100], shadows: [-100, 100], whites: [-100, 100], blacks: [-100, 100],
  clarity: [-100, 100], vibrance: [-100, 100], saturation: [-100, 100], sharpening: [0, 100],
};

export function clampSettings(s: Settings): Settings {
  const out = { ...s };
  for (const k of Object.keys(RANGES) as (keyof Settings)[]) {
    const [lo, hi] = RANGES[k];
    out[k] = Math.min(hi, Math.max(lo, Number.isFinite(out[k]) ? out[k] : 0));
  }
  return out;
}

// ---------- colour helpers ----------

export const srgbToLinear = (v: number) =>
  v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
export const linearToSrgb = (v: number) =>
  v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;

const TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) TO_LINEAR[i] = srgbToLinear(i / 255);

/** Encode linear values 0…4 (exposure can push past 1) through a LUT. */
const ENC_MAX = 4;
const ENC_N = 8192;
const TO_SRGB = new Float32Array(ENC_N + 1);
for (let i = 0; i <= ENC_N; i++) {
  const x = (i / ENC_N) * ENC_MAX;
  TO_SRGB[i] = x <= 1 ? linearToSrgb(x) : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}
function encode(x: number): number {
  if (x <= 0) return 0;
  const f = (x / ENC_MAX) * ENC_N;
  return f >= ENC_N ? TO_SRGB[ENC_N] : TO_SRGB[f | 0];
}

/** Perceived brightness of sRGB-encoded values (Rec.709 weights). */
export const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// ---------- white balance ----------

/** Channel gains for a temp/tint pair, normalised so brightness is kept. */
export function wbGains(temp: number, tint: number): [number, number, number] {
  const t = temp / 100, m = tint / 100;
  let r = Math.exp(0.35 * t), g = Math.exp(-0.3 * m), b = Math.exp(-0.35 * t);
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  r /= y; g /= y; b /= y;
  return [r, g, b];
}

// ---------- tone curve ----------

const smooth = (x: number) => x * x * (3 - 2 * x);

/**
 * Global tone curve on perceived brightness L (0…~1.6 before the shoulder).
 * Every term is monotonic for sliders in range, so the curve never inverts.
 */
export function toneCurve(L: number, s: Settings): number {
  const x = preShoulder(L, s);
  // Soft shoulder only when Exposure pushes real light past white: bright skies
  // roll off gently instead of clipping. (Whites + is a deliberate clip, like
  // Lightroom, and a neutral edit stays exact.)
  if (s.exposure <= 0) return Math.min(1, x);
  const lmax = 1.055 * Math.pow(Math.pow(2, s.exposure), 1 / 2.4) - 0.055;
  const over = preShoulder(Math.min(1.6, lmax), { ...s, whites: Math.min(0, s.whites) }) - 1;
  if (over <= 0) return Math.min(1, x);
  const k = 1 - 0.12 * Math.min(1, over / 0.3);
  if (x <= k) return x;
  return k + (1 - k) * (1 - Math.exp(-(x - k) / (1 - k)));
}

function preShoulder(L: number, s: Settings): number {
  // whites / blacks: move the end points (levels)
  const bp = -(s.blacks / 100) * 0.25;
  const wp = 1 - (s.whites / 100) * 0.3;
  let x = (L - bp) / (wp - bp);
  if (x < 0) x = 0;
  // shadows / highlights: lift or pull only their own end of the range.
  // Strengths are capped so the curve can never reverse (see tests).
  const xc = Math.min(1, x);
  const sh = s.shadows / 100, hl = s.highlights / 100;
  x += sh * (sh > 0 ? 1.5 : 0.9) * xc * (1 - xc) ** 3;
  x += hl * (hl < 0 ? 1.5 : 0.9) * xc ** 3 * (1 - xc);
  if (hl < 0 && x > 1) x = 1 + (x - 1) * (1 + hl / 2);
  // contrast: S-curve around the midpoint
  const c = (s.contrast / 100) * 0.7;
  if (x <= 1) x = x + c * (smooth(x) - x);
  return x < 0 ? 0 : x;
}

// ---------- blur (for clarity + sharpening) ----------

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  if (r < 1) { out.set(src); return out; }
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[row + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * inv;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += tmp[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc * inv;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}
/** Three box passes ≈ a Gaussian blur. */
export function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const rr = Math.max(1, Math.round(r / 1.7));
  return boxBlur(boxBlur(boxBlur(src, w, h, rr), w, h, rr), w, h, rr);
}

// ---------- the pipeline ----------

/** Apply settings to RGBA pixels (sRGB, 8-bit). Returns a new array. */
export function develop(src: Uint8ClampedArray, w: number, h: number, input: Settings): Uint8ClampedArray {
  const s = clampSettings(input);
  const n = w * h;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), L = new Float32Array(n);
  const [gr, gg, gb] = wbGains(s.temp, s.tint);
  const ev = Math.pow(2, s.exposure);
  const kr = gr * ev, kg = gg * ev, kb = gb * ev;

  // tone curve as a lookup table over L ∈ [0, 1.6]
  const TN = 4096, TMAX = 1.6;
  const tone = new Float32Array(TN + 1);
  for (let i = 0; i <= TN; i++) tone[i] = toneCurve((i / TN) * TMAX, s);

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = encode(TO_LINEAR[src[p]] * kr);
    const g = encode(TO_LINEAR[src[p + 1]] * kg);
    const b = encode(TO_LINEAR[src[p + 2]] * kb);
    const l = luma(r, g, b);
    const idx = Math.min(TN, ((l / TMAX) * TN) | 0);
    const l2 = tone[idx];
    // keep colour (chroma) and move brightness; scale shadows a little so lifted
    // shadows keep their colour rather than turning grey
    const scale = l > 1e-4 ? Math.min(2, Math.max(0.5, l2 / l)) : 1;
    const mix = 0.5;
    const cr = (r - l) * (mix * scale + (1 - mix)), cg = (g - l) * (mix * scale + (1 - mix)), cb = (b - l) * (mix * scale + (1 - mix));
    R[i] = cr; G[i] = cg; B[i] = cb; L[i] = l2;
  }

  // clarity: local contrast in the midtones (radius ≈ 1.5 % of the long side)
  if (s.clarity !== 0) {
    const rad = Math.max(2, Math.round(Math.max(w, h) * 0.015));
    const base = blur(L, w, h, rad);
    const amt = (s.clarity / 100) * 0.8;
    for (let i = 0; i < n; i++) {
      const l = L[i];
      const mid = 4 * l * (1 - l); // strongest in midtones, none at black/white
      L[i] = l + amt * (l - base[i]) * Math.max(0, mid);
    }
  }

  // sharpening: small-radius unsharp mask, only on edges (masking)
  if (s.sharpening > 0) {
    const base = blur(L, w, h, 1);
    const amt = (s.sharpening / 100) * 1.2;
    for (let i = 0; i < n; i++) {
      const d = L[i] - base[i];
      const edge = Math.min(1, Math.abs(d) * 40); // ignore flat areas (keeps noise down)
      L[i] += amt * d * edge;
    }
  }

  const vib = s.vibrance / 100, sat = s.saturation / 100;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    let l = L[i];
    if (l < 0) l = 0; else if (l > 1) l = 1;
    let cr = R[i], cg = G[i], cb = B[i];
    // vibrance boosts dull colours more than strong ones, and protects skin
    const chroma = Math.max(cr, cg, cb) - Math.min(cr, cg, cb);
    const r0 = cr + l, g0 = cg + l, b0 = cb + l;
    const skin = r0 > g0 && g0 > b0 && (r0 - b0) > 0.08 && (r0 - b0) < 0.45 ? 0.5 : 1;
    let f = 1 + sat + vib * skin * (1 - Math.min(1, chroma * 2.2));
    if (f < 0) f = 0;
    cr *= f; cg *= f; cb *= f;
    // fit into gamut by reducing colour, never by shifting brightness
    let k = 1;
    const mx = Math.max(cr, cg, cb), mn = Math.min(cr, cg, cb);
    if (l + mx > 1 && mx > 0) k = Math.min(k, (1 - l) / mx);
    if (l + mn < 0 && mn < 0) k = Math.min(k, -l / mn);
    out[p] = (l + cr * k) * 255 + 0.5;
    out[p + 1] = (l + cg * k) * 255 + 0.5;
    out[p + 2] = (l + cb * k) * 255 + 0.5;
    out[p + 3] = src[p + 3];
  }
  return out;
}
