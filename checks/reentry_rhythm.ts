import { reentryPolicy } from '../src/session/reentry';

/**
 * The lapse screen REPLACES Home, so speaking when nothing is wrong costs
 * the user every route on it — goal, setup, adherence, session preview.
 * A gap is only a gap relative to the user's own training frequency.
 */
let fails = 0;
const ck = (n: string, c: boolean, extra = '') => {
  if (c) console.log(`  ok   ${n}`); else { fails++; console.log(`  FAIL ${n} ${extra}`); }
};

const p = (gapDays: number, daysPerWeek: number, sessionsBefore = 12) =>
  reentryPolicy({ gapDays, daysPerWeek, sessionsBefore, skipReasons: [] });

console.log('\nNormal rhythm must NOT trigger the lapse screen\n');
ck('6x/week, 1 day off  -> silent', !p(1, 6).speak);
ck('4x/week, 2 days off -> silent', !p(2, 4).speak);
ck('3x/week, 3 days off -> silent', !p(3, 3).speak);
ck('2x/week, 4 days off -> silent  (was: lapse screen every Monday)', !p(4, 2).speak);
ck('2x/week, 5 days off -> silent', !p(5, 2).speak);
ck('1x/week, 7 days off -> silent', !p(7, 1).speak);

console.log('\nA real gap must still be caught\n');
ck('2x/week, 15 days off -> speaks', p(15, 2).speak);
ck('4x/week, 11 days off -> speaks', p(11, 4).speak);
ck('6x/week, 12 days off -> speaks', p(12, 6).speak);
ck('any rhythm, 60 days  -> speaks', p(60, 2).speak && p(60, 6).speak);

console.log('\nCopy must not blame the user\n');
const one = p(30, 3, 1);
ck('one prior session reads as English, not "trained 1 times"',
  !one.evidence.some((e) => /1 times/.test(e)), one.evidence.join(' | '));
const zeroAdherence = reentryPolicy({
  gapDays: 30, daysPerWeek: 3, sessionsBefore: 12, skipReasons: [],
  adherenceBefore: { completed: 0, expected: 12 },
});
ck('a 0-of-12 adherence line is suppressed, not printed',
  !zeroAdherence.evidence.some((e) => /0 of your last/.test(e)),
  zeroAdherence.evidence.join(' | '));
const good = reentryPolicy({
  gapDays: 30, daysPerWeek: 3, sessionsBefore: 12, skipReasons: [],
  adherenceBefore: { completed: 9, expected: 12 },
});
ck('a good adherence line IS printed', good.evidence.some((e) => /9 of your last 12/.test(e)));

console.log('\nWhat a 30-day return actually says:');
const r = p(30, 3);
console.log(`  "${r.headline}"`);
r.evidence.forEach((e) => console.log(`  · ${e}`));
console.log(`  ${r.rationale}`);

console.log(fails === 0 ? '\nall passed' : `\n${fails} FAILURE(S)`);
if (fails > 0) process.exit(1);
