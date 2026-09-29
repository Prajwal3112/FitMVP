import type { ExerciseHistory, ExercisePerformance } from '../projections/sessions';
import type { ExerciseSlot } from '../events/session';
import { canonicalExerciseId } from '../data/exercises';
import { estimateStartingLoad } from './startingLoad';
import type { Experience } from '../events/userContext';

// ─── RPE autoregulation (BLUEPRINT Part 8, locked) ───────────────────
// Deterministic. No LLM, ever. The model may one day phrase the reason;
// it never picks the number.
//
// This is the first consumer of RPE in the codebase. Until now every
// rating the user tapped was stored, carried, rendered, averaged — and
// read by nothing that made a decision.

/** Below this across two sessions, there's load left on the table. */
const EASY_RPE = 7;
/** At or above this, the set was a grind — hold and let fatigue clear. */
const HARD_RPE = 9;

const STANDARD_INCREMENT_KG = 2.5;
/** ARCHITECTURE §8.15 — no more than 5% per exercise per week. */
const MAX_WEEKLY_INCREASE_PCT = 0.05;
/**
 * The smallest change you can actually make to a loaded exercise: a PAIR of
 * 1.25 kg plates, which is also the usual dumbbell and machine-pin jump.
 *
 * Was 1.25 and documented as "smallest pair of micro-plates" while being
 * applied as a TOTAL bar increment — so suggestions came out at 31.25,
 * 36.25 and 48.75 kg, none of which can be loaded without 0.625 kg plates.
 */
const MIN_LOADABLE_STEP_KG = 2.5;
/**
 * Above this many reps past target, adding reps stops being progression and
 * starts being endurance work. `add_reps` had no ceiling and no way back to
 * load: a 20 kg press at RPE 6.5 drifted to 26 reps by session 20 under a
 * 6-12 rep programme, and the prefill showed it.
 */
const REPS_OVER_TARGET_BEFORE_LOADING = 3;
/** Nothing sane is prescribed above this. */
const ABSOLUTE_REP_CEILING = 30;

export type SuggestionKind =
  | 'increase'        // add load
  | 'add_reps'        // bodyweight, or load step would breach the 5% ceiling
  | 'hold'            // repeat — either grinding or still building reps
  | 'estimate'        // first time: a conservative guess from bodyweight
  | 'no_history';     // first time, and nothing to estimate from

export type LoadSuggestion = {
  exerciseId: string;
  kind: SuggestionKind;
  /** Present for 'increase'. */
  suggestedWeight?: number;
  /** Present for 'add_reps'. */
  suggestedReps?: number;
  /** User-facing, ≤100 chars, deterministic. Step 8 may restyle it. */
  reason: string;
  /** How many past sessions the call is based on. */
  basedOn: number;
};

/**
 * Largest legal step up from `weight`: the standard increment, capped by
 * the 5%/week ceiling, floored to something you can actually load.
 * Returns 0 when no legal step exists.
 */
export function loadStep(weight: number): number {
  // Bodyweight work has no load to step. Must come first: without it the
  // floor below would prescribe adding 2.5 kg to a push-up.
  if (weight <= 0) return 0;

  const ceiling = weight * MAX_WEEKLY_INCREASE_PCT;
  const allowed = Math.min(STANDARD_INCREMENT_KG, ceiling);
  // Returns 0 below 50 kg, and that is CORRECT, not the freeze it looks
  // like: 2.5 kg on a 20 kg press is a 12.5% jump. The bug was never here —
  // it was that `add_reps` had no ceiling and no way back to load, so a
  // light lift climbed to 26 reps under a 6-12 rep programme and never
  // loaded. Double progression is the fix: add reps to the top of the range,
  // then take one step of load and reset the reps. See
  // REPS_OVER_TARGET_BEFORE_LOADING below.
  return Math.floor(allowed / MIN_LOADABLE_STEP_KG) * MIN_LOADABLE_STEP_KG;
}

function hitTarget(perf: ExercisePerformance, targetReps: number | undefined): boolean {
  if (targetReps === undefined) return true; // nothing prescribed to miss
  return perf.minReps >= targetReps;
}

/**
 * What to do on this exercise today, from what actually happened before.
 *
 * Rules, in priority order:
 *   1. No history            → no suggestion (Day 1 needs an estimate, not a trend)
 *   2. Missed prescribed reps → hold. Earn the reps before the load
 *   3. Last session ≥ RPE 9   → hold. That was a grind
 *   4. Two sessions ≤ RPE 7   → add load (or reps, if bodyweight/too light to step)
 *   5. Otherwise              → hold. It's working; don't rush it
 */
export type EstimateContext = {
  bodyweightKg: number;
  experience: Experience | null;
};

export function suggestLoad(
  slot: ExerciseSlot,
  history: ExerciseHistory,
  estimate?: EstimateContext,
): LoadSuggestion {
  const past = history[canonicalExerciseId(slot.exerciseId)] ?? [];
  const last = past[0];

  if (!last) {
    // No trend to follow. Offer a conservative starting point rather than
    // an empty box — but never present it as a known number.
    const est = estimate
      ? estimateStartingLoad({
          exerciseId: slot.exerciseId,
          bodyweightKg: estimate.bodyweightKg,
          experience: estimate.experience,
        })
      : null;

    if (est && est.weightKg > 0) {
      return {
        exerciseId: slot.exerciseId,
        kind: 'estimate',
        suggestedWeight: est.weightKg,
        reason: `Starting guess: ${est.weightKg}kg. Adjust it — today is about finding the number.`,
        basedOn: 0,
      };
    }
    return {
      exerciseId: slot.exerciseId,
      kind: 'no_history',
      reason: 'First time on this one — find a weight that leaves 2–3 reps in the tank.',
      basedOn: 0,
    };
  }

  const isBodyweight = last.weight_kg === 0;

  if (!hitTarget(last, slot.targetReps)) {
    return {
      exerciseId: slot.exerciseId,
      kind: 'hold',
      ...(isBodyweight ? {} : { suggestedWeight: last.weight_kg }),
      reason: `Last time you got ${last.minReps} of ${slot.targetReps ?? '?'}. Same again — get the reps first.`,
      basedOn: 1,
    };
  }

  if (last.avgRpe !== undefined && last.avgRpe >= HARD_RPE) {
    return {
      exerciseId: slot.exerciseId,
      kind: 'hold',
      ...(isBodyweight ? {} : { suggestedWeight: last.weight_kg }),
      reason: `That was a grind last time (RPE ${last.avgRpe}). Same weight — let it settle.`,
      basedOn: 1,
    };
  }

  // Rule 4 needs two consecutive easy sessions at the same load.
  const prev = past[1];
  const twoEasy =
    last.avgRpe !== undefined &&
    last.avgRpe <= EASY_RPE &&
    prev?.avgRpe !== undefined &&
    prev.avgRpe <= EASY_RPE &&
    (isBodyweight || prev.weight_kg === last.weight_kg);

  if (twoEasy) {
    if (isBodyweight) {
      const next = Math.min(ABSOLUTE_REP_CEILING, last.reps + 1);
      if (next <= last.reps) {
        // Nothing left to add without load. Say so plainly rather than
        // climbing toward 40 reps.
        return {
          exerciseId: slot.exerciseId,
          kind: 'hold',
          reason: `${last.reps} reps is plenty here. This one needs added weight or a harder variation to keep going.`,
          basedOn: 2,
        };
      }
      return {
        exerciseId: slot.exerciseId,
        kind: 'add_reps',
        suggestedReps: next,
        reason: `Two easy sessions (RPE ${prev.avgRpe} then ${last.avgRpe}). Try ${next} reps.`,
        basedOn: 2,
      };
    }
    // Well past the prescribed range on a loaded lift: add weight, not reps.
    const target = slot.targetReps;
    if (target !== undefined && last.reps >= target + REPS_OVER_TARGET_BEFORE_LOADING) {
      const up = Math.round((last.weight_kg + MIN_LOADABLE_STEP_KG) * 100) / 100;
      return {
        exerciseId: slot.exerciseId,
        kind: 'increase',
        suggestedWeight: up,
        suggestedReps: target,
        reason: `${last.reps} reps at ${last.weight_kg}kg is past the range. Go to ${up}kg and back to ${target}.`,
        basedOn: 2,
      };
    }
    const step = loadStep(last.weight_kg);
    if (step <= 0) {
      // Too light for a legal load step, so climb reps — but only to the top
      // of the range. Unbounded, this reached 26 reps at 20 kg by session 20.
      const ceiling = (slot.targetReps ?? 12) + REPS_OVER_TARGET_BEFORE_LOADING;
      if (last.reps < ceiling) {
        return {
          exerciseId: slot.exerciseId,
          kind: 'add_reps',
          suggestedReps: last.reps + 1,
          suggestedWeight: last.weight_kg,
          reason: `Too light to add a plate safely. Add a rep instead — try ${last.reps + 1}.`,
          basedOn: 2,
        };
      }
      // Top of the range reached: take the smallest loadable step and reset
      // the reps. This is the half of double progression that was missing.
      const up = Math.round((last.weight_kg + MIN_LOADABLE_STEP_KG) * 100) / 100;
      const back = slot.targetReps ?? 8;
      return {
        exerciseId: slot.exerciseId,
        kind: 'increase',
        suggestedWeight: up,
        suggestedReps: back,
        reason: `${last.reps} reps is the top of the range. Go to ${up}kg and back to ${back}.`,
        basedOn: 2,
      };
    }
    const next = Math.round((last.weight_kg + step) * 100) / 100;
    return {
      exerciseId: slot.exerciseId,
      kind: 'increase',
      suggestedWeight: next,
      reason: `Two sessions at RPE ${last.avgRpe} or under — you've got more. Try ${next}kg.`,
      basedOn: 2,
    };
  }

  return {
    exerciseId: slot.exerciseId,
    kind: 'hold',
    ...(isBodyweight ? {} : { suggestedWeight: last.weight_kg }),
    reason:
      last.avgRpe !== undefined
        ? `Last time: ${last.weight_kg > 0 ? `${last.weight_kg}kg × ` : ''}${last.reps} at RPE ${last.avgRpe}. Repeat it.`
        : 'Repeat last session. Rate a set or two and I can start moving the weight.',
    basedOn: past.length,
  };
}

/** Suggestions for a whole session, keyed by exerciseId. */
export function suggestSession(
  slots: ExerciseSlot[],
  history: ExerciseHistory,
  estimate?: EstimateContext,
): Record<string, LoadSuggestion> {
  const out: Record<string, LoadSuggestion> = {};
  for (const slot of slots) out[slot.exerciseId] = suggestLoad(slot, history, estimate);
  return out;
}
