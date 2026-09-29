import type { Event } from '../events';
import { canonicalExerciseId } from '../data/exercises';
import type {
  ExerciseSlot,
  PreCheckinPayload,
  SkipReason,
  SubstitutionReason,
  SessionReview,
  Mobility,
  DroppedSlot,
} from '../events/session';

// ─── Session status ──────────────────────────────────────────────────
// ARCHITECTURE §7. `abandoned` is not produced by this reducer yet —
// it is a *time-derived* status (app backgrounded ≥4h) that Step 7b
// computes on read rather than storing in the log.

export type SessionStatus = 'scheduled' | 'active' | 'completed' | 'skipped';

export type LoggedSet = {
  exerciseId: string;
  setIndex: number;
  isWarmup: boolean;
  weight_kg: number;
  reps: number;
  durationSec?: number;
  rpe?: number;
  rir?: number;
};

/** Working sets only — warmups never count toward prescribed volume. */
export function workingSets(sets: LoggedSet[]): LoggedSet[] {
  return sets.filter((s) => !s.isWarmup);
}

export type AppliedSubstitution = {
  originalExerciseId: string;
  substituteExerciseId: string;
  reason: SubstitutionReason;
};

export type SessionState = {
  sessionId: string;
  trainingDay: string;
  planId: string | null;
  workoutId: string;
  workoutName: string;
  status: SessionStatus;
  exercises: ExerciseSlot[];
  openingNote: string;
  checkin: PreCheckinPayload | null;
  setLog: LoggedSet[];
  skippedExerciseIds: string[];
  substitutions: AppliedSubstitution[];
  startedAt: string | null;
  completedAt: string | null;
  skipReason: SkipReason | null;
  /** The tester's own words on why they didn't train. */
  skipNotes: string | null;
  summary: string | null;
  highlights: string[];
  /** The user's own verdict on the session. Required to finish, while testing. */
  review: SessionReview | null;
  /** Prep movements, dynamic only. Empty for sessions scheduled before 2026-09-29. */
  warmup: { raise: Mobility[]; mobilise: Mobility[]; minutes: number } | null;
  /** Held stretches, for after. */
  cooldown: Mobility[];
  /** Slots the engine could not fill, and why. */
  dropped: DroppedSlot[];
  /** Why today looks like this. `openingNote` is the one-line version. */
  reasons: string[];
};

// ─── Projection state ────────────────────────────────────────────────
// Every session ever, keyed by id, plus a trainingDay → sessionId index.
// Invariant §8.2 (one completed session per trainingDay) makes the day
// index single-valued.

export type SessionsProjection = {
  byId: Record<string, SessionState>;
  sessionIdByDay: Record<string, string>;
  /** Ordered by first appearance — drives template rotation. */
  order: string[];
  lastSeq: number;
};

export const INITIAL_SESSIONS: SessionsProjection = {
  byId: {},
  sessionIdByDay: {},
  order: [],
  lastSeq: -1,
};

// ─── Reducer ─────────────────────────────────────────────────────────
// Total and pure: never throws, never rejects. Guards live in the command
// layer (src/session/commands.ts) which validates *before* appending.
// A reducer that threw would make a bad historical event unreplayable.

function patch(
  state: SessionsProjection,
  sessionId: string,
  seq: number,
  fn: (s: SessionState) => SessionState,
): SessionsProjection {
  const existing = state.byId[sessionId];
  if (!existing) return { ...state, lastSeq: seq };
  return {
    ...state,
    byId: { ...state.byId, [sessionId]: fn(existing) },
    lastSeq: seq,
  };
}

export function applySessionEvent(
  state: SessionsProjection,
  event: Event,
): SessionsProjection {
  switch (event.type) {
    case 'SessionScheduled': {
      const p = event.payload;
      const session: SessionState = {
        sessionId: p.sessionId,
        trainingDay: p.trainingDay,
        planId: p.planId,
        workoutId: p.workoutId,
        workoutName: p.workoutName,
        status: 'scheduled',
        exercises: p.exercises,
        openingNote: p.openingNote,
        checkin: state.byId[p.sessionId]?.checkin ?? null,
        setLog: [],
        skippedExerciseIds: [],
        substitutions: [],
        startedAt: null,
        completedAt: null,
        skipReason: null,
        skipNotes: null,
        summary: null,
        highlights: [],
        review: null,
        warmup: p.warmup ?? null,
        cooldown: p.cooldown ?? [],
        dropped: p.dropped ?? [],
        reasons: p.reasons ?? [],
      };
      return {
        byId: { ...state.byId, [p.sessionId]: session },
        sessionIdByDay: { ...state.sessionIdByDay, [p.trainingDay]: p.sessionId },
        order: state.order.includes(p.sessionId)
          ? state.order
          : [...state.order, p.sessionId],
        lastSeq: event.seq,
      };
    }

    case 'PreCheckinRecorded': {
      const p = event.payload;
      const existing = state.byId[p.sessionId];
      if (!existing) {
        // Check-in lands *before* SessionScheduled by design. Park a stub
        // so the data isn't lost; SessionScheduled fills in the rest and
        // carries this checkin forward.
        const stub: SessionState = {
          sessionId: p.sessionId,
          trainingDay: event.trainingDay,
          planId: null,
          workoutId: '',
          workoutName: '',
          status: 'scheduled',
          exercises: [],
          openingNote: '',
          checkin: p,
          setLog: [],
          skippedExerciseIds: [],
          substitutions: [],
          startedAt: null,
          completedAt: null,
          skipReason: null,
          skipNotes: null,
          summary: null,
          highlights: [],
          review: null,
          warmup: null,
          cooldown: [],
          dropped: [],
          reasons: [],
        };
        return {
          ...state,
          byId: { ...state.byId, [p.sessionId]: stub },
          order: state.order.includes(p.sessionId)
            ? state.order
            : [...state.order, p.sessionId],
          lastSeq: event.seq,
        };
      }
      return patch(state, p.sessionId, event.seq, (s) => ({ ...s, checkin: p }));
    }

    case 'SessionStarted':
      return patch(state, event.payload.sessionId, event.seq, (s) => ({
        ...s,
        status: 'active',
        startedAt: event.payload.startedAt,
      }));

    case 'SessionResumed':
      return patch(state, event.payload.sessionId, event.seq, (s) => ({
        ...s,
        status: 'active',
      }));

    case 'SetCompleted': {
      const p = event.payload;
      return patch(state, p.sessionId, event.seq, (s) => {
        const isWarmup = p.isWarmup === true;
        const entry: LoggedSet = {
          exerciseId: p.exerciseId,
          setIndex: p.setIndex,
          isWarmup,
          weight_kg: p.weight_kg,
          reps: p.reps,
          ...(p.durationSec !== undefined ? { durationSec: p.durationSec } : {}),
          ...(p.rpe !== undefined ? { rpe: p.rpe } : {}),
          ...(p.rir !== undefined ? { rir: p.rir } : {}),
        };
        // Re-logging the same set overwrites rather than duplicates.
        // Warmups have their own index space, so identity is the triple.
        const rest = s.setLog.filter(
          (x) => !(
            x.exerciseId === p.exerciseId &&
            x.setIndex === p.setIndex &&
            x.isWarmup === isWarmup
          ),
        );
        return { ...s, setLog: [...rest, entry] };
      });
    }

    case 'ExerciseSkipped':
      return patch(state, event.payload.sessionId, event.seq, (s) => ({
        ...s,
        skippedExerciseIds: s.skippedExerciseIds.includes(event.payload.exerciseId)
          ? s.skippedExerciseIds
          : [...s.skippedExerciseIds, event.payload.exerciseId],
      }));

    case 'ExerciseSubstituted': {
      const p = event.payload;
      return patch(state, p.sessionId, event.seq, (s) => ({
        ...s,
        exercises: s.exercises.map((slot) =>
          slot.exerciseId === p.originalExerciseId
            ? { ...slot, exerciseId: p.substituteExerciseId, name: p.substituteName }
            : slot,
        ),
        substitutions: [
          ...s.substitutions,
          {
            originalExerciseId: p.originalExerciseId,
            substituteExerciseId: p.substituteExerciseId,
            reason: p.reason,
          },
        ],
      }));
    }

    case 'SessionCompleted':
      return patch(state, event.payload.sessionId, event.seq, (s) => ({
        ...s,
        status: 'completed',
        completedAt: event.payload.completedAt,
        review: event.payload.review ?? null,
      }));

    case 'SessionSkipped': {
      const p = event.payload;
      const existing = state.byId[p.sessionId];
      if (!existing) {
        // Skipping a day that never got a scheduled session (user skipped
        // from Home before checking in).
        const stub: SessionState = {
          sessionId: p.sessionId,
          trainingDay: p.trainingDay,
          planId: null,
          workoutId: '',
          workoutName: '',
          status: 'skipped',
          exercises: [],
          openingNote: '',
          checkin: null,
          setLog: [],
          skippedExerciseIds: [],
          substitutions: [],
          startedAt: null,
          completedAt: null,
          skipReason: p.reason,
          skipNotes: p.notes ?? null,
          summary: null,
          highlights: [],
          review: null,
          warmup: null,
          cooldown: [],
          dropped: [],
          reasons: [],
        };
        return {
          byId: { ...state.byId, [p.sessionId]: stub },
          sessionIdByDay: { ...state.sessionIdByDay, [p.trainingDay]: p.sessionId },
          order: state.order.includes(p.sessionId)
            ? state.order
            : [...state.order, p.sessionId],
          lastSeq: event.seq,
        };
      }
      return patch(state, p.sessionId, event.seq, (s) => ({
        ...s,
        status: 'skipped',
        skipReason: p.reason,
        skipNotes: p.notes ?? null,
      }));
    }

    case 'SessionSummaryGenerated':
      return patch(state, event.payload.sessionId, event.seq, (s) => ({
        ...s,
        summary: event.payload.summary,
        highlights: event.payload.highlights,
      }));

    default:
      return state;
  }
}

// ─── Builder ─────────────────────────────────────────────────────────

export function buildSessionsProjection(events: Event[]): SessionsProjection {
  return events.reduce(applySessionEvent, INITIAL_SESSIONS);
}

// ─── Selectors ───────────────────────────────────────────────────────

/** The session for a given training day, if one exists. */
export function selectSessionForDay(
  p: SessionsProjection,
  trainingDay: string,
): SessionState | null {
  const id = p.sessionIdByDay[trainingDay];
  if (id === undefined) return null;
  return p.byId[id] ?? null;
}

/**
 * Sessions been through, completed or skipped. Drives the "Day N" label.
 */
export function selectSessionIndex(p: SessionsProjection): number {
  return p.order.reduce((n, id) => {
    const s = p.byId[id];
    if (!s) return n;
    return s.status === 'completed' || s.status === 'skipped' ? n + 1 : n;
  }, 0);
}

/**
 * Where you are in the split's rotation.
 *
 * COMPLETIONS ONLY — a skipped day must not advance it. Miss Wednesday
 * and Thursday is still the session Wednesday would have been. Counting
 * skips here is how a rotation silently decays the first week someone
 * misses a session, which is every week.
 */
export function selectRotationIndex(p: SessionsProjection): number {
  return p.order.reduce((n, id) => {
    const s = p.byId[id];
    return s && s.status === 'completed' ? n + 1 : n;
  }, 0);
}

// ─── ExerciseHistory (ARCHITECTURE §4) ───────────────────────────────
// "last: 102.5 × 8 @ 8" — the most-read line on a logging screen — and the
// input to progression. Keeps several sessions back, because the RPE
// autoregulation rules (BLUEPRINT Part 8) need two data points, not one.

export type ExercisePerformance = {
  trainingDay: string;
  /** Heaviest working set of that session. 0 for bodyweight work. */
  weight_kg: number;
  /** Reps on the last working set — where fatigue shows. */
  reps: number;
  /** Lowest reps across the working sets: did they fall off? */
  minReps: number;
  avgRpe?: number;
  maxRpe?: number;
  durationSec?: number;
  setsLogged: number;
};

/** Newest first, capped. */
export type ExerciseHistory = Record<string, ExercisePerformance[]>;

const HISTORY_DEPTH = 5;

/**
 * Per-exercise performance from *completed* sessions, newest first.
 *
 * Only completed sessions count — a session abandoned halfway is not a
 * benchmark to chase. Warmups are excluded throughout.
 */
/**
 * Every exerciseId this user has logged a working set against.
 *
 * Feeds the scheduler's continuity preference so the slot occupant stays
 * put and load history accumulates. Nothing consumed this before, which is
 * why a 6-slot programme produced 25 distinct exercise ids over 12 weeks
 * and `suggestLoad` could almost never fire.
 */
export function selectKnownExerciseIds(p: SessionsProjection): string[] {
  const out = new Set<string>();
  for (const id of p.order) {
    const s = p.byId[id];
    if (!s) continue;
    for (const set of s.setLog) {
      if (!set.isWarmup) out.add(canonicalExerciseId(set.exerciseId));
    }
  }
  return [...out];
}

export function selectExerciseHistory(p: SessionsProjection): ExerciseHistory {
  const out: ExerciseHistory = {};

  // p.order is chronological; walk backwards so newest lands first.
  for (let i = p.order.length - 1; i >= 0; i--) {
    const id = p.order[i];
    if (id === undefined) continue;
    const s = p.byId[id];
    if (!s || s.status !== 'completed') continue;

    const byExercise = new Map<string, LoggedSet[]>();
    for (const entry of workingSets(s.setLog)) {
      // Events are immutable: sets logged under the old name-derived ids
      // are translated here rather than rewritten in the log.
      const key = canonicalExerciseId(entry.exerciseId);
      const list = byExercise.get(key) ?? [];
      list.push(entry);
      byExercise.set(key, list);
    }

    for (const [exerciseId, sets] of byExercise) {
      const bucket = out[exerciseId] ?? [];
      if (bucket.length >= HISTORY_DEPTH) continue;

      const ordered = [...sets].sort((a, b) => a.setIndex - b.setIndex);
      const last = ordered[ordered.length - 1];
      if (!last) continue;

      const rpes = ordered
        .map((x) => x.rpe)
        .filter((r): r is number => typeof r === 'number');

      const perf: ExercisePerformance = {
        trainingDay: s.trainingDay,
        weight_kg: ordered.reduce((m, x) => Math.max(m, x.weight_kg), 0),
        reps: last.reps,
        minReps: ordered.reduce((m, x) => Math.min(m, x.reps), Infinity),
        ...(rpes.length > 0
          ? {
              avgRpe: Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10,
              maxRpe: Math.max(...rpes),
            }
          : {}),
        ...(last.durationSec !== undefined ? { durationSec: last.durationSec } : {}),
        setsLogged: ordered.length,
      };

      bucket.push(perf);
      out[exerciseId] = bucket;
    }
  }
  return out;
}

/** Most recent completed performance of an exercise, if any. */
export function lastPerformance(
  h: ExerciseHistory,
  exerciseId: string,
): ExercisePerformance | undefined {
  return h[exerciseId]?.[0];
}

// ─── Trailing adherence ──────────────────────────────────────────────
// "You've hit 17 of your last 20." Replaces the consecutive-day streak,
// which punishes programmed rest days and measures the wrong unit for
// anyone training more than 3x/week.

export type AdherenceWindow = {
  completed: number;
  expected: number;
  /** True once there's enough history for the number to mean anything. */
  meaningful: boolean;
};

function shiftDay(trainingDay: string, deltaDays: number): string {
  const [y, m, d] = trainingDay.split('-').map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

export function selectAdherenceWindow(
  p: SessionsProjection,
  todayTrainingDay: string,
  daysPerWeek: number,
  weeks = 4,
): AdherenceWindow {
  const cutoff = shiftDay(todayTrainingDay, -(weeks * 7 - 1));

  let completed = 0;
  let firstDay: string | null = null;
  for (const id of p.order) {
    const s = p.byId[id];
    if (!s) continue;
    if (firstDay === null || s.trainingDay < firstDay) firstDay = s.trainingDay;
    // YYYY-MM-DD compares correctly as a string.
    if (s.trainingDay >= cutoff && s.status === 'completed') completed += 1;
  }

  // Don't invent a denominator covering time before the user existed.
  const windowStart = firstDay && firstDay > cutoff ? firstDay : cutoff;
  const daysElapsed = Math.max(
    1,
    Math.round(
      (Date.parse(`${todayTrainingDay}T00:00:00Z`) -
        Date.parse(`${windowStart}T00:00:00Z`)) / 86_400_000,
    ) + 1,
  );
  const expected = Math.max(completed, Math.round((daysElapsed / 7) * daysPerWeek));

  // With an empty log firstDay is null, windowStart falls back to the
  // 28-day cutoff and the very first screen a new user sees reads
  // "0 of 16" — sixteen sessions missed before they installed the app.
  if (p.order.length === 0) return { completed: 0, expected: 0, meaningful: false };

  return { completed, expected, meaningful: daysElapsed >= 7 };
}

// ─── Gap detection ───────────────────────────────────────────────────
// Feeds reentryPolicy(). Everything here already exists in the log —
// nothing new is collected.

export type GapInfo = {
  gapDays: number;
  lastCompletedDay: string | null;
  /** Skip reasons recorded since the last completed session. */
  skipReasons: SkipReason[];
  sessionsBefore: number;
  bestLift?: { exerciseId: string; weight_kg: number; reps: number };
};

function daysBetween(fromDay: string, toDay: string): number {
  const a = Date.parse(`${fromDay}T00:00:00Z`);
  const b = Date.parse(`${toDay}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export function selectGap(p: SessionsProjection, todayTrainingDay: string): GapInfo {
  let lastCompletedDay: string | null = null;
  let sessionsBefore = 0;
  let bestLift: GapInfo['bestLift'];
  const skipReasons: SkipReason[] = [];

  for (const id of p.order) {
    const s = p.byId[id];
    if (!s) continue;
    if (s.status === 'completed') {
      sessionsBefore += 1;
      if (lastCompletedDay === null || s.trainingDay > lastCompletedDay) {
        lastCompletedDay = s.trainingDay;
        const top = workingSets(s.setLog)
          .filter((x) => x.weight_kg > 0)
          .sort((a, b) => b.weight_kg - a.weight_kg)[0];
        bestLift = top
          ? { exerciseId: top.exerciseId, weight_kg: top.weight_kg, reps: top.reps }
          : undefined;
      }
    }
  }

  // Only skips *after* the last completed session describe this gap.
  for (const id of p.order) {
    const s = p.byId[id];
    if (!s || s.status !== 'skipped' || s.skipReason === null) continue;
    if (lastCompletedDay === null || s.trainingDay > lastCompletedDay) {
      skipReasons.push(s.skipReason);
    }
  }

  return {
    gapDays: lastCompletedDay === null ? 0 : daysBetween(lastCompletedDay, todayTrainingDay),
    lastCompletedDay,
    skipReasons,
    sessionsBefore,
    ...(bestLift ? { bestLift } : {}),
  };
}

// ─── Day-of-week completion ──────────────────────────────────────────
// The highest-value signal already in the log and read by nothing.
// `trainingDay` is on every event; nothing has ever bucketed by weekday.
//
// This is the one insight that FIXES THE PLAN rather than nagging about
// it: "you've missed Friday four weeks running" is answered by dropping
// to three days, not by a motivational push notification. It is also the
// empirical replacement for the days-per-week number people guess at
// onboarding — and guess badly.

export type WeekdayStat = {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  name: string;
  completed: number;
  skipped: number;
  /** completed / (completed + skipped); null when never attempted. */
  rate: number | null;
};

const WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function weekdayOf(trainingDay: string): number | null {
  const parts = trainingDay.split('-').map(Number);
  const [y, m, d] = parts;
  if (y === undefined || m === undefined || d === undefined) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(dt.getTime()) ? null : dt.getUTCDay();
}

export function selectWeekdayStats(p: SessionsProjection): WeekdayStat[] {
  const done = new Array(7).fill(0) as number[];
  const miss = new Array(7).fill(0) as number[];

  for (const id of p.order) {
    const s = p.byId[id];
    if (!s) continue;
    const w = weekdayOf(s.trainingDay);
    if (w === null) continue;
    if (s.status === 'completed') done[w] = (done[w] ?? 0) + 1;
    else if (s.status === 'skipped') miss[w] = (miss[w] ?? 0) + 1;
  }

  return WEEKDAY_NAMES.map((name, w) => {
    const c = done[w] ?? 0;
    const k = miss[w] ?? 0;
    return { weekday: w, name, completed: c, skipped: k, rate: c + k === 0 ? null : c / (c + k) };
  });
}

export type ScheduleAdvice =
  | { kind: 'none' }
  | { kind: 'drop_day'; weekday: string; suggestedDays: number; message: string }
  | { kind: 'add_day'; weekday: string; suggestedDays: number; message: string };

/**
 * Reads the weekday stats and proposes a schedule change.
 *
 * Deliberately conservative: it needs a real pattern (>= 3 attempts on a
 * day, mostly missed) before suggesting anything, because telling someone
 * to train less on thin evidence is worse than saying nothing.
 */
export function selectScheduleAdvice(
  p: SessionsProjection,
  statedDaysPerWeek: number,
  minAttempts = 3,
): ScheduleAdvice {
  const stats = selectWeekdayStats(p);
  const attempted = stats.filter((s) => s.completed + s.skipped >= minAttempts);
  if (attempted.length < 2) return { kind: 'none' };

  const worst = [...attempted].sort((a, b) => (a.rate ?? 1) - (b.rate ?? 1))[0];
  if (!worst || worst.rate === null || worst.rate > 0.34) return { kind: 'none' };

  const suggested = Math.max(2, statedDaysPerWeek - 1);
  if (suggested === statedDaysPerWeek) return { kind: 'none' };

  return {
    kind: 'drop_day',
    weekday: worst.name,
    suggestedDays: suggested,
    message: `You've missed ${worst.name} ${worst.skipped} of the last ${worst.completed + worst.skipped}. Shall we make this a ${suggested}-day week? Same muscles, one less thing to feel bad about.`,
  };
}
