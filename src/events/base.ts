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

/**
 * JSON with object keys in sorted order, recursively.
 *
 * `JSON.stringify` preserves insertion order, so two payloads with identical
 * content but different key order hash differently. Today they round-trip
 * because the stored text is re-parsed in its own order — but that is an
 * accident of the storage path, not a property of the hash, and an upcaster
 * that rebuilds a payload would break it. Sorting makes the hash a function of
 * the content alone.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** Everything the chain commits to. Nothing about an event sits outside it. */
export type HashableEvent = {
  id: string;
  type: string;
  occurredAt: string;
  trainingDay: string;
  schemaVersion: number;
  /** The previous event's hash. Including it is what makes the chain a chain. */
  prevHash: string;
  payload: unknown;
};

/**
 * The link in the hash chain.
 *
 * ⚠ THIS SIGNATURE CHANGED 2026-09-29, AND SO DID EVERY HASH. It used to be
 * `sha256(id + JSON.stringify(payload))`, which had two holes:
 *
 *  1. `seq`, `type`, `occurredAt`, `trainingDay` and `schemaVersion` were all
 *     OUTSIDE the hash. `trainingDay` is the most load-bearing field in the
 *     system — it drives adherence, gap detection, the weekday signal, the
 *     rotation and `sessionIdByDay` — and rewriting it in the database passed
 *     `verifyChain()` clean. So did changing an event's `type`.
 *  2. Event N's hash excluded N's own `prevHash`, so the "chain" did not
 *     actually chain: forging event 5 required patching exactly ONE field on
 *     event 6, not recomputing 6..N. Tampering was O(1) to hide, not O(N).
 *
 * Verified by execution both before (both attacks passed) and after (both
 * caught) — see checks/schema.ts.
 *
 * Because every hash changes, ANY pre-existing database fails verifyChain and
 * lands in read-only mode. That is acceptable exactly once, and this is the
 * moment: the app has never run on a device, so no real log exists anywhere.
 * Doing it after a tester has four weeks of data would mean an upcaster for
 * the chain itself.
 */
export function hashEvent(input: HashableEvent): string {
  return sha256([
    input.prevHash,
    input.id,
    input.type,
    input.occurredAt,
    input.trainingDay,
    String(input.schemaVersion),
    canonicalJson(input.payload),
  ].join('\u0000'));
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
