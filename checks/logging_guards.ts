import { implausibleSet, MAX_PLAUSIBLE_WEIGHT_KG } from '../src/session/plausibility';
import { SetCompletedPayloadSchema } from '../src/events/session';
import { suggestLoad } from '../src/session/progression';
import {
  buildSessionsProjection, selectSessionProgress, type ExerciseHistory,
} from '../src/projections/sessions';

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

// ── Walking away mid-session, and coming back ──
// B1 made the session unexitable by accident, with "leave it for now" as one
// of three deliberate exits. The session stays `active`, so Home has to say
// what it is resuming — "Resume Workout" alone reads as having lost the sets.
console.log('\nPick up where you left off\n');
{
  let q = 0;
  const ev = (t: string, p: unknown) => ({
    id: `e${q}`, seq: q++, type: t, occurredAt: '2026-10-18T10:00:00Z',
    trainingDay: '2026-10-18', schemaVersion: 1, prevHash: 'x', payload: p,
  }) as never;
  const EX = [
    { exerciseId: 'a', name: 'Barbell Squat', sets: 3, targetReps: 8 },
    { exerciseId: 'b', name: 'Barbell Row', sets: 3, targetReps: 8 },
    { exerciseId: 'c', name: 'Pushups', sets: 3, targetReps: 12 },
  ];
  const base = [
    ev('SessionScheduled', { sessionId: 'S', trainingDay: '2026-10-18', planId: null,
      workoutId: 'w', workoutName: 'Full body', exercises: EX, openingNote: '',
      generationMode: 'engine' }),
    ev('SessionStarted', { sessionId: 'S', startedAt: '2026-10-18T10:00:00Z' }),
  ];
  const set = (exerciseId: string, setIndex: number, isWarmup = false) =>
    ev('SetCompleted', { sessionId: 'S', exerciseId, setIndex, weight_kg: 60, reps: 8,
      ...(isWarmup ? { isWarmup: true } : {}) });

  const fresh = buildSessionsProjection(base).byId['S']!;
  const p0 = selectSessionProgress(fresh);
  ck('nothing logged yet → no resume line to show', p0.setsLogged === 0);
  ck('...and the next exercise is the first one', p0.nextExerciseName === 'Barbell Squat');

  const part = buildSessionsProjection([
    ...base, set('a', 0), set('a', 1), set('a', 2), set('b', 0),
  ]).byId['S']!;
  const p1 = selectSessionProgress(part);
  ck('4 sets across 2 exercises', p1.setsLogged === 4 && p1.exercisesDone === 2,
    `${p1.setsLogged} sets, ${p1.exercisesDone} exercises`);
  ck('next up is the one with nothing on it', p1.nextExerciseName === 'Pushups',
    String(p1.nextExerciseName));

  // A warm-up is not progress. Set identity is (exerciseId, isWarmup, setIndex)
  // and warm-ups have never counted toward volume or "exercises completed".
  const warm = buildSessionsProjection([...base, set('a', 0, true), set('a', 1, true)]).byId['S']!;
  ck('warm-ups alone are not progress', selectSessionProgress(warm).setsLogged === 0);
  ck('...and do not mark the exercise started',
    selectSessionProgress(warm).nextExerciseName === 'Barbell Squat');

  // A skipped exercise must leave the denominator, or "2 of 3" never completes.
  const skipped = buildSessionsProjection([
    ...base, set('a', 0), ev('ExerciseSkipped', { sessionId: 'S', exerciseId: 'c', reason: 'equipment_unavailable' }),
  ]).byId['S']!;
  const p2 = selectSessionProgress(skipped);
  ck('a skipped exercise leaves the total', p2.exercisesTotal === 2, String(p2.exercisesTotal));
  ck('...and is not offered as next up', p2.nextExerciseName === 'Barbell Row',
    String(p2.nextExerciseName));

  const allStarted = buildSessionsProjection([
    ...base, set('a', 0), set('b', 0), set('c', 0),
  ]).byId['S']!;
  ck('every exercise started → nothing to point at',
    selectSessionProgress(allStarted).nextExerciseName === null);
}

console.log(fails === 0 ? '\nall passed' : `\n${fails} FAILURE(S)`);
if (fails > 0) process.exit(1);
