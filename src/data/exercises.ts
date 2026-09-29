import raw from './exercises.json';
import legacyIds from './legacyExerciseIds.json';
import type { EquipmentTier } from '../events/userContext';
import { musclesForAll, type Muscle } from './muscles';

// ─── Exercise library ────────────────────────────────────────────────
// 743 movements from free-exercise-db (Unlicense / public domain), plus
// four hand-tagged conditioning entries the source omits.
//
// Bundled, not fetched: the app is local-first and must work in a gym
// basement. Instructions live in a separate file and load only on demand,
// so boot parses 140 KB rather than 680 KB.

/**
 * Was `string`, which is why five separate body-part vocabulary bugs
 * compiled cleanly. Now the closed union from './muscles'.
 */
export type MuscleGroup = Muscle;
export type Level = 'beginner' | 'intermediate' | 'expert';

export type Exercise = {
  /** Stable, permanent. NEVER derived from the display name. */
  id: string;
  name: string;
  /** Raw equipment label from the source data. */
  eq: string;
  /**
   * Coarse label kept for stats and display. Availability is decided by
   * `eq` + what the user owns — see `isAvailable`.
   */
  tier: 'home' | 'gym';
  /** Primary muscles. */
  pm: MuscleGroup[];
  /** Secondary muscles. */
  sm: MuscleGroup[];
  lvl: Level;
  force: 'push' | 'pull' | 'static' | null;
  mech: 'compound' | 'isolation' | null;
  /**
   * Movement pattern. Derived once, offline, from name + muscles + force
   * + mechanic — it is not recoverable from the source tags alone
   * ("push + chest" cannot tell horizontal from vertical pressing).
   * Drives pattern-slot selection and tiered substitution.
   */
  pat: MovementPattern;
  /**
   * A lift a coach would actually name. Declared, not inferred — three
   * attempts at deriving it from the data produced "JM Press" and
   * "Spell Caster". Non-staples stay in the library for substitutions.
   */
  staple: boolean;
};

export type MovementPattern =
  | 'horizontal_push' | 'vertical_push' | 'horizontal_pull' | 'vertical_pull'
  | 'squat' | 'hinge' | 'lunge' | 'olympic' | 'carry'
  | 'chest_isolation' | 'shoulder_isolation' | 'knee_isolation' | 'hip_isolation'
  | 'bicep' | 'tricep' | 'calf' | 'core' | 'forearm' | 'neck';

export const EXERCISES = raw as Exercise[];

const BY_ID = new Map<string, Exercise>(EXERCISES.map((e) => [e.id, e]));

// ─── Legacy identity ─────────────────────────────────────────────────
// The first 24 exercises used name-derived slugs ('bench-press'), which
// meant renaming an exercise silently orphaned its history. IDs are now
// stable and opaque. Events are immutable, so old ones keep their old id
// and are translated on read — never rewritten.

const LEGACY_ALIASES = legacyIds as Record<string, string>;

/** Canonical id for any id ever written to the log. */
export function canonicalExerciseId(id: string): string {
  return LEGACY_ALIASES[id] ?? id;
}

export function getExercise(id: string): Exercise | undefined {
  return BY_ID.get(canonicalExerciseId(id));
}

export function exerciseName(id: string): string {
  return getExercise(id)?.name ?? id.replace(/[-_]/g, ' ');
}

// ─── Availability ────────────────────────────────────────────────────

/**
 * Can this be done with the equipment the user actually has?
 *
 * `owned` widens the home tier: someone training at home who owns
 * dumbbells should be offered dumbbell work, not only bodyweight. Without
 * it, asking what equipment they own would change nothing.
 */
export function isAvailable(
  ex: Exercise,
  tier: EquipmentTier,
  owned?: string[],
): boolean {
  if (tier === 'gym' || tier === 'mixed') return true; // a gym has everything
  // Only bodyweight is genuinely universal. Treating dumbbells as part of
  // a default "home" tier offered equipment to people who own none — and
  // made the question pointless for people who do.
  if (ex.eq === 'body only') return true;
  return owned !== undefined && owned.includes(ex.eq);
}

/**
 * ARCHITECTURE §8.7 — an exercise is blocked if it loads an injured area,
 * as a primary OR secondary mover. Secondary counts: a shoulder injury
 * rules out bench press even though the chest is the primary.
 */
export function loadsInjury(ex: Exercise, injuries: string[]): boolean {
  if (injuries.length === 0) return false;
  // Was two-way substring matching, which made 'back' match 'lower back' by
  // luck and 'knee' match nothing at all — three Setup pills removed zero
  // exercises while the screen promised they were safe. Areas now expand
  // through the one vocabulary map and compare exactly.
  const blocked = musclesForAll(injuries);
  if (blocked.size === 0) return false;
  for (const m of ex.pm) if (blocked.has(m)) return true;
  for (const m of ex.sm) if (blocked.has(m)) return true;
  return false;
}

export type FilterOptions = {
  tier: EquipmentTier;
  /** Equipment owned beyond the tier's default — widens what's offered. */
  owned?: string[];
  injuries?: string[];
  /** Exclude anything above this level. */
  maxLevel?: Level;
};

const LEVEL_RANK: Record<Level, number> = { beginner: 0, intermediate: 1, expert: 2 };

export function filterExercises(opts: FilterOptions): Exercise[] {
  const injuries = opts.injuries ?? [];
  const cap = opts.maxLevel ? LEVEL_RANK[opts.maxLevel] : 2;
  return EXERCISES.filter(
    (e) =>
      isAvailable(e, opts.tier, opts.owned) &&
      !loadsInjury(e, injuries) &&
      LEVEL_RANK[e.lvl] <= cap,
  );
}

// ─── Substitutions ───────────────────────────────────────────────────
// Derived, not hand-authored. BLUEPRINT Part 8 specced a hand-built
// directed graph of ~200-400 exercises × 5-10 substitutes each; the
// source data's muscle + mechanic tags make that unnecessary.

export type SubstituteOptions = FilterOptions & {
  limit?: number;
  /** 'equipment' keeps the pattern; 'pain' deliberately avoids it. */
  reason?: 'equipment' | 'pain';
};

export type TieredSubstitute = { exercise: Exercise; tier: 1 | 2 | 3; note: string };

/**
 * Alternatives to `exerciseId`, best first, in three tiers.
 *
 * "Same primary muscle" alone is too loose: bench press → cable fly
 * trains the same muscle with a completely different loading profile,
 * and throws away the load history you were progressing against.
 *
 *  Tier 1 — same movement pattern. Structure and load reference survive.
 *  Tier 2 — same primary muscle, same compound/isolation class.
 *  Tier 3 — same primary muscle, any class. Stimulus genuinely differs.
 *
 * When the swap is triggered by PAIN rather than equipment, Tier 1 is the
 * wrong answer — a hurting shoulder should not be handed a landmine press
 * just because it presses. Pass `reason: 'pain'` to invert the order.
 */
export function findSubstitutes(
  exerciseId: string,
  opts: SubstituteOptions,
): Exercise[] {
  const target = getExercise(exerciseId);
  if (!target) return [];

  const targetPm = new Set(target.pm);
  const candidates = filterExercises(opts).filter((e) => e.id !== target.id);

  const pain = opts.reason === 'pain';
  const scored = candidates
    .map((e) => {
      const pmOverlap = e.pm.filter((m) => targetPm.has(m)).length;
      if (pmOverlap === 0) return null; // must train the same thing
      let score = pmOverlap * 10;
      // Pattern match is the strongest signal — except when the reason is
      // pain, where repeating the pattern repeats the problem.
      if (e.pat === target.pat) score += pain ? -25 : 40;
      if (e.mech === target.mech) score += 8;
      if (e.force === target.force) score += 2;
      score += e.sm.filter((m) => target.sm.includes(m)).length;
      if (e.lvl === target.lvl) score += 1;
      return { e, score };
    })
    .filter((x): x is { e: Exercise; score: number } => x !== null)
    .sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name));

  return scored.slice(0, opts.limit ?? 8).map((x) => x.e);
}

/** Substitutes with their tier and a line explaining what changed. */
export function findSubstitutesTiered(
  exerciseId: string,
  opts: SubstituteOptions,
): TieredSubstitute[] {
  const target = getExercise(exerciseId);
  if (!target) return [];
  const targetPm = new Set(target.pm);

  return findSubstitutes(exerciseId, { ...opts, limit: opts.limit ?? 8 }).map((e) => {
    const samePattern = e.pat === target.pat;
    const sameMuscle = e.pm.some((m) => targetPm.has(m));
    if (samePattern) {
      return { exercise: e, tier: 1 as const, note: 'Same movement — your weights carry over.' };
    }
    if (sameMuscle && e.mech === target.mech) {
      return { exercise: e, tier: 2 as const, note: 'Same muscles, different angle.' };
    }
    return { exercise: e, tier: 3 as const, note: 'Same muscles, but it will feel different — start lighter.' };
  });
}

/**
 * Alternatives that train the same pattern without touching a sore muscle
 * — as primary OR secondary.
 *
 * Checking only primary movers is not enough: swapping a press to spare
 * sore triceps is pointless if the replacement presses too. Note this
 * returns nothing when the sore muscle IS the target's primary mover,
 * which is correct — no substitute can train a muscle while sparing it.
 * The scheduler reduces volume in that case instead of swapping.
 */
export function findNonSoreAlternatives(
  exerciseId: string,
  soreMuscles: string[],
  opts: SubstituteOptions,
): Exercise[] {
  const sore = soreMuscles.map((m) => m.toLowerCase());
  const touchesSore = (e: Exercise) =>
    [...e.pm, ...e.sm].some((m) => sore.includes(m.toLowerCase()));

  // Search wide, THEN filter, THEN limit. Filtering a pre-limited list
  // misses valid answers: compound variants outrank isolation work in the
  // ranking, so a top-6 of press substitutes is all presses — and every
  // press uses triceps. The flyes that would actually spare them sit at
  // rank 20+.
  const { limit, ...wide } = opts;
  return findSubstitutes(exerciseId, { ...wide, limit: 200 })
    .filter((e) => !touchesSore(e))
    .slice(0, limit ?? 8);
}

// ─── Instructions (lazy) ─────────────────────────────────────────────

let instructionCache: Record<string, string[]> | null = null;

/** Loads the 539 KB instruction file on first use only. */
export function getInstructions(id: string): string[] {
  if (instructionCache === null) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    instructionCache = require('./exerciseInstructions.json') as Record<string, string[]>;
  }
  return instructionCache[canonicalExerciseId(id)] ?? [];
}
