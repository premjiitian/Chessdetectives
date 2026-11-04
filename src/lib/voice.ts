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
  voiceURI: string;
  rate: number;
}

const KEY = 'voice-settings';
let settings: VoiceSettings = { enabled: false, voiceURI: '', rate: 1 };
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

/** Speak now (queued after anything already being said). */
export function speak(text: string, force = false) {
  if (!voiceSupported() || (!settings.enabled && !force)) return;
  const spoken = toSpeech(text);
  if (!spoken) return;
  const u = new SpeechSynthesisUtterance(spoken);
  const v = chosenVoice();
  if (v) u.voice = v;
  u.lang = v?.lang ?? 'en-US';
  u.rate = settings.rate;
  u.pitch = 1;
  speechSynthesis.speak(u);
}

export function stop() {
  if (voiceSupported()) speechSynthesis.cancel();
}

/** The little voice control used on the trainer and sparring pages. */
export function voiceControl(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'voice-ctl';
  if (!voiceSupported()) {
    wrap.innerHTML = '<span class="sub">🔇 Voice coach isn’t supported in this browser.</span>';
    return wrap;
  }
  const render = () => {
    const list = voices();
    wrap.innerHTML = `
      <button class="btn small ${settings.enabled ? 'primary' : ''}" data-v="toggle" aria-pressed="${settings.enabled}">
        ${settings.enabled ? '🔊 Voice coach on' : '🔈 Voice coach off'}
      </button>
      <details class="voice-more">
        <summary title="Voice settings">⚙︎</summary>
        <label>Voice <select data-v="voice">${list
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
      if (settings.enabled) speak("Hi! I'm your voice coach. I'll talk you through every case.");
    });
    wrap.querySelector<HTMLSelectElement>('[data-v=voice]')!.addEventListener('change', (e) => updateSettings({ voiceURI: (e.target as HTMLSelectElement).value }));
    wrap.querySelector<HTMLSelectElement>('[data-v=rate]')!.addEventListener('change', (e) => updateSettings({ rate: Number((e.target as HTMLSelectElement).value) }));
    wrap.querySelector('[data-v=test]')!.addEventListener('click', () => {
      stop();
      speak('Knight takes e5, check! It is a fork: your knight attacks the king and the rook at the same time.', true);
    });
  };
  render();
  // Voices load asynchronously in some browsers.
  speechSynthesis.addEventListener?.('voiceschanged', render);
  return wrap;
}
