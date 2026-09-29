import { reentryPolicy, scaleLoad, scaleSets, isPhysiological } from '../src/session/reentry';
import { buildSessionsProjection, selectGap } from '../src/projections/sessions';

let fails = 0;
const check = (n: string, c: boolean, d = '') => {
  if (c) console.log(`  ok   ${n}`); else { console.log(`  FAIL ${n} ${d}`); fails++; }
};
const base = { skipReasons: [], sessionsBefore: 14, adherenceBefore: { completed: 12, expected: 16 } };

console.log('\nBands');
// `mode` here is what reentryPolicy RETURNS, which is now rhythm-relative,
// not a direct read of the band table: ReturnHome replaces Home entirely, so
// at an absolute 4 days a twice-a-week trainer met the lapse screen every
// Monday. 4d is silent at the default 4x/week; 5d is the first real gap.
// Per-rhythm coverage lives in checks/reentry_rhythm.ts.
for (const [days, mode] of [[1,'none'],[3,'none'],[4,'none'],[5,'continue'],[10,'continue'],[11,'ease_back'],[21,'ease_back'],[30,'ease_back'],[56,'ease_back'],[70,'rebuild'],[120,'rebuild'],[200,'restart']] as const) {
  const p = reentryPolicy({ ...base, gapDays: days });
  check(`${String(days).padStart(3)}d → ${mode}`, p.mode === mode, p.mode);
}

console.log('\nA rest day is not a lapse');
const rest = reentryPolicy({ ...base, gapDays: 2 });
check('says nothing at all', rest.speak === false);
check('no load change', rest.loadMultiplier === 1);
check('no headline', rest.headline === '');

console.log('\nThe 9-day gap (Meera\'s case)');
const m = reentryPolicy({ ...base, gapDays: 9, skipReasons: ['illness'] });
check('continue — nothing measurable lost', m.mode === 'continue', m.mode);
check('speaks', m.speak === true);
check('reframes with evidence', m.evidence.length >= 2, String(m.evidence.length));
console.log(`  → "${m.headline}"`);
m.evidence.forEach(e => console.log(`     ${e}`));
console.log(`     ${m.rationale}`);

console.log('\nIllness costs more than the calendar');
const ill = reentryPolicy({ ...base, gapDays: 30, skipReasons: ['illness'] });
const lazy = reentryPolicy({ ...base, gapDays: 30, skipReasons: ['unmotivated'] });
check('illness is classed physiological', isPhysiological('illness') === true);
check('unmotivated is not', isPhysiological('unmotivated') === false);
check('illness → lower load than same-length unmotivated gap',
  ill.loadMultiplier < lazy.loadMultiplier, `${ill.loadMultiplier} vs ${lazy.loadMultiplier}`);

console.log('\nThe narrative gap leads with retention, not sympathy');
check('mentions losing less than it feels', lazy.rationale.includes('less than it feels'), lazy.rationale);
check('explains the ramp is about tendons', lazy.rationale.includes('tendons'), lazy.rationale);
console.log(`  → "${lazy.rationale}"`);

console.log('\nScaling is loadable and never rounds up');
const p70 = reentryPolicy({ ...base, gapDays: 70 });
check('100kg at 75% → 75', scaleLoad(100, p70) === 75, String(scaleLoad(100, p70)));
check('102.5kg scales to a loadable bar', scaleLoad(102.5, p70) % 1.25 === 0, String(scaleLoad(102.5, p70)));
check('never rounds up', scaleLoad(100, p70) <= 75);
check('bodyweight stays 0', scaleLoad(0, p70) === 0);
check('4 sets at 75% → 3', scaleSets(4, p70) === 3, String(scaleSets(4, p70)));
check('1 set never becomes 0', scaleSets(1, p70) >= 1);

console.log('\nselectGap reads the real log');
let seq = 0;
const ev = (type: string, day: string, payload: unknown) => ({
  id: `e${seq}`, seq: seq++, type, occurredAt: '2026-09-01T10:00:00Z',
  trainingDay: day, schemaVersion: 1, prevHash: 'x', payload,
}) as never;
const SLOT = [{ exerciseId: 'bench-press', name: 'Bench Press', sets: 2, targetReps: 8 }];
const sched = (id: string, day: string) => [
  ev('SessionScheduled', day, { sessionId: id, trainingDay: day, planId: null, workoutId: 'g', workoutName: 'Push Day', exercises: SLOT, openingNote: '', generationMode: 'template_fallback' }),
  ev('SessionStarted', day, { sessionId: id, startedAt: 'T' }),
];
const proj = buildSessionsProjection([
  ...sched('A', '2026-09-01'),
  ev('SetCompleted', '2026-09-01', { sessionId: 'A', exerciseId: 'bench-press', setIndex: 0, weight_kg: 100, reps: 8 }),
  ev('SetCompleted', '2026-09-01', { sessionId: 'A', exerciseId: 'bench-press', setIndex: 1, weight_kg: 102.5, reps: 6 }),
  ev('SessionCompleted', '2026-09-01', { sessionId: 'A', completedAt: 'T', completedExercises: 1, totalExercises: 1 }),
  ev('SessionSkipped', '2026-09-03', { sessionId: 'B', trainingDay: '2026-09-03', reason: 'illness' }),
  ev('SessionSkipped', '2026-09-05', { sessionId: 'C', trainingDay: '2026-09-05', reason: 'illness' }),
]);
const gap = selectGap(proj, '2026-09-10');
check('gap measured from last COMPLETED session', gap.gapDays === 9, String(gap.gapDays));
check('skip reasons since the gap collected', gap.skipReasons.length === 2, JSON.stringify(gap.skipReasons));
check('sessions before the gap counted', gap.sessionsBefore === 1, String(gap.sessionsBefore));
check('best lift is the heaviest working set', gap.bestLift?.weight_kg === 102.5, JSON.stringify(gap.bestLift));
check('no gap on a fresh log', selectGap(buildSessionsProjection([]), '2026-09-10').gapDays === 0);

console.log(fails === 0 ? '\nALL PASS\n' : `\n${fails} FAILURE(S)\n`);
process.exit(fails === 0 ? 0 : 1);
