import { buildSessionDraft } from '../src/session/scheduler';
import { suggestSession } from '../src/session/progression';
import type { ExerciseHistory } from '../src/projections/sessions';

/**
 * 12 weeks of doing everything right must move the weights.
 *
 * Two independent bugs made this impossible: the slot occupant wandered
 * every rotation (so nothing accumulated two sessions of history), and
 * loadStep() returned 0 for anything under 25 kg (so every lift a novice
 * starts on was frozen at the empty bar). A run where every set is logged
 * at RPE 7 is the most favourable case there is — if loads do not climb
 * here, they never will.
 */
let fails = 0;
const ck = (n: string, c: boolean, extra = '') => {
  if (c) console.log(`  ok   ${n}`); else { fails++; console.log(`  FAIL ${n} ${extra}`); }
};

const hist: ExerciseHistory = {};
const known = new Set<string>();
const startOf = new Map<string, number>();
const endOf = new Map<string, number>();
let increases = 0, estimates = 0;

for (let session = 0; session < 24; session++) {
  const d = buildSessionDraft({
    equipment: 'gym', rotationIndex: session,
    checkin: { sessionId: 's', energy: 6, soreness: [] },
    goal: 'hypertrophy', experience: 'regular', daysPerWeek: 4,
    knownExerciseIds: [...known],
  });
  const sugg = suggestSession(d.exercises, hist, { bodyweightKg: 80, experience: 'regular' });
  for (const slot of d.exercises) {
    const s = sugg[slot.exerciseId];
    if (s?.kind === 'increase') increases++;
    if (s?.kind === 'estimate' || s?.kind === 'no_history') estimates++;
    // Log it exactly as prescribed, at an easy RPE.
    const w = s?.suggestedWeight ?? 40;
    const reps = s?.suggestedReps ?? slot.targetReps ?? 8;
    if (!startOf.has(slot.exerciseId)) startOf.set(slot.exerciseId, w);
    endOf.set(slot.exerciseId, w);
    known.add(slot.exerciseId);
    const prev = hist[slot.exerciseId] ?? [];
    hist[slot.exerciseId] = [
      { exerciseId: slot.exerciseId, trainingDay: `2026-01-${String((session % 28) + 1).padStart(2, '0')}`, weight_kg: w, reps, minReps: reps, avgRpe: 7, maxRpe: 7, setsLogged: slot.sets },
      ...prev,
    ].slice(0, 5);
  }
}

const frozen = [...startOf.entries()].filter(([id, start]) => (endOf.get(id) ?? 0) <= start);
const moved = [...startOf.entries()].filter(([id, start]) => (endOf.get(id) ?? 0) > start);

console.log('\n12 weeks, every set logged at RPE 7\n');
console.log(`  exercises seen     : ${startOf.size}`);
console.log(`  loads that moved   : ${moved.length}`);
console.log(`  loads still frozen : ${frozen.length}`);
console.log(`  "add weight" calls : ${increases}`);
console.log(`  "first time" calls : ${estimates}`);
if (frozen.length) console.log(`\n  frozen: ${frozen.map(([id, w]) => `${id}@${w}kg`).join(', ')}`);

// UPPER_LOWER_4 alternates, so a 24-session run legitimately covers two day
// types: 6 upper + 6 lower = 12. Before the stability fix this was 25.
ck('the programme settles on ~12 exercises (6 per day type), not 25',
  startOf.size <= 14, `${startOf.size}`);
ck('no loaded lift is frozen for 12 weeks', frozen.length === 0, `${frozen.length} frozen`);
// Double progression climbs reps to the top of the range, then takes one
// load step and resets — so load increases are intentionally a minority of
// calls. What matters is that every lift moved and none froze.
ck('load increases happen regularly', increases >= 20, `${increases}`);
ck('EVERY loaded lift gained weight over 12 weeks',
  moved.length === startOf.size, `${moved.length} of ${startOf.size} moved`);
// Exactly one "first time" per exercise, never a repeat — a repeat means the
// slot wandered and the history was orphaned.
ck('each exercise is "first time" exactly once, never again',
  estimates === startOf.size, `${estimates} first-times for ${startOf.size} exercises`);
for (const [id, start] of moved.slice(0, 4)) {
  console.log(`       ${id}: ${start}kg -> ${endOf.get(id)}kg`);
}
// Every suggested weight must be loadable on a real bar.
const bad = [...endOf.values()].filter((w) => w > 0 && Math.abs(w / 1.25 - Math.round(w / 1.25)) > 1e-9);
ck('every suggested weight is loadable (multiple of 1.25kg)', bad.length === 0, bad.join(','));

console.log(fails === 0 ? '\nall passed' : `\n${fails} FAILURE(S)`);
if (fails > 0) process.exit(1);
