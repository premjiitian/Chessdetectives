// Older iPads keep older Safari (an iPad that stopped at iPadOS 15 has Safari 15).
// One unsupported feature in the main script stops the WHOLE app from starting,
// so scan the built files for things Safari 15.0 cannot do.
//   node scripts/check-safari.mjs [dist]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist';
const RULES = [
  // [what, pattern, Safari version that added it]
  ['regex look-behind (?<= / (?<!', /\(\?<[=!]/, '16.4'],
  ['Array/String .at()', /[\w\])]\.at\((?:-?\d|[a-zA-Z_$])/, '15.4'],
  ['.findLast() / .findLastIndex()', /\.findLast(Index)?\(/, '15.4'],
  ['structuredClone()', /\bstructuredClone\(/, '15.4'],
  ['Object.hasOwn()', /\bObject\.hasOwn\(/, '15.4'],
  ['.toSorted() / .toReversed() / .toSpliced() / .with()', /\.to(Sorted|Reversed|Spliced)\(/, '16'],
  ['Array.fromAsync()', /\bArray\.fromAsync\(/, '16.4'],
];
// Files only loaded on demand by optional features (Google sign-in, the
// downloadable natural voice): a problem there disables that feature, not the app.
const OPTIONAL = /^(index\.esm|ort\.min|piper|vits-web|transformers)/;

const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js') && !p.includes('/engine/')) files.push(p);
  }
};
walk(dir);
let bad = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const name = f.split('/').pop();
  for (const [what, re, ver] of RULES) {
    const m = src.match(re);
    if (!m) continue;
    const at = m.index ?? 0;
    const optional = OPTIONAL.test(name);
    if (!optional) bad++;
    console.log(`${optional ? '⚠️ ' : '❌'} ${name}: ${what} (needs Safari ${ver})${optional ? ' — optional feature only' : ''}\n     …${src.slice(Math.max(0, at - 40), at + 40).replace(/\s+/g, ' ')}…`);
  }
}
console.log(bad ? `\n❌ ${bad} problem(s): the app would not start on older iPads` : `\n✅ main app code runs on Safari 15 (${files.length} files checked)`);
process.exit(bad ? 1 : 0);
