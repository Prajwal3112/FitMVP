import { buildSessionsProjection, applySessionEvent } from '../src/projections/sessions';
import { hashEvent, GENESIS_PREV_HASH } from '../src/events/base';
import type { Event } from '../src/events';

/**
 * Logging a set must not cost a full replay of the log.
 *
 * refreshProjections() re-read every row out of SQLite, Zod-parsed all of
 * them, and rebuilt all four projections — after EVERY append, including each
 * individual set. buildSessionsProjection is quadratic (patch() spreads
 * state.byId per event), so this compounded: ~25 appends per workout against
 * a fold that grows with history.
 */
let fails = 0;
const ck = (n: string, c: boolean, extra = '') => {
  if (c) console.log(`  ok   ${n}`); else { fails++; console.log(`  FAIL ${n} ${extra}`); }
};

function makeLog(sessions: number): Event[] {
  const out: Event[] = [];
  let prevHash = GENESIS_PREV_HASH;
  let seq = 0;
  const push = (type: string, payload: Record<string, unknown>, day: string) => {
    const e = { id: `id${String(seq).padStart(7, '0')}`, seq, type, occurredAt: '2026-01-01T09:00:00.000Z',
      trainingDay: day, schemaVersion: 1, prevHash, payload } as unknown as Event;
    out.push(e); prevHash = hashEvent(e); seq += 1;
  };
  for (let i = 0; i < sessions; i++) {
    const day = new Date(Date.UTC(2020, 0, 1 + i * 2)).toISOString().slice(0, 10);
    const sid = `s${i}`;
    push('SessionScheduled', { sessionId: sid, trainingDay: day, planId: null, workoutId: 'w',
      workoutName: 'Upper', openingNote: '', generationMode: 'template_fallback',
      exercises: Array.from({ length: 6 }, (_, k) => ({ exerciseId: `ex${k}`, name: `Ex ${k}`, sets: 3, targetReps: 8 })) }, day);
    push('SessionStarted', { sessionId: sid, startedAt: '2026-01-01T09:00:00.000Z' }, day);
    for (let k = 0; k < 6; k++) for (let st = 0; st < 3; st++) {
      push('SetCompleted', { sessionId: sid, exerciseId: `ex${k}`, setIndex: st, weight_kg: 60, reps: 8, rpe: 8 }, day);
    }
    push('SessionCompleted', { sessionId: sid, completedAt: '2026-01-01T10:00:00.000Z' }, day);
  }
  return out;
}

const time = (fn: () => void, n = 1) => {
  const t = Date.now(); for (let i = 0; i < n; i++) fn(); return (Date.now() - t) / n;
};

console.log('\n            full replay   vs   fold one event');
const results: { sessions: number; full: number; one: number }[] = [];
for (const sessions of [100, 300, 600, 1000]) {
  const log = makeLog(sessions);
  const proj = buildSessionsProjection(log);
  const newEvent = log[log.length - 1]!;
  const full = time(() => buildSessionsProjection(log));
  const one = time(() => applySessionEvent(proj, newEvent), 200);
  results.push({ sessions, full, one });
  console.log(`  ${String(sessions).padStart(4)} sessions  ${String(log.length).padStart(6)} events` +
    `   ${full.toFixed(0).padStart(6)} ms   ${one.toFixed(3).padStart(9)} ms   (${Math.round(full / Math.max(one, 0.001))}× cheaper)`);
}

const worst = results[results.length - 1]!;
ck('folding one event is under 5ms even at 1000 sessions', worst.one < 5, `${worst.one}ms`);
ck('a workout of 25 sets costs under 100ms incrementally',
  worst.one * 25 < 100, `${(worst.one * 25).toFixed(0)}ms`);
console.log(`\n  a 25-set workout: ${(worst.full * 25 / 1000).toFixed(1)}s of replay  ->  ${(worst.one * 25).toFixed(0)}ms incremental`);
console.log('  (desktop V8; Hermes on a mid-range Android is typically 3-10x slower)');
console.log('\n  NOTE: the cold-boot fold is still quadratic — that is remaining debt,');
console.log('  but it now happens once at launch instead of after every tap.');

console.log(fails === 0 ? '\nall passed' : `\n${fails} FAILURE(S)`);
if (fails > 0) process.exit(1);
