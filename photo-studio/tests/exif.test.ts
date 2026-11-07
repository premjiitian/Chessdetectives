import { describe, it, expect } from 'vitest';
import { readExif, cleanExif, insertExif } from '../src/lib/exif';

/** Build a tiny JPEG-like file with an EXIF block: orientation 6, a GPS block with a latitude. */
function fakeJpeg(le = true) {
  const tiff: number[] = [];
  const w16 = (v: number) => (le ? tiff.push(v & 255, v >> 8) : tiff.push(v >> 8, v & 255));
  const w32 = (v: number) => (le ? tiff.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24) : tiff.push(v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255));
  tiff.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d])); w16(42); w32(8);
  // IFD0 at 8: 2 entries
  w16(2);
  w16(0x0112); w16(3); w32(1); w16(6); w16(0);   // orientation = 6
  w16(0x8825); w16(4); w32(1); w32(38);          // GPS IFD at 38
  w32(64);                                       // next IFD (thumbnail) at 64
  // GPS IFD at 38: 1 entry → one rational (latitude) stored at 56
  w16(1);
  w16(0x0002); w16(5); w32(1); w32(56);
  w32(0);
  w32(51); w32(1);                               // latitude 51/1 at 56
  while (tiff.length < 68) tiff.push(0);
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = payload.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...payload, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
}

describe('EXIF (keep camera details, protect location)', () => {
  for (const le of [true, false]) {
    it(`resets orientation and wipes GPS (${le ? 'little' : 'big'}-endian)`, () => {
      const seg = readExif(fakeJpeg(le))!;
      expect(seg).not.toBeNull();
      const clean = cleanExif(seg, false);
      const v = new DataView(clean.buffer);
      const t = 10;
      expect(v.getUint16(t + 8 + 2 + 8, le)).toBe(1);          // orientation now normal
      expect(v.getUint16(t + 38, le)).toBe(0);                 // GPS block emptied
      expect(v.getUint32(t + 56, le)).toBe(0);                 // latitude bytes zeroed
      expect(v.getUint32(t + 8 + 2 + 24, le)).toBe(0);         // thumbnail dropped
    });
  }
  it('keeps GPS when asked', () => {
    const clean = cleanExif(readExif(fakeJpeg())!, true);
    expect(new DataView(clean.buffer).getUint32(10 + 56, true)).toBe(51);
  });
  it('returns null (no crash) for files without EXIF or broken files', () => {
    expect(readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
    expect(readExif(new Uint8Array([1, 2, 3]))).toBeNull();
    const broken = fakeJpeg(); broken[5] = 255; // length runs past the end
    expect(() => readExif(broken)).not.toThrow();
  });
  it('insertExif puts the block right after the start marker', () => {
    const seg = readExif(fakeJpeg())!;
    const out = insertExif(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), seg);
    expect([out[0], out[1], out[2], out[3]]).toEqual([0xff, 0xd8, 0xff, 0xe1]);
    expect(readExif(out)).not.toBeNull();
  });
});
