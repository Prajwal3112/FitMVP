import { selectNextSession } from '../src/session/nextSession';
import { RECOVERY_HOURS } from '../src/program/resolve';
import { buildSessionsProjection, selectLastCompletedAt } from '../src/projections/sessions';

/**
 * "When can I do the next one?" — asked out loud after an hour on a real
 * phone, with no answer anywhere in the app.
 *
 * The hard part is honesty. THE ROTATION ADVANCES ON COMPLETION, NEVER THE
 * DATE, so there is no "your next session is Thursday" to give, and inventing
 * one would be the first lie in an app whose pitch is that it does not
 * pretend to know things.
 */
let f = 0;
const ck = (n: string, c: boolean, d = '') => {
  if (c) console.log(`  ok   ${n}`); else { console.log(`  FAIL ${n} ${d}`); f++; }
};

// LOCAL dates, built field by field. Written as '2026-10-18T18:00:00Z' the
// first time, which in this machine's timezone is 23:30 on the 18th — so
// "finished at 5pm, checking at 6pm" was actually "finished at 22:30", and
// the day labels looked wrong when they were right. The 4am rollover makes
// every one of these judgements local, so the test has to be local too.
const at = (d: number, h: number) => new Date(2026, 9, d, h, 0, 0);
const NOW = at(18, 18);                       // 6pm on the 18th, local
const hoursAgo = (h: number) =>
  new Date(NOW.getTime() - h * 3_600_000).toISOString();

console.log('\nThe recovery floor is the scheduler\'s own number');
// Two sources of truth for a recovery window would eventually tell someone to
// come back at a time the engine then refuses.
ck('36h, imported not re-declared', RECOVERY_HOURS === 36, String(RECOVERY_HOURS));

console.log('\nWhat it says, and when');
const fresh = selectNextSession(null, 4, NOW);
ck('nothing logged → no gate at all', fresh.hoursToFloor === 0);
ck('...and it says why', fresh.detail.includes('nothing to recover'), fresh.detail);

// THE HEADLINE ANSWERS "WHEN CAN I TRAIN", NOT "WHEN CAN I REPEAT TODAY".
// Conflating them produced a flat contradiction: a 6-day lifter saw "The day
// after tomorrow" over a line reading "your week is most days, so tomorrow is
// the plan". The rotation trains something else tomorrow, so tomorrow is
// available; the 36h floor is about today's muscles, which is the detail's job.
const justFinished = selectNextSession(hoursAgo(1), 4, NOW);
ck('an hour after finishing, a 4-day lifter trains tomorrow',
  justFinished.label === 'Tomorrow', justFinished.label);
ck('...and the detail carries the same-muscle gap instead',
  justFinished.detail.includes('day after tomorrow before you load them again'),
  justFinished.detail);
// The headline must agree with the rhythm line under it — the same
// contradiction, one layer down.
for (const days of [2, 3, 4, 5, 6]) {
  const r = selectNextSession(hoursAgo(1), days, NOW);
  // "every 2 to 3 days" and "Tomorrow" is not a contradiction — on a 3-day
  // week tomorrow genuinely is the next one. Three days or more apart is.
  const saysSparse = /every ([3-9]|\d{2,})( to \d)? days/.test(r.detail);
  ck(`${days}/wk: headline "${r.label}" agrees with the rhythm`,
    saysSparse ? r.label === 'In a day or two' : r.label !== 'In a day or two',
    r.detail);
}
// THE CASE THAT CAUGHT THE UNIT BUG. Same elapsed time is irrelevant; what
// matters is which day the floor lands on. Both checked at 9am on the 19th:
{
  const morning = selectNextSession(at(18, 7).toISOString(), 4, at(19, 9));
  ck('trained 7am yesterday → today\'s muscles clear later today',
    morning.detail.includes('later today before you load them again'), morning.detail);
  const lateNight = selectNextSession(at(18, 23).toISOString(), 4, at(19, 9));
  ck('trained 11pm yesterday → not until tomorrow',
    lateNight.detail.includes('tomorrow before you load them again'), lateNight.detail);
  ck('...so the time of day genuinely changes the answer',
    morning.detail !== lateNight.detail);
}
ck('...with hours still on the clock', justFinished.hoursToFloor > 0);
// NOT "in 14 hours" — that invites someone to train at 2am to beat a counter.
ck('never counts down in hours on screen',
  !/\d+\s*hours? (left|to go|from now)/i.test(justFinished.label + justFinished.detail),
  justFinished.detail);
console.log('  1h ago  → ' + justFinished.label + ' · ' + justFinished.detail);

const yesterday = selectNextSession(hoursAgo(20), 4, NOW);
ck('20h in, still short of the floor', yesterday.hoursToFloor > 0);
const twoDays = selectNextSession(hoursAgo(40), 4, NOW);
ck('40h in, past the floor', twoDays.hoursToFloor === 0);
ck('...and the copy switches to go', twoDays.label === 'Ready when you are', twoDays.label);
console.log('  40h ago → ' + twoDays.label + ' · ' + twoDays.detail);
// The boundary itself, exactly.
ck('the floor clears at exactly 36h', selectNextSession(hoursAgo(36), 4, NOW).hoursToFloor === 0);
ck('and not at 35', selectNextSession(hoursAgo(35), 4, NOW).hoursToFloor > 0);

console.log('\nThe rhythm comes from THEIR answer, not a default');
// A RANGE, not a rounded figure: 7/2 = 3.5 rounded to "every 4 days", which
// is 1.75 sessions a week and not the two they committed to.
for (const [days, must] of [[2, '3 to 4 days'], [3, '2 to 3 days'], [4, 'other day'], [6, 'most days']] as const) {
  const r = selectNextSession(hoursAgo(1), days, NOW);
  ck(`${days} days a week → "${must}"`, r.detail.includes(must), r.detail);
  console.log(`  ${days}/wk → ${r.detail}`);
}
// daysPerWeek was hardcoded to 4 until the onboarding rebuild; a 2-day and a
// 6-day week must not produce the same sentence.
ck('a 2-day and a 6-day week say different things',
  selectNextSession(hoursAgo(1), 2, NOW).detail
  !== selectNextSession(hoursAgo(1), 6, NOW).detail);

console.log('\nIt never promises a date, and never forbids training');
for (const h of [1, 10, 20, 30, 40, 100]) {
  const r = selectNextSession(hoursAgo(h), 4, NOW);
  const text = `${r.label} ${r.detail}`;
  ck(`${h}h: no weekday named`,
    !/monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(text), text);
  ck(`${h}h: nothing is forbidden`,
    !/(do not|don't|must not|cannot) train/i.test(text), text);
}
// The one thing that must be said while under the floor: you may go anyway.
// Phrased as what tomorrow IS rather than as permission — "going sooner is
// fine" invites the reading that there is a rule to break.
ck('under the floor, it says tomorrow trains something else',
  justFinished.detail.includes('trains something else'), justFinished.detail);

console.log('\nGarbage in');
ck('an unparseable timestamp does not produce NaN copy',
  !/NaN/.test(JSON.stringify(selectNextSession('not-a-date', 4, NOW))));
ck('zero days a week does not divide by zero',
  !/Infinity|NaN/.test(JSON.stringify(selectNextSession(hoursAgo(1), 0, NOW))));
ck('a session logged in the future does not read as overdue',
  selectNextSession(new Date(NOW.getTime() + 3_600_000).toISOString(), 4, NOW)
    .hoursToFloor > 0);

console.log('\nThe timestamp it reads');
{
  let q = 0;
  const ev = (t: string, day: string, p: unknown) => ({
    id: `e${q}`, seq: q++, type: t, occurredAt: `${day}T10:00:00Z`,
    trainingDay: day, schemaVersion: 1, prevHash: 'x', payload: p,
  }) as never;
  const sess = (id: string, day: string, done: boolean, at: string) => [
    ev('SessionScheduled', day, { sessionId: id, trainingDay: day, planId: null,
      workoutId: 'w', workoutName: 'W', exercises: [{ exerciseId: 'a', name: 'A', sets: 1, targetReps: 8 }],
      openingNote: '', generationMode: 'engine' }),
    ...(done
      ? [ev('SessionCompleted', day, { sessionId: id, completedAt: at, completedExercises: 1, totalExercises: 1 })]
      : [ev('SessionSkipped', day, { sessionId: id, trainingDay: day, reason: 'time' })]),
  ];
  const p = buildSessionsProjection([
    ...sess('A', '2026-10-14', true, '2026-10-14T19:30:00Z'),
    ...sess('B', '2026-10-16', true, '2026-10-16T07:15:00Z'),
    ...sess('C', '2026-10-17', false, ''),
  ]);
  // selectGap gives the last completed training DAY, which loses the hour —
  // and the floor is measured in hours.
  ck('the most recent COMPLETED session wins',
    selectLastCompletedAt(p) === '2026-10-16T07:15:00Z', String(selectLastCompletedAt(p)));
  ck('a later skip does not count as a session',
    selectLastCompletedAt(p) !== null && !selectLastCompletedAt(p)!.startsWith('2026-10-17'));
  ck('an empty log has no timestamp', selectLastCompletedAt(buildSessionsProjection([])) === null);
}

console.log(f === 0 ? '\nALL PASS\n' : `\n${f} FAILURE(S)\n`);
process.exit(f === 0 ? 0 : 1);
