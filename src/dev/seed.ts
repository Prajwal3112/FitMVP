import { db } from '../db/client';
import { events } from '../db/schema';
import { appendEvent } from '../events/log';
import { newEventId, trainingDayOf } from '../events/base';
import {
  draftPreCheckinRecorded,
  draftSessionScheduled,
  draftSessionStarted,
  draftSetCompleted,
  draftSessionCompleted,
  draftSessionSkipped,
  draftSessionSummaryGenerated,
  type SkipReason,
} from '../events/session';
import { draftUserContextCreated } from '../events/userContext';
import { draftGoalCreated } from '../events/goal';
import { buildSessionDraft } from '../session/scheduler';
import type { Equipment } from '../constants/workouts';

// ─── Dev-only history seeder ─────────────────────────────────────────
// DEV BUILDS ONLY. Writes backdated events straight to the log so a
// multi-week test can be run in an afternoon.
//
// Rather than faking a clock, this seeds history *further into the past* —
// `appendEvent` already accepts an explicit `occurredAt`, and `trainingDay`
// is derived from it. A 9-day gap is just "stop seeding 9 days ago".
//
// Everything written here goes through the same Zod validation and hash
// chain as real events, so a seeded log is indistinguishable from a real
// one to every projection.

const ROLLOVER_HOUR = 4;

/** Plausible starting loads, so prefill and progression have real numbers. */
const BASE_LOAD: Record<string, number> = {
  'bench-press': 60,
  'overhead-press': 35,
  'incline-dumbbell-press': 22.5,
  'tricep-pushdown': 25,
  deadlift: 100,
  'lat-pulldown': 50,
  'cable-row': 45,
  'bicep-curl': 15,
  'barbell-squat': 80,
  'leg-press': 120,
  'romanian-deadlift': 70,
  'leg-curl': 35,
};

function daysAgo(n: number, hour = 18): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/**
 * Onboarding + goal, backdated before the first session.
 *
 * Without this a wipe-then-seed leaves a log full of sessions but no
 * UserContext, so `isOnboarded` is false and the app strands you on the
 * onboarding screen with history behind it.
 */
async function seedIdentity(equipment: Equipment, startedDaysAgo: number): Promise<number> {
  const when = daysAgo(startedDaysAgo + 1, 9);

  await appendEvent(
    draftUserContextCreated({
      profile: { age: 30, height_cm: 175, weight_kg: 78, sex: 'other' },
      routine: { wakeHour: 6, sleepHour: 23, sessionWindow: '06:00' },
      equipment,
      constraints: { daysPerWeek: 4, sessionMaxMinutes: 60 },
      knownInjuries: [],
      dayRolloverHour: ROLLOVER_HOUR,
      experience: 'regular',
      ownedEquipment: equipment === 'home' ? ['dumbbell', 'bands'] : [],
    }),
    { rolloverHour: ROLLOVER_HOUR, occurredAt: when },
  );

  const target = new Date();
  target.setMonth(target.getMonth() + 3);

  await appendEvent(
    draftGoalCreated({
      goalId: newEventId(),
      goalType: 'hypertrophy',
      why: 'Seeded by the dev panel — replace this with something real.',
      targetDate: target.toISOString().slice(0, 10),
    }),
    { rolloverHour: ROLLOVER_HOUR, occurredAt: when },
  );

  return 2;
}

export type SeedOptions = {
  /** How many training days to generate. */
  sessions: number;
  /** Days between the last seeded session and today. 0 = trained today. */
  gapDays: number;
  equipment: Equipment;
  /** Roughly 1 in N sessions becomes a skip instead of a completion. */
  skipEvery?: number;
};

export type SeedResult = { completed: number; skipped: number; events: number };

/**
 * Seed `sessions` training days ending `gapDays` ago.
 * Loads ramp over time so ExerciseHistory and progression have a trend.
 */
export async function seedHistory(opts: SeedOptions): Promise<SeedResult> {
  const { sessions, gapDays, equipment, skipEvery = 6 } = opts;
  let completed = 0;
  let skipped = 0;
  let eventCount = 0;

  // Identity first, so seq order stays chronological.
  eventCount += await seedIdentity(equipment, gapDays + (sessions - 1) * 2);

  // Oldest first, so seq order matches chronological order.
  for (let i = sessions - 1; i >= 0; i--) {
    const offset = gapDays + i * 2; // train roughly every other day
    const when = daysAgo(offset);
    const sessionId = newEventId();
    const sessionNumber = sessions - 1 - i;
    // Must match what appendEvent derives, or the skip lands on the wrong day.
    const trainingDay = trainingDayOf(when, ROLLOVER_HOUR);

    const isSkip = skipEvery > 0 && sessionNumber > 0 && sessionNumber % skipEvery === 0;

    if (isSkip) {
      const reasons: SkipReason[] = ['travel', 'illness', 'time', 'unmotivated'];
      const reason = reasons[sessionNumber % reasons.length] ?? 'other';
      await appendEvent(
        draftSessionSkipped({ sessionId, trainingDay, reason }),
        { rolloverHour: ROLLOVER_HOUR, occurredAt: when },
      );
      skipped += 1;
      eventCount += 1;
      continue;
    }

    const energy = 5 + ((sessionNumber * 3) % 5); // 5..9, deterministic
    const checkin = { sessionId, energy, soreness: [] };

    await appendEvent(draftPreCheckinRecorded(checkin), {
      rolloverHour: ROLLOVER_HOUR,
      occurredAt: when,
    });
    eventCount += 1;

    const draft = buildSessionDraft({ equipment, rotationIndex: sessionNumber, checkin,
      goal: 'hypertrophy', experience: 'regular', daysPerWeek: 4 });

    await appendEvent(
      draftSessionScheduled({
        sessionId,
        trainingDay,
        planId: null,
        workoutId: draft.workoutId,
        workoutName: draft.workoutName,
        exercises: draft.exercises,
        openingNote: draft.openingNote,
        generationMode: 'template_fallback',
      }),
      { rolloverHour: ROLLOVER_HOUR, occurredAt: when },
    );
    eventCount += 1;

    await appendEvent(
      draftSessionStarted({ sessionId, startedAt: when.toISOString() }),
      { rolloverHour: ROLLOVER_HOUR, occurredAt: when },
    );
    eventCount += 1;

    // How many times this exercise has come round before — drives the ramp.
    const cycle = Math.floor(sessionNumber / 3);

    for (const slot of draft.exercises) {
      const base = BASE_LOAD[slot.exerciseId] ?? 0;
      const weight = base > 0 ? base + cycle * 2.5 : 0;
      for (let setIndex = 0; setIndex < slot.sets; setIndex++) {
        // RPE climbs across the sets of an exercise, as it does in reality.
        const rpe = Math.min(10, 7 + setIndex * 0.5);
        await appendEvent(
          draftSetCompleted({
            sessionId,
            exerciseId: slot.exerciseId,
            setIndex,
            weight_kg: weight,
            reps: slot.targetReps ?? 0,
            ...(slot.targetDurationSec !== undefined
              ? { durationSec: slot.targetDurationSec }
              : {}),
            rpe,
          }),
          { rolloverHour: ROLLOVER_HOUR, occurredAt: when },
        );
        eventCount += 1;
      }
    }

    const totalSets = draft.exercises.reduce((n, e) => n + e.sets, 0);
    await appendEvent(
      draftSessionCompleted({
        sessionId,
        completedAt: when.toISOString(),
        completedExercises: draft.exercises.length,
        totalExercises: draft.exercises.length,
        avgRpe: 7.5,
      }),
      { rolloverHour: ROLLOVER_HOUR, occurredAt: when },
    );
    eventCount += 1;

    await appendEvent(
      draftSessionSummaryGenerated({
        sessionId,
        summary: `${draft.workoutName}: ${draft.exercises.length}/${draft.exercises.length} exercises, ${totalSets} sets. Avg RPE 7.5. Energy ${energy}/10.`,
        highlights: [],
        generationMode: 'extractive_fallback',
      }),
      { rolloverHour: ROLLOVER_HOUR, occurredAt: when },
    );
    eventCount += 1;

    completed += 1;
  }

  return { completed, skipped, events: eventCount };
}

/** Delete every event. Projections rebuild empty on the next read. */
export async function wipeAllEvents(): Promise<void> {
  await db.delete(events);
}
