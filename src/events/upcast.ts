import {
  USER_CONTEXT_CREATED_VERSION, USER_CONTEXT_UPDATED_VERSION,
} from './userContext';
import { GOAL_CREATED_VERSION, GOAL_REVISED_VERSION } from './goal';
import {
  SESSION_SCHEDULED_VERSION, PRE_CHECKIN_RECORDED_VERSION,
  SESSION_STARTED_VERSION, SESSION_RESUMED_VERSION, SET_COMPLETED_VERSION,
  EXERCISE_SUBSTITUTED_VERSION, EXERCISE_SKIPPED_VERSION,
  SESSION_COMPLETED_VERSION, SESSION_SKIPPED_VERSION,
  SESSION_SUMMARY_GENERATED_VERSION,
} from './session';

/**
 * Forward-only payload migration on read. ARCHITECTURE §15 specified this;
 * `src/events/migrations/` never existed.
 *
 * WHY IT MATTERS MORE THAN IT LOOKS. Every event schema pins
 * `schemaVersion: z.literal(N)`. Without upcasting, the day anyone bumps a
 * version, every historical row of that type fails EventSchema.parse. The
 * read then failed entirely, the hydrate `catch` logged to a console nobody
 * reads, every projection stayed at INITIAL_*, `isOnboarded` came back false,
 * and the navigator sent the user to Onboarding — a BRAND NEW APP, with their
 * whole history on disk and invisible. They then re-onboarded on top of it.
 *
 * The failure never presented as an error. It presented as "the app forgot
 * me", which is the worst thing this codebase can do to someone.
 *
 * Events are immutable, so this runs on READ, every time. It never writes.
 */

/** The version this build writes for each type. */
export const CURRENT_VERSION: Record<string, number> = {
  UserContextCreated: USER_CONTEXT_CREATED_VERSION,
  UserContextUpdated: USER_CONTEXT_UPDATED_VERSION,
  GoalCreated: GOAL_CREATED_VERSION,
  GoalRevised: GOAL_REVISED_VERSION,
  SessionScheduled: SESSION_SCHEDULED_VERSION,
  PreCheckinRecorded: PRE_CHECKIN_RECORDED_VERSION,
  SessionStarted: SESSION_STARTED_VERSION,
  SessionResumed: SESSION_RESUMED_VERSION,
  SetCompleted: SET_COMPLETED_VERSION,
  ExerciseSubstituted: EXERCISE_SUBSTITUTED_VERSION,
  ExerciseSkipped: EXERCISE_SKIPPED_VERSION,
  SessionCompleted: SESSION_COMPLETED_VERSION,
  SessionSkipped: SESSION_SKIPPED_VERSION,
  SessionSummaryGenerated: SESSION_SUMMARY_GENERATED_VERSION,
};

/**
 * One step per entry: `UPCASTERS[type][n]` turns a v`n` payload into v`n+1`.
 *
 * Empty today — everything is at v1. When you bump a version, add the step
 * here in the same commit. A bump without its upcaster is caught by
 * checks/upcast.ts, which fails if any type can reach its current version
 * without a complete chain of steps from v1.
 *
 * Rules for writing one:
 *  · pure, total, and never throwing — it runs on every read, forever
 *  · it receives whatever was on disk, so treat the input as unknown
 *  · widening a constraint (optional field, looser number) needs NO bump and
 *    therefore no entry here; only a shape change does
 */
export const UPCASTERS: Record<string, Record<number, (payload: unknown) => unknown>> = {
  // e.g. SetCompleted: { 1: (p) => ({ ...(p as object), tempo: null }) },
};

export type UpcastResult =
  | { ok: true; payload: unknown; version: number }
  | { ok: false; reason: string };

/**
 * Bring a stored payload up to the version this build expects.
 *
 * Refuses rather than guesses in two cases: a gap in the upcaster chain, and
 * a row written by a NEWER build than this one (a tester side-loading an
 * older APK over a newer one — which Android permits, since every build so
 * far carries the same versionCode).
 */
export function upcastPayload(
  type: string,
  storedVersion: number,
  payload: unknown,
): UpcastResult {
  const current = CURRENT_VERSION[type];
  if (current === undefined) {
    return { ok: false, reason: `unknown event type "${type}"` };
  }
  if (storedVersion > current) {
    return {
      ok: false,
      reason: `written by a newer version of the app (v${storedVersion} of ${type}; this build reads v${current})`,
    };
  }
  let out = payload;
  for (let v = storedVersion; v < current; v++) {
    const step = UPCASTERS[type]?.[v];
    if (!step) {
      return {
        ok: false,
        reason: `no upcaster for ${type} v${v} → v${v + 1}`,
      };
    }
    out = step(out);
  }
  return { ok: true, payload: out, version: current };
}
