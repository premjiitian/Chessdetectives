import { pinKey, pinManifest, pinUrl } from './pin';
// The voice coach: reads coaching out loud with the browser's built-in
// speech engine (free, no account). It picks the most natural-sounding
// English voice your device has and says chess moves the way people do.

const PIECES: Record<string, string> = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight' };

/** "Nxe5+" -> "Knight takes e5, check". */
export function sayMove(san: string): string {
  if (/^O-O-O/.test(san)) return 'castles queenside' + (san.includes('#') ? ', checkmate' : san.includes('+') ? ', check' : '');
  if (/^O-O/.test(san)) return 'castles kingside' + (san.includes('#') ? ', checkmate' : san.includes('+') ? ', check' : '');
  const m = san.match(/^([KQRBN])?([a-h]?[1-8]?)(x)?([a-h][1-8])(=([QRBN]))?([+#])?/);
  if (!m) return san;
  const [, piece, from, takes, to, , promo, check] = m;
  const parts: string[] = [];
  parts.push(piece ? PIECES[piece] : takes && from ? `${from} pawn` : '');
  if (piece && from) parts.push(from);
  if (takes) parts.push('takes');
  parts.push(to);
  if (promo) parts.push(`promotes to ${PIECES[promo]}`);
  if (check === '+') parts.push(', check');
  if (check === '#') parts.push(', checkmate');
  return parts.filter(Boolean).join(' ').replace(' ,', ',');
}

/** Turns a coach message into natural speech. */
export function toSpeech(text: string): string {
  return (
    text
      // 18...Qb6 / 19.Qb3 -> drop move numbers
      .replace(/\b\d+\.(\.\.)?\s?/g, '')
      // Long engine lines and the points legend read badly aloud; they stay on screen.
      .replace(/(Stockfish's main line|A likely continuation|Best line):[^.]*(\.|$)/g, '')
      .replace(/\(pawn = 1[^)]*\)/g, '')
      .replace(/\b(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBN])?[+#]?)(?=[\s.,;:!?)—–-]|$)/g, (s) => sayMove(s))
      .replace(/[★☆]/g, '')
      .replace(/≈/g, 'about ')
      .replace(/%/g, ' percent')
      .replace(/\s+—\s+/g, ', ')
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/\s+([.,!?])/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
}

export interface VoiceSettings {
  enabled: boolean;
  engine: 'pin' | 'natural' | 'device';
  naturalVoice: string;
  voiceURI: string;
  rate: number;
}

/** Free neural voices (Piper, MIT licence) that run inside the browser. */
export const NATURAL_VOICES = [
  { id: 'en_US-hfc_female-medium', label: 'Hannah · US' },
  { id: 'en_US-ryan-medium', label: 'Ryan · US' },
  { id: 'en_GB-alba-medium', label: 'Alba · UK' },
  { id: 'en_GB-northern_english_male-medium', label: 'Arthur · UK' },
] as const;

const KEY = 'voice-settings';
let settings: VoiceSettings = { enabled: false, engine: 'pin', naturalVoice: NATURAL_VOICES[1].id, voiceURI: '', rate: 1 };
try {
  settings = { ...settings, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
} catch {}

export const voiceSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export function getSettings() {
  return settings;
}

export function updateSettings(s: Partial<VoiceSettings>) {
  settings = { ...settings, ...s };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
  if (!settings.enabled) stop();
}

/** English voices, best-sounding first. */
export function voices(): SpeechSynthesisVoice[] {
  if (!voiceSupported()) return [];
  const score = (v: SpeechSynthesisVoice) =>
    (/natural|neural|online/i.test(v.name) ? 100 : 0) +
    (/premium|enhanced/i.test(v.name) ? 60 : 0) +
    (/google/i.test(v.name) ? 40 : 0) +
    (/samantha|daniel|karen|moira|serena|aria|jenny|guy|libby|sonia/i.test(v.name) ? 30 : 0) +
    (v.lang.startsWith('en-') ? 20 : 0) +
    (v.localService ? 0 : 5);
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith('en'))
    .sort((a, b) => score(b) - score(a));
}

function chosenVoice(): SpeechSynthesisVoice | undefined {
  const list = voices();
  return list.find((v) => v.voiceURI === settings.voiceURI) ?? list[0];
}

// ---------- natural (neural) voice ----------
type Piper = typeof import('@diffusionstudio/vits-web');
let piper: Promise<Piper> | null = null;
let naturalReady = false;
let naturalFailed = false;
let downloadPct: number | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

function loadPiper(): Promise<Piper> {
  piper ??= import('@diffusionstudio/vits-web');
  return piper;
}

/** Downloads the chosen natural voice once (then it lives in the browser's storage). */
async function prepareNatural(): Promise<boolean> {
  if (naturalReady) return true;
  if (naturalFailed) return false;
  try {
    const tts = await loadPiper();
    const have = await tts.stored().catch(() => [] as string[]);
    if (!have.includes(settings.naturalVoice as never)) {
      downloadPct = 0;
      notify();
      await tts.download(settings.naturalVoice as never, (p) => {
        if (p.total) downloadPct = Math.round((p.loaded / p.total) * 100);
        notify();
      });
    }
    naturalReady = true;
    downloadPct = null;
    notify();
    return true;
  } catch (e) {
    console.warn('Natural voice unavailable, using device voice', e);
    naturalFailed = true;
    downloadPct = null;
    notify();
    return false;
  }
}

let queue: string[] = [];
let playing = false;
let generation = 0; // bumps on stop() so stale audio is dropped
let current: HTMLAudioElement | null = null;
const audioCache = new Map<string, Promise<Blob>>();

function synth(text: string): Promise<Blob> {
  const key = settings.naturalVoice + '|' + text;
  let p = audioCache.get(key);
  if (!p) {
    p = loadPiper().then((tts) => tts.predict({ text, voiceId: settings.naturalVoice as never }));
    audioCache.set(key, p);
    if (audioCache.size > 80) audioCache.delete(audioCache.keys().next().value!);
  }
  return p;
}

/** Short sentences come back faster, so speech starts sooner. */
export function sentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]*/g)?.map((x) => x.trim()).filter(Boolean) ?? [text];
}

async function pump() {
  if (playing) return;
  playing = true;
  const gen = generation;
  while (queue.length && gen === generation) {
    const text = queue.shift()!;
    const clips = settings.engine === 'pin' ? await pinManifest() : {};
    const clip = clips[pinKey(text)];
    if (queue[0] && !clips[pinKey(queue[0])]) synth(queue[0]); // prepare the next sentence while this one plays
    try {
      const src = clip ? pinUrl(clip) : URL.createObjectURL(await synth(text));
      if (gen !== generation) break;
      await new Promise<void>((resolve) => {
        const a = new Audio(src);
        current = a;
        a.playbackRate = settings.rate;
        a.onended = a.onerror = () => resolve();
        a.play().catch(() => resolve());
      });
    } catch {
      deviceSpeak(text);
    }
  }
  current = null;
  playing = false;
}

function deviceSpeak(spoken: string) {
  if (!voiceSupported()) return;
  const u = new SpeechSynthesisUtterance(spoken);
  const v = chosenVoice();
  if (v) u.voice = v;
  u.lang = v?.lang ?? 'en-US';
  u.rate = settings.rate;
  speechSynthesis.speak(u);
}

/** Speak now (queued after anything already being said). */
export function speak(text: string, force = false) {
  if (!settings.enabled && !force) return;
  const spoken = toSpeech(text);
  if (!spoken) return;
  if (settings.engine !== 'device' && !naturalFailed) {
    if (naturalReady) {
      queue.push(...sentences(spoken));
      pump();
      return;
    }
    // Still downloading: use the device voice meanwhile.
    prepareNatural();
  }
  deviceSpeak(spoken);
}

export function stop() {
  generation++;
  queue = [];
  current?.pause();
  current = null;
  playing = false;
  if (voiceSupported()) speechSynthesis.cancel();
}

/** For tests and the settings panel. */
export function naturalStatus() {
  return { ready: naturalReady, failed: naturalFailed, downloading: downloadPct };
}
export { prepareNatural };

/** The little voice control used on the trainer and sparring pages. */
export function voiceControl(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'voice-ctl';
  const render = () => {
    const list = voices();
    const st = naturalStatus();
    const natural = settings.engine !== 'device';
    const status = !settings.enabled
      ? ''
      : natural && st.downloading !== null
        ? `<span class="sub v-status">⬇ Preparing natural voice… ${st.downloading}% (one time, ≈60 MB)</span>`
        : natural && st.failed
          ? '<span class="sub v-status">Natural voice unavailable here — using your device voice.</span>'
          : natural && st.ready
            ? '<span class="sub v-status">✓ Natural voice ready</span>'
            : '';
    wrap.innerHTML = `
      <button class="btn small ${settings.enabled ? 'primary' : ''}" data-v="toggle" aria-pressed="${settings.enabled}">
        ${settings.enabled ? '🔊 Voice coach on' : '🔈 Voice coach off'}
      </button>
      ${status}
      <details class="voice-more">
        <summary title="Voice settings">⚙︎</summary>
        <label>Type <select data-v="engine">
          <option value="pin" ${settings.engine === 'pin' ? 'selected' : ''}>🕵️ Professor Pin</option>
          <option value="natural" ${settings.engine === 'natural' ? 'selected' : ''}>Natural voice (free, downloads once)</option>
          <option value="device" ${!natural ? 'selected' : ''}>Device voice (instant)</option>
        </select></label>
        <label ${natural ? '' : 'hidden'}>${settings.engine === 'pin' ? 'Other lines' : 'Voice'} <select data-v="natural">${NATURAL_VOICES.map(
          (v) => `<option value="${v.id}" ${v.id === settings.naturalVoice ? 'selected' : ''}>${v.label}</option>`,
        ).join('')}</select></label>
        <label ${natural ? 'hidden' : ''}>Voice <select data-v="voice">${list
          .map((v) => `<option value="${v.voiceURI}" ${v.voiceURI === (chosenVoice()?.voiceURI ?? '') ? 'selected' : ''}>${v.name.replace(/[<>&"]/g, '')}</option>`)
          .join('') || '<option>Default</option>'}</select></label>
        <label>Speed <select data-v="rate">${[0.8, 0.9, 1, 1.1, 1.25]
          .map((r) => `<option value="${r}" ${r === settings.rate ? 'selected' : ''}>${r}×</option>`)
          .join('')}</select></label>
        <button class="btn small ghost" data-v="test">▶ Test voice</button>
      </details>`;
    wrap.querySelector('[data-v=toggle]')!.addEventListener('click', () => {
      updateSettings({ enabled: !settings.enabled });
      render();
      if (settings.enabled) {
        if (settings.engine !== 'device') prepareNatural().then(() => speak("Hello, detective! I'm Professor Pin. I'll talk you through every case."));
        else speak("Hello, detective! I'm Professor Pin. I'll talk you through every case.");
      }
    });
    wrap.querySelector<HTMLSelectElement>('[data-v=engine]')!.addEventListener('change', (e) => {
      stop();
      updateSettings({ engine: (e.target as HTMLSelectElement).value as VoiceSettings['engine'] });
      render();
      wrap.querySelector('details')?.setAttribute('open', '');
      if (settings.enabled && settings.engine !== 'device') prepareNatural();
    });
    wrap.querySelector<HTMLSelectElement>('[data-v=natural]')!.addEventListener('change', (e) => {
      stop();
      updateSettings({ naturalVoice: (e.target as HTMLSelectElement).value });
      naturalReady = false;
      naturalFailed = false;
      if (settings.enabled) prepareNatural();
    });
    wrap.querySelector<HTMLSelectElement>('[data-v=voice]')!.addEventListener('change', (e) => updateSettings({ voiceURI: (e.target as HTMLSelectElement).value }));
    wrap.querySelector<HTMLSelectElement>('[data-v=rate]')!.addEventListener('change', (e) => updateSettings({ rate: Number((e.target as HTMLSelectElement).value) }));
    wrap.querySelector('[data-v=test]')!.addEventListener('click', () => {
      stop();
      speak('Knight takes e5, check! It is a fork: your knight attacks the king and the rook at the same time.', true);
    });
  };
  render();
  // Voices load asynchronously in some browsers; the natural voice reports download progress.
  if (voiceSupported()) speechSynthesis.addEventListener?.('voiceschanged', render);
  const onStatus = () => {
    if (!wrap.isConnected) return listeners.delete(onStatus);
    const open = wrap.querySelector('details')?.hasAttribute('open');
    render();
    if (open) wrap.querySelector('details')?.setAttribute('open', '');
  };
  listeners.add(onStatus);
  if (settings.enabled && settings.engine !== 'device') prepareNatural();
  return wrap;
}

// Hook for the automated browser test (tests/e2e.mjs).
if (typeof window !== 'undefined') (window as any).__voice = { speak, naturalStatus, prepareNatural, synth };
