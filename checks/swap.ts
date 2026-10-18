import { proposeSwaps, canSwap, SWAP_REASONS } from '../src/session/swap';
import { buildSessionsProjection, applySessionEvent } from '../src/projections/sessions';
import { getExercise, loadsInjury } from '../src/data/exercises';
import { ExerciseSubstitutedPayloadSchema } from '../src/events/session';
import type { SessionState } from '../src/projections/sessions';

/**
 * Mid-session swap — "the machine is taken".
 *
 * The first thing the founder hit in an hour of real use, and the app's only
 * answer was Skip: drops the slot, loses the volume, and tells the engine you
 * avoided the movement.
 *
 * `findSubstitutesTiered` had zero consumers and `ExerciseSubstituted` zero
 * emitters, although the projection already applied it and the card already
 * rendered `swappedFrom`. The machinery existed end to end with nothing to
 * start it — this project's signature failure, in its purest form.
 */
let f = 0;
const ck = (n: string, c: boolean, d = '') => {
  if (c) console.log(`  ok   ${n}`); else { console.log(`  FAIL ${n} ${d}`); f++; }
};

let q = 0;
const ev = (t: string, p: unknown) => ({
  id: `e${q}`, seq: q++, type: t, occurredAt: '2026-10-18T10:00:00Z',
  trainingDay: '2026-10-18', schemaVersion: 1, prevHash: 'x', payload: p,
}) as never;

const BENCH = 'Barbell_Bench_Press_-_Medium_Grip';
const SQUAT = 'Barbell_Squat';
const EX = [
  { exerciseId: BENCH, name: 'Barbell Bench Press', sets: 3, targetReps: 8 },
  { exerciseId: SQUAT, name: 'Barbell Squat', sets: 3, targetReps: 8 },
];
const open = [
  ev('SessionScheduled', { sessionId: 'S', trainingDay: '2026-10-18', planId: null,
    workoutId: 'w', workoutName: 'Full body', exercises: EX, openingNote: '',
    generationMode: 'engine' }),
  ev('SessionStarted', { sessionId: 'S', startedAt: '2026-10-18T10:00:00Z' }),
];
const sessionOf = (extra: unknown[] = []): SessionState =>
  buildSessionsProjection([...open, ...extra] as never).byId['S']!;

const live = sessionOf();
const GYM = { equipment: 'gym' as const };

console.log('\nThe options offered');
const eq = proposeSwaps(live, BENCH, 'equipment', GYM);
ck('a gym bench press has alternatives', eq.ok && eq.options.length > 0);
if (eq.ok) {
  console.log('  taken → ' + eq.options.map((o) => `${o.exercise.name} (T${o.tier})`).join(' · '));
  ck('all of them train the chest',
    eq.options.every((o) => o.exercise.pm.includes('chest')),
    eq.options.map((o) => o.exercise.pm.join('/')).join(' | '));
  ck('best first — tiers never go backwards',
    eq.options.every((o, i) => i === 0 || o.tier >= eq.options[i - 1]!.tier),
    eq.options.map((o) => o.tier).join(','));
  // THE POINT OF TIER 1. bench → cable fly trains the same muscle and
  // discards your load history; bench → dumbbell press keeps it.
  ck('"can\'t get to it" leads with the same movement pattern',
    eq.options[0]!.exercise.pat === getExercise(BENCH)!.pat,
    `${eq.options[0]!.exercise.pat} vs ${getExercise(BENCH)!.pat}`);
  ck('...and says so, in the words that matter',
    eq.options[0]!.note.includes('carry over'), eq.options[0]!.note);
  // Without staple-first ordering the top offer was "Alternating Floor Press"
  // — the exact obscure-variant failure `staple: true` was declared to fix.
  ck('the first offer is a lift a coach would name',
    eq.options[0]!.exercise.staple === true, eq.options[0]!.exercise.name);
}

console.log('\nPain INVERTS the ranking');
const pain = proposeSwaps(live, BENCH, 'pain', GYM);
ck('it hurts → alternatives exist', pain.ok && pain.options.length > 0);
if (pain.ok && eq.ok) {
  console.log('  hurts → ' + pain.options.map((o) => o.exercise.name).join(' · '));
  // A hurting shoulder should not be handed another press.
  ck('the top suggestion is NOT the same pattern it hurt on',
    pain.options[0]!.exercise.pat !== getExercise(BENCH)!.pat,
    pain.options[0]!.exercise.pat);
  ck('pain and equipment give different first answers',
    pain.options[0]!.exercise.id !== eq.options[0]!.exercise.id,
    `${pain.options[0]!.exercise.name} / ${eq.options[0]!.exercise.name}`);
}

console.log('\nA swap can never bypass a safety rule');
// §8.7 is enforced in the scheduler. A user-chosen swap that ignored it would
// be worse than offering no swap at all.
const hurt = proposeSwaps(live, BENCH, 'equipment', { ...GYM, injuries: ['shoulders'] });
ck('nothing offered loads a flagged injury',
  !hurt.ok || hurt.options.every((o) => !loadsInjury(o.exercise, ['shoulders'])),
  hurt.ok ? hurt.options.map((o) => o.exercise.name).join(', ') : hurt.reason);
const homeNothing = proposeSwaps(live, BENCH, 'equipment', { equipment: 'home' });
ck('a home user owning nothing is offered only bodyweight work',
  !homeNothing.ok || homeNothing.options.every((o) => o.exercise.eq === 'body only'),
  homeNothing.ok ? homeNothing.options.map((o) => o.exercise.eq).join(',') : homeNothing.reason);
const beginner = proposeSwaps(live, BENCH, 'equipment', { ...GYM, beginnerOnly: true });
ck('a novice is not offered expert movements',
  !beginner.ok || beginner.options.every((o) => o.exercise.lvl !== 'expert'));

console.log('\nNever offer what is already in the session');
// Offering the squat from slot 2 as a replacement for slot 1 would quietly
// halve the session's coverage.
const squatSwap = proposeSwaps(live, SQUAT, 'equipment', GYM);
ck('the other slot in today\'s session is excluded',
  !squatSwap.ok || squatSwap.options.every((o) => o.exercise.id !== BENCH));
ck('and so is the exercise being replaced',
  !squatSwap.ok || squatSwap.options.every((o) => o.exercise.id !== SQUAT));

console.log('\nA dead end says so, honestly');
const nowhere = proposeSwaps(live, 'not-a-real-exercise', 'equipment', GYM);
ck('an unknown exercise fails with a reason, not a crash', !nowhere.ok);

console.log('\nWhen a swap is allowed');
ck('a fresh slot in a live session can be swapped', canSwap(live, BENCH) === null,
  String(canSwap(live, BENCH)));
// THE GUARD THAT MATTERS. Sets are keyed by exerciseId in an append-only log:
// swapping after logging would orphan them onto a movement that is no longer
// in the session, corrupting both the completed count and that lift's history.
const logged = sessionOf([
  ev('SetCompleted', { sessionId: 'S', exerciseId: BENCH, setIndex: 0, weight_kg: 80, reps: 8 }),
]);
ck('once a set is logged, no', canSwap(logged, BENCH) !== null);
ck('...and the reason is actionable',
  (canSwap(logged, BENCH) ?? '').includes('already logged'), String(canSwap(logged, BENCH)));
// A WARM-UP IS NOT A COMMITMENT. You warm up, find the bench is taken, and
// must still be able to move. Set identity is (exerciseId, isWarmup, setIndex)
// and a warm-up has never counted toward volume or completion.
const warmed = sessionOf([
  ev('SetCompleted', { sessionId: 'S', exerciseId: BENCH, setIndex: 0, weight_kg: 40,
    reps: 10, isWarmup: true }),
]);
ck('a warm-up alone does NOT lock the slot', canSwap(warmed, BENCH) === null,
  String(canSwap(warmed, BENCH)));
const skipped = sessionOf([
  ev('ExerciseSkipped', { sessionId: 'S', exerciseId: BENCH, reason: 'user_skipped' }),
]);
ck('an already-skipped exercise cannot be swapped', canSwap(skipped, BENCH) !== null);
ck('a slot not in the session cannot be swapped', canSwap(live, 'Pushups') !== null);
const done = sessionOf([
  ev('SetCompleted', { sessionId: 'S', exerciseId: SQUAT, setIndex: 0, weight_kg: 100, reps: 5 }),
  ev('SessionCompleted', { sessionId: 'S', completedAt: 'T', completedExercises: 1, totalExercises: 2 }),
]);
ck('a finished session cannot be swapped', canSwap(done, BENCH) !== null);

console.log('\nThe event, and what the projection does with it');
const payload = {
  sessionId: 'S', originalExerciseId: BENCH,
  substituteExerciseId: 'Dumbbell_Bench_Press', substituteName: 'Dumbbell Bench Press',
  reason: 'equipment_unavailable' as const, proposedBy: 'user' as const,
};
ck('the payload passes its own Zod schema',
  ExerciseSubstitutedPayloadSchema.safeParse(payload).success);
const after = applySessionEvent(
  buildSessionsProjection(open as never),
  ev('ExerciseSubstituted', payload),
);
const slot = after.byId['S']!.exercises[0]!;
ck('the slot is replaced in place, keeping its position',
  slot.exerciseId === 'Dumbbell_Bench_Press' && slot.name === 'Dumbbell Bench Press',
  slot.exerciseId);
ck('the other slot is untouched', after.byId['S']!.exercises[1]!.exerciseId === SQUAT);
ck('the session still has the same number of exercises',
  after.byId['S']!.exercises.length === 2);
// An audit trail, not a mutation: the log says what was asked for and why.
ck('the swap is recorded, with its reason',
  after.byId['S']!.substitutions[0]?.originalExerciseId === BENCH
  && after.byId['S']!.substitutions[0]?.reason === 'equipment_unavailable');
// And a swap must leave the slot swappable again — the replacement might also
// be taken.
ck('the replacement can itself be swapped',
  canSwap(after.byId['S']!, 'Dumbbell_Bench_Press') === null,
  String(canSwap(after.byId['S']!, 'Dumbbell_Bench_Press')));

console.log('\nThe two reasons the screen offers');
ck('both are real SwapReason values', SWAP_REASONS.length === 2);
ck('each explains itself', SWAP_REASONS.every((r) => r.sub.length > 10));

console.log(f === 0 ? '\nALL PASS\n' : `\n${f} FAILURE(S)\n`);
process.exit(f === 0 ? 0 : 1);
