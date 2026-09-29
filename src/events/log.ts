import { asc, desc, eq, gte, lte, and, inArray, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { events, type EventRow } from '../db/schema';
import { upcastPayload } from './upcast';
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

// ARCHITECTURE §12 — once the chain is known broken, the log is read-only.
// Appending onto a corrupt chain buries the break under valid-looking rows.
let readOnly: { brokenAtSeq: number; reason: string } | null = null;

export function enterReadOnlyMode(at: { brokenAtSeq: number; reason: string }): void {
  readOnly = at;
}
export function isReadOnly(): boolean {
  return readOnly !== null;
}

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

/**
 * Rows this build could not parse. Surfaced to the UI so the failure is
 * loud: the alternative, which shipped, was a `catch` that logged to a
 * console nobody reads and left every projection at INITIAL_* — so
 * `isOnboarded` was false, the navigator sent the user to Onboarding, and
 * they saw a BRAND NEW APP with their whole history intact on disk and
 * invisible. Then they re-onboarded and appended a second identity on top.
 *
 * The failure did not present as an error. It presented as "the app forgot
 * me", which is the worst outcome this codebase can produce.
 */
let unreadableRows: { seq: number; type: string; reason: string }[] = [];

export function unreadableEventCount(): number {
  return unreadableRows.length;
}
export function unreadableEventDetail(): { seq: number; type: string; reason: string }[] {
  return [...unreadableRows];
}

function rowToEvent(row: EventRow): Event {
  const stored = JSON.parse(row.payloadJson) as unknown;

  // Migrate the payload forward before validating. The schemas pin
  // `schemaVersion: z.literal(N)`, so an un-upcast v1 row fails to parse the
  // moment N becomes 2 — see src/events/upcast.ts for what that did.
  const up = upcastPayload(row.type, row.schemaVersion, stored);
  if (!up.ok) {
    throw new Error(`seq ${row.seq}: ${up.reason}`);
  }

  const reconstituted = {
    id: row.id,
    seq: row.seq,
    type: row.type,
    occurredAt: row.occurredAt,
    trainingDay: row.trainingDay,
    schemaVersion: up.version,
    prevHash: row.prevHash,
    payload: up.payload,
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
  if (readOnly !== null) {
    throw new Error(
      `Event log is read-only: integrity check failed at seq ${readOnly.brokenAtSeq} (${readOnly.reason}).`,
    );
  }
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
      // Hashes the whole stored envelope, not just id + payload — see
      // hashEvent. The row's own fields are used verbatim so the value here
      // matches what verifyChain will recompute from disk.
      const prevHash = last
        ? hashEvent({
            id: last.id,
            type: last.type,
            occurredAt: last.occurredAt,
            trainingDay: last.trainingDay,
            schemaVersion: last.schemaVersion,
            prevHash: last.prevHash,
            payload: JSON.parse(last.payloadJson),
          })
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
    // Push the type filter into SQL so it composes with the seq/day filters
    // below. An earlier version short-circuited on multi-type reads and
    // silently dropped fromSeq/toSeq/trainingDay.
    if (types.length === 1) {
      const t = types[0];
      if (t !== undefined) conditions.push(eq(events.type, t));
    } else if (types.length > 1) {
      conditions.push(inArray(events.type, types));
    } else {
      // Explicit empty type list means "match nothing" — don't silently
      // widen it to "match everything".
      return [];
    }
  }
  if (filter.fromSeq !== undefined) conditions.push(gte(events.seq, filter.fromSeq));
  if (filter.toSeq !== undefined) conditions.push(lte(events.seq, filter.toSeq));
  if (filter.trainingDay !== undefined) conditions.push(eq(events.trainingDay, filter.trainingDay));

  const whereClause = conditions.length === 0 ? undefined : and(...conditions);

  const rows = whereClause
    ? await db.select().from(events).where(whereClause).orderBy(asc(events.seq))
    : await db.select().from(events).orderBy(asc(events.seq));

  // Skip-and-count rather than throw. One unparseable row used to take the
  // entire read down — and every future schemaVersion bump makes every
  // historical row of that type unparseable, because each event schema pins
  // `schemaVersion: z.literal(N)` and there is no upcaster chain yet.
  const out: Event[] = [];
  const bad: { seq: number; type: string; reason: string }[] = [];
  for (const row of rows) {
    try {
      out.push(rowToEvent(row));
    } catch (e) {
      bad.push({
        seq: row.seq,
        type: row.type,
        reason: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
    }
  }
  unreadableRows = bad;
  if (bad.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`[log] ${bad.length} unreadable row(s); first at seq ${bad[0]!.seq} (${bad[0]!.type}): ${bad[0]!.reason}`);
    // Do not write on top of a log we cannot fully read — appending would
    // bury the damage under valid-looking rows.
    enterReadOnlyMode({
      brokenAtSeq: bad[0]!.seq,
      reason: `${bad.length} event(s) could not be read. First: ${bad[0]!.type} — ${bad[0]!.reason}`,
    });
  }
  return out;
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
    expectedPrevHash = hashEvent({
      id: row.id,
      type: row.type,
      occurredAt: row.occurredAt,
      trainingDay: row.trainingDay,
      schemaVersion: row.schemaVersion,
      prevHash: row.prevHash,
      payload,
    });
    expectedSeq += 1;
  }

  return { ok: true, count: rows.length };
}
