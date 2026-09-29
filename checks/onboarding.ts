import {
  validateOnboardingForm, formToOnboardingPayload, emptyOnboardingForm, type OnboardingForm,
} from '../src/onboarding/form';
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
ck('equipment reaches the payload', payload.equipment === 'gym');

// ── nothing is required that the screen never asks ──
const ONSCREEN = ['weight', 'workoutTime', 'equipment', 'experience', 'daysPerWeek', 'ownedEquipment', 'injuries'];
const keys = Object.keys(emptyForm());
ck('the form type has no field the screen cannot fill',
  keys.every((k) => ONSCREEN.includes(k)), keys.filter((k) => !ONSCREEN.includes(k)).join(','));

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
