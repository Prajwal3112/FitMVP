import { canonicalExerciseId as CID } from '../src/data/exercises';
import { suggestLoad, loadStep } from '../src/session/progression';
import type { ExerciseHistory } from '../src/projections/sessions';

let fails = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { console.log(`  FAIL ${name} ${detail}`); fails++; }
};
const BENCH = { exerciseId: 'bench-press', name: 'Bench Press', sets: 3, targetReps: 8 };
const PUSHUP = { exerciseId: 'push-ups', name: 'Push-Ups', sets: 3, targetReps: 12 };
const perf = (o: Partial<ExerciseHistory[string][number]> = {}) => ({
  trainingDay: '2026-09-20', weight_kg: 100, reps: 8, minReps: 8, setsLogged: 3, ...o,
} as ExerciseHistory[string][number]);

console.log('\nRule 1 — no history');
const s1 = suggestLoad(BENCH, {});
check('kind is no_history', s1.kind === 'no_history', s1.kind);
check('tells you how to pick a weight', s1.reason.includes('2–3 reps'), s1.reason);
check('does not invent a number', s1.suggestedWeight === undefined);

console.log('\nRule 2 — missed reps beats everything');
const s2 = suggestLoad(BENCH, { [CID('bench-press')]: [
  perf({ minReps: 6, avgRpe: 6 }), perf({ avgRpe: 6 }),
]});
check('holds despite two easy sessions', s2.kind === 'hold', s2.kind);
check('names the actual shortfall', s2.reason.includes('6 of 8'), s2.reason);

console.log('\nRule 3 — a grind holds');
const s3 = suggestLoad(BENCH, { [CID('bench-press')]: [perf({ avgRpe: 9.5 }), perf({ avgRpe: 6 })] });
check('holds', s3.kind === 'hold', s3.kind);
check('repeats the same weight', s3.suggestedWeight === 100, String(s3.suggestedWeight));
check('says why', s3.reason.includes('grind'), s3.reason);

console.log('\nRule 4 — two easy sessions add load');
const s4 = suggestLoad(BENCH, { [CID('bench-press')]: [perf({ avgRpe: 7 }), perf({ avgRpe: 6.5 })] });
check('increases', s4.kind === 'increase', s4.kind);
check('+2.5kg on 100kg', s4.suggestedWeight === 102.5, String(s4.suggestedWeight));
check('based on 2 sessions', s4.basedOn === 2);
console.log(`  → "${s4.reason}"`);

console.log('\nRule 4 — one easy session is not enough');
const s5 = suggestLoad(BENCH, { [CID('bench-press')]: [perf({ avgRpe: 6 })] });
check('holds on a single data point', s5.kind === 'hold', s5.kind);

console.log('\nRule 4 — load must have been the same both times');
const s6 = suggestLoad(BENCH, { [CID('bench-press')]: [
  perf({ avgRpe: 6, weight_kg: 100 }), perf({ avgRpe: 6, weight_kg: 80 }),
]});
check('no jump after a load change', s6.kind === 'hold', s6.kind);

console.log('\n§8.15 — the 5%/week ceiling');
check('100kg → 2.5 step', loadStep(100) === 2.5, String(loadStep(100)));
check('50kg → 2.5 step (5% = 2.5)', loadStep(50) === 2.5, String(loadStep(50)));
// Was asserting 1.25, which is not loadable on a barbell — it needs a
// 0.625 kg plate per side. The smallest real change is a PAIR of 1.25s,
// i.e. 2.5 kg total, so at 40 kg (5% = 2.0) there is no legal step and
// double progression takes over. See REPS_OVER_TARGET_BEFORE_LOADING.
check('40kg → no legal step (5% = 2.0, under one loadable pair)', loadStep(40) === 0, String(loadStep(40)));
check('50kg+ → a loadable 2.5 step', loadStep(50) === 2.5 && loadStep(120) === 2.5,
  `${loadStep(50)} / ${loadStep(120)}`);
check('20kg → 1.0, no legal plate step', loadStep(20) === 0, String(loadStep(20)));
const s7 = suggestLoad({ ...BENCH, exerciseId: 'bicep-curl' }, { [CID('bicep-curl')]: [
  perf({ weight_kg: 15, avgRpe: 6 }), perf({ weight_kg: 15, avgRpe: 6 }),
]});
check('light lift adds reps, not an illegal 16% jump', s7.kind === 'add_reps', s7.kind);
check('suggests one more rep', s7.suggestedReps === 9, String(s7.suggestedReps));
console.log(`  → "${s7.reason}"`);

console.log('\nBodyweight — progresses by reps, never by kg');
const s8 = suggestLoad(PUSHUP, { [CID('push-ups')]: [
  perf({ weight_kg: 0, reps: 12, minReps: 12, avgRpe: 6.5 }),
  perf({ weight_kg: 0, reps: 12, minReps: 12, avgRpe: 7 }),
]});
check('adds reps', s8.kind === 'add_reps', s8.kind);
check('13 next time', s8.suggestedReps === 13, String(s8.suggestedReps));
check('never suggests a weight for bodyweight', s8.suggestedWeight === undefined);
console.log(`  → "${s8.reason}"`);

console.log('\nNo RPE logged — degrades honestly');
const s9 = suggestLoad(BENCH, { [CID('bench-press')]: [perf({}), perf({})] });
check('holds', s9.kind === 'hold', s9.kind);
check('asks for ratings rather than guessing', s9.reason.includes('Rate a set'), s9.reason);

console.log('\nEvery reason is short enough to render');
const all = [s1,s2,s3,s4,s5,s6,s7,s8,s9];
check('all reasons ≤ 100 chars', all.every(x => x.reason.length <= 100),
  String(Math.max(...all.map(x => x.reason.length))));

console.log(fails === 0 ? '\nALL PASS\n' : `\n${fails} FAILURE(S)\n`);
process.exit(fails === 0 ? 0 : 1);
