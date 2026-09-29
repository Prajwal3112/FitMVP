import type { GoalKind } from '../events/goal';
import type { Experience } from '../events/userContext';
import { tierOf } from './splits';

// ─── Volume, intensity and rest, per goal ────────────────────────────
// [E] = controlled research · [C] = convention · [X] = judgement call
//
// Honest note carried from the spec: hypertrophy is similar across 6–30
// reps WHEN sets are taken near failure [E]. The "hypertrophy range" is a
// practical convention, not a physiological window. What is well
// supported: 10–20 weekly sets per muscle shows a dose-response with
// diminishing returns past ~20 [E], longer rest beats short for both
// strength and hypertrophy [E], and strength is specific to the rep
// range trained [E].

export type Parameters = {
  repLow: number;
  repHigh: number;
  restSec: number;
  setsPerExercise: number;
  weeklySetsPerMuscle: number;
  /** Ceiling on how close to failure to work. */
  maxRpe: number;
};

const BASE: Record<GoalKind, Parameters> = {
  hypertrophy:     { repLow: 6,  repHigh: 12, restSec: 105, setsPerExercise: 3, weeklySetsPerMuscle: 16, maxRpe: 9 },
  strength:        { repLow: 3,  repHigh: 6,  restSec: 240, setsPerExercise: 4, weeklySetsPerMuscle: 12, maxRpe: 9 },
  // Training does not determine fat loss — energy balance does. The short
  // rest and higher reps are for session density and time, not "toning".
  // Capped at RPE 8 [X]: recovery is compromised in a deficit.
  fat_loss:        { repLow: 8,  repHigh: 15, restSec: 75,  setsPerExercise: 3, weeklySetsPerMuscle: 13, maxRpe: 8 },
  endurance:       { repLow: 12, repHigh: 20, restSec: 60,  setsPerExercise: 3, weeklySetsPerMuscle: 12, maxRpe: 8 },
  general_fitness: { repLow: 8,  repHigh: 12, restSec: 90,  setsPerExercise: 3, weeklySetsPerMuscle: 10, maxRpe: 8 },
};

/** Novices adapt on remarkably little volume; their limit is technique
 *  and connective-tissue adaptation, not stimulus. [E] */
const TIER_VOLUME: Record<ReturnType<typeof tierOf>, number> = {
  novice: 0.6,
  intermediate: 1.0,
  advanced: 1.2,
};

export function getParameters(
  goal: GoalKind | null,
  experience: Experience | null,
): Parameters {
  const base = BASE[goal ?? 'general_fitness'];
  const tier = tierOf(experience);
  const scale = TIER_VOLUME[tier];
  return {
    ...base,
    setsPerExercise: Math.max(2, Math.round(base.setsPerExercise * (tier === 'novice' ? 0.75 : 1))),
    weeklySetsPerMuscle: Math.round(base.weeklySetsPerMuscle * scale),
    maxRpe: tier === 'novice' ? Math.min(base.maxRpe, 8) : base.maxRpe,
  };
}

/**
 * How many exercises fit the time available.
 * 45s of working time per set, 5 minutes of warm-up off the top. [C]
 */
export function exerciseCount(p: Parameters, sessionMinutes: number): number {
  const perSet = p.restSec + 45;
  const available = Math.floor((sessionMinutes * 60 - 300) / perSet);
  const n = Math.round(available / p.setsPerExercise);
  return Math.max(3, Math.min(8, n));
}

// ─── Progression differs by goal ─────────────────────────────────────
// The mistake most apps make is one rule everywhere.

export type ProgressionStyle = 'double' | 'load' | 'density' | 'conservative';

export function progressionStyle(goal: GoalKind | null): ProgressionStyle {
  switch (goal) {
    case 'strength': return 'load';        // reps fixed, load is the only variable [E]
    case 'hypertrophy': return 'double';   // reps to the top of range, then load
    case 'fat_loss': return 'density';     // hold load, shorten rest
    case 'endurance': return 'density';
    default: return 'conservative';        // double progression, two sessions before a jump
  }
}

/**
 * What "doing well" means, in the user's language — and it genuinely
 * differs. In a deficit you get weaker; an app reading that as failure
 * will demoralise someone who is doing everything right.
 */
export function successFraming(goal: GoalKind | null): string {
  if (goal === 'fat_loss') {
    return 'Holding your weights while you lose fat is the win. Getting stronger too is a bonus, not the target.';
  }
  if (goal === 'strength') return 'The number on the bar going up is the whole game.';
  if (goal === 'hypertrophy') return 'More good reps, then more weight. Both count.';
  return 'Showing up and finishing is the win.';
}
