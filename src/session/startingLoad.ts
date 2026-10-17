import { getExercise, type Exercise } from '../data/exercises';
import { declaredLoadFor } from '../onboarding/declaredLifts';
import type { Experience } from '../events/userContext';

// ─── Day-1 starting load ─────────────────────────────────────────────
// The answer to Raj's deletion moment: "it told me to bench 4×8 without
// knowing whether I bench 60kg or 180kg."
//
// Deliberately CONSERVATIVE. Under-suggesting is self-correcting — RPE
// autoregulation adds load within two sessions. Over-suggesting risks
// injury and destroys trust on day one. When unsure, go lighter.
//
// This is a starting point, not a prescription, and the UI must say so.

/**
 * Bodyweight fractions for a *novice* lifter, by movement pattern.
 * Deliberately below commonly cited novice standards — see above.
 */
const PATTERN_RATIO: { match: (e: Exercise) => boolean; ratio: number }[] = [
  // Lower-body compound: the heaviest patterns.
  { match: (e) => e.mech === 'compound' && e.pm.some((m) => ['hamstrings', 'lower back', 'glutes'].includes(m)), ratio: 0.70 },
  { match: (e) => e.mech === 'compound' && e.pm.includes('quadriceps'), ratio: 0.60 },
  // Upper-body horizontal and vertical pressing/pulling.
  { match: (e) => e.mech === 'compound' && e.pm.includes('chest'), ratio: 0.45 },
  { match: (e) => e.mech === 'compound' && e.pm.some((m) => ['lats', 'middle back', 'traps'].includes(m)), ratio: 0.40 },
  { match: (e) => e.mech === 'compound' && e.pm.includes('shoulders'), ratio: 0.30 },
  // Isolation work is a fraction of the compound it assists.
  { match: (e) => e.pm.some((m) => ['biceps', 'triceps', 'forearms', 'neck'].includes(m)), ratio: 0.12 },
  { match: (e) => e.pm.includes('calves'), ratio: 0.35 },
  { match: (e) => e.pm.includes('abdominals'), ratio: 0.10 },
];

const DEFAULT_RATIO = 0.20;

/** Multiplier on the novice ratio. `new` starts well below it. */
const EXPERIENCE_FACTOR: Record<Experience, number> = {
  new: 0.55,
  returning: 0.75,
  regular: 1.0,
  experienced: 1.25,
};

/** Equipment that isn't loaded with plates at all. */
function isUnloaded(e: Exercise): boolean {
  return e.eq === 'body only' || e.eq === 'bands';
}

/**
 * A dumbbell figure is per-hand, so it's a fraction of the barbell total.
 *
 * Applied to COMPOUND lifts only: the isolation ratios above are already
 * expressed per-hand, and halving them again produced absurd numbers
 * (a 2.5kg curl for a regular 80kg lifter).
 */
function perImplementFactor(e: Exercise): number {
  if (e.mech !== 'compound') return 1;
  if (e.eq === 'dumbbell' || e.eq === 'kettlebells') return 0.4;
  return 1;
}

/** An Olympic bar weighs 20kg; you cannot load less than that on one. */
const EMPTY_BARBELL_KG = 20;

function usesBarbell(e: Exercise): boolean {
  return e.eq === 'barbell' || e.eq === 'e-z curl bar';
}

export type StartingLoadInput = {
  exerciseId: string;
  bodyweightKg: number;
  experience: Experience | null;
  /** Lifts the user reported at onboarding. Preferred over any ratio. */
  declaredLifts?: Record<string, number>;
};

export type StartingLoadEstimate = {
  /** 0 means bodyweight — there is no load to prescribe. */
  weightKg: number;
  /**
   * False ONLY when the user declared a number for this exact lift. Otherwise
   * true and the UI must not present it as known. (Was "always true here" —
   * declared lifts broke that, 2026-10-17.)
   */
  isEstimate: boolean;
  reason: string;
};

/** Round down to something you can actually load on a bar. */
function toLoadable(kg: number): number {
  return Math.max(0, Math.floor(kg / 2.5) * 2.5);
}

export function estimateStartingLoad(
  input: StartingLoadInput,
): StartingLoadEstimate | null {
  const ex = getExercise(input.exerciseId);
  if (!ex) return null;
  if (isUnloaded(ex)) return null; // bodyweight work: reps are the variable

  // A NUMBER THE USER GAVE US BEATS ANY RATIO WE CAN COMPUTE.
  // Without this, a regular lifter who squats 140kg was offered 47.5kg on the
  // first screen they saw — wrong by a factor of three, from a formula, about
  // their own body. See src/onboarding/declaredLifts.ts for why a declared
  // number is an estimate source and never history.
  if (input.declaredLifts) {
    const d = declaredLoadFor(input.exerciseId, ex.pat, input.declaredLifts);
    if (d !== null) {
      // `isEstimate` is FALSE only for a number the user gave us for this
      // exact lift — it is their figure, not our arithmetic. A scaled
      // variation is still a guess, just a much better-founded one.
      return d.exact
        ? {
            weightKg: d.kg,
            isEstimate: false,
            reason: `You told me you lift ${d.kg}kg here.`,
          }
        : {
            weightKg: d.kg,
            isEstimate: true,
            reason: `Worked out from the numbers you gave me. Adjust it.`,
          };
    }
  }

  const bw = input.bodyweightKg;
  if (!Number.isFinite(bw) || bw <= 0) return null;

  const ratio = PATTERN_RATIO.find((p) => p.match(ex))?.ratio ?? DEFAULT_RATIO;
  const factor = EXPERIENCE_FACTOR[input.experience ?? 'new'];
  const raw = bw * ratio * factor * perImplementFactor(ex);

  let weightKg = toLoadable(raw);

  // You can't put 17.5kg on a barbell — the bar itself is 20.
  if (usesBarbell(ex) && weightKg < EMPTY_BARBELL_KG) {
    return {
      weightKg: EMPTY_BARBELL_KG,
      isEstimate: true,
      reason: 'Start with just the bar and see how it moves.',
    };
  }

  if (weightKg <= 0) {
    return {
      weightKg: 0,
      isEstimate: true,
      reason: 'Start with the lightest weight available.',
    };
  }

  return {
    weightKg,
    isEstimate: true,
    reason: 'Starting guess from your bodyweight — treat today as finding the right number.',
  };
}

/**
 * Whether the app should frame this session as calibration.
 * True while the user has no logged history to progress from.
 */
export function isCalibrationSession(completedSessions: number): boolean {
  return completedSessions === 0;
}
