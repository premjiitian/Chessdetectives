// Runs the same Stockfish 19 build in Node for tests.
import { createRequire } from 'node:module';
import { Engine } from '../src/lib/engine';

export function nodeEngine(): Engine {
  const require = createRequire(import.meta.url);
  let cb: (l: string) => void = () => {};
  const sf = require('stockfish')('lite-single', (line: string) => cb(line));
  return new Engine({ post: (c) => sf.processCommand(c), onLine: (f) => (cb = f), terminate: () => sf.terminate() });
}
