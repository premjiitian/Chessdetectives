"""Quality gate for Professor Pin's voice: transcribe every clip with Whisper,
re-record lines that don't clearly say their words (up to 3 more takes), keep
the best take. Only clips scoring >= 0.6 are published by the app build step.

  pip install faster-whisper
  python scripts/fix-pin-voice.py <folder with phrases.json, ref.wav, clips/>
"""
import json, re, sys, difflib, subprocess, os, tempfile, hashlib
import numpy as np, torch, torchaudio
from faster_whisper import WhisperModel
from chatterbox.tts import ChatterboxTTS
S = sys.argv[1]; ref = f'{S}/ref.wav'; clips = f'{S}/clips'
phr = {p['key']: p['text'] for p in json.load(open(f'{S}/phrases.json'))}
man = json.load(open(f'{clips}/manifest.json'))
torch.set_num_threads(4)
asr = WhisperModel('base.en', device='cpu', compute_type='int8')
norm = lambda t: re.sub(r'[^a-z0-9 ]+', ' ', t.lower().replace('’', "'")).split()
def load(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 's16le', '-ac', '1', '-ar', '16000', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768
def score(path, text):
    heard = ' '.join(s.text for s in asr.transcribe(load(path), beam_size=1, language='en')[0])
    return difflib.SequenceMatcher(None, norm(text), norm(heard)).ratio(), heard
scores = {}
for k, f in man.items(): scores[k] = score(f'{clips}/{f}', phr[k])[0]
todo = [k for k, s in scores.items() if s < 0.8]
print(f'{len(todo)} lines to improve', flush=True)
tts = ChatterboxTTS.from_pretrained(device='cpu')
for k in todo:
    text = phr[k]
    for attempt in range(3):
        wav = tts.generate(text, audio_prompt_path=ref, exaggeration=0.4, cfg_weight=0.6 if attempt else 0.5, temperature=0.6)
        with tempfile.NamedTemporaryFile(suffix='.wav') as tmp:
            torchaudio.save(tmp.name, wav, tts.sr)
            cand = f'{clips}/cand.mp3'
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', tmp.name, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse', '-ac', '1', '-ar', '24000', '-b:a', '48k', cand], check=True)
        sc, heard = score(cand, text)
        if sc > scores[k]:
            name = hashlib.sha1((k + str(attempt)).encode()).hexdigest()[:12] + '.mp3'
            os.replace(cand, f'{clips}/{name}')
            old = man.get(k)
            if old and old != name and os.path.exists(f'{clips}/{old}'): os.remove(f'{clips}/{old}')
            man[k] = name; scores[k] = sc
            json.dump(man, open(f'{clips}/manifest.json', 'w'), indent=0, sort_keys=True)
        print(f'  {text[:50]!r} try {attempt + 1}: {sc:.2f} heard {heard!r} (best {scores[k]:.2f})', flush=True)
        if scores[k] >= 0.8: break
json.dump(scores, open(f'{S}/scores.json', 'w'), indent=0, sort_keys=True)
good = sum(1 for s in scores.values() if s >= 0.6)
print(f'done: {good}/{len(scores)} clips pass (>= 0.6 match); best-score file written', flush=True)
