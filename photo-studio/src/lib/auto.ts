/**
 * Auto edit: reads the photo and chooses Basic-panel settings the way a careful
 * Lightroom editor would. Each step follows a common best practice:
 *
 *  1. White balance first — neutralise colour casts using near-grey areas,
 *     but only partly, so sunsets and candle-light keep their mood.
 *  2. Exposure — bring the middle of the photo to a comfortable brightness.
 *  3. Highlights down / shadows up — recover sky and shade detail.
 *  4. Whites & blacks — set the true white and black points
 *     (Lightroom's "Shift + double-click"), with a tiny bit of clipping allowed.
 *  5. Contrast only if the photo is flat; a little clarity for texture.
 *  6. Vibrance rather than saturation — it protects skin and strong colours.
 *  7. Light sharpening last.
 *
 * Every decision is also returned as a plain-English reason for the UI.
 */
import { NEUTRAL, type Settings, srgbToLinear, linearToSrgb, wbGains, toneCurve, luma, clampSettings } from './develop';

export interface Analysis {
  medianL: number;
  p005: number; p05: number; p95: number; p995: number;
  clippedHi: number; // share of pixels near white
  crushedLo: number; // share of pixels near black
  meanChroma: number;
  skinShare: number;
  cast: [number, number, number]; // average linear RGB of near-grey pixels
}

export interface AutoResult { settings: Settings; reasons: string[]; analysis: Analysis }

/** Downsample to at most `max` pixels on the long side for fast analysis. */
export function sample(src: Uint8ClampedArray, w: number, h: number, max = 400) {
  const step = Math.max(1, Math.ceil(Math.max(w, h) / max));
  const out: number[] = [];
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const p = (y * w + x) * 4;
    out.push(src[p], src[p + 1], src[p + 2]);
  }
  return Float32Array.from(out, (v) => v / 255);
}

function percentile(sorted: Float32Array, q: number) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
}

/** Statistics after applying white balance + exposure (so later steps see the corrected photo). */
export function analyze(px: Float32Array, temp = 0, tint = 0, exposure = 0): Analysis {
  const n = px.length / 3;
  const [gr, gg, gb] = wbGains(temp, tint);
  const ev = Math.pow(2, exposure);
  const Ls = new Float32Array(n);
  let chromaSum = 0, skin = 0, hi = 0, lo = 0;
  const greys: { c: number; r: number; g: number; b: number }[] = [];
  for (let i = 0; i < n; i++) {
    const rl = srgbToLinear(px[3 * i]) * gr * ev, gl = srgbToLinear(px[3 * i + 1]) * gg * ev, bl = srgbToLinear(px[3 * i + 2]) * gb * ev;
    const r = linearToSrgb(Math.min(1, rl)), g = linearToSrgb(Math.min(1, gl)), b = linearToSrgb(Math.min(1, bl));
    const l = luma(r, g, b);
    Ls[i] = l;
    const c = Math.max(r, g, b) - Math.min(r, g, b);
    chromaSum += c;
    if (l > 0.97) hi++;
    if (l < 0.02) lo++;
    if (r > g && g > b && r - b > 0.08 && r - b < 0.45 && l > 0.2 && l < 0.85) skin++;
    if (l > 0.12 && l < 0.9) greys.push({ c: c / (l + 0.05), r: rl, g: gl, b: bl });
  }
  Ls.sort();
  // near-grey = the least colourful 30 % of mid-tone pixels
  greys.sort((a, b) => a.c - b.c);
  const take = greys.slice(0, Math.max(1, Math.floor(greys.length * 0.3)));
  const cast: [number, number, number] = [0, 0, 0];
  for (const g of take) { cast[0] += g.r; cast[1] += g.g; cast[2] += g.b; }
  for (let k = 0; k < 3; k++) cast[k] /= take.length || 1;
  return {
    medianL: percentile(Ls, 0.5), p005: percentile(Ls, 0.005), p05: percentile(Ls, 0.05),
    p95: percentile(Ls, 0.95), p995: percentile(Ls, 0.995),
    clippedHi: hi / n, crushedLo: lo / n, meanChroma: chromaSum / n, skinShare: skin / n, cast,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Find x in [lo,hi] so that f(x) ≈ target, for monotonic f. */
function solve(f: (x: number) => number, target: number, lo: number, hi: number, increasing: boolean) {
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if ((f(mid) < target) === increasing) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Grey-pixel white balance. For each candidate temp/tint, count mid-tone pixels
 * that become neutral; pick the winner (ties go to the smaller correction).
 * Confidence = share of grey pixels: few greys (sunset, forest) → gentler fix.
 */
export function findWhiteBalance(px: Float32Array): { temp: number; tint: number; confidence: number } | null {
  const n = px.length / 3;
  const step = Math.max(1, Math.floor(n / 12000));
  const pts: number[] = [];
  for (let i = 0; i < n; i += step) {
    const r = srgbToLinear(px[3 * i]), g = srgbToLinear(px[3 * i + 1]), b = srgbToLinear(px[3 * i + 2]);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mn < 0.012 || mx > 0.92) continue; // too dark to trust, or clipped
    pts.push(r, g, b);
  }
  const m = pts.length / 3;
  if (m < 50) return null;
  const score = (t: number, ti: number) => {
    const [gr, gg, gb] = wbGains(t * 100, ti * 100);
    let c = 0;
    for (let i = 0; i < pts.length; i += 3) {
      const r = pts[i] * gr, g = pts[i + 1] * gg, b = pts[i + 2] * gb;
      const mean = (r + g + b) / 3;
      const dev = Math.max(Math.abs(r - g), Math.abs(b - g)) / mean;
      // soft score: exactly grey counts 1, 8 % off counts 0 — sharp, so it centres well
      if (dev < 0.08) { const w = 1 - dev / 0.08; c += w * w; }
    }
    return c - (Math.abs(t) + Math.abs(ti)) * m * 0.004; // prefer smaller fixes
  };
  let best = { t: 0, ti: 0, v: score(0, 0) };
  const search = (t0: number, ti0: number, span: number, stp: number) => {
    for (let t = t0 - span; t <= t0 + span + 1e-9; t += stp)
      for (let ti = ti0 - span * 0.6; ti <= ti0 + span * 0.6 + 1e-9; ti += stp) {
        if (Math.abs(t) > 1 || Math.abs(ti) > 0.6) continue;
        const v = score(t, ti);
        if (v > best.v) best = { t, ti, v };
      }
  };
  search(0, 0, 1, 0.08);
  search(best.t, best.ti, 0.1, 0.02);
  const greyShare = Math.max(0, best.v) / m;
  // confident (≥ 12 % grey pixels) → near-full fix; unsure → gentle
  const strength = 0.3 + 0.65 * Math.min(1, greyShare / 0.12);
  return {
    temp: clamp(Math.round(best.t * 100 * strength), -100, 100),
    tint: clamp(Math.round(best.ti * 100 * strength), -60, 60),
    confidence: greyShare,
  };
}

export function autoSettings(px: Float32Array): AutoResult {
  const reasons: string[] = [];
  const s: Settings = { ...NEUTRAL };
  const a0 = analyze(px);

  // 1. White balance: try many corrections, keep the one that makes the most
  //    pixels truly grey. (Plain "average = grey" is fooled by blue skies.)
  const wb = findWhiteBalance(px);
  if (wb) {
    s.temp = wb.temp; s.tint = wb.tint;
    if (Math.abs(s.temp) >= 8) reasons.push(s.temp > 0 ? 'Warmed the colours — the photo had a blue cast.' : 'Cooled the colours — the photo had a yellow/orange cast.');
    if (Math.abs(s.tint) >= 8) reasons.push(s.tint > 0 ? 'Removed a green tint.' : 'Removed a magenta tint.');
  }

  // 2–4. Exposure, then highlights/shadows, then white & black points.
  //      Tone steps change brightness too, so we predict the final mid-tone
  //      and correct exposure (twice at most) to land in a comfortable band.
  const a1 = analyze(px, s.temp, s.tint);
  const band = (m: number) => (m < 0.4 ? 0.44 : m > 0.64 ? 0.6 : m);
  const evFor = (from: number, to: number) => Math.log2(srgbToLinear(to) / Math.max(1e-4, srgbToLinear(from)));
  let ev = evFor(a1.medianL, band(a1.medianL));
  if (ev > 0 && a1.p995 > 0.9) ev *= 0.7; // low-key on purpose: gentler lift
  const alreadyWhite = a0.p995 > 0.97 || a0.clippedHi > 0.005; // never push burnt highlights back up
  const curveAt = (L: number, over: Partial<Settings> = {}) => toneCurve(L, { ...s, ...over });
  let a2 = a1;
  for (let iter = 0; iter < 3; iter++) {
    s.exposure = Math.round(clamp(ev, -2, 2.5) * 100) / 100;
    if (Math.abs(s.exposure) < 0.08) s.exposure = 0;
    a2 = analyze(px, s.temp, s.tint, s.exposure);
    s.highlights = 0; s.shadows = 0; s.whites = 0; s.blacks = 0;
    if (a2.p95 > 0.82 || a2.clippedHi > 0.005)
      s.highlights = -Math.round(clamp(20 + (a2.p95 - 0.82) * 250 + a2.clippedHi * 1500, 15, 70));
    if (a2.p05 < 0.12) s.shadows = Math.round(clamp(15 + (0.12 - a2.p05) * 300, 10, 60));
    if (a2.p995 - a2.p005 > 0.05) {
      let w = solve((x) => curveAt(a2.p995, { whites: x }), 0.96, -80, 80, true);
      if (alreadyWhite) w = Math.min(0, w);
      if (s.exposure < 0) w = Math.min(w, 25); // don't darken, then brighten again
      s.whites = Math.round(clamp(w, -80, 80));
      s.blacks = Math.round(clamp(solve((x) => curveAt(a2.p005, { blacks: x }), 0.03, -80, 80, true), -80, 80));
    }
    // only correct exposure if the finished photo would leave the comfortable band
    const predicted = curveAt(a2.medianL);
    const want = band(predicted);
    if (Math.abs(predicted - want) < 0.015) break;
    ev += evFor(predicted, want) * 0.9;
  }
  if (s.exposure >= 0.15) reasons.push(`Brightened by ${s.exposure.toFixed(1)} stops — the photo was dark.`);
  if (s.exposure <= -0.15) reasons.push(`Darkened by ${(-s.exposure).toFixed(1)} stops — the photo was too bright.`);
  if (s.highlights < 0) reasons.push('Pulled down bright areas to bring back detail in the sky and highlights.');
  if (s.shadows > 0) reasons.push('Lifted the shadows so dark areas show detail.');
  if (s.whites >= 15 || s.blacks <= -15) reasons.push('Set the true white and black points so the photo has full range.');

  // 5. Contrast for flat photos; clarity for texture (less on faces)
  const spread = curveAt(a2.p95) - curveAt(a2.p05);
  s.contrast = Math.round(clamp((0.72 - spread) * 120, 0, 35));
  if (s.contrast >= 12) reasons.push('Added contrast — the photo looked flat.');
  const portrait = a2.skinShare > 0.12;
  s.clarity = portrait ? 5 : 15;

  // 6. Vibrance, not saturation (protects skin)
  s.vibrance = Math.round(clamp((0.2 - a2.meanChroma) * 200, 0, portrait ? 15 : 35));
  if (s.vibrance >= 10) reasons.push('Gave dull colours more life with Vibrance (skin tones protected).');
  if (portrait) reasons.push('Found skin tones — used gentle clarity so skin stays soft.');

  // 7. Sharpening last, gentle
  s.sharpening = portrait ? 20 : 30;

  if (reasons.length === 0) reasons.push('This photo was already well balanced — only light polish was added.');
  return { settings: clampSettings(s), reasons, analysis: a2 };
}

/** Blend between "no edit" and the auto edit: 0 = original, 1 = auto, 1.5 = stronger. */
export function scaleSettings(s: Settings, amount: number): Settings {
  const out = { ...s };
  for (const k of Object.keys(out) as (keyof Settings)[]) out[k] = s[k] * amount;
  return clampSettings(out);
}
