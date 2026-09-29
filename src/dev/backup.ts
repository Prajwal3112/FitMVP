import { z } from 'zod';
import { EventSchema, type Event } from '../events';
import { hashEvent, GENESIS_PREV_HASH } from '../events/base';
import { APP_BUILD } from '../constants/build';

/**
 * A restorable backup of the whole event log.
 *
 * DISTINCT FROM `digest.ts`. The digest is human-readable prose for the
 * developer's eyes: lossy by design, and it cannot rebuild anything. This is
 * the bytes — every event, verbatim, with its hash chain intact — and it is
 * the only thing standing between a tester and total loss, because uninstall
 * or "Clear data" wipes the SQLite file with no warning.
 *
 * Pure functions only: no database, no react-native. Both so the format can
 * be tested, and so a restore can be validated fully BEFORE anything is
 * written. Restoring a half-checked log onto a working one is the kind of
 * mistake there is no recovering from.
 */

const BACKUP_FORMAT = 1;

export const BackupSchema = z.object({
  /** Bumped only if the envelope changes. Event payloads carry their own. */
  format: z.literal(BACKUP_FORMAT),
  app: z.string(),
  exportedAt: z.string(),
  eventCount: z.number().int().nonnegative(),
  /** Chain head at export time, so a truncated file is detectable. */
  finalHash: z.string(),
  events: z.array(EventSchema),
});
export type Backup = z.infer<typeof BackupSchema>;

/** Serialise the log. `events` must be in seq order. */
export function serializeLog(events: Event[]): string {
  let head = GENESIS_PREV_HASH;
  for (const e of events) head = hashEvent(e);
  const backup: Backup = {
    format: BACKUP_FORMAT,
    app: APP_BUILD,
    exportedAt: new Date().toISOString(),
    eventCount: events.length,
    finalHash: head,
    events,
  };
  return JSON.stringify(backup);
}

export type ParseResult =
  | { ok: true; events: Event[]; exportedAt: string; app: string }
  | { ok: false; reason: string };

/**
 * Validate a backup completely before it is trusted.
 *
 * Checks, in order: it is JSON; it matches the envelope; every event passes
 * its own schema; seq is gapless from 0; the hash chain recomputes; and the
 * recomputed head matches the head recorded at export. A file that fails any
 * of these is refused rather than partially restored.
 */
export function parseBackup(json: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { ok: false, reason: `Not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }

  const parsed = BackupSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      reason: first
        ? `Backup is not in a format this build understands (${first.path.join('.')}: ${first.message})`
        : 'Backup is not in a format this build understands',
    };
  }
  const b = parsed.data;

  if (b.events.length !== b.eventCount) {
    return {
      ok: false,
      reason: `Backup says ${b.eventCount} events but contains ${b.events.length} — the file looks truncated.`,
    };
  }

  let head = GENESIS_PREV_HASH;
  for (let i = 0; i < b.events.length; i++) {
    const e = b.events[i]!;
    if (e.seq !== i) {
      return { ok: false, reason: `Event ${i} has seq ${e.seq} — the sequence has a gap.` };
    }
    if (e.prevHash !== head) {
      return { ok: false, reason: `Hash chain breaks at seq ${e.seq}. The file has been altered.` };
    }
    head = hashEvent(e);
  }
  if (head !== b.finalHash) {
    return { ok: false, reason: 'The chain does not end where the backup says it should.' };
  }

  return { ok: true, events: b.events, exportedAt: b.exportedAt, app: b.app };
}

/** Human summary, for the confirmation prompt before a restore. */
export function describeBackup(events: Event[], exportedAt: string): string {
  const days = new Set(events.map((e) => e.trainingDay));
  const sessions = events.filter((e) => e.type === 'SessionCompleted').length;
  const first = events[0]?.trainingDay ?? '—';
  const last = events[events.length - 1]?.trainingDay ?? '—';
  return [
    `${events.length} events`,
    `${sessions} completed session${sessions === 1 ? '' : 's'}`,
    `${days.size} day${days.size === 1 ? '' : 's'} of history`,
    `${first} to ${last}`,
    `saved ${exportedAt.slice(0, 10)}`,
  ].join(' · ');
}
