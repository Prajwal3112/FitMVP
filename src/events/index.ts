import { z } from 'zod';
import {
  UserContextCreatedSchema,
  UserContextUpdatedSchema,
  type UserContextCreated,
  type UserContextUpdated,
  type UserContextCreatedPayload,
  type UserContextUpdatedPayload,
} from './userContext';
import {
  GoalCreatedSchema,
  GoalRevisedSchema,
  type GoalCreated,
  type GoalRevised,
  type GoalCreatedPayload,
  type GoalRevisedPayload,
} from './goal';
import type { EventDraft } from './base';

// ─── Discriminated union of all events ───────────────────────────────
// Add new event schemas to this union as they're built.
// `event.type` narrows the payload via TypeScript's discriminated union magic.

export const EventSchema = z.discriminatedUnion('type', [
  UserContextCreatedSchema,
  UserContextUpdatedSchema,
  GoalCreatedSchema,
  GoalRevisedSchema,
]);

export type Event = z.infer<typeof EventSchema>;

// ─── Discriminated union of event drafts ─────────────────────────────
// What handlers produce *before* the log fills in id/seq/etc.

export type AnyEventDraft =
  | EventDraft<'UserContextCreated', UserContextCreatedPayload>
  | EventDraft<'UserContextUpdated', UserContextUpdatedPayload>
  | EventDraft<'GoalCreated', GoalCreatedPayload>
  | EventDraft<'GoalRevised', GoalRevisedPayload>;

// ─── Re-exports ──────────────────────────────────────────────────────

export * from './base';
export * from './userContext';
export * from './goal';

// Convenience type maps for tooling.
export type EventType = Event['type'];
export type EventByType<T extends EventType> = Extract<Event, { type: T }>;

// Re-export concrete event types for downstream consumers.
export type { UserContextCreated, UserContextUpdated, GoalCreated, GoalRevised };
