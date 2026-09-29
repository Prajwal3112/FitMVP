import { buildSessionDraft } from '../src/session/scheduler';

/**
 * The slot occupant must not wander between sessions.
 *
 * `suggestLoad` needs two sessions on the SAME exerciseId at the same load
 * before it will add weight. When the scheduler reshuffled every rotation,
 * progression was structurally unreachable, the prefill was empty, and the
 * "last: 102.5 × 8 @ 8" line read "last: —" on half the cards forever.
 */
let fails = 0;
const ck = (n: string, c: boolean, extra = '') => {
  if (c) console.log(`  ok   ${n}`); else { fails++; console.log(`  FAIL ${n} ${extra}`); }
};

const draft = (rot: number, known: string[] = [], d = 4) => buildSessionDraft({
  equipment: 'gym', rotationIndex: rot, checkin: { sessionId: 'x', energy: 6, soreness: [] },
  goal: 'hypertrophy', experience: 'regular', daysPerWeek: d, knownExerciseIds: known,
});

console.log('\nExercise stability across rotations\n');

// Same day type recurring through the split must give the same exercises.
for (const [label, days, step] of [['UPPER_LOWER_4', 4, 2], ['FULL_BODY_3', 3, 1]] as const) {
  const first = draft(0, [], days).exercises.map((e) => e.exerciseId).join('|');
  let stable = true; const seen: string[] = [];
  for (let r = 0; r < 6 * step; r += step) {
    const ids = draft(r, [], days).exercises.map((e) => e.exerciseId).join('|');
    seen.push(ids);
    if (ids !== first) stable = false;
  }
  ck(`${label}: the same day type gives the same exercises every cycle`, stable,
    stable ? '' : `\n       ${[...new Set(seen)].length} distinct sets across 6 visits`);
}

// Total distinct ids over a 12-week block, same day type.
const ids = new Set<string>();
for (let r = 0; r < 24; r += 2) for (const e of draft(r, [], 4).exercises) ids.add(e.exerciseId);
ck(`12 weeks of UPPER produces 6 distinct exercises, not 13+ (got ${ids.size})`, ids.size <= 7, `${ids.size}`);

// Having history on an exercise must not push it out of its slot.
const base = draft(0).exercises.map((e) => e.exerciseId);
const withHistory = draft(0, base).exercises.map((e) => e.exerciseId);
ck('logged history keeps an exercise in its slot, never displaces it',
  base.join('|') === withHistory.join('|'), `\n       ${base.join(',')}\n       ${withHistory.join(',')}`);

// A different person still gets a different programme — stability must not
// collapse into "everyone gets the same thing".
const a = buildSessionDraft({ equipment: 'home', rotationIndex: 0, checkin: { sessionId: 'x', energy: 6, soreness: [] },
  goal: 'fat_loss', experience: 'new', daysPerWeek: 2, ownedEquipment: ['dumbbell'] }).exercises.map((e) => e.name).join('|');
const b = draft(0).exercises.map((e) => e.name).join('|');
ck('two different people still get different sessions', a !== b);

console.log(fails === 0 ? '\nall passed' : `\n${fails} FAILURE(S)`);
if (fails > 0) process.exit(1);
