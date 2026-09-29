import { z } from 'zod';
import { BaseEventSchema, type EventDraft } from './base';

// ─── Shared sub-schemas ─────────────────────────────────────────────

/**
 * One ordered slot in a scheduled session.
 *
 * `exerciseId` is a stable slug (e.g. 'bench-press'). Until the static
 * exercise library lands it is derived from the template's exercise name,
 * which is deterministic and stable across rotations.
 *
 * Exactly one of `targetReps` / `targetDurationSec` is meaningful — the
 * static templates carry rep-based and hold-based exercises side by side.
 */
export const ExerciseSlotSchema = z.object({
  exerciseId: z.string().min(1),
  name: z.string().min(1),
  sets: z.number().int().positive().max(20),
  targetReps: z.number().int().positive().max(200).optional(),
  targetDurationSec: z.number().int().positive().max(3600).optional(),
  targetRpe: z.number().min(1).max(10).optional(),
  /** Set when the deterministic scheduler replaced the template's choice. */
  swappedFrom: z.string().min(1).optional(),
  swapReason: z.enum(['injury', 'soreness', 'equipment']).optional(),
});

export type ExerciseSlot = z.infer<typeof ExerciseSlotSchema>;

export const SorenessEntrySchema = z.object({
  muscle: z.string().min(1),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export type SorenessEntry = z.infer<typeof SorenessEntrySchema>;

export const SubstitutionReasonEnum = z.enum([
  'pain',
  'equipment_unavailable',
  'low_energy',
  'preference',
  'other',
]);
export type SubstitutionReason = z.infer<typeof SubstitutionReasonEnum>;

export const SkipReasonEnum = z.enum([
  'travel',
  'illness',
  'unmotivated',
  'time',
  'other',
]);
export type SkipReason = z.infer<typeof SkipReasonEnum>;

export const GenerationModeEnum = z.enum(['llm_styled', 'template_fallback']);
export type GenerationMode = z.infer<typeof GenerationModeEnum>;

// ─── SessionScheduled (v1) ───────────────────────────────────────────
// Emitted once per trainingDay, after the pre-check-in is recorded.
//
// `planId` is nullable by design: until the deterministic planner lands
// (PlanGenerated, Step 8+), sessions come from the static template
// rotation and have no plan to point at. Null means exactly that.
//
// `workoutId` / `workoutName` are additive vs ARCHITECTURE §2 — without a
// plan there is nothing else to render a session title from.

export const SESSION_SCHEDULED_VERSION = 1;

/** A prep or cool-down movement, as prescribed. */
export const MobilitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});
export type Mobility = z.infer<typeof MobilitySchema>;

/** Something the engine wanted to prescribe and could not. */
export const DroppedSlotSchema = z.object({
  name: z.string().min(1),
  reason: z.enum(['injury', 'soreness', 'nothing_available']),
});
export type DroppedSlot = z.infer<typeof DroppedSlotSchema>;

export const SessionScheduledPayloadSchema = z.object({
  sessionId: z.string().min(1),
  trainingDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  planId: z.string().min(1).nullable(),
  workoutId: z.string().min(1),
  workoutName: z.string().min(1),
  exercises: z.array(ExerciseSlotSchema).min(1),
  openingNote: z.string().max(400),
  generationMode: GenerationModeEnum,

  // ── All four ADDITIVE-OPTIONAL, so no schemaVersion bump. ──
  // The scheduler computed every one of these on every check-in and
  // `checkInAndSchedule` forwarded none of them, so they were built and
  // discarded ~25 times per workout and no user ever saw one. 137 warm-up
  // movements and the whole dynamic-before/static-after argument produced
  // zero pixels.

  /** Raise temperature, then mobilise what today will load. Dynamic only. */
  warmup: z.object({
    raise: z.array(MobilitySchema),
    mobilise: z.array(MobilitySchema),
    minutes: z.number().int().nonnegative(),
  }).optional(),
  /** Held stretches, after — never before; static pre-lift cuts force output. */
  cooldown: z.array(MobilitySchema).optional(),
  /** What was left out, and why. Silence here reads as a thin session. */
  dropped: z.array(DroppedSlotSchema).optional(),
  /**
   * Why today looks like this, in the user's words. `openingNote` only ever
   * carried resolveSession's lines; the split rationale, the injury
   * explanation, the pull-up-bar suggestion and the six-day-novice warning
   * all lived past `reasons[0]` and Home rendered `reasons[0]` alone.
   */
  reasons: z.array(z.string().max(300)).max(8).optional(),
});

export type SessionScheduledPayload = z.infer<typeof SessionScheduledPayloadSchema>;

export const SessionScheduledSchema = BaseEventSchema.extend({
  type: z.literal('SessionScheduled'),
  schemaVersion: z.literal(SESSION_SCHEDULED_VERSION),
  payload: SessionScheduledPayloadSchema,
});

export type SessionScheduled = z.infer<typeof SessionScheduledSchema>;

export function draftSessionScheduled(
  payload: SessionScheduledPayload,
): EventDraft<'SessionScheduled', SessionScheduledPayload> {
  return {
    type: 'SessionScheduled',
    schemaVersion: SESSION_SCHEDULED_VERSION,
    payload: SessionScheduledPayloadSchema.parse(payload),
  };
}

// ─── PreCheckinRecorded (v1) ─────────────────────────────────────────
// Guards scheduled → active (ARCHITECTURE §7). Recorded *before*
// SessionScheduled so the scheduler can react to energy/soreness.

export const PRE_CHECKIN_RECORDED_VERSION = 1;

export const PreCheckinPayloadSchema = z.object({
  sessionId: z.string().min(1),
  energy: z.number().int().min(1).max(10),
  soreness: z.array(SorenessEntrySchema),
  notes: z.string().max(500).optional(),
});

export type PreCheckinPayload = z.infer<typeof PreCheckinPayloadSchema>;

export const PreCheckinRecordedSchema = BaseEventSchema.extend({
  type: z.literal('PreCheckinRecorded'),
  schemaVersion: z.literal(PRE_CHECKIN_RECORDED_VERSION),
  payload: PreCheckinPayloadSchema,
});

export type PreCheckinRecorded = z.infer<typeof PreCheckinRecordedSchema>;

export function draftPreCheckinRecorded(
  payload: PreCheckinPayload,
): EventDraft<'PreCheckinRecorded', PreCheckinPayload> {
  return {
    type: 'PreCheckinRecorded',
    schemaVersion: PRE_CHECKIN_RECORDED_VERSION,
    payload: PreCheckinPayloadSchema.parse(payload),
  };
}

// ─── SessionStarted (v1) ─────────────────────────────────────────────

export const SESSION_STARTED_VERSION = 1;

export const SessionStartedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  startedAt: z.string(),
});

export type SessionStartedPayload = z.infer<typeof SessionStartedPayloadSchema>;

export const SessionStartedSchema = BaseEventSchema.extend({
  type: z.literal('SessionStarted'),
  schemaVersion: z.literal(SESSION_STARTED_VERSION),
  payload: SessionStartedPayloadSchema,
});

export type SessionStarted = z.infer<typeof SessionStartedSchema>;

export function draftSessionStarted(
  payload: SessionStartedPayload,
): EventDraft<'SessionStarted', SessionStartedPayload> {
  return {
    type: 'SessionStarted',
    schemaVersion: SESSION_STARTED_VERSION,
    payload: SessionStartedPayloadSchema.parse(payload),
  };
}

// ─── SessionResumed (v1) ─────────────────────────────────────────────
// abandoned → active. Schema lands here so the catalog and the §7 state
// machine agree; it is only *emitted* once abandonment detection ships
// (Step 7b). A resumed session is real signal for the coach later.

export const SESSION_RESUMED_VERSION = 1;

export const SessionResumedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  resumedAt: z.string(),
  /** Minutes the session sat idle before the user came back. */
  idleMinutes: z.number().int().nonnegative(),
});

export type SessionResumedPayload = z.infer<typeof SessionResumedPayloadSchema>;

export const SessionResumedSchema = BaseEventSchema.extend({
  type: z.literal('SessionResumed'),
  schemaVersion: z.literal(SESSION_RESUMED_VERSION),
  payload: SessionResumedPayloadSchema,
});

export type SessionResumed = z.infer<typeof SessionResumedSchema>;

export function draftSessionResumed(
  payload: SessionResumedPayload,
): EventDraft<'SessionResumed', SessionResumedPayload> {
  return {
    type: 'SessionResumed',
    schemaVersion: SESSION_RESUMED_VERSION,
    payload: SessionResumedPayloadSchema.parse(payload),
  };
}

// ─── SetCompleted (v1) ───────────────────────────────────────────────
// `durationSec` is additive vs ARCHITECTURE §2: the static templates
// include hold-based work (Plank Hold, 3 × 30 sec) that `reps` cannot
// honestly represent. Rep-based sets leave it undefined.

export const SET_COMPLETED_VERSION = 1;

// RPE carries half-steps: 8.5 vs 9 is a real distinction and every
// autoregulation protocol uses it. This is a *widening* of the original
// integer-only rule — every previously valid payload still validates, no
// field changed shape — so it stays at schemaVersion 1 and needs no
// upcaster. (ARCHITECTURE §15's bump rule is about payload shape changes.)
export const RpeSchema = z.number().min(1).max(10).multipleOf(0.5);
export const RirSchema = z.number().min(0).max(5).multipleOf(0.5);

export const SetCompletedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  exerciseId: z.string().min(1),
  /**
   * Unique per (exerciseId, isWarmup). Working sets run 0..slot.sets-1;
   * warmups have their own index space so ramping up doesn't consume
   * prescribed volume.
   */
  setIndex: z.number().int().nonnegative(),
  isWarmup: z.boolean().optional(),
  weight_kg: z.number().nonnegative().max(1000),
  reps: z.number().int().nonnegative().max(200),
  durationSec: z.number().int().positive().max(3600).optional(),
  rpe: RpeSchema.optional(),
  rir: RirSchema.optional(),
});

export type SetCompletedPayload = z.infer<typeof SetCompletedPayloadSchema>;

export const SetCompletedSchema = BaseEventSchema.extend({
  type: z.literal('SetCompleted'),
  schemaVersion: z.literal(SET_COMPLETED_VERSION),
  payload: SetCompletedPayloadSchema,
});

export type SetCompleted = z.infer<typeof SetCompletedSchema>;

export function draftSetCompleted(
  payload: SetCompletedPayload,
): EventDraft<'SetCompleted', SetCompletedPayload> {
  return {
    type: 'SetCompleted',
    schemaVersion: SET_COMPLETED_VERSION,
    payload: SetCompletedPayloadSchema.parse(payload),
  };
}

// ─── ExerciseSubstituted (v1) ────────────────────────────────────────
// Schema only in 7a — emitting this needs the substitution graph and
// `proposeSubstitution` (Step 8).

export const EXERCISE_SUBSTITUTED_VERSION = 1;

export const ExerciseSubstitutedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  originalExerciseId: z.string().min(1),
  substituteExerciseId: z.string().min(1),
  substituteName: z.string().min(1),
  reason: SubstitutionReasonEnum,
  reasonText: z.string().max(300).optional(),
  proposedBy: z.enum(['user', 'llm', 'fallback']),
});

export type ExerciseSubstitutedPayload = z.infer<typeof ExerciseSubstitutedPayloadSchema>;

export const ExerciseSubstitutedSchema = BaseEventSchema.extend({
  type: z.literal('ExerciseSubstituted'),
  schemaVersion: z.literal(EXERCISE_SUBSTITUTED_VERSION),
  payload: ExerciseSubstitutedPayloadSchema,
});

export type ExerciseSubstituted = z.infer<typeof ExerciseSubstitutedSchema>;

export function draftExerciseSubstituted(
  payload: ExerciseSubstitutedPayload,
): EventDraft<'ExerciseSubstituted', ExerciseSubstitutedPayload> {
  return {
    type: 'ExerciseSubstituted',
    schemaVersion: EXERCISE_SUBSTITUTED_VERSION,
    payload: ExerciseSubstitutedPayloadSchema.parse(payload),
  };
}

// ─── ExerciseSkipped (v1) ────────────────────────────────────────────

export const EXERCISE_SKIPPED_VERSION = 1;

export const ExerciseSkippedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  exerciseId: z.string().min(1),
  reason: z.string().max(300),
});

export type ExerciseSkippedPayload = z.infer<typeof ExerciseSkippedPayloadSchema>;

export const ExerciseSkippedSchema = BaseEventSchema.extend({
  type: z.literal('ExerciseSkipped'),
  schemaVersion: z.literal(EXERCISE_SKIPPED_VERSION),
  payload: ExerciseSkippedPayloadSchema,
});

export type ExerciseSkipped = z.infer<typeof ExerciseSkippedSchema>;

export function draftExerciseSkipped(
  payload: ExerciseSkippedPayload,
): EventDraft<'ExerciseSkipped', ExerciseSkippedPayload> {
  return {
    type: 'ExerciseSkipped',
    schemaVersion: EXERCISE_SKIPPED_VERSION,
    payload: ExerciseSkippedPayloadSchema.parse(payload),
  };
}

// ─── SessionCompleted (v1) ───────────────────────────────────────────

export const SESSION_COMPLETED_VERSION = 1;

/**
 * How the session landed, in the user's own judgement.
 *
 * `verdict` is the one the app cannot derive: RPE says how hard a SET felt,
 * this says whether the SESSION was the right session. That is the calibration
 * signal the whole deterministic engine is missing — it prescribes volume and
 * load from rules, and nothing has ever told it whether the result was any
 * good.
 */
export const SessionVerdictEnum = z.enum(['too_easy', 'about_right', 'too_much']);
export type SessionVerdict = z.infer<typeof SessionVerdictEnum>;

/** What went wrong, if anything. Multi-select; the app cannot infer these. */
export const SessionGripeEnum = z.enum([
  'wrong_exercises',
  'too_long',
  'too_short',
  'something_hurt',
  'confusing',
  'equipment_missing',
]);
export type SessionGripe = z.infer<typeof SessionGripeEnum>;

export const SessionReviewSchema = z.object({
  verdict: SessionVerdictEnum,
  gripes: z.array(SessionGripeEnum).default([]),
  /** Free text, optional. Capped so it cannot bloat the log. */
  note: z.string().max(1000).optional(),
});
export type SessionReview = z.infer<typeof SessionReviewSchema>;

export const SessionCompletedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  completedAt: z.string(),
  completedExercises: z.number().int().nonnegative(),
  totalExercises: z.number().int().nonnegative(),
  avgRpe: z.number().min(1).max(10).optional(),
  /**
   * OPTIONAL in the schema, REQUIRED by the command layer during testing.
   *
   * Optional because adding a required field would narrow the schema, which
   * needs a schemaVersion bump and an upcaster for every historical event.
   * Required in `completeSession` because that is where invariants live and
   * where a guard can be relaxed after the test without touching history.
   */
  review: SessionReviewSchema.optional(),
});

export type SessionCompletedPayload = z.infer<typeof SessionCompletedPayloadSchema>;

export const SessionCompletedSchema = BaseEventSchema.extend({
  type: z.literal('SessionCompleted'),
  schemaVersion: z.literal(SESSION_COMPLETED_VERSION),
  payload: SessionCompletedPayloadSchema,
});

export type SessionCompleted = z.infer<typeof SessionCompletedSchema>;

export function draftSessionCompleted(
  payload: SessionCompletedPayload,
): EventDraft<'SessionCompleted', SessionCompletedPayload> {
  return {
    type: 'SessionCompleted',
    schemaVersion: SESSION_COMPLETED_VERSION,
    payload: SessionCompletedPayloadSchema.parse(payload),
  };
}

// ─── SessionSkipped (v1) ─────────────────────────────────────────────

export const SESSION_SKIPPED_VERSION = 1;

export const SessionSkippedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  trainingDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: SkipReasonEnum,
  notes: z.string().max(500).optional(),
});

export type SessionSkippedPayload = z.infer<typeof SessionSkippedPayloadSchema>;

export const SessionSkippedSchema = BaseEventSchema.extend({
  type: z.literal('SessionSkipped'),
  schemaVersion: z.literal(SESSION_SKIPPED_VERSION),
  payload: SessionSkippedPayloadSchema,
});

export type SessionSkipped = z.infer<typeof SessionSkippedSchema>;

export function draftSessionSkipped(
  payload: SessionSkippedPayload,
): EventDraft<'SessionSkipped', SessionSkippedPayload> {
  return {
    type: 'SessionSkipped',
    schemaVersion: SESSION_SKIPPED_VERSION,
    payload: SessionSkippedPayloadSchema.parse(payload),
  };
}

// ─── SessionSummaryGenerated (v1) ────────────────────────────────────
// 7a emits this with generationMode 'extractive_fallback' — the
// deterministic fallback ARCHITECTURE §3 tool 5 mandates. Step 8 swaps in
// the Groq call and flips the mode to 'llm'.

export const SESSION_SUMMARY_GENERATED_VERSION = 1;

export const SummaryModeEnum = z.enum(['llm', 'extractive_fallback']);
export type SummaryMode = z.infer<typeof SummaryModeEnum>;

export const SessionSummaryPayloadSchema = z.object({
  sessionId: z.string().min(1),
  summary: z.string().min(1).max(300),
  highlights: z.array(z.string().max(200)),
  embedding: z.array(z.number()).optional(),
  generationMode: SummaryModeEnum,
});

export type SessionSummaryPayload = z.infer<typeof SessionSummaryPayloadSchema>;

export const SessionSummaryGeneratedSchema = BaseEventSchema.extend({
  type: z.literal('SessionSummaryGenerated'),
  schemaVersion: z.literal(SESSION_SUMMARY_GENERATED_VERSION),
  payload: SessionSummaryPayloadSchema,
});

export type SessionSummaryGenerated = z.infer<typeof SessionSummaryGeneratedSchema>;

export function draftSessionSummaryGenerated(
  payload: SessionSummaryPayload,
): EventDraft<'SessionSummaryGenerated', SessionSummaryPayload> {
  return {
    type: 'SessionSummaryGenerated',
    schemaVersion: SESSION_SUMMARY_GENERATED_VERSION,
    payload: SessionSummaryPayloadSchema.parse(payload),
  };
}
