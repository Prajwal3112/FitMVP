import { SPLITS, type DayType, type SplitId } from './splits';
export type { DayType } from './splits';
import { musclesFor, type Muscle } from '../data/muscles';
import type { SorenessEntry } from '../events/session';

// ─── What today's session actually is ────────────────────────────────
// A strict precedence. Each step either returns, or passes to the next.
//
// ⚠ THE RULE THAT MATTERS MOST: the rotation advances on COMPLETION,
// never on the calendar. Miss Wednesday and Thursday is still the session
// Wednesday would have been. Get this wrong and the whole system decays
// the first week someone misses a session — which is every week.

export type ResolveInput = {
  splitId: SplitId;
  /** Completed sessions only. Skips must NOT advance this. */
  completedCount: number;
  /** Days since the last completed session. 0 if they trained today. */
  gapDays: number;
  /** Hours since each day type was last trained. Missing = never. */
  hoursSinceDayType: Partial<Record<DayType, number>>;
  /** Days since each day type was last trained, for the drift guard. */
  daysSinceDayType: Partial<Record<DayType, number>>;
  soreness: SorenessEntry[];
  feel: 'rough' | 'ok' | 'good';
  /** Suppresses the recovery path for people who are simply new. */
  totalSessions: number;
};

export type Resolved = {
  dayType: DayType;
  /** Per-muscle volume multipliers from soreness. */
  muscleVolume: Record<string, number>;
  /** Applied across the whole session, from feel and gaps. */
  globalVolume: number;
  /** Load scaling after a long gap. */
  loadScale: number;
  /** Ceiling on effort today. */
  maxRpe: number;
  /** Why it looks like this, in the user's words. */
  reasons: string[];
  /** True when the split was overridden — the user should be told. */
  overridden: boolean;
};

/** 36h is the practical floor between sessions hitting the same muscles. [C] */
const RECOVERY_HOURS = 36;
/** Past this, a muscle group is being starved and something is wrong. */
const DRIFT_DAYS = 14;
/** Below this many sessions, soreness everywhere is just being new. */
const NOVICE_SESSIONS = 6;

/**
 * Keyed by real library muscles, not by whatever word the screen used.
 * Before this, 'legs' was stored as the literal key 'legs', which matched
 * no exercise — so four of six check-in chips changed nothing while the
 * app said it had trimmed sets.
 */
function sorenessMultipliers(soreness: SorenessEntry[]): Record<Muscle, number> {
  const out = {} as Record<Muscle, number>;
  for (const s of soreness) {
    // Mild DOMS is not a training contraindication. [E]
    const mult = s.level >= 3 ? 0 : s.level === 2 ? 0.6 : 1;
    for (const m of musclesFor(s.muscle)) {
      // Worst report wins where two areas overlap (e.g. legs + knee).
      const prev = out[m];
      out[m] = prev === undefined ? mult : Math.min(prev, mult);
    }
  }
  return out;
}

/** Soreness reports that actually resolved to something trainable. */
function meaningfulSore(soreness: SorenessEntry[]): SorenessEntry[] {
  return soreness.filter((s) => musclesFor(s.muscle).length > 0);
}

export function resolveSession(input: ResolveInput): Resolved {
  const seq = SPLITS[input.splitId].sequence;
  const reasons: string[] = [];
  const muscleVolume = sorenessMultipliers(input.soreness);
  let globalVolume = 1;
  let loadScale = 1;
  let maxRpe = 10;
  let overridden = false;

  // ── Step 0 — gap check, before anything else ──────────────────────
  if (input.gapDays > 21) {
    reasons.push("You've been away a while, so today is full body at half volume — getting the whole system moving again before we specialise.");
    return {
      dayType: 'FB', muscleVolume, globalVolume: 0.5, loadScale: 0.7,
      maxRpe: 8, reasons, overridden: true,
    };
  }
  if (input.gapDays > 10) {
    // NOTE: loadScale is read by nobody — buildSessionDraft ignores it, and
    // reentryPolicy() owns gap handling end to end (with its own, different
    // thresholds). The promise "the weights are 10% lighter" used to be made
    // here and honoured nowhere, so it is gone. Do not re-add a gap message
    // to this file; it belongs in src/session/reentry.ts.
    loadScale = 0.9;
  }

  // ── Step 1 — the rotation sets the candidate ──────────────────────
  // completedCount, NOT days elapsed. This is the important line.
  let idx = input.completedCount % seq.length;
  let dayType = seq[idx]!;

  // ── Step 2 — recovery gate, max two retries ───────────────────────
  for (let retry = 0; retry < 2; retry++) {
    const hrs = input.hoursSinceDayType[dayType];
    if (hrs === undefined || hrs >= RECOVERY_HOURS) break;
    idx = (idx + 1) % seq.length;
    dayType = seq[idx]!;
    overridden = true;
    reasons.push('You trained this recently, so we have moved you on a day.');
  }

  // ── Drift guard — a starved muscle group forces its way back in ───
  for (const [type, days] of Object.entries(input.daysSinceDayType)) {
    if (days !== undefined && days > DRIFT_DAYS && seq.includes(type as DayType)) {
      dayType = type as DayType;
      globalVolume = 0.5;
      overridden = true;
      reasons.push(`It has been over two weeks since a ${type.toLowerCase()} day. We are doing one today, lighter than usual.`);
      break;
    }
  }

  // ── Step 3 — soreness modifies volume. It NEVER switches the day. ─
  // Swapping to legs because your chest is sore silently destroys the
  // rotation and desynchronises frequency across muscle groups.
  // Counting inert words here let dead chips flip the day to RECOVERY
  // without changing a single exercise. And counting *entries* rather than
  // muscles meant one tap on "legs" (six muscles, the whole lower body)
  // scored 1 and slipped under the threshold — then the scheduler dropped
  // every exercise on leg day and handed back an empty session, which
  // throws and cannot be skipped past. Count what is actually knocked out.
  const severeMuscles = new Set<Muscle>();
  for (const e of input.soreness) {
    if (e.level >= 3) for (const m of musclesFor(e.muscle)) severeMuscles.add(m);
  }
  // The question is not "how many muscles are sore" — it is "is there
  // anything left to train today". Sore arms on leg day is not a recovery
  // day; a wrecked lower body on leg day is. A raw count gets both wrong,
  // and the old entry count missed "legs" entirely (one tap, six muscles).
  const todays = DAY_MUSCLES[dayType];
  const todaysSore = todays.filter((m) => severeMuscles.has(m as Muscle)).length;
  const mostOfTodayIsSore = todays.length > 0 && todaysSore / todays.length >= 0.66;
  if (mostOfTodayIsSore && input.totalSessions >= NOVICE_SESSIONS) {
    reasons.push('You are sore nearly everywhere. Today is light full-body movement — that is the session, not a consolation prize.');
    return {
      dayType: 'RECOVERY', muscleVolume, globalVolume: 0.4, loadScale: 0.7,
      maxRpe: 6, reasons, overridden: true,
    };
  }
  // The "those sets are trimmed" line used to be pushed from here, off the
  // raw user input — so it appeared over sessions with identical set counts.
  // Only the scheduler knows what it actually cut, so only the scheduler
  // says so. See buildSessionDraft's soreNote.

  // ── Step 4 — feel scales volume globally, not the day ─────────────
  // "Good" does NOT add volume — adding on good days and cutting on bad
  // ones is a random walk with no progressive overload. It permits
  // higher intensity within the same set count. [C]
  if (input.feel === 'rough') {
    globalVolume *= 0.7;
    maxRpe = 7;
    reasons.push('Rough day — fewer sets, and we are not chasing hard ones.');
  } else if (input.feel === 'good') {
    maxRpe = 9;
  }

  return { dayType, muscleVolume, globalVolume, loadScale, maxRpe, reasons, overridden };
}

/** Muscles each day type exists to train — bounds what may be added. */
export const DAY_MUSCLES: Record<DayType, string[]> = {
  PUSH:  ['chest', 'shoulders', 'triceps'],
  PULL:  ['lats', 'middle back', 'traps', 'biceps', 'forearms'],
  LEGS:  ['quadriceps', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors'],
  UPPER: ['chest', 'shoulders', 'triceps', 'lats', 'middle back', 'traps', 'biceps', 'forearms'],
  LOWER: ['quadriceps', 'hamstrings', 'glutes', 'calves', 'lower back', 'adductors', 'abductors'],
  FB:    ['chest', 'shoulders', 'lats', 'middle back', 'quadriceps', 'hamstrings', 'glutes', 'abdominals'],
  RECOVERY: ['abdominals', 'lower back', 'glutes'],
};

export const DAY_NAME: Record<DayType, string> = {
  PUSH: 'Push day', PULL: 'Pull day', LEGS: 'Leg day',
  UPPER: 'Upper body', LOWER: 'Lower body', FB: 'Full body',
  RECOVERY: 'Recovery session',
};
