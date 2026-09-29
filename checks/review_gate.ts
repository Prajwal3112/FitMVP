import { SessionReviewSchema, SessionCompletedPayloadSchema } from '../src/events/session';
import { buildSessionsProjection } from '../src/projections/sessions';
import { buildDigest } from '../src/dev/digest';
import { selectContextCompleteness } from '../src/context/completeness';
import { INITIAL_USER_CONTEXT } from '../src/projections/userContext';
import { hashEvent, GENESIS_PREV_HASH } from '../src/events/base';
import type { Event } from '../src/events';

/**
 * A finished session must carry the tester's own verdict.
 *
 * `completeSession` throws `review_required` without one, so the gate itself is
 * only reachable through the DB-bound command layer. What is checkable here:
 * the schema accepts what the screen produces, the projection carries it, and
 * the digest surfaces it — because a review nobody can read is no review.
 */
let fails = 0;
const ck = (n: string, c: boolean, extra = '') => {
  if (c) console.log(`  ok   ${n}`); else { fails++; console.log(`  FAIL ${n} ${extra}`); }
};

console.log('\nThe review shape\n');
ck('a one-tap review is valid (gripes and note optional)',
  SessionReviewSchema.safeParse({ verdict: 'about_right' }).success);
ck('a full review is valid',
  SessionReviewSchema.safeParse({
    verdict: 'too_much', gripes: ['something_hurt', 'too_long'], note: 'shoulder twinged on press',
  }).success);
ck('a verdict is REQUIRED', !SessionReviewSchema.safeParse({ gripes: [] }).success);
ck('an unknown verdict is refused', !SessionReviewSchema.safeParse({ verdict: 'meh' }).success);
ck('an unknown gripe is refused',
  !SessionReviewSchema.safeParse({ verdict: 'too_easy', gripes: ['vibes'] }).success);
ck('a 5000-char essay is refused (log bloat)',
  !SessionReviewSchema.safeParse({ verdict: 'too_easy', note: 'x'.repeat(5000) }).success);
ck('gripes default to [] so the screen need not send them',
  SessionReviewSchema.parse({ verdict: 'too_easy' }).gripes.length === 0);

console.log('\nBackward compatibility — history written before reviews existed\n');
ck('a SessionCompleted with NO review still parses (widening, no version bump)',
  SessionCompletedPayloadSchema.safeParse({
    sessionId: 's', completedAt: '2026-01-01T10:00:00.000Z',
    completedExercises: 6, totalExercises: 6,
  }).success);

console.log('\nIt reaches the projection and the digest\n');
let seq = 0; let prevHash = GENESIS_PREV_HASH;
const evs: Event[] = [];
const push = (type: string, payload: Record<string, unknown>) => {
  const e = { id: `id${seq}`, seq, type, occurredAt: '2026-01-05T09:00:00.000Z',
    trainingDay: '2026-01-05', schemaVersion: 1, prevHash, payload } as unknown as Event;
  evs.push(e); prevHash = hashEvent(e); seq += 1;
};
push('SessionScheduled', { sessionId: 's1', trainingDay: '2026-01-05', planId: null,
  workoutId: 'w', workoutName: 'Upper body', openingNote: '', generationMode: 'template_fallback',
  exercises: [{ exerciseId: 'bench', name: 'Bench Press', sets: 3, targetReps: 8 }] });
push('SessionStarted', { sessionId: 's1', startedAt: '2026-01-05T09:00:00.000Z' });
push('SetCompleted', { sessionId: 's1', exerciseId: 'bench', setIndex: 0, weight_kg: 60, reps: 8, rpe: 7 });
push('SessionCompleted', { sessionId: 's1', completedAt: '2026-01-05T10:00:00.000Z',
  completedExercises: 1, totalExercises: 1,
  review: { verdict: 'too_much', gripes: ['something_hurt', 'too_long'],
    note: 'left shoulder complained on the last set' } });

const proj = buildSessionsProjection(evs);
const s1 = proj.byId['s1'];
ck('the projection carries the review', s1?.review?.verdict === 'too_much', JSON.stringify(s1?.review));
ck('gripes survive the fold', s1?.review?.gripes.length === 2);

const digest = buildDigest(proj, selectContextCompleteness(proj, '2026-01-06'),
  INITIAL_USER_CONTEXT, 'test');
for (const [label, needle] of [
  ['the verdict tally', '1 too much'],
  ['the per-session verdict', 'VERDICT: too_much'],
  ['the gripes', 'something_hurt'],
  ['the free text', 'left shoulder complained'],
] as const) {
  ck(`the digest reports ${label}`, digest.includes(needle), digest.slice(0, 200));
}

console.log('\n  --- what lands in your chat thread ---');
digest.split('\n').filter((l) => /VERDICT|GRIPES|verdict|shoulder|▸/.test(l))
  .forEach((l) => console.log(`  ${l}`));

console.log(fails === 0 ? '\nall passed' : `\n${fails} FAILURE(S)`);
if (fails > 0) process.exit(1);
