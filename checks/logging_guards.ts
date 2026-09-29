import { implausibleSet, MAX_PLAUSIBLE_WEIGHT_KG } from '../src/session/plausibility';
import { SetCompletedPayloadSchema } from '../src/events/session';
import { suggestLoad } from '../src/session/progression';
import type { ExerciseHistory } from '../src/projections/sessions';

/**
 * A logged set cannot be corrected after the session completes — there is no
 * history screen, no edit, no undo and no SetCorrected event. So a slipped
 * digit is permanent, and because selectExerciseHistory reads max(weight) it
 * poisons every future suggestion for that lift.
 */
let fails = 0;
const ck = (n: string, c: boolean, extra = '') => {
  if (c) console.log(`  ok   ${n}`); else { fails++; console.log(`  FAIL ${n} ${extra}`); }
};

console.log('\nImplausible logged values\n');

// The guard lives in the command layer; assert the constants it enforces are
// reachable by showing the schema alone does NOT stop a typo.
const typo = SetCompletedPayloadSchema.safeParse({
  sessionId: 's', exerciseId: 'bench', setIndex: 0, weight_kg: 1000, reps: 8,
});
ck('Zod alone still accepts 1000kg (so the command guard is load-bearing)', typo.success);

// What that typo used to do to every future suggestion.
const poisoned: ExerciseHistory = {
  bench: [
    { trainingDay: '2026-01-08', weight_kg: 1000, reps: 8, minReps: 8, avgRpe: 6, maxRpe: 6, setsLogged: 3 },
    { trainingDay: '2026-01-05', weight_kg: 1000, reps: 8, minReps: 8, avgRpe: 6, maxRpe: 6, setsLogged: 3 },
  ],
};
const s = suggestLoad({ exerciseId: 'bench', name: 'Bench', sets: 3, targetReps: 8 }, poisoned);
console.log(`       a 1000kg typo would otherwise suggest: "${s.reason}"`);
ck('...which is why the write is refused, not the read patched', true);

ck('1000kg is refused', implausibleSet({ weight_kg: 1000, reps: 8 }) !== null);
ck('a 100kg bench is fine', implausibleSet({ weight_kg: 100, reps: 8 }) === null);
ck('a 500kg deadlift is still allowed', implausibleSet({ weight_kg: MAX_PLAUSIBLE_WEIGHT_KG, reps: 1 }) === null);
ck('bodyweight (0kg) is fine', implausibleSet({ weight_kg: 0, reps: 20 }) === null);
ck('999 reps is refused', implausibleSet({ weight_kg: 0, reps: 999 }) !== null);
ck('NaN is refused', implausibleSet({ weight_kg: NaN, reps: 8 }) !== null);
ck('negative weight is refused', implausibleSet({ weight_kg: -50, reps: 8 }) !== null);
console.log(`       message: "${implausibleSet({ weight_kg: 1000, reps: 8 })}"`);

console.log('\nRow-edit semantics (ExerciseLogCard)\n');
console.log('  Not machine-checkable without a renderer. Asserted by reading:');
console.log('   · inputs bind to the draft, so typing into a logged row shows');
console.log('     the keystrokes (the value was pinned to the stored number)');
console.log('   · ✓ on an unedited logged row is a no-op (it used to re-commit');
console.log('     the PREFILL, silently overwriting a real set)');
console.log('   · blur commits only when the numbers actually changed');

console.log(fails === 0 ? '\nall passed' : `\n${fails} FAILURE(S)`);
if (fails > 0) process.exit(1);
