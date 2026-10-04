import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The palette must stay readable in a gym — at 6am under harsh overhead light
 * and at 9pm under dim ones.
 *
 * Computed, not eyeballed. "Looks fine on my desk at 100% brightness" is how
 * an interface ends up unreadable on a phone held at arm's length in a bright
 * room, and the first device session flagged the old light theme as too bright
 * to look at. WCAG ratios are a proxy for legibility rather than a law, but
 * they are a measurable proxy, which beats taste.
 */
const SRC = readFileSync(resolve(__dirname, '../src/constants/colors.ts'), 'utf8');

const colors: Record<string, string> = {};
for (const m of SRC.matchAll(/^\s*([a-zA-Z]+):\s*'(#[0-9A-Fa-f]{6})'/gm)) {
  colors[m[1]!] = m[2]!;
}

let fails = 0;
const ck = (n: string, c: boolean, extra = '') => {
  if (c) console.log(`  ok   ${n}`); else { fails++; console.log(`  FAIL ${n} ${extra}`); }
};

const lin = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

console.log(`\n  parsed ${Object.keys(colors).length} colour tokens\n`);

/** [foreground, background, minimum, why] */
const REQUIRED: [string, string, number, string][] = [
  ['text', 'card', 7, 'body text — must survive harsh overhead light'],
  ['text', 'background', 7, 'body text on the ground'],
  ['textMuted', 'card', 4.5, 'secondary text still carries meaning'],
  ['textTertiary', 'card', 4.5, 'hints make features discoverable'],
  ['primary', 'card', 4.5, 'the accent marks what is actionable'],
  ['primary', 'background', 4.5, 'the accent on the ground'],
  ['onPrimary', 'primary', 4.5, 'button labels sit ON the accent'],
  ['destructive', 'card', 4.5, 'destructive actions must be unmistakable'],
  ['caution', 'card', 4.5, 'caution text, e.g. a dropped exercise'],
];

for (const [fg, bg, min, why] of REQUIRED) {
  const a = colors[fg]; const b = colors[bg];
  if (!a || !b) { fails++; console.log(`  FAIL token missing: ${fg} or ${bg}`); continue; }
  const r = ratio(a, b);
  ck(`${(fg + ' on ' + bg).padEnd(26)} ${r.toFixed(2)}:1  (min ${min})  — ${why}`, r >= min,
    `${r.toFixed(2)}:1`);
}

console.log('\n  Dark-theme hygiene\n');
// Pure white on a dark ground haloes under bright light; pure black makes
// every edge a hard line and smears on OLED while scrolling.
ck('no pure white text', !Object.values(colors).some((v) => v.toUpperCase() === '#FFFFFF'),
  Object.entries(colors).filter(([, v]) => v.toUpperCase() === '#FFFFFF').map(([k]) => k).join(', '));
ck('no pure black ground', !Object.values(colors).some((v) => v.toUpperCase() === '#000000'));
ck('the ground is genuinely dark (a dark theme, not a dim light one)',
  lum(colors['background']!) < 0.05, String(lum(colors['background']!).toFixed(3)));
ck('card is lifted above the ground, so a surface reads as a surface',
  lum(colors['card']!) > lum(colors['background']!));
ck('raised is lifted above card', lum(colors['raised']!) > lum(colors['card']!));

console.log('\n  Semantic colours must be tellable apart\n');
// Contrast ratio is the WRONG metric here and my first version of this check
// used it: two colours can have near-identical luminance and be obviously
// different hues (coral vs amber), or vice versa. Separation is about hue.
// Fixing the metric found a real problem — destructive and caution were 25°
// apart, which is not enough at a glance, let alone with red-green colour
// blindness.
const hue = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r!, g!, b!); const mn = Math.min(r!, g!, b!); const d = mx - mn;
  if (d === 0) return 0;
  let h = mx === r ? ((g! - b!) / d + 6) % 6 : mx === g ? (b! - r!) / d + 2 : (r! - g!) / d + 4;
  return Math.round(h * 60);
};
const sep = (a: string, b: string) => {
  const d = Math.abs(hue(colors[a]!) - hue(colors[b]!));
  return Math.min(d, 360 - d);
};
for (const [a, b] of [['destructive', 'caution'], ['primary', 'caution'], ['primary', 'destructive']] as const) {
  const d = sep(a, b);
  ck(`${(a + ' vs ' + b).padEnd(26)} ${String(d).padStart(3)}° apart (min 30)`, d >= 30, `${d}°`);
}
console.log('\n  Colour never carries meaning alone — every use above is paired with words.');

console.log(fails === 0 ? '\nall passed' : `\n${fails} FAILURE(S)`);
if (fails > 0) process.exit(1);
