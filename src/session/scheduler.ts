import type { ExerciseSlot, PreCheckinPayload, SorenessEntry } from '../events/session';
import type { GoalKind } from '../events/goal';
import type { Experience, EquipmentTier } from '../events/userContext';
import {
  canonicalExerciseId, getExercise, loadsInjury, filterExercises,
  type Exercise, type MovementPattern,
} from '../data/exercises';
import { musclesFor, type Muscle } from '../data/muscles';
import { buildWarmup, buildCooldown, type Warmup } from '../data/warmups';
import { selectSplit } from '../program/splits';
import { getParameters, exerciseCount, type Parameters } from '../program/parameters';
import { resolveSession, DAY_NAME, DAY_MUSCLES, type DayType } from '../program/resolve';

// ─── Session builder ─────────────────────────────────────────────────
// Sessions are assembled from the 743-exercise library by movement-pattern
// slot, not chosen from three hardcoded templates.
//
// Slots are ordered compound-first: compounds go where you're fresh,
// isolation where fatigue doesn't compromise them.

const DAY_SLOTS: Record<DayType, MovementPattern[]> = {
  PUSH:  ['horizontal_push', 'vertical_push', 'horizontal_push', 'shoulder_isolation', 'tricep', 'chest_isolation'],
  PULL:  ['vertical_pull', 'horizontal_pull', 'horizontal_pull', 'shoulder_isolation', 'bicep', 'forearm'],
  LEGS:  ['squat', 'hinge', 'lunge', 'knee_isolation', 'hip_isolation', 'calf'],
  UPPER: ['horizontal_push', 'vertical_pull', 'vertical_push', 'horizontal_pull', 'bicep', 'tricep'],
  LOWER: ['squat', 'hinge', 'lunge', 'knee_isolation', 'hip_isolation', 'calf'],
  FB:    ['squat', 'horizontal_push', 'vertical_pull', 'hinge', 'core', 'shoulder_isolation'],
  // resolveSession's own copy calls this "light full-body movement", and
  // ['core','hip_isolation','core'] was neither full-body nor three distinct
  // exercises once `used` de-duplicated it. Widened to match the promise;
  // volume and RPE are what make it recovery, not a short slot list.
  RECOVERY: ['squat', 'horizontal_push', 'horizontal_pull', 'core', 'hip_isolation'],
};

/** Legacy helper — template names to stable library ids. */
export function exerciseIdOf(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return canonicalExerciseId(slug);
}

export type ScheduleInput = {
  equipment: Equipment;
  /** Completions only — a skip must not advance the split. */
  rotationIndex: number;
  checkin: PreCheckinPayload;
  goal: GoalKind | null;
  experience: Experience | null;
  daysPerWeek: number;
  sessionMaxMinutes?: number;
  injuries?: string[];
  ownedEquipment?: string[];
  /**
   * Exercise ids this user has already logged sets against. Preferred, not
   * avoided — see the `known` term in pickForSlot. Was `recentExerciseIds`
   * with the opposite sign, and was never passed by any caller.
   */
  knownExerciseIds?: string[];
  /** Days since the last completed session. */
  gapDays?: number;
  hoursSinceDayType?: Partial<Record<DayType, number>>;
  daysSinceDayType?: Partial<Record<DayType, number>>;
  totalSessions?: number;
};

export type Equipment = EquipmentTier | 'home' | 'gym';

export type ScheduledSessionDraft = {
  workoutId: string;
  workoutName: string;
  exercises: ExerciseSlot[];
  openingNote: string;
  dropped: { name: string; reason: 'injury' | 'soreness' | 'nothing_available' }[];
  warmup: { raise: Warmup[]; mobilise: Warmup[] };
  cooldown: Warmup[];
  /** For the UI: why today looks like this. */
  splitName: string;
  dayType: DayType;
  reasons: string[];
};

/** Equipment people recognise, in the order a coach would reach for it. */
const STAPLE_EQUIPMENT: Record<string, number> = {
  barbell: 25, dumbbell: 22, machine: 20, cable: 18,
  'body only': 15, 'e-z curl bar': 10, kettlebells: 8,
  bands: 4, 'exercise ball': 2, 'medicine ball': 2, other: 0, 'foam roll': 0,
};

/**
 * Specialist variants a coach wouldn't open a session with. The library
 * has no "is this the canonical lift" flag, and without this the ranking
 * happily prescribes a Jerk Dip Squat to a 19-year-old and a Stiff Leg
 * Good Morning to a 58-year-old who has never lifted.
 */
const SPECIALIST = /board|jerk|zercher|bradford|cambered|deficit|pause|chain|anderson|pin |rack pull|floor press|guillotine|behind the neck|sots|hack |landmine|sumo|snatch|clean|bulgarian|pistol|nordic|glute-ham|reverse hyper|good morning|smith/i;

/** Bodyweight moves that still need a bar, rings or parallel bars. */
const NEEDS_FIXTURE = /pull-?ups?|chin-?ups?|muscle-?ups?|dips?|hanging|inverted row|australian/i;

/**
 * Per-exercise jitter, to break score ties without an alphabetical bias
 * (that bias once handed every user "Alternating Floor Press").
 *
 * ⚠ IT MUST NOT VARY BY SESSION. This was salted with `rotationIndex`, so
 * the tiebreak changed every rotation and the occupant of each slot moved
 * with it: a 6-slot programme produced 25 distinct exercise ids over 12
 * weeks. `suggestLoad` needs two sessions on the SAME exerciseId at the
 * same load before it will add weight, so progression could never fire,
 * the prefill was empty, and "last: 102.5 × 8 @ 8" showed "last: —" on
 * half the cards forever. Variety is the user's to ask for (task 2.5,
 * mid-session swap); it is not the scheduler's to impose.
 */
function jitter(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 9973;
  return h / 9973; // 0..1
}

function pickForSlot(
  slot: MovementPattern,
  pool: Exercise[],
  used: Set<string>,
  slotIndex: number,
  goal: GoalKind | null,
  /** Exercise ids this user already has logged sets against. */
  known: ReadonlySet<string>,
  owned: string[],
  tier: EquipmentTier,
  novice: boolean,
): Exercise | undefined {
  const needsFixture = (e: Exercise) =>
    tier === 'home' && NEEDS_FIXTURE.test(e.name) && !owned.includes('pullup bar');

  let candidates = pool.filter((e) => e.pat === slot && !used.has(e.id) && !needsFixture(e));
  // Prefer the declared staples outright. Only fall back to the wider
  // library when this slot has no canonical option available.
  const staples = candidates.filter((e) => e.staple);
  if (staples.length > 0) candidates = staples;
  if (candidates.length === 0) return undefined;

  const scored = candidates.map((e) => {
    let score = 100;
    if (e.mech === 'compound' && slotIndex < 3) score += 30;
    if (goal === 'strength' && e.eq === 'barbell') score += 20;
    if (goal === 'fat_loss' && e.sm.length >= 2) score += 15;
    // The comment here used to say "novelty is penalised on purpose" while
    // the code did `score -= 40` for anything recently done — i.e. it pushed
    // AWAY from the exercises whose load history the user had just built.
    // Inverted. Continuity is the point: an exercise you have numbers
    // against is worth more than a fresh one, because the numbers are what
    // progression reads.
    if (known.has(e.id)) score += 45;

    // Prefer the recognisable version of a movement. Without this the
    // scores tie and the alphabetical tiebreak hands everyone whatever
    // the library happens to list first — which is why five different
    // people were all getting "Alternating Floor Press".
    score += STAPLE_EQUIPMENT[e.eq] ?? 0;

    // If you own kit, use it. Otherwise asking what you own is theatre.
    if (tier === 'home' && owned.includes(e.eq)) score += 20;

    // Explosive and technical lifts are not a novice's first session,
    // whatever the source data tags them as.
    if (novice && (e.pat === 'olympic' || e.pat === 'carry')) score -= 60;
    if (novice && /bound|hop|jump|plyo|explosive|snatch|clean|muscle-up/i.test(e.name)) score -= 60;
    if (novice && e.lvl === 'beginner') score += 10;
    if (e.lvl === 'expert') score -= novice ? 50 : 10;

    if (SPECIALIST.test(e.name)) score -= novice ? 45 : 22;

    return { e, score: score + jitter(e.id) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.e;
}

/**
 * Area words expanded into real library muscles. The old version keyed the
 * map by the raw chip label, so 'legs' / 'arms' / 'back' / 'core' matched
 * nothing in `ex.pm` and four of six check-in chips were decorative.
 */
function soreLevels(soreness: SorenessEntry[]): Map<Muscle, number> {
  const m = new Map<Muscle, number>();
  for (const s of soreness) {
    for (const mus of musclesFor(s.muscle)) {
      m.set(mus, Math.max(m.get(mus) ?? 0, s.level));
    }
  }
  return m;
}

export function buildSessionDraft(input: ScheduleInput): ScheduledSessionDraft {
  const {
    equipment, rotationIndex, checkin, goal, experience, daysPerWeek,
    sessionMaxMinutes = 60,
  } = input;
  const injuries = input.injuries ?? [];
  const owned = input.ownedEquipment ?? [];
  const known = new Set(input.knownExerciseIds ?? []);
  const tier = equipment as EquipmentTier;

  // 1 ─ which split
  const split = selectSplit(daysPerWeek, experience, goal, tier, sessionMaxMinutes);

  // 2 ─ which day, and today's modifiers
  const resolved = resolveSession({
    splitId: split.splitId,
    completedCount: rotationIndex,
    gapDays: input.gapDays ?? 1,
    hoursSinceDayType: input.hoursSinceDayType ?? {},
    daysSinceDayType: input.daysSinceDayType ?? {},
    soreness: checkin.soreness,
    feel: checkin.energy <= 3 ? 'rough' : checkin.energy >= 8 ? 'good' : 'ok',
    totalSessions: input.totalSessions ?? 0,
  });

  // 3 ─ goal sets the parameters
  const params: Parameters = getParameters(goal, experience);
  const want = exerciseCount(params, sessionMaxMinutes);

  // 4 ─ fill the day's pattern slots from the library
  const pool = filterExercises({
    tier,
    owned,
    injuries,
    ...(experience === 'new' ? { maxLevel: 'beginner' as const } : {}),
  });
  const used = new Set<string>();
  const exercises: ExerciseSlot[] = [];
  const dropped: ScheduledSessionDraft['dropped'] = [];
  let trimmedForSoreness = 0;
  const sore = soreLevels(checkin.soreness);
  let borrowedFullBody = false;

  // A day whose own slots cannot be filled falls back to full-body slots
  // rather than returning nothing. This matters more than it looks: the
  // rotation advances on COMPLETION only, so an empty session is not a bad
  // day — it is a permanent dead stop. A home user with no pull-up bar has
  // zero horizontal or vertical pull options in the whole 743-exercise
  // library, so PULL day was unfillable and unskippable.
  let slots: MovementPattern[] = DAY_SLOTS[resolved.dayType] ?? [];
  const fillable = slots.some((slot) =>
    pool.some((e) => e.pat === slot &&
      !(tier === 'home' && NEEDS_FIXTURE.test(e.name) && !owned.includes('pullup bar'))));
  if (!fillable) {
    slots = DAY_SLOTS.FB ?? [];
    borrowedFullBody = true;
  }

  for (let i = 0; i < slots.length && exercises.length < want; i++) {
    const slot = slots[i]!;
    const ex = pickForSlot(
      slot, pool, used, i, goal, known, owned, tier,
      experience === 'new' || experience === 'returning',
    );
    if (!ex) {
      dropped.push({ name: slot.replace(/_/g, ' '), reason: 'nothing_available' });
      continue;
    }
    used.add(ex.id);

    // volume: goal × soreness × feel
    const worstSore = Math.max(0, ...ex.pm.map((m) => sore.get(m) ?? 0));
    const soreFactor = worstSore >= 3 ? 0 : worstSore === 2 ? 0.6 : 1;
    if (soreFactor === 0) {
      // Was tagged 'injury', which is what the UI would have told the user.
      dropped.push({ name: ex.name, reason: 'soreness' });
      continue;
    }
    const sets = Math.max(1, Math.round(params.setsPerExercise * soreFactor * resolved.globalVolume));
    if (soreFactor < 1) trimmedForSoreness += 1;
    const reps = Math.round((params.repLow + params.repHigh) / 2);

    exercises.push({
      exerciseId: ex.id,
      name: ex.name,
      sets,
      targetReps: reps,
      ...(params.maxRpe <= resolved.maxRpe ? { targetRpe: params.maxRpe } : { targetRpe: resolved.maxRpe }),
    });
  }

  // BACKSTOP. Severe soreness across a whole region can empty the day even
  // after resolveSession's recovery path (which is deliberately suppressed
  // for novices, who are sore everywhere for their first weeks). An empty
  // session is not a bad day — it throws, and because the rotation advances
  // on completion only, it cannot be skipped past. Refill from whatever is
  // not sore, and say so.
  let soreForcedSwap = false;
  if (exercises.length === 0) {
    const notSore = (p: MovementPattern) =>
      pool.some((e) => e.pat === p && Math.max(0, ...e.pm.map((m) => sore.get(m) ?? 0)) < 3);
    const fallback = (DAY_SLOTS.FB ?? []).filter(notSore);
    for (let i = 0; i < fallback.length && exercises.length < Math.min(want, 4); i++) {
      const slot = fallback[i]!;
      const ex = pickForSlot(slot, pool, used, i, goal, known, owned, tier,
        experience === 'new' || experience === 'returning');
      if (!ex) continue;
      const worst = Math.max(0, ...ex.pm.map((m) => sore.get(m) ?? 0));
      if (worst >= 3) continue;
      used.add(ex.id);
      soreForcedSwap = true;
      exercises.push({
        exerciseId: ex.id,
        name: ex.name,
        // Deliberately light: this is not the session they were due.
        sets: Math.max(2, Math.round(params.setsPerExercise * 0.6)),
        targetReps: Math.round((params.repLow + params.repHigh) / 2),
        targetRpe: Math.min(7, params.maxRpe),
      });
    }
  }

  // Injuries are enforced by filtering the pool, so nothing unsafe is ever
  // built. But silent safety reads as a boring session — say what changed.
  const extraReasons: string[] = [];
  if (injuries.length > 0) {
    const all = filterExercises({ tier, owned });
    const removed = all.length - pool.length;
    if (removed > 0) {
      extraReasons.push(
        `${injuries.join(' and ')} flagged — ${removed} exercises left out, and nothing today loads it.`,
      );
    }
  }
  // Said only when it is true of this session. The old line came out of
  // resolveSession off the raw check-in input, so it appeared over sessions
  // whose set counts were untouched — a claim a user disproves by counting.
  const soreDropped = dropped.filter((d) => d.reason === 'soreness').length;
  if (soreDropped > 0 && trimmedForSoreness > 0) {
    extraReasons.push(`${soreDropped} exercise${soreDropped > 1 ? 's' : ''} left out and ${trimmedForSoreness} cut back where you said you were sore.`);
  } else if (soreDropped > 0) {
    extraReasons.push(`${soreDropped} exercise${soreDropped > 1 ? 's' : ''} left out where you said you were sore.`);
  } else if (trimmedForSoreness > 0) {
    extraReasons.push(`${trimmedForSoreness} exercise${trimmedForSoreness > 1 ? 's' : ''} cut back where you said you were sore.`);
  }
  // Soreness reported in a word the library has no muscle for: say nothing
  // rather than implying it landed.
  if (soreForcedSwap) {
    extraReasons.push(
      "Everything today's session trains is badly sore, so this is light work on what is not. Your proper session is still next in line — this does not skip it.",
    );
  }
  if (borrowedFullBody) {
    extraReasons.push(
      "There's nothing in your kit that trains today's pattern, so this is a full-body session instead. A pull-up bar would open up the pulling work — add one in your setup if you get one.",
    );
  }

  // When the day borrowed full-body slots, call it what it is. Serving
  // squats and push-ups under the heading "Pull" is the kind of small lie
  // that makes someone stop trusting the rest of it.
  const effectiveDay: DayType = borrowedFullBody ? 'FB' : resolved.dayType;
  const dayMuscles = DAY_MUSCLES[effectiveDay];
  return {
    workoutId: `${split.splitId}:${effectiveDay}`,
    workoutName: DAY_NAME[effectiveDay],
    exercises,
    openingNote: [DAY_NAME[effectiveDay] + '.', ...resolved.reasons].join(' ').slice(0, 400),
    dropped,
    warmup: buildWarmup(dayMuscles, tier, owned),
    cooldown: buildCooldown(dayMuscles, tier, owned),
    splitName: split.name ?? '',
    dayType: effectiveDay,
    reasons: [split.why, ...resolved.reasons, ...extraReasons, ...(split.warning ? [split.warning] : [])],
  };
}
