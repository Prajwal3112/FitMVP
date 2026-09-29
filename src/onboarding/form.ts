import type { Equipment } from '../constants/workouts';
import type { Experience, OwnedEquipment } from '../events/userContext';

/**
 * Onboarding's form shape, validation, and event payload — as plain
 * functions with no React and no react-native import.
 *
 * WHY IT LIVES HERE. This logic used to sit inside FitnessContext.tsx,
 * which imports react-native. Nothing outside the app could execute it:
 * `tsx` fails on react-native's source, so no check could ever fill in the
 * form and press Continue. Fourteen suites passed green while onboarding
 * was completely unusable, because every one of them wrote
 * UserContextCreated straight to the log and skipped the screen.
 *
 * The rule this encodes: anything that decides whether a user can proceed
 * belongs in a module a test can import.
 */

export type OnboardingForm = {
  weight: string;
  workoutTime: string;
  equipment: Equipment | null;
  /** How long they've trained. Drives load estimates and whether RPE shows. */
  experience: Experience | null;
  /** Realistic sessions per week. Replaces the hardcoded 4. */
  daysPerWeek: number | null;
  /** What they actually own, beyond the home/gym tier. */
  ownedEquipment: OwnedEquipment[];
  /** Body areas, from INJURY_AREAS in src/data/muscles.ts. */
  injuries: string[];
};

/** Exactly what the screen's useState holds on a cold install. */
export function emptyOnboardingForm(): OnboardingForm {
  return {
    weight: '',
    workoutTime: 'morning',
    equipment: null,
    experience: null,
    daysPerWeek: null,
    ownedEquipment: [],
    injuries: [],
  };
}

/**
 * The ONE place onboarding completeness is decided.
 *
 * The Continue button used to carry its own copy of these rules and the two
 * drifted: the button checked four fields, the writer required five, and the
 * fifth (age) was never on screen. Every new user tapped Continue and got
 * "Invalid age" under a form with no age field. The screen now asks this
 * function, so the button and the writer cannot disagree.
 *
 * Returns null when the form is complete, or the reason it is not.
 */
export function validateOnboardingForm(form: OnboardingForm): string | null {
  if (form.weight.trim().length === 0) return 'Bodyweight is required';
  const weightNum = Number(form.weight);
  if (!Number.isFinite(weightNum) || weightNum <= 0) return 'Bodyweight must be a number';
  // A mistyped bodyweight silently skews every starting-load estimate, and
  // there is no way to correct a logged set afterwards.
  if (weightNum < 25 || weightNum > 400) return 'That bodyweight looks like a typo';
  if (form.equipment === null) return 'Where you train is required';
  if (form.experience === null) return 'Experience is required';
  if (form.daysPerWeek === null) return 'Days per week is required';
  return null;
}

const DEFAULT_HEIGHT_CM = 170;
const DEFAULT_SEX = 'other' as const;
const DEFAULT_WAKE_HOUR = 7;
const DEFAULT_SLEEP_HOUR = 23;
const DEFAULT_SESSION_MAX_MINUTES = 60;
const DEFAULT_ROLLOVER_HOUR = 4;

export function formToOnboardingPayload(form: OnboardingForm) {
  const invalid = validateOnboardingForm(form);
  if (invalid !== null) throw new Error(invalid);
  const { equipment, experience, daysPerWeek } = form;
  if (equipment === null || experience === null || daysPerWeek === null) {
    throw new Error('Onboarding form incomplete'); // unreachable; narrows types
  }
  return {
    profile: {
      // No `age`: the form never asked for one, and nothing reads it.
      height_cm: DEFAULT_HEIGHT_CM,
      weight_kg: Number(form.weight),
      sex: DEFAULT_SEX,
    },
    routine: {
      wakeHour: DEFAULT_WAKE_HOUR,
      sleepHour: DEFAULT_SLEEP_HOUR,
      sessionWindow: form.workoutTime,
    },
    equipment,
    constraints: {
      daysPerWeek,
      sessionMaxMinutes: DEFAULT_SESSION_MAX_MINUTES,
    },
    knownInjuries: form.injuries,
    dayRolloverHour: DEFAULT_ROLLOVER_HOUR,
    experience,
    ownedEquipment: form.ownedEquipment,
  };
}
