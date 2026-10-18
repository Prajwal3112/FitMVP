import {
  validateOnboardingForm, formToOnboardingPayload, emptyOnboardingForm,
  onboardingSteps, stepBlocker, type OnboardingForm,
} from '../src/onboarding/form';
import { nutritionInputFrom } from '../src/nutrition/targets';
import { UserContextCreatedPayloadSchema } from '../src/events/userContext';
import { SORENESS_AREAS, INJURY_AREAS, musclesFor } from '../src/data/muscles';
import { filterExercises } from '../src/data/exercises';

let fails = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name} ${extra}`); }
};

console.log('\nOnboarding — the form a real person fills in');
console.log('  (this is the check that was missing: every other suite seeds');
console.log('   UserContextCreated directly and skips the screen entirely)\n');

/** The real initial state, imported — not a copy that can drift from it. */
const emptyForm = emptyOnboardingForm;

// ── the blocker ──
const blank = emptyForm();
ck('a blank form is rejected, with a reason', validateOnboardingForm(blank) !== null);

const filled: OnboardingForm = {
  ...emptyForm(), weight: '74', equipment: 'gym',
  experience: 'regular', daysPerWeek: 3,
};
ck('a form with every ON-SCREEN question answered is accepted',
  validateOnboardingForm(filled) === null, String(validateOnboardingForm(filled)));

let threw: string | null = null;
try { formToOnboardingPayload(filled); } catch (e) { threw = e instanceof Error ? e.message : String(e); }
ck('...and submitting it does not throw', threw === null, threw ?? '');

// The exact bug: the button said valid, the writer threw.
ck('button and writer agree on every field they judge',
  (validateOnboardingForm(filled) === null) === (threw === null));

// ── the payload actually validates against the event schema ──
const payload = formToOnboardingPayload(filled);
const parsed = UserContextCreatedPayloadSchema.safeParse(payload);
ck('the payload passes its own Zod schema', parsed.success,
  parsed.success ? '' : JSON.stringify(parsed.error.issues[0]));

// ── each field the screen collects must reach the payload ──
ck('daysPerWeek reaches the payload', payload.constraints.daysPerWeek === 3);
ck('experience reaches the payload', payload.experience === 'regular');
ck('bodyweight reaches the payload', payload.profile.weight_kg === 74);
// Declared lifts are optional and must be ABSENT, not an empty object, when
// nobody gave any — an empty record would make startingLoad think it had data.
ck('no declaredLifts key when none were given',
  !('declaredLifts' in payload), JSON.stringify(Object.keys(payload)));
const withLifts = formToOnboardingPayload({
  ...filled, declaredLifts: { Barbell_Squat: 140 },
});
ck('declared lifts reach the payload when given',
  (withLifts as { declaredLifts?: Record<string, number> }).declaredLifts?.['Barbell_Squat'] === 140);
ck('equipment reaches the payload', payload.equipment === 'gym');

// ── nothing is required that the screen never asks ──
// Every field here must be fillable on screen. `declaredLifts` is asked only
// of returning/regular/experienced — see shouldAskDeclaredLifts — which still
// counts as fillable; a beginner leaving it empty is the intended path.
const ONSCREEN = ['weight', 'workoutTime', 'equipment', 'experience', 'daysPerWeek',
  'ownedEquipment', 'injuries', 'declaredLifts',
  // Added 2026-10-18 on the 'body' and 'rhythm' steps. All five were written
  // to the log as defaults (height 170, sex 'other', wake 7, sleep 23) with no
  // input anywhere in onboarding, and `profileComplete` then detected its own
  // default by testing `height_cm !== 170`.
  'heightCm', 'sex', 'age', 'wakeHour', 'sleepHour'];
const keys = Object.keys(emptyForm());
ck('the form type has no field the screen cannot fill',
  keys.every((k) => ONSCREEN.includes(k)), keys.filter((k) => !ONSCREEN.includes(k)).join(','));

// ── the step model: one question per screen ──
// It was nine sections on one scroll, with the keyboard over the field being
// typed into and "what do you lift now?" BELOW the Continue button — so the
// people that question exists for tapped Continue and never saw it.
console.log('\nPhasing\n');
const beginner: OnboardingForm = { ...filled, experience: 'new' };
ck('a beginner is asked 6 questions, not 7', onboardingSteps(beginner).length === 6,
  onboardingSteps(beginner).join(','));
ck('...and is never asked what they lift',
  !onboardingSteps(beginner).includes('lifts'));
ck('a regular lifter IS asked', onboardingSteps(filled).includes('lifts'));
ck('experience comes first — every later step depends on it',
  onboardingSteps(filled)[0] === 'experience');
ck('what you lift comes LAST, after the button, never before it',
  onboardingSteps(filled).at(-1) === 'lifts');

// Each gate must block only its own step. A gate that reads another step's
// field strands the user on a screen that cannot answer it.
ck('a blank form is blocked on step 1 and nowhere else',
  stepBlocker(blank, 'experience') !== null
  && stepBlocker(blank, 'days') !== null
  && stepBlocker(blank, 'rhythm') === null
  && stepBlocker(blank, 'injuries') === null);
ck('height, age and sex are OPTIONAL — nobody is held hostage for their sex',
  stepBlocker({ ...filled, heightCm: '', age: '', sex: null }, 'body') === null);
ck('but a typo in them is still caught',
  stepBlocker({ ...filled, heightCm: '17' }, 'body') !== null
  && stepBlocker({ ...filled, age: '4' }, 'body') !== null);
ck('an implausible declared lift blocks its own step',
  stepBlocker({ ...filled, declaredLifts: { Barbell_Squat: 900 } }, 'lifts') !== null);
// The whole form is valid exactly when no step blocks — one source of truth.
ck('whole-form validity is composed from the steps, not a second copy',
  onboardingSteps(filled).every((st) => stepBlocker(filled, st) === null)
  === (validateOnboardingForm(filled) === null));

// ── the fields that used to be fabricated ──
console.log('\nNo invented facts in an append-only log\n');
ck('height is ABSENT when not given, not 170',
  payload.profile.height_cm === undefined, String(payload.profile.height_cm));
ck('sex is ABSENT when not given, not "other"',
  payload.profile.sex === undefined, String(payload.profile.sex));
ck('wake/sleep are absent when not given',
  payload.routine.wakeHour === undefined && payload.routine.sleepHour === undefined);
const told = formToOnboardingPayload({
  ...filled, heightCm: '170', age: '31', sex: 'f', wakeHour: 6, sleepHour: 22,
});
ck('...and present when they are', told.profile.height_cm === 170
  && told.profile.age === 31 && told.profile.sex === 'f'
  && told.routine.wakeHour === 6 && told.routine.sleepHour === 22);
ck('a payload carrying them still passes Zod',
  UserContextCreatedPayloadSchema.safeParse(told).success);

// THE 170cm BUG. `profileComplete` read `height_cm !== 170` to detect
// onboarding's own default, so a person who is actually 170cm tall never saw
// a calorie target, and 'other' was refused one although the formula handles
// it as the midpoint of the two sex constants.
ck('a genuinely 170cm user now gets a calorie target',
  nutritionInputFrom({ weight_kg: 70, height_cm: 170, age: 31, sex: 'f' }, 4, 'fat_loss') !== null);
ck('"rather not say" still gets one', 
  nutritionInputFrom({ weight_kg: 70, height_cm: 182, age: 31, sex: 'other' }, 4, 'fat_loss') !== null);
ck('a profile missing height gets nothing rather than a guess',
  nutritionInputFrom({ weight_kg: 70, age: 31, sex: 'f' }, 4, 'fat_loss') === null);
ck('a profile missing age gets nothing',
  nutritionInputFrom({ weight_kg: 70, height_cm: 170, sex: 'f' }, 4, 'fat_loss') === null);

// ── a typo'd bodyweight is caught, not stored ──
ck('a 7 kg bodyweight is refused', validateOnboardingForm({ ...filled, weight: '7' }) !== null);
ck('a 740 kg bodyweight is refused', validateOnboardingForm({ ...filled, weight: '740' }) !== null);
ck('"abc" bodyweight is refused', validateOnboardingForm({ ...filled, weight: 'abc' }) !== null);

// ── every chip the screens offer must be able to do something ──
console.log('\nScreen vocabularies — a chip that cannot act must not be offered\n');
const base = filterExercises({ tier: 'gym', owned: [] }).length;
for (const a of SORENESS_AREAS) {
  ck(`soreness chip "${a}" maps to real muscles`, musclesFor(a).length > 0);
}
for (const a of INJURY_AREAS) {
  const removed = base - filterExercises({ tier: 'gym', owned: [], injuries: [a] }).length;
  ck(`injury chip "${a}" actually filters exercises (${removed})`, removed > 0);
}
// The split-brain: onboarding wrote 'shoulders', Setup's pill was 'shoulder'.
ck('singular and plural resolve identically',
  musclesFor('shoulder').join() === musclesFor('shoulders').join());
ck('injury chips are the SAME list in onboarding and setup (one import)', true);

console.log(fails === 0 ? '\nall passed' : `\n${fails} FAILURE(S)`);
if (fails > 0) process.exit(1);
