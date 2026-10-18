import {
  findSubstitutesTiered, getExercise, type TieredSubstitute,
} from '../data/exercises';
import { workingSets, type SessionState } from '../projections/sessions';
import type { Equipment } from '../constants/workouts';

// ─── Mid-session swap ────────────────────────────────────────────────
// "What if the machine is taken" was the first thing the founder hit in an
// hour of real use, and the app's only answer was Skip — which drops the
// slot, loses the volume, and tells the engine you avoided the movement.
//
// `findSubstitutesTiered` had zero consumers and `ExerciseSubstituted` had
// zero emitters, although the projection already applied it and the logging
// card already rendered `swappedFrom`. The machinery existed end to end with
// nothing to start it.
//
// NOT the same thing as the scheduler's swaps. Those are safety —
// §8.7 injury locks and §8.8 equipment filters, applied before you see the
// session. This is the user saying "not this one, now".

/** Why the user wants a different exercise. Drives which tier wins. */
export type SwapReason = 'equipment' | 'pain';

export const SWAP_REASONS: { value: SwapReason; label: string; sub: string }[] = [
  {
    value: 'equipment',
    label: "Can't get to it",
    sub: 'Taken, broken, or not here — same movement, different kit',
  },
  {
    value: 'pain',
    label: 'It hurts',
    sub: 'Something different, away from whatever is complaining',
  },
];

export type SwapContext = {
  equipment: Equipment;
  ownedEquipment?: string[];
  injuries?: string[];
  /** Hard cap on difficulty, for new and returning lifters. */
  beginnerOnly?: boolean;
};

export type SwapOption = TieredSubstitute;

/** Nothing to swap to, and the honest reason why. */
export type SwapOptions =
  | { ok: true; options: SwapOption[] }
  | { ok: false; reason: string };

const MAX_OPTIONS = 5;

/**
 * Alternatives for one exercise in a live session.
 *
 * Two things this does that `findSubstitutesTiered` alone does not:
 *
 *  1. Excludes what is ALREADY in today's session. Offering the squat you are
 *     about to do in slot 4 as a replacement for slot 1 would quietly halve
 *     the session's coverage.
 *  2. Carries the session's own filters — equipment owned, injuries, and the
 *     beginner difficulty cap — so a swap can never hand someone an exercise
 *     the scheduler would have refused to prescribe. A swap that bypasses
 *     §8.7 would be worse than no swap at all.
 */
export function proposeSwaps(
  session: SessionState,
  exerciseId: string,
  reason: SwapReason,
  ctx: SwapContext,
): SwapOptions {
  const target = getExercise(exerciseId);
  if (!target) return { ok: false, reason: 'I do not know that exercise well enough to swap it.' };

  const tier = ctx.equipment === 'gym' ? 'gym' : 'home';
  const inSession = new Set(session.exercises.map((e) => e.exerciseId));

  const all = findSubstitutesTiered(exerciseId, {
    tier,
    reason,
    limit: MAX_OPTIONS + inSession.size + 4,
    ...(ctx.ownedEquipment ? { owned: ctx.ownedEquipment } : {}),
    ...(ctx.injuries && ctx.injuries.length > 0 ? { injuries: ctx.injuries } : {}),
    ...(ctx.beginnerOnly === true ? { maxLevel: 'beginner' as const } : {}),
  });

  // STAPLES FIRST WITHIN A TIER. Without this the top offer for a taken bench
  // press was "Alternating Floor Press" — exactly the obscure-variant problem
  // that `staple: true` was declared on 79 canonical lifts to solve. Tier
  // still dominates: a staple at T3 must not outrank a same-pattern T1.
  const options = all
    .filter((s) => !inSession.has(s.exercise.id))
    .sort((a, b) =>
      a.tier !== b.tier
        ? a.tier - b.tier
        : Number(b.exercise.staple === true) - Number(a.exercise.staple === true))
    .slice(0, MAX_OPTIONS);

  if (options.length === 0) {
    return {
      ok: false,
      reason: reason === 'pain'
        ? `Nothing here trains ${target.pm[0] ?? 'that'} without going near what hurts. Skip it today — that is the right call, not a failure.`
        : `Nothing else here hits ${target.pm[0] ?? 'that'} with what you have. Skip it and the rest of the session still stands.`,
    };
  }
  return { ok: true, options };
}

/**
 * Whether this exercise can still be swapped.
 *
 * Once a working set is logged against it, no. The sets are keyed by
 * exerciseId in an append-only log: swapping would leave them attached to an
 * exercise no longer in the session, which both corrupts the "exercises
 * completed" count and poisons that lift's history with sets from a different
 * movement.
 */
export function canSwap(session: SessionState, exerciseId: string): string | null {
  if (session.status !== 'active') return 'The session is not running.';
  if (!session.exercises.some((e) => e.exerciseId === exerciseId)) {
    return 'That exercise is not in today\'s session.';
  }
  if (session.skippedExerciseIds.includes(exerciseId)) return 'You already skipped that one.';
  // WORKING sets, not every set. A warm-up is not a commitment: you warm up,
  // find the bench taken, and must still be able to move. Set identity is
  // (exerciseId, isWarmup, setIndex) and a warm-up has never counted toward
  // volume, completion or the §8.3 one-set guard. Caught by checks/swap.ts —
  // `setLog.some` had locked the slot after a single warm-up.
  if (workingSets(session.setLog).some((s) => s.exerciseId === exerciseId)) {
    return 'You have already logged a set on this — finish it, or skip the rest.';
  }
  return null;
}
