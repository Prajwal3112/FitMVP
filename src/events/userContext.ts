import { z } from 'zod';
import { BaseEventSchema, type EventDraft } from './base';

// ─── Shared sub-schemas ─────────────────────────────────────────────

export const ProfileSchema = z.object({
  /**
   * OPTIONAL, and nothing reads it. Onboarding never asked for age, yet the
   * payload builder required it — `Number('') === 0` failed the `> 0` check
   * and every new user hit "Invalid age" under a form with no age field.
   * Widened rather than back-filled with a fabricated number: if we do not
   * know someone's age we should not record one. Widening keeps every
   * existing payload valid, so no schemaVersion bump.
   */
  age: z.number().int().min(0).max(150).optional(),
  height_cm: z.number().positive().max(300),
  weight_kg: z.number().positive().max(500),
  sex: z.enum(['m', 'f', 'other']),
});

export type Profile = z.infer<typeof ProfileSchema>;

export const RoutineSchema = z.object({
  wakeHour: z.number().int().min(0).max(23),
  sleepHour: z.number().int().min(0).max(23),
  sessionWindow: z.string(),                          // e.g., '07:00'
});

export type Routine = z.infer<typeof RoutineSchema>;

export const EquipmentEnum = z.enum(['home', 'gym', 'mixed']);
export type EquipmentTier = z.infer<typeof EquipmentEnum>;

export const ConstraintsSchema = z.object({
  daysPerWeek: z.number().int().min(1).max(7),
  sessionMaxMinutes: z.number().int().positive().max(240),
});

// ─── Experience ──────────────────────────────────────────────────────
// The single highest-value onboarding answer. Drives starting-load
// estimates, whether RPE is shown at all, and whether exercises are
// capped to beginner-safe movements.

export const ExperienceEnum = z.enum(['new', 'returning', 'regular', 'experienced']);
export type Experience = z.infer<typeof ExperienceEnum>;

/**
 * What the user actually owns, beyond the home/gym tier. Values match the
 * exercise library's equipment labels so they filter directly.
 */
export const OwnedEquipmentEnum = z.enum([
  'body only',
  'dumbbell',
  'bands',
  'kettlebells',
  'exercise ball',
  'medicine ball',
  'barbell',
  'machine',
  'cable',
  'e-z curl bar',
  'pullup bar',
]);
export type OwnedEquipment = z.infer<typeof OwnedEquipmentEnum>;

export type Constraints = z.infer<typeof ConstraintsSchema>;

// ─── UserContextCreated (v1) ─────────────────────────────────────────

export const USER_CONTEXT_CREATED_VERSION = 1;

export const UserContextCreatedPayloadSchema = z.object({
  profile: ProfileSchema,
  routine: RoutineSchema,
  equipment: EquipmentEnum,
  constraints: ConstraintsSchema,
  knownInjuries: z.array(z.string()),                 // lowercase muscle/joint tags
  dayRolloverHour: z.number().int().min(0).max(23),   // default 4
  // Additive + optional: every payload written before these existed still
  // validates, so no schemaVersion bump and no upcaster (see §15 rule).
  experience: ExperienceEnum.optional(),
  ownedEquipment: z.array(OwnedEquipmentEnum).optional(),
});

export type UserContextCreatedPayload = z.infer<typeof UserContextCreatedPayloadSchema>;

export const UserContextCreatedSchema = BaseEventSchema.extend({
  type: z.literal('UserContextCreated'),
  schemaVersion: z.literal(USER_CONTEXT_CREATED_VERSION),
  payload: UserContextCreatedPayloadSchema,
});

export type UserContextCreated = z.infer<typeof UserContextCreatedSchema>;

export function draftUserContextCreated(
  payload: UserContextCreatedPayload,
): EventDraft<'UserContextCreated', UserContextCreatedPayload> {
  return {
    type: 'UserContextCreated',
    schemaVersion: USER_CONTEXT_CREATED_VERSION,
    payload: UserContextCreatedPayloadSchema.parse(payload),
  };
}

// ─── UserContextUpdated (v1) ─────────────────────────────────────────
// Partial mutations to UserContext after onboarding.
// Field is dotted-path string so we can target nested values (e.g., 'profile.weight_kg').

export const USER_CONTEXT_UPDATED_VERSION = 1;

export const UserContextUpdatedPayloadSchema = z.object({
  field: z.string().min(1),
  before: z.unknown(),
  after: z.unknown(),
});

export type UserContextUpdatedPayload = z.infer<typeof UserContextUpdatedPayloadSchema>;

export const UserContextUpdatedSchema = BaseEventSchema.extend({
  type: z.literal('UserContextUpdated'),
  schemaVersion: z.literal(USER_CONTEXT_UPDATED_VERSION),
  payload: UserContextUpdatedPayloadSchema,
});

export type UserContextUpdated = z.infer<typeof UserContextUpdatedSchema>;

export function draftUserContextUpdated(
  payload: UserContextUpdatedPayload,
): EventDraft<'UserContextUpdated', UserContextUpdatedPayload> {
  return {
    type: 'UserContextUpdated',
    schemaVersion: USER_CONTEXT_UPDATED_VERSION,
    payload: UserContextUpdatedPayloadSchema.parse(payload),
  };
}
