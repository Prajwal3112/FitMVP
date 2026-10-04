import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildSessionDraft } from '../src/session/scheduler';

/**
 * Every exercise the app can prescribe should have a photo, and no photo
 * should ship for one it cannot.
 *
 * This is the guard that stops the 596 KB mistake recurring in the other
 * direction: `exerciseInstructions.json` shipped text for 875 exercises with
 * zero consumers, for a scheduler that reaches 90. If the selection logic
 * changes, the reachable set moves and this check fails rather than silently
 * shipping dead weight or a blank card.
 */
let fails = 0;
const ck = (n: string, c: boolean, extra = '') => {
  if (c) console.log(`  ok   ${n}`); else { fails++; console.log(`  FAIL ${n} ${extra}`); }
};

const reachable = new Set<string>();
for (const tier of ['gym', 'home'] as const)
  for (const exp of ['new', 'returning', 'regular', 'experienced'] as const)
    for (const d of [2, 3, 4, 5, 6])
      for (const g of ['hypertrophy', 'strength', 'fat_loss', 'general_fitness', 'endurance'] as const)
        for (const kit of tier === 'home' ? [[], ['dumbbell'], ['dumbbell', 'pullup bar', 'barbell']] : [[]])
          for (let rot = 0; rot < 120; rot++)
            for (const e of buildSessionDraft({
              equipment: tier, rotationIndex: rot,
              checkin: { sessionId: 'x', energy: 6, soreness: [] },
              goal: g, experience: exp, daysPerWeek: d, ownedEquipment: [...kit],
            }).exercises) reachable.add(e.exerciseId);

const dir = resolve(__dirname, '../src/data/img');
const files = readdirSync(dir).filter((f) => f.endsWith('.jpg'));
const haveImage = new Set(files.map((f) => f.replace(/\.jpg$/, '')));
// Read the generated map as TEXT, not as a module: it contains
// require('./img/*.jpg'), which only Metro resolves — node cannot parse it.
// Reading the source is also the correct way to guard a generated file.
const mapSrc = readFileSync(resolve(__dirname, '../src/data/exerciseImages.ts'), 'utf8');
const mapped = new Set(
  [...mapSrc.matchAll(/^\s*'([^']+)':\s*require\(/gm)].map((m) => m[1]!),
);

console.log(`\n  reachable exercises : ${reachable.size} of 743`);
console.log(`  bundled photos      : ${files.length}`);
console.log(`  entries in the map  : ${mapped.size}`);

const missing = [...reachable].filter((id) => !haveImage.has(id));
const orphan = [...haveImage].filter((id) => !reachable.has(id));

// The two hand-added conditioning entries have no upstream photo — the source
// dataset does not contain them. Named, so this is a known gap not a surprise.
const KNOWN_NO_PHOTO = new Set(['fitmvp_Jumping_Jacks', 'fitmvp_Pike_Push-Up']);
const realMissing = missing.filter((id) => !KNOWN_NO_PHOTO.has(id));

ck('every prescribable exercise has a photo', realMissing.length === 0,
  realMissing.slice(0, 8).join(', '));
ck('no photo ships for an exercise that cannot be prescribed', orphan.length === 0,
  orphan.slice(0, 8).join(', '));
ck('the generated map matches the files on disk',
  mapped.size === files.length && [...mapped].every((id) => haveImage.has(id)));

const totalKb = files.reduce((n, f) => n + statSync(join(dir, f)).size, 0) / 1024;
console.log(`  total weight        : ${Math.round(totalKb)} KB (${(totalKb / 1024).toFixed(2)} MB)`);
// Shipping all 743 at this resolution would be ~11 MB; at source resolution ~6.6 MB.
ck('photos stay under 2 MB', totalKb < 2048, `${Math.round(totalKb)} KB`);
ck('no single photo over 40 KB',
  files.every((f) => statSync(join(dir, f)).size < 40 * 1024),
  files.filter((f) => statSync(join(dir, f)).size >= 40 * 1024).join(', '));

console.log(fails === 0 ? '\nall passed' : `\n${fails} FAILURE(S)`);
if (fails > 0) process.exit(1);
