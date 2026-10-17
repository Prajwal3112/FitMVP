import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

/**
 * The UI has to work across roughly a 4x width range.
 *
 *   ~280dp  folded Galaxy Z Fold outer screen
 *   ~360dp  small Android phones, still shipping in 2026
 *   ~440dp  iPhone Pro Max / Galaxy Ultra
 *   ~600dp  small tablets, unfolded foldables, a phone in landscape
 *  ~1100dp  a 13" tablet
 *
 * Checked statically because there is no renderer here. These are the mistakes
 * that actually break it, and each is greppable.
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
    // .ts as well as .tsx: layout.ts is where the breakpoints live, and the
    // first version of this check only walked .tsx, so every "layout exposes
    // X" assertion read an empty string and failed for the wrong reason.
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}
const ui = walk(join(ROOT, 'src')).concat([join(ROOT, 'App.tsx')]);
const src = new Map(ui.map((f) => [f, readFileSync(f, 'utf8')]));
const rel = (f: string) => relative(ROOT, f);

console.log('\nThe layout primitive exists and is the only source of breakpoints\n');
ck('src/constants/layout.ts exists', src.has(join(ROOT, 'src/constants/layout.ts')));
const layoutSrc = src.get(join(ROOT, 'src/constants/layout.ts')) ?? '';
for (const token of ['compact', 'regular', 'wide', 'maxContentWidth', 'isShort']) {
  ck(`layout exposes "${token}"`, layoutSrc.includes(token));
}
// Screens must not invent their own breakpoints.
const rogue = [...src.entries()].filter(([f, s]) =>
  !f.endsWith('constants/layout.ts') && /useWindowDimensions|Dimensions\s*\.\s*get/.test(s));
ck('no screen reads window size directly — all go through useLayout',
  rogue.length === 0, rogue.map(([f]) => rel(f)).join(', '));

console.log('\nNothing is wider than the narrowest phone\n');
// A fixed width or minWidth above ~260 overflows a folded 280dp screen once
// the gutter is taken off.
const TOO_WIDE = 260;
const wide: string[] = [];
for (const [f, s] of src) {
  if (!/\.tsx$/.test(f)) continue; // styles only live in components
  for (const m of s.matchAll(/\b(?:min)?[wW]idth:\s*(\d{3,})/g)) {
    if (Number(m[1]) > TOO_WIDE) wide.push(`${rel(f)}: ${m[0]}`);
  }
}
ck(`no fixed width over ${TOO_WIDE}dp`, wide.length === 0, wide.join(' · '));

console.log('\nText must not stretch on a tablet\n');
ck('a readable column cap is defined', /READABLE_COLUMN|maxWidth/.test(layoutSrc));
const screenSrc = src.get(join(ROOT, 'src/components/Screen.tsx')) ?? '';
ck('the Screen shell applies maxWidth and centres', 
  /maxWidth/.test(screenSrc) && /alignSelf:\s*'center'/.test(screenSrc));

console.log('\nAccessibility font scaling is not disabled\n');
// Someone with large text turned on needs it; layouts must flex instead.
// Strip comments first: layout.ts DOCUMENTS that nothing disables font
// scaling, and the first version of this check flagged that sentence.
const stripComments = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|\*).*$/gm, '');
const noScale = [...src.entries()]
  .filter(([, s]) => /allowFontScaling\s*=\s*\{?false/.test(stripComments(s)));
ck('nothing sets allowFontScaling={false}', noScale.length === 0,
  noScale.map(([f]) => rel(f)).join(', '));

console.log('\nRows of chips must be able to wrap\n');
// A non-wrapping row of pills is the classic folded-phone overflow.
const rows: string[] = [];
for (const [f, s] of src) {
  if (!/\.tsx$/.test(f)) continue;
  for (const m of s.matchAll(/flexDirection:\s*'row'[^}]*}/g)) {
    const block = m[0];
    // Only flag blocks that look like they hold many children.
    if (/gap:/.test(block) && !/flexWrap/.test(block) && /chip|pill|row:|chips|macroRow/i.test(block)) {
      rows.push(`${rel(f)}: ${block.slice(0, 60)}`);
    }
  }
}
ck('chip/pill rows declare flexWrap', rows.length === 0, rows.join(' · '));

console.log('\nTap targets stay thumb-sized\n');
// Material's floor is 48dp; Apple's is 44. Anything under 40 is a miss.
const small: string[] = [];
for (const [f, s] of src) {
  if (!/\.tsx$/.test(f)) continue;
  for (const m of s.matchAll(/minHeight:\s*(\d+)/g)) {
    if (Number(m[1]) < 40) small.push(`${rel(f)}: minHeight ${m[1]}`);
  }
}
ck('no interactive minHeight under 40dp', small.length === 0, small.join(' · '));

console.log(fails === 0 ? '\nall passed' : `\n${fails} FAILURE(S)`);
if (fails > 0) process.exit(1);
