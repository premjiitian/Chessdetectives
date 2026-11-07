/**
 * Keep the photo's camera details (date taken, camera, lens) when saving, so the
 * edited copy sorts next to the original in Photos. Browsers drop all metadata
 * when they re-encode a JPEG; we copy the original's EXIF block back in.
 *
 *  - Orientation is reset to "normal" (the pixels are already rotated).
 *  - Location (GPS) is wiped unless the user chooses to keep it.
 *  - The embedded thumbnail (an unedited preview) is dropped.
 */

const SOI = 0xffd8, APP1 = 0xffe1;

/** Find the EXIF APP1 segment in a JPEG. Returns a copy, or null. */
export function readExif(jpeg: Uint8Array): Uint8Array | null {
  if (jpeg.length < 4 || ((jpeg[0] << 8) | jpeg[1]) !== SOI) return null;
  let p = 2;
  while (p + 4 <= jpeg.length) {
    if (jpeg[p] !== 0xff) return null;
    const marker = (jpeg[p] << 8) | jpeg[p + 1];
    if (marker === 0xffda || marker === 0xffd9) return null; // image data starts: no EXIF
    const len = (jpeg[p + 2] << 8) | jpeg[p + 3];
    if (len < 2 || p + 2 + len > jpeg.length) return null;
    if (marker === APP1 && len > 8 && String.fromCharCode(...jpeg.subarray(p + 4, p + 10)) === 'Exif\0\0') {
      return jpeg.slice(p, p + 2 + len);
    }
    p += 2 + len;
  }
  return null;
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/** Edit an APP1 segment in place: orientation → 1, optionally wipe GPS, drop thumbnail. */
export function cleanExif(seg: Uint8Array, keepLocation: boolean): Uint8Array {
  const out = seg.slice();
  const t = 10; // TIFF header starts after FFE1 + length + "Exif\0\0"
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  if (t + 8 > out.length) return out;
  const le = out[t] === 0x49; // "II" little-endian, "MM" big-endian
  const u16 = (o: number) => view.getUint16(t + o, le);
  const u32 = (o: number) => view.getUint32(t + o, le);
  const inside = (o: number, n: number) => o >= 0 && t + o + n <= out.length;
  const ifd0 = u32(4);
  if (!inside(ifd0, 2)) return out;
  const count = u16(ifd0);
  if (!inside(ifd0 + 2, count * 12 + 4)) return out;
  for (let i = 0; i < count; i++) {
    const e = ifd0 + 2 + i * 12;
    const tag = u16(e);
    if (tag === 0x0112) view.setUint16(t + e + 8, 1, le); // orientation: normal
    if (tag === 0x8825 && !keepLocation) wipeIfd(u32(e + 8));
  }
  view.setUint32(t + ifd0 + 2 + count * 12, 0, le); // no thumbnail IFD
  return out;

  function wipeIfd(off: number) {
    if (!inside(off, 2)) return;
    const n = u16(off);
    if (!inside(off + 2, n * 12)) return;
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      const size = (TYPE_SIZE[u16(e + 2)] ?? 1) * u32(e + 4);
      if (size > 4) { const vo = u32(e + 8); if (inside(vo, size)) out.fill(0, t + vo, t + vo + size); }
    }
    out.fill(0, t + off + 2, t + off + 2 + n * 12);
    view.setUint16(t + off, 0, le); // empty GPS block
  }
}

/** Insert an APP1 segment right after the start-of-image marker. */
export function insertExif(jpeg: Uint8Array, seg: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(jpeg.length + seg.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(seg, 2);
  out.set(jpeg.subarray(2), 2 + seg.length);
  return out;
}
