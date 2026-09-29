import { buildSessionDraft } from '../src/session/scheduler';
import { getExercise, loadsInjury } from '../src/data/exercises';
let f=0; const ck=(n:string,c:boolean,d='')=>{c?console.log(`  ok   ${n}`):(console.log(`  FAIL ${n} ${d}`),f++)};
const B={goal:'hypertrophy',experience:'regular',daysPerWeek:4,rotationIndex:0,
 checkin:{sessionId:'S',energy:7,soreness:[]}} as never;
const draft=(o:object)=>buildSessionDraft({...(B as object),...o} as never);

console.log('\nThe engine is actually wired');
const gym=draft({equipment:'gym'});
ck('a session is built from the library, not 3 templates', gym.exercises.length>=4, String(gym.exercises.length));
ck('it names the split', gym.splitName.length>0, gym.splitName);
ck('it explains itself', gym.reasons.length>0, gym.reasons.join(' | '));
ck('warm-up included', gym.warmup.mobilise.length>0);
ck('cool-down included', gym.cooldown.length>0);

console.log('\nDifferent people get different sessions');
const maya=draft({equipment:'gym',goal:'fat_loss',experience:'new',daysPerWeek:4,sessionMaxMinutes:45});
const jay=draft({equipment:'gym',goal:'hypertrophy',experience:'regular',daysPerWeek:6});
const tom=draft({equipment:'home',goal:'strength',experience:'returning',daysPerWeek:3,ownedEquipment:['barbell']});
const names=(d:typeof gym)=>d.exercises.map(e=>e.name).join('|');
ck('novice fat-loss ≠ experienced hypertrophy', names(maya)!==names(jay));
ck('gym ≠ home-with-barbell', names(jay)!==names(tom));
ck('strength gets low reps', (tom.exercises[0]?.targetReps??99)<=6, String(tom.exercises[0]?.targetReps));
ck('fat loss gets higher reps', (maya.exercises[0]?.targetReps??0)>=10, String(maya.exercises[0]?.targetReps));
ck('strength gets fewer exercises (long rests)', tom.exercises.length<jay.exercises.length,
  `${tom.exercises.length} vs ${jay.exercises.length}`);

console.log('\nOwned equipment reaches the session itself');
const bare=draft({equipment:'home',ownedEquipment:[]});
const dumb=draft({equipment:'home',ownedEquipment:['dumbbell']});
ck('nothing owned → bodyweight only', bare.exercises.every(e=>getExercise(e.exerciseId)?.eq==='body only'),
  bare.exercises.map(e=>getExercise(e.exerciseId)?.eq).join(','));
ck('dumbbells owned → dumbbells used', dumb.exercises.some(e=>getExercise(e.exerciseId)?.eq==='dumbbell'),
  dumb.exercises.map(e=>e.name).join(', '));
ck('no pull-up bar → no pull-ups prescribed at home',
  !bare.exercises.some(e=>/pull-?up|chin-?up|dip/i.test(e.name)), bare.exercises.map(e=>e.name).join(', '));

console.log('\nCanonical lifts, not obscure variants');
for(const d of [gym,jay,tom]) ck(`"${d.exercises[0]?.name}" is a staple`,
  getExercise(d.exercises[0]!.exerciseId)?.staple===true, d.exercises[0]?.name);

console.log('\n§8.7 injury locks still hold, and now explain themselves');
let unsafe=0;
for(const eq of ['home','gym'] as const)
 for(const inj of [['shoulders'],['quadriceps'],['chest'],['lower back']])
  for(let r=0;r<3;r++){
   const d=draft({equipment:eq,rotationIndex:r,injuries:inj,ownedEquipment:['dumbbell','barbell']});
   for(const s of d.exercises){const x=getExercise(s.exerciseId); if(x&&loadsInjury(x,inj))unsafe++}
  }
ck('24 combinations, zero unsafe prescriptions', unsafe===0, `${unsafe} unsafe`);
const inj=draft({equipment:'gym',injuries:['shoulders']});
ck('and it says what it left out', inj.reasons.some(r=>r.includes('shoulders')), inj.reasons.join(' | '));

console.log('\nSoreness cuts volume, never the day');
const sore=draft({equipment:'gym',checkin:{sessionId:'S',energy:7,soreness:[{muscle:'chest',level:2}]}});
ck('still the same day type', sore.dayType===gym.dayType, `${sore.dayType} vs ${gym.dayType}`);
const low=draft({equipment:'gym',checkin:{sessionId:'S',energy:2,soreness:[]}});
ck('feeling rough cuts sets', (low.exercises[0]?.sets??9)<(gym.exercises[0]?.sets??0),
  `${low.exercises[0]?.sets} vs ${gym.exercises[0]?.sets}`);

console.log('\nRotation cycles through the split');
const days=[0,1,2].map(r=>draft({equipment:'gym',daysPerWeek:6,rotationIndex:r}).workoutName);
ck('three different days in a row', new Set(days).size===3, days.join(' · '));

console.log(f===0?'\nALL PASS\n':`\n${f} FAILURE(S)\n`);
process.exit(f===0?0:1);
