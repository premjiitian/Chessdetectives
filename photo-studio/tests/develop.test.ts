import { describe, it, expect } from 'vitest';
import { develop, NEUTRAL, toneCurve, RANGES, type Settings } from '../src/lib/develop';
import { scene, meanDiff, metrics } from '../src/lib/quality';

const img = scene();
const run = (s: Partial<Settings>) => develop(img.data, img.w, img.h, { ...NEUTRAL, ...s });
const avg = (d: Uint8ClampedArray, c: number) => { let s = 0; for (let p = c; p < d.length; p += 4) s += d[p]; return s / (d.length / 4); };

describe('develop pipeline', () => {
  it('neutral settings leave the photo unchanged', () => {
    expect(meanDiff(run({}), img.data)).toBeLessThan(1 / 255);
  });

  it('tone curve never inverts (monotonic) at any slider extreme', () => {
    const keys = ['contrast', 'highlights', 'shadows', 'whites', 'blacks'] as const;
    for (const k of keys) for (const v of [RANGES[k][0], RANGES[k][1]]) {
      let prev = -1;
      for (let L = 0; L <= 1.6; L += 0.002) {
        const y = toneCurve(L, { ...NEUTRAL, [k]: v });
        expect(y, `${k}=${v} at L=${L.toFixed(3)}`).toBeGreaterThanOrEqual(prev - 1e-6);
        prev = y;
      }
    }
  });

  it('each slider moves the photo the way its name says', () => {
    const base = metrics(img).median;
    expect(metrics({ ...img, data: run({ exposure: 1 }) }).median).toBeGreaterThan(base + 0.1);
    expect(metrics({ ...img, data: run({ exposure: -1 }) }).median).toBeLessThan(base - 0.1);
    const warm = run({ temp: 50 });
    expect(avg(warm, 0) - avg(warm, 2)).toBeGreaterThan(avg(img.data, 0) - avg(img.data, 2) + 10);
    const mono = run({ saturation: -100 });
    for (let p = 0; p < mono.length; p += 400) {
      expect(Math.abs(mono[p] - mono[p + 1])).toBeLessThanOrEqual(1);
      expect(Math.abs(mono[p + 1] - mono[p + 2])).toBeLessThanOrEqual(1);
    }
  });

  it('pulling highlights reduces clipped pixels on a bright photo', () => {
    const bright = run({ exposure: 1 });
    const pulled = run({ exposure: 1, highlights: -80 });
    expect(metrics({ ...img, data: pulled }).clippedHi).toBeLessThan(metrics({ ...img, data: bright }).clippedHi);
  });

  it('survives garbage settings without NaN pixels', () => {
    const out = run({ exposure: NaN, contrast: 1e9, temp: -Infinity });
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });
});
