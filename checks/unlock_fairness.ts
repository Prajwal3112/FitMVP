import { selectContextCompleteness } from '../src/context/completeness';
import { buildSessionsProjection } from '../src/projections/sessions';
import { hashEvent, GENESIS_PREV_HASH } from '../src/events/base';
import type { Event } from '../src/events';

/**
 * The gate must not punish the ideal client.
 *
 * As shipped it required soreness in 4 separate weeks (weight 12), a bad week
 * AND a skip (9), and 4 lifts whose *kilos* changed (13). So the app told
 * someone who trained every session, recovered well and worked out at home
 * that after a month it still did not know them well enough to talk:
 * never-sore 54, bodyweight 50, both 41 — against a gate of 60.
 */
let fails = 0;
const ck = (n: string, c: boolean, extra = '') => {
  if (c) console.log(`  ok   ${n}`); else { fails++; console.log(`  FAIL ${n} ${extra}`); }
};

type Opts = { weeks: number; perWeek: number; bodyweight: boolean; sore: boolean; skips: number; roughDays: number };

function log(o: Opts): Event[] {
  const out: Event[] = [];
  let prevHash = GENESIS_PREV_HASH;
  let seq = 0;
  const push = (type: string, payload: Record<string, unknown>, day: string) => {
    const e = { id: `id${String(seq).padStart(7, '0')}`, seq, type,
      occurredAt: `${day}T09:00:00.000Z`, trainingDay: day, schemaVersion: 1, prevHash, payload } as unknown as Event;
    out.push(e); prevHash = hashEvent(e); seq += 1;
  };
  const start = Date.UTC(2026, 0, 5);
  let n = 0, rough = o.roughDays, skipsLeft = o.skips;
  for (let w = 0; w < o.weeks; w++) {
    for (let d = 0; d < o.perWeek; d++) {
      const day = new Date(start + (w * 7 + d * 2) * 86400000).toISOString().slice(0, 10);
      const sid = `s${n++}`;
      const energy = rough-- > 0 ? 2 : 7;
      push('PreCheckinRecorded', { sessionId: sid, energy,
        soreness: o.sore ? [{ muscle: 'legs', level: 1 }] : [] }, day);
      if (skipsLeft-- > 0) { push('SessionScheduled', { sessionId: sid, trainingDay: day, planId: null,
          workoutId: 'w', workoutName: 'Upper', openingNote: '', generationMode: 'template_fallback',
          exercises: [{ exerciseId: 'ex0', name: 'E0', sets: 3, targetReps: 8 }] }, day);
        push('SessionSkipped', { sessionId: sid, reason: 'too_tired' }, day); continue; }
      push('SessionScheduled', { sessionId: sid, trainingDay: day, planId: null, workoutId: 'w',
        workoutName: 'Upper', openingNote: '', generationMode: 'template_fallback',
        exercises: Array.from({ length: 6 }, (_, k) => ({ exerciseId: `ex${k}`, name: `E${k}`, sets: 3, targetReps: 8 })) }, day);
      push('SessionStarted', { sessionId: sid, startedAt: `${day}T09:00:00.000Z` }, day);
      for (let k = 0; k < 6; k++) for (let st = 0; st < 3; st++) {
        // Progress over time: kilos if loaded, reps if bodyweight.
        push('SetCompleted', { sessionId: sid, exerciseId: `ex${k}`, setIndex: st,
          weight_kg: o.bodyweight ? 0 : 40 + w * 2.5, reps: o.bodyweight ? 8 + w : 8, rpe: 7 }, day);
      }
      push('SessionCompleted', { sessionId: sid, completedAt: `${day}T10:00:00.000Z` }, day);
    }
  }
  return out;
}

const score = (o: Opts) => {
  const p = buildSessionsProjection(log(o));
  const last = new Date(Date.UTC(2026, 0, 5) + (o.weeks * 7 + 1) * 86400000).toISOString().slice(0, 10);
  return selectContextCompleteness(p, last);
};

const base = { weeks: 5, perWeek: 3 };
const clients = [
  ['sore sometimes, misses sometimes, barbell', { ...base, bodyweight: false, sore: true, skips: 1, roughDays: 1 }],
  ['never sore, never misses, barbell',          { ...base, bodyweight: false, sore: false, skips: 0, roughDays: 0 }],
  ['bodyweight at home, never sore',             { ...base, bodyweight: true,  sore: false, skips: 0, roughDays: 0 }],
  ['bodyweight, never sore, never misses',       { ...base, bodyweight: true,  sore: false, skips: 0, roughDays: 0 }],
] as const;

console.log('\n  after 5 weeks of 3x/week, every set logged\n');
for (const [label, o] of clients) {
  const st = score(o as Opts);
  console.log(`  ${String(Math.round(st.percent)).padStart(3)}%  ${st.unlocked ? 'UNLOCKED' : 'locked  '}  ${label}`);
  ck(`"${label}" reaches the coach`, st.unlocked, `${Math.round(st.percent)}%`);
}

// The gate must still MEAN something — four weeks is not waivable.
const tooEarly = score({ weeks: 2, perWeek: 3, bodyweight: false, sore: true, skips: 0, roughDays: 1 });
ck('two weeks does NOT unlock, however diligent', !tooEarly.unlocked, `${Math.round(tooEarly.percent)}%`);
const barelyTrained = score({ weeks: 6, perWeek: 1, bodyweight: false, sore: false, skips: 0, roughDays: 0 });
console.log(`  ${String(Math.round(barelyTrained.percent)).padStart(3)}%  ${barelyTrained.unlocked ? 'UNLOCKED' : 'locked  '}  6 weeks but only once a week`);
ck('the ceiling still caps at 75', clients.every(([, o]) => score(o as Opts).percent <= 75));

console.log(fails === 0 ? '\nall passed' : `\n${fails} FAILURE(S)`);
if (fails > 0) process.exit(1);
