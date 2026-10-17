import {
  ANCHOR_LIFTS, shouldAskDeclaredLifts, implausibleDeclaredLift,
  declaredLoadFor, MIN_DECLARED_KG, MAX_DECLARED_KG,
} from '../src/onboarding/declaredLifts';
import { estimateStartingLoad } from '../src/session/startingLoad';
import { getExercise } from '../src/data/exercises';

/**
 * A number the user gave us must beat any ratio we can compute.
 *
 * `startingLoad` worked from bodyweight x pattern ratio x experience factor,
 * so a regular lifter who squats 140kg was offered 47.5kg on the first screen
 * they saw — wrong by a factor of three, from a formula, about their own body.
 * The research found exactly that complaint: "apps pretend that they know more
 * about my body than I do."
 */
let fails = 0;
const ck = (n: string, c: boolean, extra = '') => {
  if (c) console.log(`  ok   ${n}`); else { fails++; console.log(`  FAIL ${n} ${extra}`); }
};

console.log('\nWho gets asked\n');
ck('a beginner is NOT asked (they have no numbers to give)',
  !shouldAskDeclaredLifts('new'));
for (const e of ['returning', 'regular', 'experienced']) {
  ck(`"${e}" is asked`, shouldAskDeclaredLifts(e));
}
ck('unknown experience is not asked', !shouldAskDeclaredLifts(null));

console.log('\nThe anchors are real, recognisable exercises\n');
for (const a of ANCHOR_LIFTS) {
  const ex = getExercise(a.exerciseId);
  ck(`${a.label.padEnd(16)} -> ${a.exerciseId}`, ex !== undefined, 'not in the library');
  if (ex) {
    ck(`  ...and its pattern matches the declared one (${a.pattern})`, ex.pat === a.pattern, String(ex.pat));
  }
}
ck('the anchors cover distinct patterns (no two competing)',
  new Set(ANCHOR_LIFTS.map((a) => a.pattern)).size === ANCHOR_LIFTS.length);

console.log('\nPlausibility — catch a slipped digit, do not judge the lift\n');
ck('a 60kg bench is fine', implausibleDeclaredLift(60) === null);
ck('a 20kg bench is fine (nobody is told they are weak)', implausibleDeclaredLift(20) === null);
ck(`${MIN_DECLARED_KG - 5}kg is refused`, implausibleDeclaredLift(MIN_DECLARED_KG - 5) !== null);
ck(`${MAX_DECLARED_KG + 50}kg is refused (past the world record)`,
  implausibleDeclaredLift(MAX_DECLARED_KG + 50) !== null);
ck('NaN is refused', implausibleDeclaredLift(NaN) !== null);
// A pounds/kilos mix-up: 315 lb bench typed as 315 "kg" is above the record.
ck('a lb/kg mix-up on a big lift is caught', implausibleDeclaredLift(700) !== null);

console.log('\nIt beats the bodyweight ratio\n');
const declared = { Barbell_Squat: 140, 'Barbell_Bench_Press_-_Medium_Grip': 100 };
const guess = (id: string) => estimateStartingLoad({ exerciseId: id, bodyweightKg: 80, experience: 'regular' });
const told = (id: string) => estimateStartingLoad({ exerciseId: id, bodyweightKg: 80, experience: 'regular', declaredLifts: declared });

for (const [id, want] of [['Barbell_Squat', 140], ['Barbell_Bench_Press_-_Medium_Grip', 100]] as const) {
  const g = guess(id); const t = told(id);
  ck(`${id.slice(0, 34).padEnd(36)} ${g?.weightKg} -> ${t?.weightKg}`, t?.weightKg === want, String(t?.weightKg));
  ck(`  ...and is not flagged as an estimate (it is their number)`, t?.isEstimate === false);
}

console.log('\nVariations inherit from the anchor, conservatively\n');
const incline = told('Barbell_Incline_Bench_Press_-_Medium_Grip');
ck('incline bench inherits from the declared bench', (incline?.weightKg ?? 0) > 0);
ck('...scaled DOWN, never up (a failed rep under a bar is not recoverable)',
  (incline?.weightKg ?? 999) < 100, String(incline?.weightKg));
ck('...and IS flagged as an estimate, because it is still a guess',
  incline?.isEstimate === true);
ck('...landing on something loadable', ((incline?.weightKg ?? 0) * 10) % 25 === 0, String(incline?.weightKg));

console.log('\nIt does not leak across patterns\n');
const dl = told('Barbell_Deadlift');
ck('deadlift is NOT inherited from a declared squat (different pattern)',
  dl?.weightKg === guess('Barbell_Deadlift')?.weightKg,
  `${dl?.weightKg} vs ${guess('Barbell_Deadlift')?.weightKg}`);
ck('a bodyweight exercise still returns null, declared or not',
  estimateStartingLoad({ exerciseId: 'Pushups', bodyweightKg: 80, experience: 'regular', declaredLifts: declared }) === null);

console.log('\nDeclared is not performed\n');
ck('declaredLoadFor returns a number, never a session record',
  typeof declaredLoadFor('Barbell_Squat', 'squat', declared)?.kg === 'number');
ck('an undeclared lift with no anchor returns null',
  declaredLoadFor('Thigh_Abductor', 'hip_isolation', declared) === null);
console.log('       (synthetic SetCompleted events are deliberately NOT written —');
console.log('        that would put training that never happened into the log)');

console.log(fails === 0 ? '\nall passed' : `\n${fails} FAILURE(S)`);
if (fails > 0) process.exit(1);
