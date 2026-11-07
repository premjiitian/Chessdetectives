import './style.css';
import { NEUTRAL, RANGES, clampSettings, type Settings } from './lib/develop';
import { scaleSettings } from './lib/auto';
import { LOOKS, applyLook } from './lib/looks';
import { readExif, cleanExif, insertExif } from './lib/exif';

// ---------- tiny DOM helper (text is always set as text, never as HTML) ----------
type Attrs = Record<string, string | number | boolean | ((e: any) => void)>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | false)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v as EventListener);
    else if (v === false) continue;
    else if (k in el && k !== 'list' && typeof v !== 'string') (el as any)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const k of kids) if (k !== null && k !== false) el.append(k);
  return el;
}

// ---------- worker ----------
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
let nextId = 1;
const pending = new Map<number, (m: any) => void>();
worker.onmessage = (e) => { const cb = pending.get(e.data.id); pending.delete(e.data.id); cb?.(e.data); };
function call(job: any, transfer: Transferable[] = []): Promise<any> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, (m) => (m.ok ? resolve(m) : reject(new Error(m.error))));
    worker.postMessage({ ...job, id }, transfer);
  });
}

// ---------- state ----------
interface Photo {
  id: number; file: File; name: string;
  w: number; h: number; preview: Uint8ClampedArray; // small copy for fast editing
  auto: Settings; reasons: string[];
  look: string; amount: number; manual: Partial<Settings>;
  thumb: string; // object URL of a small JPEG for the strip
}
const photos: Photo[] = [];
let current = -1;
let comparing = false;
let keepLocation = false;
const PREVIEW_MAX = 1400;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const MAX_SAVE_PIXELS = isIOS ? 16_000_000 : 48_000_000; // iPhone/iPad Safari canvas limit

const main = document.getElementById('main')!;
const status = document.getElementById('status')!;
let sayTimer = 0;
const say = (msg: string, stay = false) => {
  status.textContent = msg;
  clearTimeout(sayTimer);
  if (!stay) sayTimer = window.setTimeout(() => (status.textContent = ''), 5000);
};

function finalSettings(p: Photo): Settings {
  const look = LOOKS.find((l) => l.id === p.look) ?? LOOKS[0];
  return clampSettings({ ...applyLook(scaleSettings(p.auto, p.amount), look), ...p.manual });
}

// ---------- loading ----------
async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  } catch {
    // Some browsers can't read HEIC/RAW. Safari on iPhone converts to JPEG automatically.
    throw new Error(`Couldn't open “${file.name}”. Try a JPEG or PNG (on iPhone, pick from Photos — it converts automatically).`);
  }
}

function toPixels(bmp: ImageBitmap, maxSide: number, maxPixels = Infinity) {
  let scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  scale = Math.min(scale, Math.sqrt(maxPixels / (bmp.width * bmp.height)));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  return { w, h, data: ctx.getImageData(0, 0, w, h).data, canvas: c, scaled: scale < 1 };
}

async function addFiles(files: FileList | File[]) {
  const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp|avif)$/i.test(f.name));
  if (!list.length) { say('Those files are not photos.'); return; }
  let added = 0;
  for (const [i, file] of list.entries()) {
    say(`Reading photo ${i + 1} of ${list.length}…`, true);
    try {
      const bmp = await decode(file);
      const px = toPixels(bmp, PREVIEW_MAX);
      const thumbC = toPixels(bmp, 160).canvas;
      bmp.close();
      const thumb = URL.createObjectURL(await new Promise<Blob>((r) => thumbC.toBlob((b) => r(b!), 'image/jpeg', 0.8)));
      const copy = px.data.slice();
      const res = await call({ kind: 'auto', w: px.w, h: px.h, buf: copy.buffer }, [copy.buffer]);
      photos.push({
        id: nextId++, file, name: file.name, w: px.w, h: px.h, preview: px.data,
        auto: res.auto.settings, reasons: res.auto.reasons, look: 'natural', amount: 1, manual: {}, thumb,
      });
      added++;
    } catch (e) { say((e as Error).message); }
  }
  if (added) {
    if (current < 0) current = photos.length - added;
    render();
    say(added === 1 ? 'Auto edit applied. Hold the photo to see the original.' : `${added} photos auto-edited.`);
  }
}

// ---------- preview rendering (latest request wins) ----------
let drawing = false, again = false;
async function drawPreview() {
  if (drawing) { again = true; return; }
  const p = photos[current]; if (!p) return;
  const canvas = document.getElementById('view') as HTMLCanvasElement | null; if (!canvas) return;
  drawing = true;
  try {
    let out: Uint8ClampedArray;
    if (comparing) out = p.preview;
    else {
      const copy = p.preview.slice();
      const res = await call({ kind: 'develop', w: p.w, h: p.h, buf: copy.buffer, settings: finalSettings(p) }, [copy.buffer]);
      out = new Uint8ClampedArray(res.buf);
    }
    if (photos[current] === p) {
      canvas.width = p.w; canvas.height = p.h;
      canvas.getContext('2d')!.putImageData(new ImageData(out as Uint8ClampedArray<ArrayBuffer>, p.w, p.h), 0, 0);
      canvas.dataset.state = comparing ? 'original' : 'edited';
    }
  } finally {
    drawing = false;
    if (again) { again = false; drawPreview(); }
  }
}

// ---------- saving (full resolution, stays on device) ----------
async function exportPhoto(p: Photo): Promise<File> {
  const bmp = await decode(p.file);
  const px = toPixels(bmp, Infinity, MAX_SAVE_PIXELS);
  bmp.close();
  const res = await call({ kind: 'develop', w: px.w, h: px.h, buf: px.data.buffer, settings: finalSettings(p) }, [px.data.buffer]);
  const ctx = px.canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(res.buf), px.w, px.h), 0, 0);
  const blob = await new Promise<Blob | null>((r) => px.canvas.toBlob(r, 'image/jpeg', 0.92));
  px.canvas.width = px.canvas.height = 0; // free memory on phones
  if (!blob) throw new Error('This photo is too large for this browser to save.');
  let bytes: Uint8Array = new Uint8Array(await blob.arrayBuffer());
  if (/jpe?g$/i.test(p.file.type) || /\.jpe?g$/i.test(p.name)) {
    const exif = readExif(new Uint8Array(await p.file.slice(0, 256 * 1024).arrayBuffer()));
    if (exif) bytes = insertExif(bytes, cleanExif(exif, keepLocation));
  }
  const base = p.name.replace(/\.[^.]+$/, '') || 'photo';
  return new File([bytes as Uint8Array<ArrayBuffer>], `${base}-edited.jpg`, { type: 'image/jpeg', lastModified: p.file.lastModified });
}

async function save(list: Photo[]) {
  const btns = [...document.querySelectorAll<HTMLButtonElement>('[data-save]')];
  btns.forEach((b) => (b.disabled = true));
  try {
    const files: File[] = [];
    for (const [i, p] of list.entries()) { say(`Preparing photo ${i + 1} of ${list.length} at full quality…`, true); files.push(await exportPhoto(p)); }
    // iPhone / iPad: the share sheet offers “Save Image” straight to Photos — no cloud involved.
    if (navigator.canShare?.({ files }) && (isIOS || matchMedia('(pointer: coarse)').matches)) {
      try { await navigator.share({ files }); say('Saved. Choose “Save Image” to put it in Photos.'); return; }
      catch (e) { if ((e as Error).name === 'AbortError') { say('Saving cancelled.'); return; } }
    }
    for (const f of files) {
      const a = h('a', { href: URL.createObjectURL(f), download: f.name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
    }
    say(files.length === 1 ? `Saved “${files[0].name}” to your Downloads.` : `Saved ${files.length} photos to your Downloads.`);
  } catch (e) {
    say((e as Error).message);
  } finally { btns.forEach((b) => (b.disabled = false)); }
}

// ---------- screens ----------
function picker(label: string, primary = true) {
  const input = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'visually-hidden', id: `pick-${nextId++}`,
    onchange: (e: Event) => { const t = e.target as HTMLInputElement; if (t.files) addFiles(t.files); t.value = ''; } });
  return h('label', { class: primary ? 'btn primary big' : 'btn', for: input.id }, input, label);
}

function renderEmpty() {
  main.replaceChildren(
    h('section', { class: 'empty', 'aria-labelledby': 'empty-title' },
      h('h2', { id: 'empty-title' }, 'Make your photos look their best — in one tap'),
      h('p', {}, 'Choose photos from your iPhone, iPad or computer. Auto edit fixes brightness, colour and detail the way a professional editor would, and tells you what it changed.'),
      picker('Choose photos'),
      h('p', { class: 'hint' }, 'Or drag photos here. Works offline — try Airplane Mode.'),
      h('ul', { class: 'how' },
        h('li', {}, h('strong', {}, '1 · Open'), ' your photos'),
        h('li', {}, h('strong', {}, '2 · Auto edit'), ' happens instantly — adjust if you like'),
        h('li', {}, h('strong', {}, '3 · Save'), ' back to Photos or your computer'),
      ),
    ),
  );
}

function slider(p: Photo, key: keyof Settings, label: string) {
  const [lo, hi] = RANGES[key];
  const step = key === 'exposure' ? 0.05 : 1;
  const val = finalSettings(p)[key];
  const id = `s-${key}`;
  const out = h('output', { for: id, id: `${id}-out` }, fmt(key, val));
  const input = h('input', { type: 'range', id, min: lo, max: hi, step, value: String(val),
    oninput: (e: Event) => {
      const v = Number((e.target as HTMLInputElement).value);
      p.manual[key] = v; out.textContent = fmt(key, v); drawPreview();
    },
    ondblclick: () => { delete p.manual[key]; render(); } });
  return h('div', { class: 'slider' }, h('label', { for: id }, label), out, input);
}
const fmt = (k: keyof Settings, v: number) => (k === 'exposure' ? `${v > 0 ? '+' : ''}${v.toFixed(2)}` : `${v > 0 ? '+' : ''}${Math.round(v)}`);

function renderEditor() {
  const p = photos[current];
  const canvas = h('canvas', { id: 'view', class: 'view', role: 'img', 'aria-label': `Photo ${p.name}, edited. Hold to see the original.` });
  const setCompare = (on: boolean) => { if (comparing === on) return; comparing = on; compareBtn.setAttribute('aria-pressed', String(on)); compareBtn.textContent = on ? 'Showing original' : 'Compare'; drawPreview(); };
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); setCompare(true); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) canvas.addEventListener(ev, () => setCompare(false));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  const compareBtn = h('button', { class: 'btn', type: 'button', 'aria-pressed': 'false', onclick: () => setCompare(!comparing) }, 'Compare');

  const looks = h('div', { class: 'looks', role: 'radiogroup', 'aria-label': 'Look' },
    ...LOOKS.map((l) => h('button', { type: 'button', role: 'radio', class: 'chip', 'aria-checked': String(p.look === l.id), title: l.hint,
      onclick: () => { p.look = l.id; p.manual = {}; render(); } }, l.name)));

  const amountOut = h('output', { for: 'amount' }, `${Math.round(p.amount * 100)}%`);
  const amount = h('div', { class: 'slider amount' },
    h('label', { for: 'amount' }, 'Auto strength'), amountOut,
    h('input', { type: 'range', id: 'amount', min: 0, max: 1.5, step: 0.05, value: String(p.amount),
      oninput: (e: Event) => { p.amount = Number((e.target as HTMLInputElement).value); amountOut.textContent = `${Math.round(p.amount * 100)}%`; p.manual = {}; drawPreview(); },
      onchange: () => render() }));

  const group = (title: string, items: [keyof Settings, string][], open = false) =>
    h('details', { class: 'group', open }, h('summary', {}, title), ...items.map(([k, l]) => slider(p, k, l)));

  const saveRow = h('div', { class: 'save-row' },
    h('button', { class: 'btn primary', type: 'button', 'data-save': '1', onclick: () => save([p]) }, 'Save photo'),
    photos.length > 1 ? h('button', { class: 'btn', type: 'button', 'data-save': '1', onclick: () => save(photos) }, `Save all ${photos.length}`) : null,
  );

  const loc = h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: keepLocation, onchange: (e: Event) => { keepLocation = (e.target as HTMLInputElement).checked; } }),
    ' Keep location in saved photos');

  main.replaceChildren(
    h('div', { class: 'editor' },
      h('section', { class: 'stage', 'aria-label': 'Photo' },
        h('div', { class: 'frame' }, canvas),
        h('div', { class: 'stage-bar' }, compareBtn, h('span', { class: 'hint' }, 'Tip: hold the photo to see the original')),
        photos.length > 1 ? h('ul', { class: 'strip', 'aria-label': 'Your photos' },
          ...photos.map((q, i) => h('li', {}, h('button', { type: 'button', class: 'thumb', 'aria-current': String(i === current), onclick: () => { current = i; comparing = false; render(); } },
            h('img', { src: q.thumb, alt: q.name }))))) : null,
      ),
      h('section', { class: 'panel', 'aria-label': 'Edit' },
        saveRow,
        h('h2', {}, 'Look'), looks, amount,
        h('details', { class: 'why', open: true }, h('summary', {}, 'What Auto changed'), h('ul', {}, ...p.reasons.map((r) => h('li', {}, r)))),
        h('h2', {}, 'Fine-tune'),
        group('Light', [['exposure', 'Exposure'], ['contrast', 'Contrast'], ['highlights', 'Highlights'], ['shadows', 'Shadows'], ['whites', 'Whites'], ['blacks', 'Blacks']]),
        group('Colour', [['temp', 'Temperature'], ['tint', 'Tint'], ['vibrance', 'Vibrance'], ['saturation', 'Saturation']]),
        group('Detail', [['clarity', 'Clarity'], ['sharpening', 'Sharpening']]),
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: () => { p.manual = {}; p.look = 'natural'; p.amount = 1; render(); say('Back to the Auto edit.'); } }, 'Reset to Auto'),
          h('button', { class: 'btn', type: 'button', onclick: () => { p.manual = { ...NEUTRAL }; render(); say('Showing the photo with no edits.'); } }, 'No edits'),
          picker('Add photos', false)),
        loc,
        h('p', { class: 'hint' }, 'Saved photos keep their date and camera details. Double-click a slider to undo it.'),
      ),
    ),
  );
  drawPreview();
}

function render() { if (current < 0 || !photos[current]) renderEmpty(); else renderEditor(); }

// drag & drop on laptops
addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('drop'); });
addEventListener('dragleave', (e: DragEvent) => { if (!e.relatedTarget) document.body.classList.remove('drop'); });
addEventListener('drop', (e: DragEvent) => { e.preventDefault(); document.body.classList.remove('drop'); if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files); });

render();

// Offline support (production only): the app works with no connection at all.
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('./sw.js').catch(() => {});

// test hook (used by the browser checks)
(window as any).__studio = { photos, finalSettings: () => photos[current] && finalSettings(photos[current]) };
