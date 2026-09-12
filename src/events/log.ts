import { asc, desc, eq, gte, lte, and, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { events, type EventRow } from '../db/schema';
import {
  EventSchema,
  hashEvent,
  newEventId,
  trainingDayOf,
  GENESIS_PREV_HASH,
  type Event,
  type AnyEventDraft,
  type EventType,
} from './index';

// ─── Write lock ──────────────────────────────────────────────────────
// Serializes appendEvent calls so seq stays monotonic + gapless.
// Single-process app — JS promise chain is enough.

let writeChain: Promise<unknown> = Promise.resolve();

async function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = writeChain;
  let release!: () => void;
  writeChain = new Promise<void>((r) => {
    release = r;
  });
  try {
    await previous;
    return await fn();
  } finally {
    release();
  }
}

// ─── Row ↔ Event conversion ──────────────────────────────────────────

function rowToEvent(row: EventRow): Event {
  const reconstituted = {
    id: row.id,
    seq: row.seq,
    type: row.type,
    occurredAt: row.occurredAt,
    trainingDay: row.trainingDay,
    schemaVersion: row.schemaVersion,
    prevHash: row.prevHash,
    payload: JSON.parse(row.payloadJson) as unknown,
  };
  return EventSchema.parse(reconstituted);
}

// ─── Internal helpers ────────────────────────────────────────────────

async function getLastEventRow(): Promise<EventRow | null> {
  const rows = await db
    .select()
    .from(events)
    .orderBy(desc(events.seq))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Public API ──────────────────────────────────────────────────────

export type AppendOptions = {
  /** Hour-of-day boundary for `trainingDay`. Default 4 (4am). */
  rolloverHour?: number;
  /** Override `occurredAt`. Default = now. Use only for backfill/tests. */
  occurredAt?: Date;
};

export type AppendResult = {
  event: Event;
  isGenesis: boolean;
};

/**
 * Append a single event to the log.
 * Atomic with the seq assignment via SQLite transaction + JS write lock.
 * Validates the full event against the discriminated union before write.
 */
export async function appendEvent(
  draft: AnyEventDraft,
  options: AppendOptions = {},
): Promise<AppendResult> {
  const rolloverHour = options.rolloverHour ?? 4;
  const now = options.occurredAt ?? new Date();
  const occurredAt = now.toISOString();
  const trainingDay = trainingDayOf(now, rolloverHour);
  const id = newEventId();

  return withWriteLock(async () => {
    return await db.transaction(async (tx) => {
      const lastRow = await tx
        .select()
        .from(events)
        .orderBy(desc(events.seq))
        .limit(1);
      const last = lastRow[0] ?? null;

      const nextSeq = last ? last.seq + 1 : 0;
      const prevHash = last
        ? hashEvent({ id: last.id, payload: JSON.parse(last.payloadJson) })
        : GENESIS_PREV_HASH;

      const event: Event = EventSchema.parse({
        id,
        seq: nextSeq,
        type: draft.type,
        occurredAt,
        trainingDay,
        schemaVersion: draft.schemaVersion,
        prevHash,
        payload: draft.payload,
      });

      await tx.insert(events).values({
        id: event.id,
        seq: event.seq,
        type: event.type,
        occurredAt: event.occurredAt,
        trainingDay: event.trainingDay,
        payloadJson: JSON.stringify(event.payload),
        schemaVersion: event.schemaVersion,
        prevHash: event.prevHash,
      });

      return { event, isGenesis: last === null };
    });
  });
}

// ─── Read API ────────────────────────────────────────────────────────

export type ReadFilter = {
  type?: EventType | EventType[];
  fromSeq?: number;
  toSeq?: number;
  trainingDay?: string;
};

/**
 * Read events ordered by seq ASC.
 * Each row is validated through Zod on read — rejects corrupted/legacy rows.
 */
export async function readEvents(filter: ReadFilter = {}): Promise<Event[]> {
  const conditions: SQL[] = [];
  if (filter.type) {
    const types = Array.isArray(filter.type) ? filter.type : [filter.type];
    // Use OR via raw `in` would be nicer; for now, single-type fast path covers the common case.
    if (types.length === 1) {
      const t = types[0];
      if (t !== undefined) conditions.push(eq(events.type, t));
    } else if (types.length > 1) {
      // Fallback: read all then filter in JS. (Single-user volume tolerates this.)
      const rows = await db.select().from(events).orderBy(asc(events.seq));
      return rows
        .filter((r) => types.includes(r.type as EventType))
        .map(rowToEvent);
    }
  }
  if (filter.fromSeq !== undefined) conditions.push(gte(events.seq, filter.fromSeq));
  if (filter.toSeq !== undefined) conditions.push(lte(events.seq, filter.toSeq));
  if (filter.trainingDay !== undefined) conditions.push(eq(events.trainingDay, filter.trainingDay));

  const whereClause = conditions.length === 0 ? undefined : and(...conditions);

  const rows = whereClause
    ? await db.select().from(events).where(whereClause).orderBy(asc(events.seq))
    : await db.select().from(events).orderBy(asc(events.seq));

  return rows.map(rowToEvent);
}

/** Convenience: last event in the log, or null if empty. */
export async function getLastEvent(): Promise<Event | null> {
  const row = await getLastEventRow();
  return row ? rowToEvent(row) : null;
}

/** Convenience: total event count. */
export async function eventCount(): Promise<number> {
  const row = await getLastEventRow();
  return row ? row.seq + 1 : 0;
}

// ─── Chain verification ──────────────────────────────────────────────

export type ChainVerifyResult =
  | { ok: true; count: number }
  | { ok: false; brokenAtSeq: number; reason: 'hash_mismatch' | 'seq_gap' | 'parse_error'; details: string };

/**
 * Replay the entire log, recomputing prev_hash chain.
 * O(N) — fine for single-user volume (tens of thousands of events).
 * Used to detect tampering or corruption.
 */
export async function verifyChain(): Promise<ChainVerifyResult> {
  const rows = await db.select().from(events).orderBy(asc(events.seq));

  let expectedPrevHash = GENESIS_PREV_HASH;
  let expectedSeq = 0;

  for (const row of rows) {
    if (row.seq !== expectedSeq) {
      return {
        ok: false,
        brokenAtSeq: row.seq,
        reason: 'seq_gap',
        details: `expected seq=${expectedSeq}, got seq=${row.seq}`,
      };
    }
    if (row.prevHash !== expectedPrevHash) {
      return {
        ok: false,
        brokenAtSeq: row.seq,
        reason: 'hash_mismatch',
        details: `expected prevHash=${expectedPrevHash}, got prevHash=${row.prevHash}`,
      };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(row.payloadJson);
    } catch (e) {
      return {
        ok: false,
        brokenAtSeq: row.seq,
        reason: 'parse_error',
        details: e instanceof Error ? e.message : String(e),
      };
    }
    expectedPrevHash = hashEvent({ id: row.id, payload });
    expectedSeq += 1;
  }

  return { ok: true, count: rows.length };
}
