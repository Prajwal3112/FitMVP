import { estimateStartingLoad } from '../src/session/startingLoad';
import { suggestLoad } from '../src/session/progression';
import { canonicalExerciseId as CID, getExercise } from '../src/data/exercises';

let fails = 0;
const check = (n: string, c: boolean, d = '') => {
  if (c) console.log(`  ok   ${n}`); else { console.log(`  FAIL ${n} ${d}`); fails++; }
};
const est = (id: string, bw: number, exp: never) =>
  estimateStartingLoad({ exerciseId: id, bodyweightKg: bw, experience: exp });

console.log('\n80kg lifter, by experience — bench press');
for (const e of ['new','returning','regular','experienced'] as const) {
  const r = est('bench-press', 80, e as never);
  console.log(`  ${e.padEnd(12)} → ${r?.weightKg}kg`);
}
const beg = est('bench-press', 80, 'new' as never)!;
const exp = est('bench-press', 80, 'experienced' as never)!;
check('experience raises the estimate', exp.weightKg > beg.weightKg, `${beg.weightKg} vs ${exp.weightKg}`);
check('beginner bench is conservative (<50% BW)', beg.weightKg < 40, String(beg.weightKg));
check('never suggests less than an empty barbell', beg.weightKg >= 20, String(beg.weightKg));
check('and says to just use the bar', beg.reason.includes('just the bar'), beg.reason);

console.log('\nMovement patterns scale sensibly (80kg, regular)');
const rows = ['barbell-squat','deadlift','bench-press','overhead-press','bicep-curl']
  .map(id => [id, est(id, 80, 'regular' as never)?.weightKg] as const);
rows.forEach(([id, w]) => console.log(`  ${id.padEnd(18)} → ${w}kg`));
const get = (id: string) => rows.find(r => r[0] === id)?.[1] ?? 0;
check('deadlift > squat > bench > press > curl',
  get('deadlift') > get('barbell-squat') && get('barbell-squat') > get('bench-press')
  && get('bench-press') > get('overhead-press') && get('overhead-press') > get('bicep-curl'),
  rows.map(r => `${r[0]}=${r[1]}`).join(' '));

console.log('\nBodyweight scaling');
check('heavier lifter gets a higher estimate',
  est('bench-press', 100, 'regular' as never)!.weightKg > est('bench-press', 60, 'regular' as never)!.weightKg);
check('all estimates land on a loadable 2.5kg step',
  rows.every(([,w]) => (w ?? 0) % 2.5 === 0), rows.map(r=>r[1]).join(','));

console.log('\nWhat it refuses to estimate');
check('bodyweight work returns null (reps are the variable)', est('push-ups', 80, 'new' as never) === null);
check('plank returns null', est('plank-hold', 80, 'new' as never) === null);
check('unknown exercise returns null', est('not-a-real-id', 80, 'new' as never) === null);
check('zero bodyweight returns null', est('bench-press', 0, 'new' as never) === null);

console.log('\nDumbbell figures are per-hand, not the barbell total');
const db = getExercise('incline-dumbbell-press')!;
check('dumbbell exercise identified', db.eq === 'dumbbell');
const dbEst = est('incline-dumbbell-press', 80, 'regular' as never)!;
const bbEst = est('bench-press', 80, 'regular' as never)!;
check('dumbbell compound is per-hand, under the barbell total', dbEst.weightKg < bbEst.weightKg * 0.7,
  `db ${dbEst.weightKg} vs bb ${bbEst.weightKg}`);
const curl = est('bicep-curl', 80, 'regular' as never)!;
check('isolation dumbbell work is not double-penalised', curl.weightKg >= 5, `curl ${curl.weightKg}kg`);

console.log('\nsuggestLoad uses the estimate on day 1');
const slot = { exerciseId: CID('bench-press'), name: 'Bench Press', sets: 3, targetReps: 8 };
const s1 = suggestLoad(slot, {}, { bodyweightKg: 80, experience: 'regular' });
check('kind is estimate', s1.kind === 'estimate', s1.kind);
check('a number is prefilled', (s1.suggestedWeight ?? 0) > 0, String(s1.suggestedWeight));
check('the copy admits it is a guess', s1.reason.toLowerCase().includes('guess'), s1.reason);
console.log(`  → "${s1.reason}"`);

const s2 = suggestLoad(slot, {});
check('without a profile it falls back honestly', s2.kind === 'no_history', s2.kind);
check('and offers no number', s2.suggestedWeight === undefined);

const s3 = suggestLoad({ exerciseId: CID('push-ups'), name: 'Pushups', sets: 3, targetReps: 12 }, {},
  { bodyweightKg: 80, experience: 'new' });
check('bodyweight exercise never gets a kg estimate', s3.kind === 'no_history', s3.kind);

console.log(fails === 0 ? '\nALL PASS\n' : `\n${fails} FAILURE(S)\n`);
process.exit(fails === 0 ? 0 : 1);
