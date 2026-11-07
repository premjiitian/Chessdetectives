/// <reference lib="webworker" />
// Heavy pixel work runs here so the screen stays smooth. Nothing leaves the device.
import { develop, type Settings } from './lib/develop';
import { autoSettings, sample } from './lib/auto';

export type Job =
  | { id: number; kind: 'develop'; w: number; h: number; buf: ArrayBuffer; settings: Settings }
  | { id: number; kind: 'auto'; w: number; h: number; buf: ArrayBuffer };

self.onmessage = (ev: MessageEvent<Job>) => {
  const job = ev.data;
  try {
    const px = new Uint8ClampedArray(job.buf);
    if (job.kind === 'auto') {
      const r = autoSettings(sample(px, job.w, job.h));
      (self as unknown as Worker).postMessage({ id: job.id, ok: true, auto: { settings: r.settings, reasons: r.reasons } });
    } else {
      const out = develop(px, job.w, job.h, job.settings);
      (self as unknown as Worker).postMessage({ id: job.id, ok: true, buf: out.buffer }, [out.buffer]);
    }
  } catch (e) {
    (self as unknown as Worker).postMessage({ id: job.id, ok: false, error: String(e) });
  }
};
