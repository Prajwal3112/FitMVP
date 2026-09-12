import { z } from 'zod';
import { BaseEventSchema, type EventDraft } from './base';

// ─── Shared sub-schemas ─────────────────────────────────────────────

export const GoalTypeEnum = z.enum([
  'hypertrophy',
  'strength',
  'fat_loss',
  'endurance',
  'general_fitness',
]);
export type GoalKind = z.infer<typeof GoalTypeEnum>;

// ─── GoalCreated (v1) ────────────────────────────────────────────────

export const GOAL_CREATED_VERSION = 1;

export const GoalCreatedPayloadSchema = z.object({
  goalId: z.string(),
  goalType: GoalTypeEnum,
  why: z.string().min(1).max(200),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),   // ISO YYYY-MM-DD
});

export type GoalCreatedPayload = z.infer<typeof GoalCreatedPayloadSchema>;

export const GoalCreatedSchema = BaseEventSchema.extend({
  type: z.literal('GoalCreated'),
  schemaVersion: z.literal(GOAL_CREATED_VERSION),
  payload: GoalCreatedPayloadSchema,
});

export type GoalCreated = z.infer<typeof GoalCreatedSchema>;

export function draftGoalCreated(
  payload: GoalCreatedPayload,
): EventDraft<'GoalCreated', GoalCreatedPayload> {
  return {
    type: 'GoalCreated',
    schemaVersion: GOAL_CREATED_VERSION,
    payload: GoalCreatedPayloadSchema.parse(payload),
  };
}

// ─── GoalRevised (v1) ────────────────────────────────────────────────
// Single-field mutation. Per ARCHITECTURE invariant §4, goalType + why
// changes inside an active TrainingBlock must emit ReplanForced upstream.

export const GOAL_REVISED_VERSION = 1;

export const GoalRevisedFieldEnum = z.enum(['why', 'targetDate', 'goalType']);
export type GoalRevisedField = z.infer<typeof GoalRevisedFieldEnum>;

export const GoalRevisedPayloadSchema = z.object({
  goalId: z.string(),
  field: GoalRevisedFieldEnum,
  before: z.unknown(),
  after: z.unknown(),
});

export type GoalRevisedPayload = z.infer<typeof GoalRevisedPayloadSchema>;

export const GoalRevisedSchema = BaseEventSchema.extend({
  type: z.literal('GoalRevised'),
  schemaVersion: z.literal(GOAL_REVISED_VERSION),
  payload: GoalRevisedPayloadSchema,
});

export type GoalRevised = z.infer<typeof GoalRevisedSchema>;

export function draftGoalRevised(
  payload: GoalRevisedPayload,
): EventDraft<'GoalRevised', GoalRevisedPayload> {
  return {
    type: 'GoalRevised',
    schemaVersion: GOAL_REVISED_VERSION,
    payload: GoalRevisedPayloadSchema.parse(payload),
  };
}
