import { buildDigest } from '../src/dev/digest';
import { buildSessionsProjection } from '../src/projections/sessions';
import { buildUserContextProjection } from '../src/projections/userContext';
import { buildGoalProjection } from '../src/projections/goal';
import { selectContextCompleteness } from '../src/context/completeness';
import { formToOnboardingPayload, emptyOnboardingForm } from '../src/onboarding/form';

/**
 * THE ONE ARTEFACT THAT COMES BACK.
 *
 * Six testers run this build unattended for weeks. There is no telemetry, no
 * crash reporting, no notifications and no way to contact anyone who stops
 * opening the app. The digest is the entire feedback channel, and a field
 * missing from it is a question that can never be answered afterwards — the
 * log is on their phone and uninstalling is total, silent loss.
 *
 * So this check reads the digest the way a person reading the report would,
 * and fails when something the log knows is not in it. Four fields were
 * missing when this was written: the goal, the `why`, the check-in notes, and
 * how far an abandoned session got.
 */
let f = 0;
const ck = (n: string, c: boolean, d = '') => {
  if (c) console.log(`  ok   ${n}`); else { console.log(`  FAIL ${n} ${d}`); f++; }
};

let q = 0;
const ev = (t: string, day: string, p: unknown, v = 1) => ({
  id: `e${q}`, seq: q++, type: t, occurredAt: `${day}T10:00:00.000Z`,
  trainingDay: day, schemaVersion: v, prevHash: 'x', payload: p,
}) as never;

// ── a realistic tester ──
// Onboarding goes through the real payload builder, so a field the form can
// produce but the digest cannot print is a failure, not an omission in a
// hand-written fixture.
const onboarding = formToOnboardingPayload({
  ...emptyOnboardingForm(),
  weight: '81', heightCm: '178', age: '34', sex: 'm',
  wakeHour: 6, sleepHour: 23, workoutTime: 'morning',
  equipment: 'gym', experience: 'regular', daysPerWeek: 4,
  injuries: ['shoulders'],
  declaredLifts: { Barbell_Squat: 120 },
});

const SLOTS = [
  { exerciseId: 'Barbell_Squat', name: 'Barbell Squat', sets: 3, targetReps: 8, targetRpe: 9 },
  { exerciseId: 'Barbell_Bench_Press_-_Medium_Grip', name: 'Barbell Bench Press', sets: 3, targetReps: 8, targetRpe: 9 },
  { exerciseId: 'Pullups', name: 'Pullups', sets: 3, targetReps: 8, targetRpe: 9 },
];

const events = [
  ev('UserContextCreated', '2026-09-28', onboarding),
  ev('GoalCreated', '2026-09-28', {
    goalId: 'g1', goalType: 'hypertrophy',
    why: 'I want to stop feeling weak picking up my kid',
    targetDate: '2027-03-01',
  }),

  // 1. a full, reviewed session with a swap
  ev('PreCheckinRecorded', '2026-09-29', {
    sessionId: 'S1', trainingDay: '2026-09-29', energy: 6,
    soreness: [{ muscle: 'chest', level: 2 }],
    notes: 'shoulder still grumbling from Friday',
  }),
  ev('SessionScheduled', '2026-09-29', {
    sessionId: 'S1', trainingDay: '2026-09-29', planId: null, workoutId: 'UL:UPPER',
    workoutName: 'Upper', exercises: SLOTS, openingNote: 'Upper.',
    generationMode: 'engine', restSec: 105,
    reasons: ['4 days suits an upper/lower split.'],
  }),
  ev('SessionStarted', '2026-09-29', { sessionId: 'S1', startedAt: '2026-09-29T10:05:00.000Z' }),
  ev('ExerciseSubstituted', '2026-09-29', {
    sessionId: 'S1', originalExerciseId: 'Pullups',
    substituteExerciseId: 'Wide-Grip_Lat_Pulldown', substituteName: 'Wide-Grip Lat Pulldown',
    reason: 'equipment_unavailable', proposedBy: 'user',
  }),
  ev('SetCompleted', '2026-09-29', { sessionId: 'S1', exerciseId: 'Barbell_Squat', setIndex: 0, weight_kg: 100, reps: 8, rpe: 8 }),
  ev('SetCompleted', '2026-09-29', { sessionId: 'S1', exerciseId: 'Barbell_Squat', setIndex: 1, weight_kg: 100, reps: 7, rpe: 9 }),
  ev('SessionCompleted', '2026-09-29', {
    sessionId: 'S1', completedAt: '2026-09-29T11:00:00.000Z',
    completedExercises: 1, totalExercises: 3,
    review: { verdict: 'too_much', gripes: ['too_long'], note: 'ran out of time at 50 minutes' },
  }),

  // 2. a skip, with the tester's own words
  ev('SessionScheduled', '2026-10-01', {
    sessionId: 'S2', trainingDay: '2026-10-01', planId: null, workoutId: 'UL:LOWER',
    workoutName: 'Lower', exercises: SLOTS, openingNote: '', generationMode: 'engine',
  }),
  ev('SessionSkipped', '2026-10-01', {
    sessionId: 'S2', trainingDay: '2026-10-01', reason: 'time',
    notes: 'work ran over, gym shut by the time I got there',
  }),

  // 3. WALKED OUT MID-SESSION — the most informative row in the file
  ev('PreCheckinRecorded', '2026-10-03', {
    sessionId: 'S3', trainingDay: '2026-10-03', energy: 2, soreness: [],
  }),
  ev('SessionScheduled', '2026-10-03', {
    sessionId: 'S3', trainingDay: '2026-10-03', planId: null, workoutId: 'UL:UPPER',
    workoutName: 'Upper', exercises: SLOTS, openingNote: '', generationMode: 'engine',
  }),
  ev('SessionStarted', '2026-10-03', { sessionId: 'S3', startedAt: '2026-10-03T10:00:00.000Z' }),
  ev('SetCompleted', '2026-10-03', { sessionId: 'S3', exerciseId: 'Barbell_Squat', setIndex: 0, weight_kg: 90, reps: 8 }),
];

const sessions = buildSessionsProjection(events);
const profile = buildUserContextProjection(events);
const goal = buildGoalProjection(events);
const ctx = selectContextCompleteness(sessions, '2026-10-18');
const d = buildDigest(sessions, ctx, profile, 'test-build', [], goal);
const has = (sub: string) => d.includes(sub);

console.log('\nWho is this person');
ck('experience', has('regular'));
ck('days per week', has('4'));
ck('where they train', has('gym'));
ck('bodyweight', has('81'));
// Asked at onboarding and then absent from the report. A verdict of "too
// much" means nothing without knowing it came from a 34-year-old who lifts.
ck('age / height / sex', has('34') && has('178') && has('m'), 'age/height/sex line');
ck('their day', has('up 6') && has('bed 23'), 'wake/sleep');
ck('injuries', has('shoulders'));
// A declared 120kg squat is the difference between our formula and their body.
ck('declared lifts, by name not id', has('120kg') && has('Barbell Squat'));

console.log('\nThe goal — principle #3, and it was missing entirely');
ck('goal type', has('hypertrophy'));
// Every verdict has to be read against this: "too much" from someone cutting
// is a different finding from the same word out of someone adding size.
ck('the why, in their words', has('stop feeling weak picking up my kid'));
ck('the target date', has('2027-03-01'));

console.log('\nWhat happened, session by session');
ck('the tally', has('1 done') && has('1 skipped') && has('1 started-not-finished'));
ck('prescribed vs logged', has('prescribed 3 exercises / 9 sets'), 'prescribed line');
ck('the actual sets', has('100×8@8') && has('100×7@9'));
ck('an exercise with nothing logged says so', has('nothing logged'));

console.log('\nThe three things only a tester can tell you');
ck('the verdict', has('VERDICT: too_much'));
ck('the gripe', has('too_long'));
ck('the review note', has('ran out of time at 50 minutes'));
ck('the verdict tally up top', has('VERDICTS'));
// PreCheckinRecorded has carried `notes` since 7a and the digest never
// printed it — a tester typing this had it vanish from the only artefact
// that comes back.
ck('CHECK-IN notes', has('shoulder still grumbling from Friday'));
ck('skip reason AND their words',
  has('reason: time') && has('work ran over'));

console.log('\nThe energy figure is a word, not a bare number');
// It is one of three buttons now (rough 2 / ok 6 / good 9). A bare "2" in a
// report read months later is the same unexplained number the screen showed.
ck('rough is labelled', has('feel rough (2)'), 'feel line');
ck('ok is labelled', has('feel ok (6)'));
ck('soreness carries its level', has('chest2'));

console.log('\nWhere they stopped');
// A session left `active` is someone walking out mid-workout, and it was
// reported as "[active]" with no indication of how far they got.
ck('an abandoned session reports its progress',
  has('stopped after 1/3 exercises'), 'progress line');
ck('...and what they were about to do', has('next would have been'));

console.log('\nSwaps read as English');
ck('both sides by name', has('Pullups → Wide-Grip Lat Pulldown'),
  'swap line');
ck('no raw library ids anywhere in the report',
  !/[A-Z][a-z]+_[A-Za-z_-]{4,}/.test(d),
  (d.match(/[A-Z][a-z]+_[A-Za-z_-]{4,}/g) ?? []).slice(0, 3).join(', '));

console.log('\nIt tells the tester what they are sending');
// The file's own comment used to claim it "keeps behaviour and drops prose",
// which was never true — and is further from true now. The honest version is
// to say so, above the content, where the share sheet shows it.
ck('names the free text it contains',
  has('typed into a check-in, a skip or a review'));
ck('and says to read it first', /[Rr]ead it before sending/.test(d));

console.log('\nIt survives the empty and the broken');
const empty = buildDigest(
  buildSessionsProjection([]),
  selectContextCompleteness(buildSessionsProjection([]), '2026-10-18'),
  buildUserContextProjection([]), 'test-build', [], null,
);
ck('a fresh install produces a readable file', empty.includes('no sessions logged yet'));
ck('...with no undefined or NaN in it', !/undefined|NaN/.test(empty), empty.slice(0, 200));
ck('a missing goal says "not set", not blank', empty.includes('not set'));
const broken = buildDigest(sessions, ctx, profile, 'test-build',
  [{ seq: 7, type: 'SetCompleted', reason: 'schema' }], goal);
// A report built on an incomplete replay must say so, or the numbers below it
// are read as fact.
ck('an unreadable row is flagged ABOVE the data it corrupts',
  broken.indexOf('UNREADABLE') < broken.indexOf('SESSIONS'),
  `${broken.indexOf('UNREADABLE')} vs ${broken.indexOf('SESSIONS')}`);

console.log('\nIt fits in a message');
// Android's share sheet silently truncates; four weeks of raw JSON is ~100KB.
const perSession = d.length / 3;
const fourWeeks = Math.round(perSession * 16);
console.log(`  ${d.length} bytes for 3 sessions → ~${fourWeeks} bytes for a 4-week test`);
ck('a 4-week test stays under 20KB', fourWeeks < 20_000, String(fourWeeks));

console.log(f === 0 ? '\nALL PASS\n' : `\n${f} FAILURE(S)\n`);
process.exit(f === 0 ? 0 : 1);
