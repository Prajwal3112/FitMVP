/**
 * Typo guards for logged sets — pure, so a check can actually run them.
 *
 * Kept out of commands.ts deliberately: that module reaches the database and
 * therefore react-native, which `tsx` cannot transform. Validation that
 * decides whether a write is accepted belongs somewhere a test can import.
 * (Onboarding's "Invalid age" dead end shipped for exactly this reason.)
 *
 * WHY A CEILING AT ALL. There is no correction path once a session is
 * completed — no history screen, no edit, no undo, no SetCorrected event —
 * and `selectExerciseHistory` reads max(weight). So one slipped digit is
 * permanent AND poisons every future suggestion for that lift: two sessions
 * logged at 1000 kg produce "you've got more, try 1002.5kg" forever. Across
 * six testers over several weeks, at least one fat-finger is near certain.
 */

/** Above any real human performance. The point is a slipped digit, not judgement. */
export const MAX_PLAUSIBLE_WEIGHT_KG = 500;
export const MAX_PLAUSIBLE_REPS = 200;
export const MAX_PLAUSIBLE_DURATION_SEC = 3600;

export type SetValues = {
  weight_kg: number;
  reps: number;
  durationSec?: number;
};

/** Returns null when the values are plausible, or the reason they are not. */
export function implausibleSet(v: SetValues): string | null {
  if (!Number.isFinite(v.weight_kg) || v.weight_kg < 0) {
    return 'That weight is not a number.';
  }
  if (!Number.isFinite(v.reps) || v.reps < 0) {
    return 'That rep count is not a number.';
  }
  if (v.weight_kg > MAX_PLAUSIBLE_WEIGHT_KG) {
    return `${v.weight_kg}kg looks like a typo — that is heavier than any lift on record. Check the number.`;
  }
  if (v.reps > MAX_PLAUSIBLE_REPS) {
    return `${v.reps} reps looks like a typo. Check the number.`;
  }
  if (v.durationSec !== undefined && v.durationSec > MAX_PLAUSIBLE_DURATION_SEC) {
    return `${v.durationSec} seconds looks like a typo. Check the number.`;
  }
  return null;
}
