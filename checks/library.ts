import {
  EXERCISES, getExercise, exerciseName, canonicalExerciseId, isAvailable,
  loadsInjury, filterExercises, findSubstitutes, findNonSoreAlternatives, getInstructions,
  filterExercises as FE,
} from '../src/data/exercises';
import { exerciseIdOf } from '../src/session/scheduler';

let fails = 0;
const check = (n: string, c: boolean, d = '') => {
  if (c) console.log(`  ok   ${n}`); else { console.log(`  FAIL ${n} ${d}`); fails++; }
};

console.log('\nLibrary integrity');
check(`${EXERCISES.length} exercises loaded`, EXERCISES.length === 743, String(EXERCISES.length));
check('all ids unique', new Set(EXERCISES.map(e => e.id)).size === EXERCISES.length);
check('every exercise has a primary muscle', EXERCISES.every(e => e.pm.length > 0),
  EXERCISES.filter(e => e.pm.length === 0).map(e => e.name).join(', '));
check('every exercise has a tier', EXERCISES.every(e => e.tier === 'home' || e.tier === 'gym'));

console.log('\nStable IDs — the whole point');
check('legacy slug resolves', canonicalExerciseId('bench-press') === 'Barbell_Bench_Press_-_Medium_Grip',
  canonicalExerciseId('bench-press'));
check('scheduler now emits the stable id', exerciseIdOf('Bench Press') === 'Barbell_Bench_Press_-_Medium_Grip',
  exerciseIdOf('Bench Press'));
check('stable id is idempotent', canonicalExerciseId(canonicalExerciseId('deadlift')) === canonicalExerciseId('deadlift'));
check('unknown id passes through untouched', canonicalExerciseId('made-up') === 'made-up');
check('old logged history still resolves to a real exercise', getExercise('push-ups')?.name === 'Pushups',
  String(getExercise('push-ups')?.name));
check('renaming no longer orphans history', exerciseName('bench-press').includes('Bench Press'));

console.log('\nAll 24 legacy exercises resolve');
const LEGACY = ['push-ups','pike-push-ups','diamond-push-ups','plank-hold','bodyweight-squats',
 'reverse-lunges','glute-bridges','mountain-climbers','burpees','squat-to-press','jumping-jacks','dead-bug',
 'bench-press','overhead-press','incline-dumbbell-press','tricep-pushdown','deadlift','lat-pulldown',
 'cable-row','bicep-curl','barbell-squat','leg-press','romanian-deadlift','leg-curl'];
const unresolved = LEGACY.filter(l => getExercise(l) === undefined);
check('none unresolved', unresolved.length === 0, unresolved.join(', '));

console.log('\nEquipment filtering (§8.8)');
const home = filterExercises({ tier: 'home' });
const gym = filterExercises({ tier: 'gym' });
check(`home, owning nothing: ${home.length} (bodyweight only)`, home.length === 91, String(home.length));
check(`gym tier: ${gym.length} (a gym has everything)`, gym.length === 743, String(gym.length));
check('no barbell work offered at home', !home.some(e => e.eq === 'barbell'));
check('bodyweight available in both', isAvailable(getExercise('Pushups')!, 'home') && isAvailable(getExercise('Pushups')!, 'gym'));
check('dumbbell work NOT offered to someone who owns none', !isAvailable(getExercise('incline-dumbbell-press')!, 'home'));
check('...but is once they say they own dumbbells', isAvailable(getExercise('incline-dumbbell-press')!, 'home', ['dumbbell']));

console.log('\nInjury locks (§8.7) — previously unenforceable');
const bench = getExercise('bench-press')!;
check('shoulder injury blocks bench (secondary mover)', loadsInjury(bench, ['shoulders']),
  JSON.stringify([bench.pm, bench.sm]));
check('knee injury does not block bench', !loadsInjury(bench, ['knee']));
const kneeSafe = filterExercises({ tier: 'gym', injuries: ['quadriceps'] });
check('quad injury removes squats from the pool',
  !kneeSafe.some(e => e.id === 'Barbell_Squat'), 'squat still present');
check('but leaves upper-body work', kneeSafe.some(e => e.id === 'Barbell_Bench_Press_-_Medium_Grip'));

console.log('\nSubstitutions — derived, not hand-authored');
const subs = findSubstitutes('bench-press', { tier: 'home', limit: 5 });
check('bench has home alternatives', subs.length > 0);
check('all are home-doable', subs.every(e => e.tier === 'home'));
check('all train the chest', subs.every(e => e.pm.includes('chest')), subs.map(e=>e.name).join(', '));
console.log('  bench press, at home → ' + subs.map(e => e.name).join(' · '));

const squatSubs = findSubstitutes('barbell-squat', { tier: 'gym', limit: 4 });
check('squat substitutes train quads', squatSubs.every(e => e.pm.includes('quadriceps')), squatSubs.map(e=>e.name).join(', '));
console.log('  barbell squat, at a gym → ' + squatSubs.map(e => e.name).join(' · '));

const injSubs = findSubstitutes('bench-press', { tier: 'gym', injuries: ['shoulders'], limit: 4 });
check('substitutes respect injuries', injSubs.every(e => !loadsInjury(e, ['shoulders'])), injSubs.map(e=>e.name).join(', '));

console.log('\nSoreness routing — previously impossible');
const sore = findNonSoreAlternatives('bench-press', ['chest'], { tier: 'gym', limit: 4 });
check('avoids the sore muscle as primary', sore.every(e => !e.pm.includes('chest')), sore.map(e=>e.name).join(', '));

console.log('\nBeginner capping (Meera: 4 push-ups when told 12)');
const beg = filterExercises({ tier: 'home', maxLevel: 'beginner' });
check(`${beg.length} beginner-safe bodyweight exercises`, beg.length > 20, String(beg.length));
check('no expert movements', !beg.some(e => e.lvl === 'expert'));

console.log('\nInstructions load lazily');
const ins = getInstructions('bench-press');
check('bench press has instructions', ins.length > 0, String(ins.length));
check('legacy id resolves to instructions', getInstructions('push-ups').length > 0);
console.log(`  → "${ins[0]?.slice(0, 80)}…"`);

// ── owned equipment widens the home tier ──
console.log('\nOwned equipment (Meera\'s £180 of dumbbells)');
const bare = FE({ tier: 'home' });
const withDb = FE({ tier: 'home', owned: ['dumbbell'] });
const withLots = FE({ tier: 'home', owned: ['dumbbell','bands','kettlebells','barbell'] });
check(`bodyweight only: ${bare.length}`, bare.length === 91, String(bare.length));
check(`+ dumbbells: ${withDb.length}`, withDb.length > bare.length, `${withDb.length} vs ${bare.length}`);
check(`+ full home gym: ${withLots.length}`, withLots.length > withDb.length);
check('owning nothing never offers barbell work', !bare.some(e => e.eq === 'barbell'));
check('owning a barbell does', withLots.some(e => e.eq === 'barbell'));
console.log(`  bodyweight ${bare.length} → +dumbbells ${withDb.length} → +full kit ${withLots.length}`);
console.log(fails === 0 ? '\nALL PASS\n' : `\n${fails} FAILURE(S)\n`);
process.exit(fails === 0 ? 0 : 1);
