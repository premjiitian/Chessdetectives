/**
 * Output-quality checks for Auto edit. The pass marks were set before tuning:
 *  - a broken photo must get at least 40 % closer to the good original after
 *    the same Auto edit (consistency: the light polish Auto adds to every photo
 *    is not counted as an error),
 *  - its middle brightness must come back close to the original's (±0.07),
 *    and never outside 0.35–0.68 (the original is sky-heavy: 0.60),
 *  - grey must look grey again (cast ≤ 0.04),
 *  - no more than 2 % of pixels blown out or crushed,
 *  - a photo that is already good must change by less than 4 % (do no harm).
 */
import { describe, it, expect } from 'vitest';
import { develop } from '../src/lib/develop';
import { autoSettings, sample } from '../src/lib/auto';
import { scene, degrade, meanDiff, metrics, type Img } from '../src/lib/quality';

const good = scene();
const auto = (img: Img) => {
  const { settings, reasons } = autoSettings(sample(img.data, img.w, img.h));
  return { out: { ...img, data: develop(img.data, img.w, img.h, settings) }, settings, reasons };
};

describe('auto edit — do no harm', () => {
  it('barely changes a well-exposed photo', () => {
    const { out } = auto(good);
    expect(meanDiff(out.data, good.data)).toBeLessThan(0.04);
  });
});

const goodAuto = auto(good).out.data;
const cases = ['dark', 'bright', 'blue', 'warm', 'flat', 'dark+blue'] as const;
describe.each(cases)('auto edit fixes a %s photo', (kind) => {
  const bad = degrade(good, kind);
  const { out, reasons } = auto(bad);
  const m = metrics(out);
  const before = meanDiff(bad.data, goodAuto), after = meanDiff(out.data, goodAuto);

  it('ends up at least 40 % closer to the good photo (same Auto edit)', () => {
    expect(after, `before ${before.toFixed(3)} after ${after.toFixed(3)}`).toBeLessThan(before * 0.6);
  });
  it('lands at a comfortable brightness, close to the original', () => {
    expect(Math.abs(m.median - metrics(good).median)).toBeLessThan(0.07);
    expect(m.median).toBeGreaterThan(0.35);
    expect(m.median).toBeLessThan(0.68);
  });
  it('makes grey look grey', () => { expect(m.greyCast).toBeLessThan(0.04); });
  it('does not blow out or crush the photo', () => {
    expect(m.clippedHi).toBeLessThan(0.02);
    expect(m.crushedLo).toBeLessThan(0.02);
  });
  it('explains what it did in plain words', () => {
    expect(reasons.length).toBeGreaterThan(0);
    for (const r of reasons) expect(r.split(' ').length).toBeLessThan(20);
    // truthful: Auto measures colour and light; it cannot see faces, so it must not claim to
    for (const r of reasons) expect(r).not.toMatch(/portrait|face|person|people/i);
  });
});
