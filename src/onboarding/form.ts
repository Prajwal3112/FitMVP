import type { Equipment } from '../constants/workouts';
import type { Experience, OwnedEquipment } from '../events/userContext';
import {
  shouldAskDeclaredLifts, implausibleDeclaredLift, type DeclaredLifts,
} from './declaredLifts';

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

/** Hour-of-day choices, kept coarse — nobody knows their wake time to the minute. */
export type Sex = 'm' | 'f' | 'other';

export type OnboardingForm = {
  weight: string;
  /**
   * The three below exist so the calorie and macro targets can be computed at
   * all. They were DEFAULTED (height 170cm, sex 'other', age absent) and only
   * askable from Setup, which a tester has no reason to open — so nutrition
   * showed nothing for everyone, and `profileComplete` detected the default by
   * testing `height_cm !== 170`, which permanently excluded anyone who is
   * actually 170cm tall.
   */
  heightCm: string;
  sex: Sex | null;
  age: string;
  /**
   * Wake and sleep hours. Asked because "when can I start the next session"
   * cannot be answered without knowing when the person is awake, and because
   * the coach layer that arrives after four weeks is supposed to speak about
   * the user's actual week.
   */
  wakeHour: number | null;
  sleepHour: number | null;
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
  /**
   * Lifts the user says they already do, keyed by exerciseId. Only asked of
   * returning/regular/experienced — a beginner has no numbers and asking
   * invites a guess worse than our estimate.
   */
  declaredLifts: DeclaredLifts;
};

/** Exactly what the screen's useState holds on a cold install. */
export function emptyOnboardingForm(): OnboardingForm {
  return {
    weight: '',
    heightCm: '',
    sex: null,
    age: '',
    wakeHour: null,
    sleepHour: null,
    workoutTime: 'morning',
    equipment: null,
    experience: null,
    daysPerWeek: null,
    ownedEquipment: [],
    injuries: [],
    declaredLifts: {},
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
  // Composed from the per-step gates so the two can never disagree. The whole
  // form is complete exactly when no step is blocked.
  for (const step of onboardingSteps(form)) {
    const blocked = stepBlocker(form, step);
    if (blocked !== null) return blocked;
  }
  return null;
}

// ─── Phasing ─────────────────────────────────────────────────────────
// Nine sections on one scroll, with the keyboard covering the field being
// typed into and "WHAT DO YOU LIFT NOW?" sitting BELOW the Continue button,
// where an experienced lifter tapped Continue and never saw it. One question
// at a time, and the step order is the question order.

export type OnboardingStepId =
  | 'experience' | 'days' | 'place' | 'body' | 'rhythm' | 'injuries' | 'lifts';

/**
 * The steps THIS form will show, in order. `lifts` is conditional: a beginner
 * has no numbers to give and asking invites a guess worse than our estimate.
 */
export function onboardingSteps(form: OnboardingForm): OnboardingStepId[] {
  const steps: OnboardingStepId[] = [
    'experience', 'days', 'place', 'body', 'rhythm', 'injuries',
  ];
  if (shouldAskDeclaredLifts(form.experience)) steps.push('lifts');
  return steps;
}

/** Why this step cannot be left yet, or null when it can. */
export function stepBlocker(form: OnboardingForm, step: OnboardingStepId): string | null {
  switch (step) {
    case 'experience':
      return form.experience === null ? 'Pick where you are starting from' : null;
    case 'days':
      return form.daysPerWeek === null ? 'Pick how many days a week' : null;
    case 'place':
      return form.equipment === null ? 'Pick where you will train' : null;
    case 'body': {
      if (form.weight.trim().length === 0) return 'Your bodyweight is needed to suggest weights';
      const w = Number(form.weight);
      if (!Number.isFinite(w) || w <= 0) return 'Bodyweight must be a number';
      // A mistyped bodyweight silently skews every starting-load estimate, and
      // there is no way to correct a logged set afterwards.
      if (w < 25 || w > 400) return 'That bodyweight looks like a typo';
      // Height, age and sex are OPTIONAL. They only buy the calorie target,
      // and refusing to let someone train until they disclose their sex would
      // be the worst trade in the app.
      if (form.heightCm.trim().length > 0) {
        const h = Number(form.heightCm);
        if (!Number.isFinite(h) || h < 100 || h > 250) return 'That height looks like a typo';
      }
      if (form.age.trim().length > 0) {
        const a = Number(form.age);
        if (!Number.isFinite(a) || a < 13 || a > 100) return 'That age looks like a typo';
      }
      return null;
    }
    // Both optional: a wake hour buys better "when next" copy and nothing
    // else, and injuries are a list that is legitimately empty.
    case 'rhythm':
    case 'injuries':
      return null;
    case 'lifts': {
      for (const [, kg] of Object.entries(form.declaredLifts)) {
        const bad = implausibleDeclaredLift(kg);
        if (bad !== null) return bad;
      }
      return null;
    }
  }
}

const DEFAULT_SESSION_MAX_MINUTES = 60;
const DEFAULT_ROLLOVER_HOUR = 4;

export function formToOnboardingPayload(form: OnboardingForm) {
  const invalid = validateOnboardingForm(form);
  if (invalid !== null) throw new Error(invalid);
  const { equipment, experience, daysPerWeek } = form;
  if (equipment === null || experience === null || daysPerWeek === null) {
    throw new Error('Onboarding form incomplete'); // unreachable; narrows types
  }
  // Each optional field is written only when the user gave it. The previous
  // version wrote height 170 / sex 'other' unconditionally, which is a
  // fabricated fact in an append-only log — and then detected its own
  // fabrication by comparing against the constant.
  const num = (s: string): number | null => {
    const n = Number(s);
    return s.trim().length > 0 && Number.isFinite(n) ? n : null;
  };
  const height = num(form.heightCm);
  const age = num(form.age);
  return {
    profile: {
      weight_kg: Number(form.weight),
      ...(height !== null ? { height_cm: height } : {}),
      ...(age !== null ? { age: Math.round(age) } : {}),
      ...(form.sex !== null ? { sex: form.sex } : {}),
    },
    routine: {
      ...(form.wakeHour !== null ? { wakeHour: form.wakeHour } : {}),
      ...(form.sleepHour !== null ? { sleepHour: form.sleepHour } : {}),
      sessionWindow: form.workoutTime,
    },
    equipment,
    constraints: {
      daysPerWeek,
      sessionMaxMinutes: DEFAULT_SESSION_MAX_MINUTES,
    },
    knownInjuries: form.injuries,
    ...(Object.keys(form.declaredLifts).length > 0
      ? { declaredLifts: form.declaredLifts }
      : {}),
    dayRolloverHour: DEFAULT_ROLLOVER_HOUR,
    experience,
    ownedEquipment: form.ownedEquipment,
  };
}
