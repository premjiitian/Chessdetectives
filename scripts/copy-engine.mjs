// Copies the Stockfish 19 (lite, single-threaded) engine into public/engine
// so the browser can load it as a Web Worker. Runs before `dev` and `build`.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'stockfish', 'bin');
const dest = join(root, 'public', 'engine');
mkdirSync(dest, { recursive: true });
for (const f of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) {
  copyFileSync(join(src, f), join(dest, f));
}
console.log('Stockfish 19 copied to public/engine');
