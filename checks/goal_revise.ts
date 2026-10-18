import { buildGoalProjection } from '../src/projections/goal';
import { draftGoalCreated, draftGoalRevised } from '../src/events/goal';
import { buildDigest } from '../src/dev/digest';
import { buildSessionsProjection } from '../src/projections/sessions';
import { buildUserContextProjection } from '../src/projections/userContext';
import { selectContextCompleteness } from '../src/context/completeness';

/**
 * Changing your goal.
 *
 * `submitGoal` always appended `GoalCreated`, so a tester who changed their
 * mind ended with two live goals in the log and `revisionCount` stuck at 0
 * forever. `GoalRevised` had a schema and a reducer that increments the count
 * and no emitter anywhere — the same end-to-end-but-dead shape the
 * mid-session swap had.
 *
 * "They changed their goal in week two" is exactly the kind of thing a
 * four-week test exists to find, and a duplicate GoalCreated destroys it.
 */
let f = 0;
const ck = (n: string, c: boolean, d = '') => {
  if (c) console.log(`  ok   ${n}`); else { console.log(`  FAIL ${n} ${d}`); f++; }
};

let q = 0;
const wrap = (draft: { type: string; schemaVersion: number; payload: unknown }, day: string) => ({
  id: `e${q}`, seq: q++, occurredAt: `${day}T10:00:00.000Z`, trainingDay: day,
  prevHash: 'x', ...draft,
}) as never;

const created = wrap(draftGoalCreated({
  goalId: 'G1', goalType: 'fat_loss',
  why: 'wedding in June', targetDate: '2027-06-01',
}), '2026-09-28');

console.log('\nThe first goal');
const one = buildGoalProjection([created]);
ck('is created, not revised', one.goalId === 'G1' && one.revisionCount === 0);
ck('carries the type and the why', one.goalType === 'fat_loss' && one.why === 'wedding in June');

console.log('\nChanging it revises, it does not duplicate');
const revised = buildGoalProjection([
  created,
  wrap(draftGoalRevised({
    goalId: 'G1', field: 'goalType', before: 'fat_loss', after: 'hypertrophy',
  }), '2026-10-12'),
  wrap(draftGoalRevised({
    goalId: 'G1', field: 'why', before: 'wedding in June', after: 'want to feel strong again',
  }), '2026-10-12'),
]);
ck('the same goal id survives', revised.goalId === 'G1');
ck('the new type applies', revised.goalType === 'hypertrophy', String(revised.goalType));
ck('the new why applies', revised.why === 'want to feel strong again', revised.why);
ck('the target date is untouched', revised.targetDate === '2027-06-01');
// The whole point: the log remembers that it MOVED.
ck('two fields changed → two revisions counted', revised.revisionCount === 2,
  String(revised.revisionCount));

console.log('\nOne event per changed field, so `before` stays truthful');
const typeOnly = buildGoalProjection([
  created,
  wrap(draftGoalRevised({
    goalId: 'G1', field: 'goalType', before: 'fat_loss', after: 'strength',
  }), '2026-10-12'),
]);
ck('revising the type leaves the why alone', typeOnly.why === 'wedding in June');
ck('...and counts one revision', typeOnly.revisionCount === 1);

console.log('\nA revision aimed at a goal that is not current is ignored');
// Guards against a stale screen writing against a goal that was replaced.
const stale = buildGoalProjection([
  created,
  wrap(draftGoalRevised({
    goalId: 'SOMEONE_ELSE', field: 'why', before: 'x', after: 'should not apply',
  }), '2026-10-12'),
]);
ck('the why is unchanged', stale.why === 'wedding in June', stale.why);
ck('and nothing is counted', stale.revisionCount === 0);

console.log('\nThe report says it happened');
// The digest prints "(revised N×)" and that line could never fire.
const sessions = buildSessionsProjection([]);
const d = buildDigest(
  sessions, selectContextCompleteness(sessions, '2026-10-18'),
  buildUserContextProjection([]), 'test', [], revised,
);
ck('the revision count reaches the report', d.includes('revised 2×'),
  d.split('\n').filter((l) => l.includes('hypertrophy')).join(' | '));
ck('...and so does the goal they moved TO', d.includes('hypertrophy'));
ck('a never-revised goal says nothing about revisions',
  !buildDigest(
    sessions, selectContextCompleteness(sessions, '2026-10-18'),
    buildUserContextProjection([]), 'test', [], one,
  ).includes('revised'));

console.log(f === 0 ? '\nALL PASS\n' : `\n${f} FAILURE(S)\n`);
process.exit(f === 0 ? 0 : 1);
