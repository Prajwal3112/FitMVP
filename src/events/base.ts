import { z } from 'zod';
import { ulid } from 'ulid';
import { sha256 } from 'js-sha256';

// ─── Envelope ─────────────────────────────────────────────────────────
// Every persisted event carries this envelope. Payload sits inside it.

export const BaseEventSchema = z.object({
  id: z.string(),
  seq: z.number().int().nonnegative(),
  type: z.string(),
  occurredAt: z.string(),                                  // ISO 8601 UTC
  trainingDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),    // YYYY-MM-DD
  schemaVersion: z.number().int().positive(),
  prevHash: z.string(),
});

export type BaseEvent = z.infer<typeof BaseEventSchema>;

// ─── Genesis hash ─────────────────────────────────────────────────────
// The seq=0 event uses this as its prevHash. Avoid collisions with real hashes.

export const GENESIS_PREV_HASH = '__genesis__';

// ─── Hashing ─────────────────────────────────────────────────────────
// Deterministic event hash: sha256(id + canonical JSON of payload).
// Used to chain events. Verifies append-only history wasn't tampered with.

export function hashEvent(input: { id: string; payload: unknown }): string {
  return sha256(input.id + JSON.stringify(input.payload));
}

// ─── Training-day boundary ───────────────────────────────────────────
// "Today" is bounded by the user's configured rollover hour (default 4am
// local time). Logging at 2am still counts as the previous day's workout.

export function trainingDayOf(when: Date, rolloverHour: number): string {
  const rolloverMs = rolloverHour * 60 * 60 * 1000;
  const shifted = new Date(when.getTime() - rolloverMs);
  const yyyy = shifted.getFullYear();
  const mm = String(shifted.getMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ─── ID generation ───────────────────────────────────────────────────
// ULID: monotonic-ish, sortable, URL-safe, 26 chars.

export function newEventId(): string {
  return ulid();
}

// ─── Draft type ──────────────────────────────────────────────────────
// What a tool/handler produces. The event log fills in:
//   id, seq, occurredAt, trainingDay, prevHash
// from the draft + current state.

export type EventDraft<TType extends string, TPayload> = {
  type: TType;
  schemaVersion: number;
  payload: TPayload;
};
