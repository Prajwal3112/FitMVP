import { canonicalExerciseId as CID } from '../src/data/exercises';
import {
  buildSessionsProjection, selectSessionForDay, selectSessionIndex,
  selectExerciseHistory, selectAdherenceWindow, workingSets,
} from '../src/projections/sessions';
import { buildExtractiveSummary, averageRpe } from '../src/session/summary';

let seq = 0;
const ev = (type: string, trainingDay: string, payload: unknown) => ({
  id: `e${seq}`, seq: seq++, type, occurredAt: '2026-09-21T10:00:00.000Z',
  trainingDay, schemaVersion: 1, prevHash: 'x', payload,
}) as never;

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { console.log(`  FAIL ${name} ${detail}`); failures++; }
};

const SLOTS = [
  { exerciseId: 'bench-press', name: 'Bench Press', sets: 3, targetReps: 8 },
  { exerciseId: 'plank-hold', name: 'Plank Hold', sets: 1, targetDurationSec: 30 },
];
const schedule = (id: string, day: string) => [
  ev('PreCheckinRecorded', day, { sessionId: id, energy: 7, soreness: [] }),
  ev('SessionScheduled', day, {
    sessionId: id, trainingDay: day, planId: null, workoutId: 'gym-a',
    workoutName: 'Push Day', exercises: SLOTS, openingNote: '', generationMode: 'template_fallback',
  }),
  ev('SessionStarted', day, { sessionId: id, startedAt: 'T' }),
];

console.log('\nWarmup sets');
const w = buildSessionsProjection([
  ...schedule('S1', '2026-09-21'),
  ev('SetCompleted', '2026-09-21', { sessionId: 'S1', exerciseId: 'bench-press', setIndex: 0, isWarmup: true, weight_kg: 40, reps: 10, rpe: 4 }),
  ev('SetCompleted', '2026-09-21', { sessionId: 'S1', exerciseId: 'bench-press', setIndex: 1, isWarmup: true, weight_kg: 60, reps: 5 }),
  ev('SetCompleted', '2026-09-21', { sessionId: 'S1', exerciseId: 'bench-press', setIndex: 0, weight_kg: 102.5, reps: 8, rpe: 7 }),
  ev('SetCompleted', '2026-09-21', { sessionId: 'S1', exerciseId: 'bench-press', setIndex: 1, weight_kg: 102.5, reps: 8, rpe: 8.5 }),
  ev('SetCompleted', '2026-09-21', { sessionId: 'S1', exerciseId: 'bench-press', setIndex: 2, weight_kg: 102.5, reps: 7, rpe: 9.5 }),
]);
const s1 = selectSessionForDay(w, '2026-09-21')!;
check('warmup + working share an index without colliding', s1.setLog.length === 5, `got ${s1.setLog.length}`);
check('workingSets() excludes warmups', workingSets(s1.setLog).length === 3, `got ${workingSets(s1.setLog).length}`);
check('per-set RPE curve preserved (7 / 8.5 / 9.5)',
  JSON.stringify(workingSets(s1.setLog).sort((a,b)=>a.setIndex-b.setIndex).map(x=>x.rpe)) === '[7,8.5,9.5]',
  JSON.stringify(workingSets(s1.setLog).map(x=>x.rpe)));
check('warmup RPE excluded from average', averageRpe(s1) === 8.3, `got ${averageRpe(s1)}`);

console.log('\nExerciseHistory ("last: … @ …")');
const done = buildSessionsProjection([
  ...schedule('S1', '2026-09-21'),
  ev('SetCompleted', '2026-09-21', { sessionId: 'S1', exerciseId: 'bench-press', setIndex: 0, isWarmup: true, weight_kg: 40, reps: 10 }),
  ev('SetCompleted', '2026-09-21', { sessionId: 'S1', exerciseId: 'bench-press', setIndex: 0, weight_kg: 100, reps: 8, rpe: 7 }),
  ev('SetCompleted', '2026-09-21', { sessionId: 'S1', exerciseId: 'bench-press', setIndex: 1, weight_kg: 102.5, reps: 8, rpe: 8 }),
  ev('SessionCompleted', '2026-09-21', { sessionId: 'S1', completedAt: 'T', completedExercises: 1, totalExercises: 2 }),
]);
const hist = selectExerciseHistory(done);
check('last set (not first) is the benchmark', hist[CID('bench-press')]?.[0]?.weight_kg === 102.5, JSON.stringify(hist[CID('bench-press')]));
check('reps carried for prefill', hist[CID('bench-press')]?.[0]?.reps === 8);
check('avg rpe across working sets (7 and 8 -> 7.5)', hist[CID('bench-press')]?.[0]?.avgRpe === 7.5, String(hist[CID('bench-press')]?.[0]?.avgRpe));
check('warmup never becomes the benchmark', hist[CID('bench-press')]?.[0]?.weight_kg !== 40);
check('heaviest working set recorded', hist[CID('bench-press')]?.[0]?.weight_kg === 102.5);

console.log('\nIncomplete sessions are not benchmarks');
const abandoned = buildSessionsProjection([
  ...schedule('S9', '2026-09-20'),
  ev('SetCompleted', '2026-09-20', { sessionId: 'S9', exerciseId: 'bench-press', setIndex: 0, weight_kg: 60, reps: 3 }),
]);
check('abandoned session excluded from history', selectExerciseHistory(abandoned)[CID('bench-press')] === undefined);
check('history is newest-first and capped', (selectExerciseHistory(done)[CID('bench-press')] ?? []).length === 1);

console.log('\nTrailing adherence');
const many = buildSessionsProjection([
  ...schedule('A', '2026-09-01'),
  ev('SetCompleted','2026-09-01',{ sessionId:'A', exerciseId:'bench-press', setIndex:0, weight_kg:100, reps:8 }),
  ev('SessionCompleted', '2026-09-01', { sessionId: 'A', completedAt: 'T', completedExercises: 1, totalExercises: 2 }),
  ...schedule('B', '2026-09-08'),
  ev('SessionCompleted', '2026-09-08', { sessionId: 'B', completedAt: 'T', completedExercises: 1, totalExercises: 2 }),
  ev('SessionSkipped', '2026-09-09', { sessionId: 'C', trainingDay: '2026-09-09', reason: 'travel' }),
  ...schedule('D', '2026-09-15'),
  ev('SessionCompleted', '2026-09-15', { sessionId: 'D', completedAt: 'T', completedExercises: 1, totalExercises: 2 }),
]);
const adh = selectAdherenceWindow(many, '2026-09-21', 4);
check('counts completions in window', adh.completed === 3, `got ${adh.completed}`);
check('denominator from daysPerWeek × elapsed', adh.expected >= 3 && adh.expected <= 14, `got ${adh.expected}`);
check('window is meaningful after 7+ days', adh.meaningful === true);
const fresh = selectAdherenceWindow(buildSessionsProjection(schedule('Z','2026-09-21')), '2026-09-21', 4);
check('day-1 user: not meaningful yet', fresh.meaningful === false);
check('day-1 user: denominator never exceeds reality', fresh.expected >= fresh.completed);
const older = selectAdherenceWindow(many, '2026-11-30', 4);
check('sessions outside the 4-week window drop out', older.completed === 0, `got ${older.completed}`);

console.log('\nSummary excludes warmups');
const sum = buildExtractiveSummary(s1);
check('set count is working sets only', sum.summary.includes('3 sets'), sum.summary);
check('top set from working sets', sum.highlights.some(h => h.includes('102.5')), JSON.stringify(sum.highlights));
console.log(`  → "${sum.summary}"`);

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
