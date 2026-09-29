// Replays the seeder's exact value computation through the real schemas,
// without a database. Catches anything Zod would reject on-device.
import { EventSchema } from '../src/events/index';
import {
  draftPreCheckinRecorded, draftSessionScheduled, draftSessionStarted,
  draftSetCompleted, draftSessionCompleted, draftSessionSkipped,
  draftSessionSummaryGenerated,
} from '../src/events/session';
import { draftUserContextCreated } from '../src/events/userContext';
import { draftGoalCreated } from '../src/events/goal';
import { buildSessionDraft } from '../src/session/scheduler';
import { trainingDayOf } from '../src/events/base';

const BASE_LOAD: Record<string, number> = {
  'bench-press': 60, 'overhead-press': 35, 'incline-dumbbell-press': 22.5,
  'tricep-pushdown': 25, deadlift: 100, 'lat-pulldown': 50, 'cable-row': 45,
  'bicep-curl': 15, 'barbell-squat': 80, 'leg-press': 120,
  'romanian-deadlift': 70, 'leg-curl': 35,
};
const daysAgo = (n: number, hour = 18) => {
  const d = new Date(); d.setDate(d.getDate() - n); d.setHours(hour, 0, 0, 0); return d;
};
const env = (d: { type: string; schemaVersion: number; payload: unknown }, when: Date) =>
  EventSchema.parse({
    id: '01JABCDEF0123456789ABCDEFG', seq: 0, type: d.type,
    occurredAt: when.toISOString(), trainingDay: trainingDayOf(when, 4),
    schemaVersion: d.schemaVersion, prevHash: '__genesis__', payload: d.payload,
  });

let n = 0, fails = 0;
const PRESETS = [
  { label: 'Trained yesterday', sessions: 4, gapDays: 1 },
  { label: 'A month in', sessions: 14, gapDays: 1 },
  { label: 'Lapsed 9 days', sessions: 14, gapDays: 9 },
  { label: 'Lapsed 10 weeks', sessions: 20, gapDays: 70 },
];

for (const equipment of ['home', 'gym'] as const) {
  for (const P of PRESETS) {
    const days = new Set<string>();
    try {
      const idWhen = daysAgo(P.gapDays + (P.sessions - 1) * 2 + 1, 9);
      const t = new Date(); t.setMonth(t.getMonth() + 3);
      env(draftUserContextCreated({
        profile: { age: 30, height_cm: 175, weight_kg: 78, sex: 'other' },
        routine: { wakeHour: 6, sleepHour: 23, sessionWindow: '06:00' },
        equipment, constraints: { daysPerWeek: 4, sessionMaxMinutes: 60 },
        knownInjuries: [], dayRolloverHour: 4,
      }), idWhen); n++;
      env(draftGoalCreated({
        goalId: 'G1', goalType: 'hypertrophy',
        why: 'Seeded by the dev panel — replace this with something real.',
        targetDate: t.toISOString().slice(0, 10),
      }), idWhen); n++;

      for (let i = P.sessions - 1; i >= 0; i--) {
        const offset = P.gapDays + i * 2;
        const when = daysAgo(offset);
        const num = P.sessions - 1 - i;
        const trainingDay = trainingDayOf(when, 4);
        if (days.has(trainingDay)) throw new Error(`duplicate trainingDay ${trainingDay} — violates §8.2`);
        days.add(trainingDay);

        if (num > 0 && num % 6 === 0) {
          const reasons = ['travel', 'illness', 'time', 'unmotivated'] as const;
          env(draftSessionSkipped({ sessionId: 'S', trainingDay, reason: reasons[num % 4]! }), when); n++;
          continue;
        }
        const energy = 5 + ((num * 3) % 5);
        const checkin = { sessionId: 'S', energy, soreness: [] };
        env(draftPreCheckinRecorded(checkin), when); n++;
        const d = buildSessionDraft({ equipment: equipment, rotationIndex: num, checkin: checkin, goal:'hypertrophy' as never, experience:'regular' as never, daysPerWeek:4 });
        env(draftSessionScheduled({
          sessionId: 'S', trainingDay, planId: null, workoutId: d.workoutId,
          workoutName: d.workoutName, exercises: d.exercises,
          openingNote: d.openingNote, generationMode: 'template_fallback',
        }), when); n++;
        env(draftSessionStarted({ sessionId: 'S', startedAt: when.toISOString() }), when); n++;

        const cycle = Math.floor(num / 3);
        let sets = 0;
        for (const slot of d.exercises) {
          const base = BASE_LOAD[slot.exerciseId] ?? 0;
          const weight = base > 0 ? base + cycle * 2.5 : 0;
          for (let si = 0; si < slot.sets; si++) {
            env(draftSetCompleted({
              sessionId: 'S', exerciseId: slot.exerciseId, setIndex: si,
              weight_kg: weight, reps: slot.targetReps ?? 0,
              ...(slot.targetDurationSec !== undefined ? { durationSec: slot.targetDurationSec } : {}),
              rpe: Math.min(10, 7 + si * 0.5),
            }), when); n++; sets++;
          }
        }
        env(draftSessionCompleted({
          sessionId: 'S', completedAt: when.toISOString(),
          completedExercises: d.exercises.length, totalExercises: d.exercises.length, avgRpe: 7.5,
        }), when); n++;
        env(draftSessionSummaryGenerated({
          sessionId: 'S',
          summary: `${d.workoutName}: ${d.exercises.length}/${d.exercises.length} exercises, ${sets} sets. Avg RPE 7.5. Energy ${energy}/10.`,
          highlights: [], generationMode: 'extractive_fallback',
        }), when); n++;
      }
      console.log(`  ok   ${equipment.padEnd(4)} · ${P.label}  (${days.size} distinct training days)`);
    } catch (e) {
      console.log(`  FAIL ${equipment} · ${P.label}: ${e instanceof Error ? e.message : String(e)}`);
      fails++;
    }
  }
}
console.log(`\n${n} payloads validated, ${fails} failure(s)\n`);
process.exit(fails === 0 ? 0 : 1);
