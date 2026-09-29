import { EXERCISES, getExercise, findSubstitutesTiered, loadsInjury } from '../src/data/exercises';
let f=0; const ck=(n:string,c:boolean,d='')=>{c?console.log(`  ok   ${n}`):(console.log(`  FAIL ${n} ${d}`),f++)};

console.log('\nCoverage');
ck('every exercise has a pattern', EXERCISES.every(e=>e.pat), String(EXERCISES.filter(e=>!e.pat).length));
ck('none fell through to "other"', !EXERCISES.some(e=>(e.pat as string)==='other'));
ck('19 distinct patterns', new Set(EXERCISES.map(e=>e.pat)).size===19, String(new Set(EXERCISES.map(e=>e.pat)).size));

console.log('\nEvery pattern slot a day type needs can actually be filled');
const SLOTS=['horizontal_push','vertical_push','horizontal_pull','vertical_pull','squat','hinge','lunge','core','bicep','tricep','calf','knee_isolation','hip_isolation','chest_isolation','shoulder_isolation'];
for(const s of SLOTS){
 const gym=EXERCISES.filter(e=>e.pat===s).length;
 const home=EXERCISES.filter(e=>e.pat===s&&e.eq==='body only').length;
 ck(`${s.padEnd(19)} gym ${String(gym).padStart(3)} · bodyweight ${home}`, gym>0);
}
const bare=SLOTS.filter(s=>!EXERCISES.some(e=>e.pat===s&&e.eq==='body only'));
console.log('  no bodyweight option:', bare.join(', ')||'none');

console.log('\nTier 1 — equipment swap keeps the movement');
const t=findSubstitutesTiered('bench-press',{tier:'gym',limit:6,reason:'equipment'});
ck('best option is same pattern', t[0]?.tier===1, `tier ${t[0]?.tier} ${t[0]?.exercise.name}`);
ck('and says weights carry over', (t[0]?.note??'').includes('carry over'));
console.log('  →', t.slice(0,3).map(x=>`${x.exercise.name} (T${x.tier})`).join(' · '));

console.log('\nPain inverts it — a sore shoulder must NOT get another press');
const bench=getExercise('bench-press')!;
const pain=findSubstitutesTiered('bench-press',{tier:'gym',injuries:['shoulders'],limit:6,reason:'pain'});
ck('nothing offered loads the shoulder', pain.every(x=>!loadsInjury(x.exercise,['shoulders'])),
  pain.filter(x=>loadsInjury(x.exercise,['shoulders'])).map(x=>x.exercise.name).join(', '));
ck('and it steers away from the same pattern', pain[0]?.exercise.pat!==bench.pat,
  `${pain[0]?.exercise.name} is ${pain[0]?.exercise.pat}`);
console.log('  →', pain.slice(0,3).map(x=>`${x.exercise.name} (T${x.tier})`).join(' · '));

console.log('\nTiers are honest about what changed');
const all=findSubstitutesTiered('barbell-squat',{tier:'gym',limit:8});
ck('tier 1 promises continuity', all.filter(x=>x.tier===1).every(x=>x.note.includes('carry over')));
ck('tier 3 warns to start lighter', all.filter(x=>x.tier===3).every(x=>x.note.includes('lighter')));
ck('results are ordered best-first', all.every((x,i)=>i===0||all[i-1]!.tier<=x.tier),
  all.map(x=>x.tier).join(''));

console.log(f===0?'\nALL PASS\n':`\n${f} FAILURE(S)\n`);
process.exit(f===0?0:1);
