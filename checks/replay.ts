import { canonicalExerciseId as CID } from '../src/data/exercises';
// Replay test for the Step 7a session projections (BLUEPRINT Part 6, Weakness 8).
// Feeds synthetic events through the reducers and asserts the resulting state.
import {
  buildSessionsProjection,
  selectSessionForDay,
  selectSessionIndex,
  selectExerciseHistory,
} from '../src/projections/sessions';
import {
  buildStreakProjection,
  selectAdherencePct,
} from '../src/projections/streak';
import { buildExtractiveSummary } from '../src/session/summary';

let seq = 0;
const ev = (type: string, trainingDay: string, payload: unknown) => ({
  id: `e${seq}`, seq: seq++, type, occurredAt: '2026-09-21T10:00:00.000Z',
  trainingDay, schemaVersion: 1, prevHash: 'x', payload,
}) as never;

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { console.log(`  ok   ${name}`); }
  else { console.log(`  FAIL ${name} ${detail}`); failures++; }
};

const SLOTS = [
  { exerciseId: 'bench-press', name: 'Bench Press', sets: 2, targetReps: 8 },
  { exerciseId: 'plank-hold', name: 'Plank Hold', sets: 1, targetDurationSec: 30 },
];

// ── Scenario 1: full happy path ───────────────────────────────────────
console.log('\nScenario 1 — check-in → schedule → start → sets → complete');
const s1 = [
  ev('PreCheckinRecorded', '2026-09-21', { sessionId: 'S1', energy: 7, soreness: [] }),
  ev('SessionScheduled', '2026-09-21', {
    sessionId: 'S1', trainingDay: '2026-09-21', planId: null,
    workoutId: 'gym-a', workoutName: 'Push Day', exercises: SLOTS,
    openingNote: 'Steady day.', generationMode: 'template_fallback',
  }),
  ev('SessionStarted', '2026-09-21', { sessionId: 'S1', startedAt: 'T' }),
  ev('SetCompleted', '2026-09-21', { sessionId: 'S1', exerciseId: 'bench-press', setIndex: 0, weight_kg: 60, reps: 8 }),
  ev('SetCompleted', '2026-09-21', { sessionId: 'S1', exerciseId: 'bench-press', setIndex: 1, weight_kg: 60, reps: 7 }),
  ev('SessionCompleted', '2026-09-21', { sessionId: 'S1', completedAt: 'T', completedExercises: 1, totalExercises: 2 }),
];
const p1 = buildSessionsProjection(s1);
const sess1 = selectSessionForDay(p1, '2026-09-21');
check('checkin survives SessionScheduled', sess1?.checkin?.energy === 7, `got ${sess1?.checkin?.energy}`);
check('status is completed', sess1?.status === 'completed', `got ${sess1?.status}`);
check('two sets logged', sess1?.setLog.length === 2, `got ${sess1?.setLog.length}`);
check('sessionIndex advances to 1', selectSessionIndex(p1) === 1, `got ${selectSessionIndex(p1)}`);

// ── Scenario 2: re-logging a set is a correction, not a duplicate ─────
console.log('\nScenario 2 — RPE correction overwrites, does not duplicate');
const s2 = buildSessionsProjection([
  ...s1.slice(0, 5),
  ev('SetCompleted', '2026-09-21', { sessionId: 'S1', exerciseId: 'bench-press', setIndex: 0, weight_kg: 60, reps: 8, rpe: 8 }),
  ev('SetCompleted', '2026-09-21', { sessionId: 'S1', exerciseId: 'bench-press', setIndex: 1, weight_kg: 60, reps: 7, rpe: 8 }),
]);
const sess2 = selectSessionForDay(s2, '2026-09-21');
check('still exactly 2 sets after re-log', sess2?.setLog.length === 2, `got ${sess2?.setLog.length}`);
check('rpe applied to both', sess2?.setLog.every((s) => s.rpe === 8) === true);

// ── Scenario 3: skipped day ───────────────────────────────────────────
console.log('\nScenario 3 — skip without ever scheduling');
const s3 = buildSessionsProjection([
  ev('SessionSkipped', '2026-09-22', { sessionId: 'S2', trainingDay: '2026-09-22', reason: 'travel' }),
]);
const sess3 = selectSessionForDay(s3, '2026-09-22');
check('stub session created', sess3 !== null);
check('status skipped', sess3?.status === 'skipped', `got ${sess3?.status}`);
check('reason preserved', sess3?.skipReason === 'travel');

// ── Scenario 4: streak + adherence ────────────────────────────────────
console.log('\nScenario 4 — streak and adherence');
const st = buildStreakProjection([...s1, ...[
  ev('SessionSkipped', '2026-09-22', { sessionId: 'S2', trainingDay: '2026-09-22', reason: 'travel' }),
  ev('SessionCompleted', '2026-09-23', { sessionId: 'S3', completedAt: 'T', completedExercises: 2, totalExercises: 2 }),
]]);
check('streak counts 2 completions', st.current === 2, `got ${st.current}`);
check('longest tracks max', st.longest === 2, `got ${st.longest}`);
check('skip does not break streak (BLUEPRINT Phase 6)', st.current === 2);
check('adherence 2/3 = 67%', selectAdherencePct(st) === 67, `got ${selectAdherencePct(st)}`);
check('lastCompletedDay is latest', st.lastCompletedDay === '2026-09-23', `got ${st.lastCompletedDay}`);

// ── Scenario 5: extractive summary ────────────────────────────────────
console.log('\nScenario 5 — extractive summary fallback');
const summ = buildExtractiveSummary(sess2!);
check('summary within 300 chars', summ.summary.length <= 300, `len ${summ.summary.length}`);
check('mode is extractive_fallback', summ.generationMode === 'extractive_fallback');
check('top set highlighted', summ.highlights.some((h) => h.includes('Bench Press')), JSON.stringify(summ.highlights));
console.log(`  → "${summ.summary}"`);

// ── Scenario 6: out-of-order / unknown session is not fatal ───────────
console.log('\nScenario 6 — orphan events do not throw (reducers stay total)');
let threw = false;
try {
  buildSessionsProjection([
    ev('SetCompleted', '2026-09-24', { sessionId: 'GHOST', exerciseId: 'x', setIndex: 0, weight_kg: 1, reps: 1 }),
    ev('SessionCompleted', '2026-09-24', { sessionId: 'GHOST', completedAt: 'T', completedExercises: 0, totalExercises: 0 }),
  ]);
} catch { threw = true; }
check('replay of orphan events survives', !threw);

// ── Scenario 7: prefill source (now ExerciseHistory) ─────────────────
console.log('\nScenario 7 — prefill from last completed session');
const lw = selectExerciseHistory(p1);
check('bench weight remembered', lw[CID('bench-press')]?.[0]?.weight_kg === 60, `got ${lw[CID('bench-press')]?.[0]?.weight_kg}`);
check('reps remembered for prefill', lw[CID('bench-press')]?.[0]?.reps === 7, `got ${lw[CID('bench-press')]?.[0]?.reps}`);
check('never-logged exercise has no history', lw[CID('plank-hold')] === undefined);

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
