import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

/**
 * Budget guards, so weight and wake-ups cannot creep back in unnoticed.
 *
 * Every item below was a real regression found by measuring on 2026-09-29:
 * a 593 KB JSON file with zero consumers, an unused 8.6 MB native module,
 * a 250 ms interval re-rendering a whole screen four times a second, and a
 * 60-second interval waking the JS thread 1,440 times a day to notice one
 * moment it could have been scheduled for exactly.
 */
const ROOT = resolve(__dirname, '..');
let fails = 0;
const ck = (n: string, c: boolean, extra = '') => {
  if (c) console.log(`  ok   ${n}`); else { fails++; console.log(`  FAIL ${n} ${extra}`); }
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const srcFiles = walk(join(ROOT, 'src'));

console.log('\nBundled data — every KB ships to every tester\n');
const json = srcFiles.filter((f) => f.endsWith('.json'));
let total = 0;
for (const f of json.sort()) {
  const kb = Math.round(statSync(f).size / 1024);
  total += kb;
  console.log(`  ${String(kb).padStart(5)} KB  ${relative(ROOT, f)}`);
}
console.log(`  ${String(total).padStart(5)} KB  total`);
// 192 KB today. The exercise library is the product; anything much past this
// wants justifying, because it is paid by every install on every phone.
ck('bundled JSON stays under 260 KB', total < 260, `${total} KB`);
ck('no single asset over 200 KB', json.every((f) => statSync(f).size < 200 * 1024),
  json.filter((f) => statSync(f).size >= 200 * 1024).map((f) => relative(ROOT, f)).join(', '));

console.log('\nBattery — repeating timers keep the JS thread out of idle\n');
// NOT "everything outside src/dev". Three of the four files in src/dev are
// production-reachable — backup.ts, digest.ts and exportFile.ts are all wired
// to HomeScreen — and only seed.ts is genuinely dev-only. Excluding the whole
// directory made this check report expo-file-system and expo-sharing as unused
// dependencies when they are what the export is built on. The directory name
// is misleading; see CLAUDE.md.
const code = srcFiles.filter((f) => /\.tsx?$/.test(f) && !f.endsWith('dev/seed.ts'));
const intervals: string[] = [];
for (const f of code) {
  const src = readFileSync(f, 'utf8');
  src.split('\n').forEach((l, i) => {
    // A comment explaining why one was REMOVED must not count as one.
    if (/\bsetInterval\s*\(/.test(l) && !/^\s*(\/\/|\*)/.test(l)) {
      intervals.push(`${relative(ROOT, f)}:${i + 1}`);
    }
  });
}
console.log(`  setInterval call sites: ${intervals.length || 'none'}`);
for (const i of intervals) console.log(`    ${i}`);
// setTimeout that reschedules itself is fine — it fires when something is
// actually due. setInterval fires whether or not anything changed.
ck('no setInterval outside src/dev', intervals.length === 0, intervals.join(', '));

console.log('\nDependencies — a declared native module ships whether imported or not\n');
const deps = Object.keys(
  (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }).dependencies,
);
/** Present for a reason other than a direct import. */
const INDIRECT = new Set([
  'react-native-screens',            // peer dep of @react-navigation/stack
  'react-native-gesture-handler',    // peer dep of @react-navigation/stack
  'react-native-get-random-values',  // side-effect import in index.js
  'react-dom', 'react-native-web', '@expo/metro-runtime', // web target only
  'babel-preset-expo',               // build
]);
const allCode = [join(ROOT, 'App.tsx'), join(ROOT, 'index.js'), ...code].map((f) => readFileSync(f, 'utf8')).join('\n');
const unused = deps.filter((d) => !INDIRECT.has(d) && !new RegExp(`['"]${d.replace(/[/\\-]/g, '\\$&')}['"]`).test(allCode));
console.log(`  declared: ${deps.length} · indirect-by-design: ${INDIRECT.size} · unaccounted: ${unused.length}`);
for (const u of unused) console.log(`    ${u}`);
ck('no dependency is declared but never referenced', unused.length === 0, unused.join(', '));

console.log(fails === 0 ? '\nall passed' : `\n${fails} FAILURE(S)`);
if (fails > 0) process.exit(1);
