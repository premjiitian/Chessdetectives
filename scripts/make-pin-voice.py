"""Records Professor Pin's fixed lines in his cloned voice (Chatterbox, MIT licence).

Usage (CPU is fine, just slow):
  pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
  pip install chatterbox-tts
  PIN_OUT=phrases.json npx vitest run tests/pin-phrases.test.ts
  python scripts/make-pin-voice.py phrases.json reference.wav public/voice/pin

`reference.wav` is 10-20 seconds of clean speech by the person whose voice it is.
Only clone a voice with that person's permission.
"""
import hashlib, json, os, subprocess, sys, tempfile

import torch, torchaudio
from chatterbox.tts import ChatterboxTTS

phrases_path, ref, out_dir = sys.argv[1:4]
os.makedirs(out_dir, exist_ok=True)
torch.set_num_threads(os.cpu_count() or 4)
model = ChatterboxTTS.from_pretrained(device="cuda" if torch.cuda.is_available() else "cpu")

manifest_path = os.path.join(out_dir, "manifest.json")
manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
phrases = json.load(open(phrases_path))
for i, p in enumerate(phrases):
    name = hashlib.sha1(p["key"].encode()).hexdigest()[:12] + ".mp3"
    if manifest.get(p["key"]) == name and os.path.exists(os.path.join(out_dir, name)):
        continue
    wav = model.generate(p["text"], audio_prompt_path=ref, exaggeration=0.5, cfg_weight=0.5)
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        torchaudio.save(tmp.name, wav, model.sr)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", tmp.name, "-af", "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse",
                        "-ac", "1", "-ar", "24000", "-b:a", "48k", os.path.join(out_dir, name)], check=True)
    manifest[p["key"]] = name
    json.dump(manifest, open(manifest_path, "w"), indent=0, sort_keys=True)  # save as we go
    print(f"[{i + 1}/{len(phrases)}] {p['text']}", flush=True)
print("done:", len(manifest), "clips")
