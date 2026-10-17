import type { GoalKind } from '../events/goal';

/**
 * Calorie and macronutrient targets — a calculator, not a cookbook.
 *
 * SCOPED THIS WAY ON PURPOSE (founder, 2026-10-17): no Indian meal database,
 * no per-cuisine recipes. "It takes a lot of time to decide and suggest things
 * as per Indian native and other natives as well. We can just keep it to the
 * fact that so and so person has to eat this much calories, where you give
 * distribution of nutrients." That is the right call — a cuisine database is
 * unbounded work and dates badly, while the arithmetic below is ~100 lines,
 * deterministic, and works for every cuisine on earth.
 *
 * WHY IT EXISTS AT ALL: roughly 40% of the chart that sustained the founder's
 * only six months of consistent training was diet — calorie target, protein
 * target, meal timing. The app had none of it. Hevy, Strong and Fitbod have
 * none of it either.
 *
 * It also gives `age`, `height_cm` and `sex` their first real consumer. All
 * three were collected and read by nothing.
 *
 * NO OUTCOME CLAIMS (founder, same day): "the app only knows what you tell,
 * not what you feel and see in mirror." So this returns a target to aim at,
 * never a prediction. Nothing here says "you will lose 4kg".
 */

export type Sex = 'm' | 'f' | 'other';

export type NutritionInput = {
  weightKg: number;
  heightCm: number;
  /** Years. Omitted when unknown — see `estimatedAge`. */
  age?: number;
  sex: Sex;
  /** Training days per week. Stands in for an activity-level question. */
  daysPerWeek: number;
  goal: GoalKind | null;
};

export type MacroTarget = {
  grams: number;
  /** Share of total calories, 0-100, rounded. */
  pct: number;
  kcal: number;
};

export type NutritionTargets = {
  /** Basal metabolic rate, kcal/day. */
  bmr: number;
  /** Maintenance: BMR × activity. */
  maintenance: number;
  /** The number to eat, after the goal adjustment. */
  target: number;
  /** Signed difference from maintenance, for honest display. */
  adjustment: number;
  protein: MacroTarget;
  fat: MacroTarget;
  carbs: MacroTarget;
  /** Plain-language notes. Shown verbatim; no claim about results. */
  notes: string[];
  /** True when `age` was absent and a default was used. */
  estimatedAge: boolean;
};

/** kcal per gram. */
const KCAL = { protein: 4, fat: 9, carbs: 4 } as const;

/** Used only when age is unknown; flagged in the result so the UI can say so. */
const ASSUMED_AGE = 30;

/**
 * Mifflin-St Jeor. Preferred over Harris-Benedict: it is more accurate in
 * modern validation studies, and it is the equation most clinical and sports
 * nutrition references default to.
 *
 * 'other' takes the midpoint of the two sex constants. That is an honest
 * approximation rather than a claim — the equation has no third form, and
 * refusing to compute would serve the user worse than a flagged estimate.
 */
function mifflinStJeor(weightKg: number, heightCm: number, age: number, sex: Sex): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  if (sex === 'm') return base + 5;
  if (sex === 'f') return base - 161;
  return base - 78; // midpoint of +5 and -161
}

/**
 * Activity multiplier derived from training frequency rather than asked.
 *
 * Standard multipliers run 1.2 (sedentary) to 1.725 (very active). Deriving it
 * from `daysPerWeek` removes a question nobody answers accurately — people
 * overstate activity level far more readily than they overstate how many days
 * they train, because the second one they can count.
 *
 * Capped at 1.6: the top of the usual scale assumes physical work ON TOP of
 * training, and over-estimating maintenance is the error that quietly stalls
 * a fat-loss goal.
 */
function activityFactor(daysPerWeek: number): number {
  const d = Math.max(0, Math.min(7, daysPerWeek));
  if (d <= 0) return 1.2;
  if (d <= 2) return 1.375;
  if (d <= 4) return 1.5;
  return 1.6;
}

/** Goal → calorie adjustment, as a fraction of maintenance. */
function goalAdjustment(goal: GoalKind | null): { pct: number; label: string } {
  switch (goal) {
    case 'fat_loss':
      // ~20% below maintenance. Aggressive deficits cost lean mass and
      // adherence; this is the range most evidence-based guidance settles on.
      return { pct: -0.20, label: 'a moderate deficit' };
    case 'hypertrophy':
      // ~10% above. Larger surpluses add fat faster than muscle, which is the
      // mistake behind most "bulks" that end in a cut.
      return { pct: 0.10, label: 'a small surplus' };
    case 'strength':
      return { pct: 0.05, label: 'a slight surplus' };
    case 'endurance':
    case 'general_fitness':
    default:
      return { pct: 0, label: 'maintenance' };
  }
}

/**
 * Protein, g/kg bodyweight.
 *
 * 1.6 g/kg is where benefits plateau in the resistance-training literature,
 * with confidence intervals extending to ~2.2 — so 1.8 is a defensible target
 * for muscle gain rather than the bottom of the range.
 *
 * HIGHER IN A DEFICIT (2.2): when calories are low, protein is what preserves
 * lean mass, so the requirement goes up exactly when people tend to eat less
 * of it.
 *
 * For context on why this matters: the chart that sustained the founder's six
 * months prescribed 85-95g, which at most adult bodyweights is nearer 1.2 g/kg
 * — low by roughly a third for a muscle-gain goal. Everything else in that
 * chart was sound. It is the clearest example in this project of LLM advice
 * that reads as authoritative and contains one weak number.
 */
function proteinPerKg(goal: GoalKind | null): number {
  if (goal === 'fat_loss') return 2.2;
  if (goal === 'hypertrophy' || goal === 'strength') return 1.8;
  return 1.6;
}

/**
 * Absolute calorie floors for unsupervised dieting.
 *
 * A BMR floor alone is NOT enough, which a check caught: a 45kg 60-year-old
 * woman has a BMR of 927, so a 20% deficit lands at 1020 — above her BMR, so
 * the BMR clamp never fires, and well below what anyone should eat without
 * supervision. Small, older, shorter people are exactly where a percentage
 * deficit produces a number a formula will happily hand over.
 *
 * ~1200 kcal (women) and ~1500 (men) are the figures most clinical guidance
 * cites as minimums outside medical supervision. Treat them as a conservative
 * convention rather than a sharp physiological threshold — but a conservative
 * convention is the right default for an app that cannot see its user.
 */
const KCAL_FLOOR: Record<Sex, number> = { f: 1200, other: 1200, m: 1500 };

/**
 * Fat as a SHARE of calories, with a g/kg floor underneath it.
 *
 * A flat g/kg does not scale: at 0.9 g/kg a 74kg lifter eating 3016 kcal got
 * 67g of fat — 20% of intake, the bottom of the usual 20-35% band — which
 * pushed carbohydrate to 62% and looked wrong to anyone who reads it. Fat
 * should grow with the calorie target; the floor exists for hormonal function
 * and only binds in a deep deficit.
 */
const FAT_PCT_OF_KCAL = 0.25;
const FAT_FLOOR_PER_KG = 0.8;

export function nutritionTargets(input: NutritionInput): NutritionTargets {
  const { weightKg, heightCm, sex, daysPerWeek, goal } = input;
  const estimatedAge = input.age === undefined;
  const age = input.age ?? ASSUMED_AGE;

  const bmr = Math.round(mifflinStJeor(weightKg, heightCm, age, sex));
  const maintenance = Math.round(bmr * activityFactor(daysPerWeek));
  const adj = goalAdjustment(goal);
  let target = Math.round(maintenance * (1 + adj.pct));

  const notes: string[] = [];

  // SAFETY FLOORS, both of them. Below BMR people lose more than fat and
  // adherence collapses; below the absolute floor nobody should be eating
  // without supervision. Clamp to whichever is higher, and say so — silently
  // prescribing it would be the worst thing in this file.
  const floor = Math.max(bmr, KCAL_FLOOR[sex]);
  if (target < floor) {
    const wasBelowAbsolute = target < KCAL_FLOOR[sex];
    target = floor;
    notes.push(
      wasBelowAbsolute
        ? `A ${Math.round(Math.abs(adj.pct) * 100)}% deficit would have put you under ${KCAL_FLOOR[sex]} calories, which is too low to do unsupervised — so it is held at ${floor}. Slower is the version that lasts.`
        : `That would have put you under what your body burns at rest, so it is held at ${floor}. Losing weight more slowly is the version that lasts.`,
    );
  }

  // Protein first — it is the target that matters most and the one people miss.
  const proteinG = Math.round(weightKg * proteinPerKg(goal));
  const proteinKcal = proteinG * KCAL.protein;

  // Fat next: a share of the target, never below the floor.
  const fatFloorG = Math.round(weightKg * FAT_FLOOR_PER_KG);
  let fatG = Math.max(fatFloorG, Math.round((target * FAT_PCT_OF_KCAL) / KCAL.fat));
  let fatKcal = fatG * KCAL.fat;

  // Carbs take the remainder — they are the lever, because protein and fat
  // both have floors and carbohydrate does not.
  let carbsKcal = target - proteinKcal - fatKcal;
  if (carbsKcal < 0) {
    // Only reachable at a very low target: shave fat toward its floor first,
    // because protein is load-bearing for everything the app is trying to do.
    const deficit = -carbsKcal;
    const shaveG = Math.min(fatG - fatFloorG, Math.ceil(deficit / KCAL.fat));
    fatG -= shaveG;
    fatKcal = fatG * KCAL.fat;
    carbsKcal = Math.max(0, target - proteinKcal - fatKcal);
    notes.push('Your calorie target is low relative to the protein you need, so fat is at its floor.');
  }
  const carbsG = Math.round(carbsKcal / KCAL.carbs);

  const total = proteinKcal + fatKcal + carbsKcal;
  const pct = (k: number) => (total > 0 ? Math.round((k / total) * 100) : 0);

  notes.push(
    adj.pct === 0
      ? `${target} calories is roughly maintenance for someone training ${daysPerWeek} day${daysPerWeek === 1 ? '' : 's'} a week.`
      : `${target} calories is ${adj.label} — ${Math.abs(target - maintenance)} ${target > maintenance ? 'above' : 'below'} your maintenance of ${maintenance}.`,
  );
  notes.push(`Protein is the one to hit: ${proteinG}g. The rest has room to move.`);
  if (estimatedAge) {
    notes.push('Age was not given, so this assumes 30. Tell me your age and it gets more accurate.');
  }

  return {
    bmr,
    maintenance,
    target,
    adjustment: target - maintenance,
    protein: { grams: proteinG, pct: pct(proteinKcal), kcal: proteinKcal },
    fat: { grams: fatG, pct: pct(fatKcal), kcal: fatKcal },
    carbs: { grams: carbsG, pct: pct(carbsKcal), kcal: carbsKcal },
    notes,
    estimatedAge,
  };
}
