import { SetCompletedPayloadSchema, SetRemovedPayloadSchema } from '../src/events/session';
import { buildSessionsProjection, workingSets } from '../src/projections/sessions';
import { MAX_SETS_PER_EXERCISE } from '../src/session/plausibility';
import { hashEvent, GENESIS_PREV_HASH } from '../src/events/base';
import { CURRENT_VERSION } from '../src/events/upcast';
import type { Event } from '../src/events';

/**
 * The app suggests. It does not enforce. It records what you did.
 *
 * `logSet` used to throw "Set 4 exceeds the 3 prescribed" — one line that made
 * the whole app a prescriber rather than a logger. If it said 3 sets and you
 * did 5, sets 4 and 5 did not exist. Every real session breaks the plan within
 * ten minutes, and the app's answer was to refuse the evidence.
 *
 * It also threw away the signal this project is about: a cut set says the day
 * was hard, two extra say there was more in the tank. Deviation IS the data for
 * training around imperfect adherence.
 */
let fails = 0;
const ck = (n: string, c: boolean, extra = '') => {
  if (c) console.log(`  ok   ${n}`); else { fails++; console.log(`  FAIL ${n} ${extra}`); }
};

let seq = 0; let prevHash = GENESIS_PREV_HASH;
const evs: Event[] = [];
const push = (type: string, payload: Record<string, unknown>) => {
  const e = { id: `i${seq}`, seq, type, occurredAt: '2026-10-04T09:00:00.000Z',
    trainingDay: '2026-10-04', schemaVersion: 1, prevHash, payload } as unknown as Event;
  evs.push(e); prevHash = hashEvent(e); seq += 1;
};

console.log('\nPrescribed 3, did 5\n');
push('SessionScheduled', { sessionId: 's1', trainingDay: '2026-10-04', planId: null,
  workoutId: 'w', workoutName: 'Upper body', openingNote: '', generationMode: 'template_fallback',
  exercises: [{ exerciseId: 'bench', name: 'Bench Press', sets: 3, targetReps: 8 }] });
push('SessionStarted', { sessionId: 's1', startedAt: '2026-10-04T09:00:00.000Z' });
for (let i = 0; i < 5; i++) {
  push('SetCompleted', { sessionId: 's1', exerciseId: 'bench', setIndex: i, weight_kg: 60, reps: 8, rpe: 7 });
}
let proj = buildSessionsProjection(evs);
ck('all five sets are recorded, not three',
  workingSets(proj.byId['s1']!.setLog).length === 5,
  String(workingSets(proj.byId['s1']!.setLog).length));
ck('the prescription still says 3 (a suggestion, not a cap)',
  proj.byId['s1']!.exercises[0]!.sets === 3);
ck('set 4 and 5 pass the payload schema',
  SetCompletedPayloadSchema.safeParse({ sessionId: 's1', exerciseId: 'bench', setIndex: 4, weight_kg: 60, reps: 8 }).success);

console.log('\nTaking a set back\n');
push('SetRemoved', { sessionId: 's1', exerciseId: 'bench', setIndex: 4 });
proj = buildSessionsProjection(evs);
ck('the removed set is gone from the projection',
  workingSets(proj.byId['s1']!.setLog).length === 4,
  String(workingSets(proj.byId['s1']!.setLog).length));
ck('the right one went (index 4, not another)',
  !proj.byId['s1']!.setLog.some((x) => x.setIndex === 4 && !x.isWarmup));
ck('the original SetCompleted is STILL in the log (tombstone, not deletion)',
  evs.some((e) => e.type === 'SetCompleted' && (e.payload as { setIndex: number }).setIndex === 4));

// Re-logging after a removal must work — people undo and redo.
push('SetCompleted', { sessionId: 's1', exerciseId: 'bench', setIndex: 4, weight_kg: 65, reps: 6, rpe: 9 });
proj = buildSessionsProjection(evs);
const back = proj.byId['s1']!.setLog.find((x) => x.setIndex === 4 && !x.isWarmup);
ck('re-logging after a removal works, with the new numbers',
  back?.weight_kg === 65 && back?.reps === 6, JSON.stringify(back));

console.log('\nWarm-ups keep their own index space\n');
push('SetCompleted', { sessionId: 's1', exerciseId: 'bench', setIndex: 0, isWarmup: true, weight_kg: 20, reps: 10 });
push('SetRemoved', { sessionId: 's1', exerciseId: 'bench', setIndex: 0, isWarmup: true });
proj = buildSessionsProjection(evs);
ck('removing warm-up 0 does not touch working set 0',
  proj.byId['s1']!.setLog.some((x) => x.setIndex === 0 && !x.isWarmup) &&
  !proj.byId['s1']!.setLog.some((x) => x.setIndex === 0 && x.isWarmup));

console.log('\nThe sanity cap is a cap, not a prescription limit\n');
ck(`${MAX_SETS_PER_EXERCISE} sets per exercise is far above any real session`,
  MAX_SETS_PER_EXERCISE >= 20 && MAX_SETS_PER_EXERCISE <= 50, String(MAX_SETS_PER_EXERCISE));
ck('SetRemoved is registered for upcasting (a new type must be)',
  CURRENT_VERSION['SetRemoved'] !== undefined);
ck('a SetRemoved payload validates', SetRemovedPayloadSchema.safeParse(
  { sessionId: 's1', exerciseId: 'bench', setIndex: 2 }).success);

console.log(fails === 0 ? '\nall passed' : `\n${fails} FAILURE(S)`);
if (fails > 0) process.exit(1);
