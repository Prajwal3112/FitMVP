import type { Event } from '../events';
import { appendEvent } from '../events/log';
import { newEventId, trainingDayOf } from '../events/base';
import {
  draftSessionScheduled,
  draftPreCheckinRecorded,
  draftSessionStarted,
  draftSetCompleted,
  draftExerciseSkipped,
  draftSessionCompleted,
  draftSessionSkipped,
  draftSessionSummaryGenerated,
  type PreCheckinPayload,
  type SetCompletedPayload,
  type SkipReason,
} from '../events/session';
import {
  selectSessionForDay,
  selectRotationIndex,
  selectKnownExerciseIds,
  selectGap,
  workingSets,
  type SessionsProjection,
  type SessionState,
} from '../projections/sessions';
import { buildSessionDraft } from './scheduler';
import { implausibleSet } from './plausibility';
import type { SessionReview } from '../events/session';
import { scaleSets, type ReentryPolicy } from './reentry';
import { buildExtractiveSummary, averageRpe, completedExerciseIds } from './summary';
import type { GoalKind } from '../events/goal';
import type { Experience } from '../events/userContext';
import type { Equipment } from '../constants/workouts';

// ─── Command layer ───────────────────────────────────────────────────
// Every write goes through here so the ARCHITECTURE §8 invariants are
// checked *before* an event reaches the log. The projection reducers stay
// total and non-throwing; this is the only place that says "no".

export class InvariantViolation extends Error {
  readonly invariant: string;
  constructor(invariant: string, message: string) {
    super(message);
    this.name = 'InvariantViolation';
    this.invariant = invariant;
  }
}

export type SessionContext = {
  sessions: SessionsProjection;
  equipment: Equipment;
  rolloverHour: number;
  /** Override "now" for tests/backfill. */
  now?: Date;
  /** Applied to today's session when returning from a gap. */
  reentry?: ReentryPolicy;
  /** Active injuries as muscle/joint tags. Enforces §8.7 at scheduling time. */
  injuries?: string[];
  /** Equipment owned beyond the tier default. */
  ownedEquipment?: string[];
  /**
   * Set false to allow finishing without a review. The dev seeder needs this
   * to backdate history; real sessions must not.
   */
  requireReview?: boolean;
  goal?: GoalKind | null;
  experience?: Experience | null;
  daysPerWeek?: number;
  sessionMaxMinutes?: number;
  totalSessions?: number;
};

function today(ctx: SessionContext): string {
  return trainingDayOf(ctx.now ?? new Date(), ctx.rolloverHour);
}

function requireSession(ctx: SessionContext, sessionId: string): SessionState {
  const session = ctx.sessions.byId[sessionId];
  if (!session) {
    throw new InvariantViolation('unknown_session', `No session ${sessionId}`);
  }
  return session;
}

// ─── Check in + schedule ─────────────────────────────────────────────

export type CheckinInput = {
  energy: number;
  soreness: { muscle: string; level: 1 | 2 | 3 }[];
  notes?: string;
  /**
   * The user came back from a gap and chose the full session. The return
   * screen offered that choice and then ignored it, because the policy was
   * applied unconditionally — a returning lifter notices inside one session.
   */
  ignoreReentry?: boolean;
};

/**
 * Records the pre-check-in and schedules today's session from it.
 *
 * Order matters and follows BLUEPRINT Phase 4: PreCheckinRecorded lands
 * first so the deterministic scheduler can react to energy, then
 * SessionScheduled. The sessionId is minted here so both events share it.
 */
export async function checkInAndSchedule(
  ctx: SessionContext,
  input: CheckinInput,
): Promise<string> {
  const trainingDay = today(ctx);

  const existing = selectSessionForDay(ctx.sessions, trainingDay);
  if (existing && existing.status === 'completed') {
    // Invariant §8.2 — one completed session per training day.
    throw new InvariantViolation(
      'one_session_per_day',
      `Today's session is already complete.`,
    );
  }
  // Re-entering the check-in for a day that is still open reuses the
  // session so we don't orphan the already-logged sets.
  const sessionId = existing ? existing.sessionId : newEventId();

  const checkin: PreCheckinPayload = {
    sessionId,
    energy: input.energy,
    soreness: input.soreness,
    ...(input.notes && input.notes.trim().length > 0
      ? { notes: input.notes.trim() }
      : {}),
  };

  // Build BEFORE writing anything. These are two separate appends, so a
  // throw between them used to leave a checked-in session with no
  // exercises: Home offered "Resume Workout", the workout screen showed
  // 0/0, and Done stayed disabled for the rest of the day with no way out
  // but Skip. Nothing is written now until we know there is a session.
  const gap = selectGap(ctx.sessions, trainingDay);
  const draft = buildSessionDraft({
    equipment: ctx.equipment,
    // COMPLETIONS ONLY — a skipped day must not advance the split.
    rotationIndex: selectRotationIndex(ctx.sessions),
    checkin,
    goal: ctx.goal ?? null,
    experience: ctx.experience ?? null,
    daysPerWeek: ctx.daysPerWeek ?? 4,
    gapDays: gap.gapDays,
    totalSessions: gap.sessionsBefore,
    // Keeps the slot occupant stable once there is history for it.
    knownExerciseIds: selectKnownExerciseIds(ctx.sessions),
    ...(ctx.sessionMaxMinutes ? { sessionMaxMinutes: ctx.sessionMaxMinutes } : {}),
    ...(ctx.injuries ? { injuries: ctx.injuries } : {}),
    ...(ctx.ownedEquipment ? { ownedEquipment: ctx.ownedEquipment } : {}),
  });

  if (draft.exercises.length === 0) {
    // Every exercise loaded an injury and nothing safe remained.
    throw new InvariantViolation(
      'no_safe_exercises',
      "Everything in today's session loads something you've flagged as injured. Update your injuries or pick a different day.",
    );
  }

  await appendEvent(draftPreCheckinRecorded(checkin), {
    rolloverHour: ctx.rolloverHour,
    ...(ctx.now ? { occurredAt: ctx.now } : {}),
  });

  // Pre-lower the bar. The return screen promises the session is already
  // adjusted; this is what makes that true rather than a claim.
  const policy = input.ignoreReentry ? undefined : ctx.reentry;
  const exercises =
    policy && policy.speak && policy.volumeMultiplier < 1
      ? draft.exercises.map((e) => ({ ...e, sets: scaleSets(e.sets, policy) }))
      : draft.exercises;

  await appendEvent(
    draftSessionScheduled({
      sessionId,
      trainingDay,
      planId: null, // no planner yet — see src/events/session.ts
      workoutId: draft.workoutId,
      workoutName: draft.workoutName,
      exercises,
      openingNote: draft.openingNote,
      generationMode: 'template_fallback',
      // Persist what the scheduler worked out. Until now this call forwarded
      // five fields and dropped four, so the warm-up, the cool-down, the
      // dropped slots and every reason past the first were computed on every
      // check-in and thrown away at the write boundary.
      warmup: {
        raise: draft.warmup.raise.map((w) => ({ id: w.id, name: w.name })),
        mobilise: draft.warmup.mobilise.map((w) => ({ id: w.id, name: w.name })),
        minutes: draft.warmup.minutes,
      },
      cooldown: draft.cooldown.map((w) => ({ id: w.id, name: w.name })),
      dropped: draft.dropped,
      reasons: draft.reasons.filter((r) => r.trim().length > 0).slice(0, 8),
    }),
    {
      rolloverHour: ctx.rolloverHour,
      ...(ctx.now ? { occurredAt: ctx.now } : {}),
    },
  );

  return sessionId;
}

// ─── Start ───────────────────────────────────────────────────────────

/** scheduled → active. Guard (§7): a check-in must exist for this session. */
export async function startSession(
  ctx: SessionContext,
  sessionId: string,
): Promise<void> {
  const session = requireSession(ctx, sessionId);
  if (session.status === 'active') return; // idempotent
  if (session.status !== 'scheduled') {
    throw new InvariantViolation(
      'bad_transition',
      `Cannot start a ${session.status} session.`,
    );
  }
  if (session.checkin === null) {
    throw new InvariantViolation(
      'checkin_required',
      'A session cannot start before its pre-check-in is recorded.',
    );
  }

  const when = ctx.now ?? new Date();
  await appendEvent(
    draftSessionStarted({ sessionId, startedAt: when.toISOString() }),
    { rolloverHour: ctx.rolloverHour, ...(ctx.now ? { occurredAt: ctx.now } : {}) },
  );
}

// ─── Log a set ───────────────────────────────────────────────────────

export type LogSetInput = {
  sessionId: string;
  exerciseId: string;
  setIndex: number;
  isWarmup?: boolean;
  weight_kg: number;
  reps: number;
  durationSec?: number;
  rpe?: number;
};

/** Ceiling on warmup sets per exercise — a ramp, not a second session. */
const MAX_WARMUP_SETS = 8;

/**
 * Returns the appended event so the caller can fold it forward instead of
 * re-reading the whole log. This is the hot path — ~25 calls per workout —
 * and a full replay after each one was a freeze after every ✓ tap.
 */
export async function logSet(
  ctx: SessionContext,
  input: LogSetInput,
): Promise<Event> {
  const session = requireSession(ctx, input.sessionId);
  if (session.status !== 'active') {
    throw new InvariantViolation(
      'bad_transition',
      `Cannot log a set on a ${session.status} session.`,
    );
  }
  const slot = session.exercises.find((e) => e.exerciseId === input.exerciseId);
  if (!slot) {
    throw new InvariantViolation(
      'unknown_exercise',
      `${input.exerciseId} is not in this session.`,
    );
  }
  // Typo guard. See src/session/plausibility.ts for why a ceiling exists.
  const implausible = implausibleSet(input);
  if (implausible !== null) {
    throw new InvariantViolation('implausible_set', implausible);
  }
  // Warmups ramp toward the working sets, so they get their own index
  // space rather than consuming prescribed volume.
  const limit = input.isWarmup ? MAX_WARMUP_SETS : slot.sets;
  if (input.setIndex >= limit) {
    throw new InvariantViolation(
      'set_out_of_range',
      input.isWarmup
        ? `That's more than ${MAX_WARMUP_SETS} warmup sets.`
        : `Set ${input.setIndex + 1} exceeds the ${slot.sets} prescribed.`,
    );
  }

  const payload: SetCompletedPayload = {
    sessionId: input.sessionId,
    exerciseId: input.exerciseId,
    setIndex: input.setIndex,
    ...(input.isWarmup ? { isWarmup: true } : {}),
    weight_kg: input.weight_kg,
    reps: input.reps,
    ...(input.durationSec !== undefined ? { durationSec: input.durationSec } : {}),
    ...(input.rpe !== undefined ? { rpe: input.rpe } : {}),
  };

  const { event } = await appendEvent(draftSetCompleted(payload), {
    rolloverHour: ctx.rolloverHour,
    ...(ctx.now ? { occurredAt: ctx.now } : {}),
  });
  return event;
}

// ─── Skip one exercise ───────────────────────────────────────────────

export async function skipExercise(
  ctx: SessionContext,
  sessionId: string,
  exerciseId: string,
  reason = 'user_skipped',
): Promise<void> {
  const session = requireSession(ctx, sessionId);
  if (session.status !== 'active') {
    throw new InvariantViolation(
      'bad_transition',
      `Cannot skip an exercise on a ${session.status} session.`,
    );
  }
  await appendEvent(draftExerciseSkipped({ sessionId, exerciseId, reason }), {
    rolloverHour: ctx.rolloverHour,
    ...(ctx.now ? { occurredAt: ctx.now } : {}),
  });
}

// ─── Complete ────────────────────────────────────────────────────────

/**
 * active → completed, then the extractive summary.
 *
 * Guards: §8.3 (at least one SetCompleted) and §8.2 (no second completed
 * session on the same training day).
 *
 * The summary is built from the projection state *plus* this completion,
 * so it is emitted after SessionCompleted — matching BLUEPRINT Phase 4.
 */
/**
 * Finish a session.
 *
 * `review` is REQUIRED while the app is out with testers. The app prescribes
 * volume and load from rules and has never been told whether the result was
 * any good — RPE says how hard a SET felt, nothing says whether the SESSION
 * was the right session. That judgement is the only thing six testers can give
 * that no amount of engineering can derive, and asking for it at the moment
 * they finish is the only time they will remember it accurately.
 *
 * Enforced here rather than in the schema so the requirement can be relaxed
 * after the test without an upcaster, and so a historical session written
 * before this existed stays replayable.
 *
 * Gating completion (rather than nagging) has a real consequence worth naming:
 * the rotation advances on COMPLETION only, so an un-reviewed session does not
 * advance it. That is correct — the day is not done — and it is recoverable,
 * since the session stays `active` and Home offers "Resume Workout".
 */
export async function completeSession(
  ctx: SessionContext,
  sessionId: string,
  review?: SessionReview,
): Promise<void> {
  const session = requireSession(ctx, sessionId);
  if (session.status === 'completed') return; // idempotent
  if (session.status !== 'active') {
    throw new InvariantViolation(
      'bad_transition',
      `Cannot complete a ${session.status} session.`,
    );
  }
  if (workingSets(session.setLog).length === 0) {
    throw new InvariantViolation(
      'set_required',
      'Log at least one working set before finishing.',
    );
  }
  if (ctx.requireReview !== false && review === undefined) {
    throw new InvariantViolation(
      'review_required',
      'Tell me how that session went before finishing it.',
    );
  }

  const otherToday = selectSessionForDay(ctx.sessions, session.trainingDay);
  if (
    otherToday &&
    otherToday.sessionId !== sessionId &&
    otherToday.status === 'completed'
  ) {
    throw new InvariantViolation(
      'one_session_per_day',
      'A session is already completed for this training day.',
    );
  }

  const when = ctx.now ?? new Date();
  const avg = averageRpe(session);

  await appendEvent(
    draftSessionCompleted({
      sessionId,
      completedAt: when.toISOString(),
      completedExercises: completedExerciseIds(session).length,
      totalExercises: session.exercises.length,
      ...(avg !== undefined ? { avgRpe: avg } : {}),
      ...(review !== undefined ? { review } : {}),
    }),
    { rolloverHour: ctx.rolloverHour, ...(ctx.now ? { occurredAt: ctx.now } : {}) },
  );

  await appendEvent(
    draftSessionSummaryGenerated(buildExtractiveSummary(session)),
    { rolloverHour: ctx.rolloverHour, ...(ctx.now ? { occurredAt: ctx.now } : {}) },
  );
}

// ─── Skip the day ────────────────────────────────────────────────────

/**
 * → skipped. Works whether or not a session was ever scheduled: skipping
 * from Home before checking in mints a session id so the day still has
 * one identity in the log.
 */
export async function skipSession(
  ctx: SessionContext,
  reason: SkipReason,
  notes?: string,
): Promise<void> {
  const trainingDay = today(ctx);
  const existing = selectSessionForDay(ctx.sessions, trainingDay);

  if (existing?.status === 'completed') {
    throw new InvariantViolation(
      'bad_transition',
      'Today is already complete — nothing to skip.',
    );
  }
  if (existing?.status === 'skipped') return; // idempotent

  const sessionId = existing ? existing.sessionId : newEventId();

  await appendEvent(
    draftSessionSkipped({
      sessionId,
      trainingDay,
      reason,
      ...(notes && notes.trim().length > 0 ? { notes: notes.trim() } : {}),
    }),
    { rolloverHour: ctx.rolloverHour, ...(ctx.now ? { occurredAt: ctx.now } : {}) },
  );
}
