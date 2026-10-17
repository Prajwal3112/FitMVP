import type { MovementPattern } from '../data/exercises';

/**
 * Lifts the user tells us they can already do.
 *
 * WHY THIS IS NOT "HISTORY". `startingLoad` estimates from
 * bodyweight × pattern ratio × experience factor, so a regular lifter who
 * squats 140kg was handed 47.5kg on their first screen, and a returner who
 * squatted 140 was handed 35kg. Wrong by a factor of three, on the first thing
 * they see — and the research found exactly that complaint: *"apps pretend
 * that they know more about my body than I do."*
 *
 * ⚠ DECLARED IS NOT PERFORMED, and the distinction is load-bearing. The
 * tempting fix is to write synthetic `SetCompleted` events so
 * `ExerciseHistory` is pre-populated. That would be fabricating training that
 * never happened: the history screen would show sessions the user never did,
 * and the event log — which exists to be a truthful record — would be lying in
 * its first five rows.
 *
 * So a declared number is an ESTIMATE SOURCE, nothing more. It replaces a
 * guess with a better guess. Real history still only comes from logged sets,
 * and the moment one exists for a lift, it wins.
 */

/** The handful worth asking about: big, recognisable, and they anchor a pattern. */
export const ANCHOR_LIFTS: {
  exerciseId: string;
  /** What a person calls it, not the library's name. */
  label: string;
  /** Other exercises in this pattern inherit a scaled version. */
  pattern: MovementPattern;
}[] = [
  { exerciseId: 'Barbell_Squat', label: 'Squat', pattern: 'squat' },
  { exerciseId: 'Barbell_Bench_Press_-_Medium_Grip', label: 'Bench press', pattern: 'horizontal_push' },
  { exerciseId: 'Barbell_Deadlift', label: 'Deadlift', pattern: 'hinge' },
  { exerciseId: 'Standing_Military_Press', label: 'Overhead press', pattern: 'vertical_push' },
];

/** exerciseId → working weight in kg, as the user reported it. */
export type DeclaredLifts = Record<string, number>;

/**
 * Plausibility bounds. Deliberately wide — the point is to catch a slipped
 * digit or a pounds/kilos mix-up, not to tell anyone their lift is too light.
 * The world record squat is around 500kg.
 */
export const MIN_DECLARED_KG = 10;
export const MAX_DECLARED_KG = 500;

export function implausibleDeclaredLift(kg: number): string | null {
  if (!Number.isFinite(kg)) return 'That is not a number.';
  if (kg < MIN_DECLARED_KG) return `Under ${MIN_DECLARED_KG}kg — did you mean something heavier?`;
  if (kg > MAX_DECLARED_KG) return `Over ${MAX_DECLARED_KG}kg is past the world record. Check the number.`;
  return null;
}

/**
 * Only worth asking someone who has numbers to give. A beginner has none, and
 * asking invites a guess that is worse than our estimate.
 */
export function shouldAskDeclaredLifts(experience: string | null): boolean {
  return experience === 'returning' || experience === 'regular' || experience === 'experienced';
}

/**
 * A declared anchor in the same movement pattern, scaled.
 *
 * If you tell us your bench, we know roughly where your incline press and
 * close-grip bench sit — far better than a bodyweight ratio. The factor is
 * deliberately conservative (0.8): a variation is almost always lighter than
 * the anchor, and being under is recoverable in one set while being over is a
 * failed rep under a loaded bar.
 */
const VARIATION_FACTOR = 0.8;

export function declaredLoadFor(
  exerciseId: string,
  pattern: MovementPattern | undefined,
  declared: DeclaredLifts,
): { kg: number; exact: boolean } | null {
  const direct = declared[exerciseId];
  if (direct !== undefined && direct > 0) return { kg: direct, exact: true };
  if (pattern === undefined) return null;

  const anchor = ANCHOR_LIFTS.find((a) => a.pattern === pattern);
  if (!anchor) return null;
  const anchorKg = declared[anchor.exerciseId];
  if (anchorKg === undefined || anchorKg <= 0) return null;

  // Round to something loadable rather than handing back 43.2kg.
  const scaled = Math.round((anchorKg * VARIATION_FACTOR) / 2.5) * 2.5;
  return scaled >= MIN_DECLARED_KG ? { kg: scaled, exact: false } : null;
}
