/**
 * The one place body-part words are defined.
 *
 * WHY THIS FILE EXISTS. Five separate bugs had the same shape: a string
 * describing a body part crossed a module boundary and silently matched
 * nothing on the other side. `MuscleGroup` was `string`, so the compiler
 * could not see any of them:
 *
 *   check-in  'legs' 'arms' 'back' 'core'   -> library muscles : 4 of 6 dead
 *   Setup     'knee' 'elbow' 'hip'          -> library muscles : 3 of 6 dead
 *   Onboarding 'shoulders' vs Setup 'shoulder'                 : duplicate entries
 *
 * In four of those the app then *narrated* what it had not done ("those
 * sets are trimmed"), which is worse than doing nothing.
 *
 * The rule now: screens speak `BodyArea`, the library speaks `Muscle`, and
 * nothing crosses without going through `musclesFor()`. Both are closed
 * unions, so a typo is a compile error instead of a silent no-op.
 */

/** The 17 values that actually occur in exercises.json. Verified exhaustive. */
export const MUSCLES = [
  'abdominals', 'abductors', 'adductors', 'biceps', 'calves', 'chest',
  'forearms', 'glutes', 'hamstrings', 'lats', 'lower back', 'middle back',
  'neck', 'quadriceps', 'shoulders', 'traps', 'triceps',
] as const;
export type Muscle = (typeof MUSCLES)[number];

const MUSCLE_SET: ReadonlySet<string> = new Set(MUSCLES);
export function isMuscle(s: string): s is Muscle {
  return MUSCLE_SET.has(s);
}

/**
 * What a person says, mapped to what the library stores.
 *
 * Two kinds of entry. Muscle groups ('legs', 'arms') expand to the muscles
 * they contain. Joints ('knee', 'elbow') have no muscle of their own, so
 * they expand to the muscles whose training loads that joint — chosen
 * narrowly on purpose: a bad knee should take out squats and leg
 * extensions, not every lower-body movement, or there is nothing left to
 * prescribe and the user is bricked.
 */
export const BODY_AREAS = {
  chest:        ['chest'],
  back:         ['lats', 'middle back', 'traps'],
  'lower back': ['lower back'],
  shoulders:    ['shoulders'],
  arms:         ['biceps', 'triceps', 'forearms'],
  legs:         ['quadriceps', 'hamstrings', 'glutes', 'calves', 'abductors', 'adductors'],
  core:         ['abdominals'],
  neck:         ['neck'],
  glutes:       ['glutes'],
  // Joints. Narrow by design — see the note above.
  knee:         ['quadriceps'],
  hip:          ['glutes', 'abductors', 'adductors'],
  elbow:        ['biceps', 'triceps'],
  wrist:        ['forearms'],
} as const satisfies Record<string, readonly Muscle[]>;

export type BodyArea = keyof typeof BODY_AREAS;

const AREA_SET: ReadonlySet<string> = new Set(Object.keys(BODY_AREAS));
export function isBodyArea(s: string): s is BodyArea {
  return AREA_SET.has(s);
}

/**
 * Muscles for one area word. Accepts a raw string because it is fed from
 * the event log, where historical values predate this union — an unknown
 * word yields nothing rather than throwing, so a bad old event stays
 * replayable. Callers that need to know should use `isBodyArea` first.
 */
export function musclesFor(area: string): readonly Muscle[] {
  const key = area.trim().toLowerCase();
  if (isBodyArea(key)) return BODY_AREAS[key];
  // Tolerate a bare library muscle name — the injury list used to store them.
  if (isMuscle(key)) return [key];
  // Singular/plural slips ('shoulder' for 'shoulders') cost a real bug.
  if (isBodyArea(`${key}s`)) return BODY_AREAS[`${key}s` as BodyArea];
  if (key.endsWith('s') && isBodyArea(key.slice(0, -1))) {
    return BODY_AREAS[key.slice(0, -1) as BodyArea];
  }
  if (isMuscle(`${key}s`)) return [`${key}s` as Muscle];
  return [];
}

/** Union of several area words. */
export function musclesForAll(areas: readonly string[]): Set<Muscle> {
  const out = new Set<Muscle>();
  for (const a of areas) for (const m of musclesFor(a)) out.add(m);
  return out;
}

/**
 * Did this area word resolve to anything? The screens use it to refuse to
 * offer a chip that cannot do anything, which is how three dead injury
 * pills shipped under a safety promise.
 */
export function areaIsMeaningful(area: string): boolean {
  return musclesFor(area).length > 0;
}

// ─── What the screens are allowed to offer ───────────────────────────
// Defined here, next to the map, so a chip cannot exist without a
// meaning. Three injury pills ('knee', 'elbow', 'hip') once shipped
// under the promise "nothing that loads a flagged area will be put in a
// session" while removing zero exercises, because the list lived in the
// screen and nobody checked it against the library.

/** Soreness: the broad areas a person feels DOMS in. */
export const SORENESS_AREAS = [
  'chest', 'back', 'shoulders', 'arms', 'legs', 'core',
] as const satisfies readonly BodyArea[];

/** Injury: joints and regions, in the words people actually use. */
export const INJURY_AREAS = [
  'shoulders', 'elbow', 'wrist', 'lower back', 'hip', 'knee', 'neck',
] as const satisfies readonly BodyArea[];

/** Title-case for display without hardcoding a second copy of the words. */
export function areaLabel(area: BodyArea): string {
  return area === 'core' ? 'Core'
    : area === 'lower back' ? 'Lower back'
    : area.charAt(0).toUpperCase() + area.slice(1);
}
