import { nutritionTargets } from '../src/nutrition/targets';

/**
 * Nutrition targets must be arithmetically sound and physiologically safe.
 *
 * This is the part of the chart that sustained the founder's only six months
 * of training and that the app had none of. It is also the part where a wrong
 * number does real harm — an under-prescribed protein target costs muscle, and
 * an over-aggressive deficit costs adherence and lean mass.
 */
let fails = 0;
const ck = (n: string, c: boolean, extra = '') => {
  if (c) console.log(`  ok   ${n}`); else { fails++; console.log(`  FAIL ${n} ${extra}`); }
};

const base = { weightKg: 74, heightCm: 170, age: 30, sex: 'm' as const, daysPerWeek: 3 };

console.log('\nMifflin-St Jeor, checked by hand\n');
// 10(74) + 6.25(170) - 5(30) + 5 = 740 + 1062.5 - 150 + 5 = 1657.5
const m = nutritionTargets({ ...base, goal: 'general_fitness' });
ck(`male BMR is 1658 (hand-computed 1657.5)`, m.bmr === 1658, String(m.bmr));
// female: same minus 161 and minus the +5 => 1657.5 - 166 = 1491.5
const f = nutritionTargets({ ...base, sex: 'f', goal: 'general_fitness' });
ck(`female BMR is 1492`, f.bmr === 1492, String(f.bmr));
ck('female BMR is below male at identical stats', f.bmr < m.bmr);
const o = nutritionTargets({ ...base, sex: 'other', goal: 'general_fitness' });
ck('"other" sits between the two, not at an extreme',
  o.bmr > f.bmr && o.bmr < m.bmr, `${f.bmr} / ${o.bmr} / ${m.bmr}`);

console.log('\nThe macros add up to the calorie target\n');
for (const goal of ['fat_loss', 'hypertrophy', 'strength', 'general_fitness', 'endurance'] as const) {
  const t = nutritionTargets({ ...base, goal });
  const sum = t.protein.kcal + t.fat.kcal + t.carbs.kcal;
  ck(`${goal.padEnd(16)} ${String(t.target).padStart(4)} kcal · ${t.protein.grams}P ${t.fat.grams}F ${t.carbs.grams}C · macros sum to target`,
    Math.abs(sum - t.target) <= 4, `sum ${sum} vs target ${t.target}`);
}

console.log('\nDirection of the goal adjustment\n');
const loss = nutritionTargets({ ...base, goal: 'fat_loss' });
const gain = nutritionTargets({ ...base, goal: 'hypertrophy' });
const maint = nutritionTargets({ ...base, goal: 'general_fitness' });
ck('fat loss is below maintenance', loss.target < maint.maintenance, `${loss.target} vs ${maint.maintenance}`);
ck('muscle gain is above maintenance', gain.target > maint.maintenance);
ck('general fitness IS maintenance', maint.target === maint.maintenance);
ck('the gain surplus is modest, not a dirty bulk (<15%)',
  (gain.target - gain.maintenance) / gain.maintenance < 0.15);

console.log('\nProtein — the number people miss\n');
ck('fat loss gets MORE protein per kg than maintenance (preserves lean mass)',
  loss.protein.grams > maint.protein.grams, `${loss.protein.grams} vs ${maint.protein.grams}`);
ck('muscle gain clears 1.6 g/kg, where the benefit plateaus',
  gain.protein.grams >= base.weightKg * 1.6, `${gain.protein.grams}g for ${base.weightKg}kg`);
ck('nobody is prescribed above 2.5 g/kg (no evidence of further benefit)',
  [loss, gain, maint].every((t) => t.protein.grams <= base.weightKg * 2.5));
// The founder's own chart said 85-95g at a muscle-gain goal.
console.log(`       for reference: this gives ${gain.protein.grams}g where that chart said 85-95g`);
ck('...which is meaningfully higher than the chart', gain.protein.grams > 100);

console.log('\nSafety floors\n');
// A very light, short, older person on a deficit is where a naive formula
// produces a dangerous number.
const small = nutritionTargets({ weightKg: 45, heightCm: 150, age: 60, sex: 'f', daysPerWeek: 2, goal: 'fat_loss' });
ck('a deficit never lands below BMR', small.target >= small.bmr, `${small.target} vs BMR ${small.bmr}`);
// A BMR floor alone is not enough: this person's BMR is 927, so a 20% deficit
// lands at 1020 — above BMR, below any sane absolute minimum. Caught by this
// check before it reached anyone.
ck('a deficit never lands below the absolute floor either',
  small.target >= 1200, `${small.target} kcal for a 45kg woman`);
ck('...and the clamp is explained, not silent',
  small.notes.some((n) => /too low to do unsupervised|under what your body burns/.test(n)),
  small.notes.join(' | '));
const smallMale = nutritionTargets({ weightKg: 55, heightCm: 160, age: 55, sex: 'm', daysPerWeek: 2, goal: 'fat_loss' });
ck('the male floor is respected too', smallMale.target >= 1500, `${smallMale.target} kcal`);
ck('fat never drops below 0.8 g/kg', small.fat.grams >= Math.round(45 * 0.8) - 1, `${small.fat.grams}g`);
ck('carbs never go negative', small.carbs.grams >= 0);

console.log('\nUnknown age degrades honestly\n');
const noAge = nutritionTargets({ weightKg: 74, heightCm: 170, sex: 'm', daysPerWeek: 3, goal: 'hypertrophy' });
ck('it still computes without an age', noAge.target > 0);
ck('...and flags that it assumed one', noAge.estimatedAge === true);
ck('...and says so in words the user reads',
  noAge.notes.some((n) => /assumes 30/.test(n)), noAge.notes.join(' | '));

console.log('\nTraining frequency moves maintenance\n');
const d0 = nutritionTargets({ ...base, daysPerWeek: 0, goal: 'general_fitness' });
const d6 = nutritionTargets({ ...base, daysPerWeek: 6, goal: 'general_fitness' });
ck('more training days means a higher maintenance', d6.maintenance > d0.maintenance, `${d0.maintenance} -> ${d6.maintenance}`);
ck('the activity factor stays inside the standard 1.2-1.725 band',
  d0.maintenance / d0.bmr >= 1.19 && d6.maintenance / d6.bmr <= 1.73,
  `${(d0.maintenance / d0.bmr).toFixed(2)} .. ${(d6.maintenance / d6.bmr).toFixed(2)}`);

console.log('\nMacro split stays inside conventional bands\n');
// Fat 20-35% of calories is the usual guidance. A flat g/kg broke this at
// higher calorie targets and pushed carbohydrate to 62%.
for (const goal of ['fat_loss', 'hypertrophy', 'general_fitness'] as const) {
  for (const d of [2, 6]) {
    const t = nutritionTargets({ ...base, daysPerWeek: d, goal });
    ck(`${goal.padEnd(16)} ${d}d · fat ${String(t.fat.pct).padStart(2)}% is inside 18-35%`,
      t.fat.pct >= 18 && t.fat.pct <= 35, `${t.fat.pct}%`);
    ck(`${goal.padEnd(16)} ${d}d · carbs ${String(t.carbs.pct).padStart(2)}% is not absurd (<=60%)`,
      t.carbs.pct <= 60, `${t.carbs.pct}%`);
  }
}

console.log('\nNo outcome claims — the app cannot see you\n');
const allNotes = [loss, gain, maint, small, noAge].flatMap((t) => t.notes).join(' ');
ck('nothing predicts a result (no "you will lose/gain X")',
  !/you will (lose|gain)|guarantee|in \d+ weeks you/i.test(allNotes), allNotes.slice(0, 120));

console.log('\n  What a 74kg lifter actually sees:');
gain.notes.forEach((n) => console.log(`    · ${n}`));

console.log(fails === 0 ? '\nall passed' : `\n${fails} FAILURE(S)`);
if (fails > 0) process.exit(1);
