import { selectSplit, SPLITS, goalFeasibility, progressionMode, tierOf } from '../src/program/splits';
import { getParameters, exerciseCount, progressionStyle, successFraming } from '../src/program/parameters';
import { resolveSession, DAY_MUSCLES } from '../src/program/resolve';
import { buildSessionsProjection, selectRotationIndex, selectSessionIndex } from '../src/projections/sessions';

let f=0; const ck=(n:string,c:boolean,d='')=>{c?console.log(`  ok   ${n}`):(console.log(`  FAIL ${n} ${d}`),f++)};
const sp=(d:number,e:never,g:never='hypertrophy' as never,q:never='gym' as never)=>selectSplit(d,e,g,q).splitId;

console.log('\nSplit matrix');
const rows:[number,string,string,string][]=[
 [2,'FULL_BODY_2','FULL_BODY_2','UPPER_LOWER_2'],
 [3,'FULL_BODY_3','FULL_BODY_3','PPL_3'],
 [4,'UPPER_LOWER_4','UPPER_LOWER_4','UPPER_LOWER_4'],
 [5,'UPPER_LOWER_5','UPPER_LOWER_5','PPL_UL_5'],
 [6,'FULL_BODY_3','PPL_6','PPL_6']];
for(const [d,nov,int,adv] of rows){
 const a=sp(d,'new' as never), b=sp(d,'regular' as never), c=sp(d,'experienced' as never);
 ck(`${d} days → ${nov} / ${int} / ${adv}`, a===nov&&b===int&&c===adv, `got ${a}/${b}/${c}`);
}

console.log('\nFrequency on the MAJOR movers (abs and lower back are accessories)');
const MAJOR=['chest','shoulders','lats','quadriceps','hamstrings','glutes'];
const freq=(id:keyof typeof SPLITS)=>{const h=new Map<string,number>();
 SPLITS[id].sequence.forEach(d=>DAY_MUSCLES[d].forEach(m=>h.set(m,(h.get(m)??0)+1)));
 return Math.min(...MAJOR.map(m=>h.get(m)??0))};
for(const id of Object.keys(SPLITS) as (keyof typeof SPLITS)[]){
 const n=SPLITS[id].sequence.length, w=freq(id);
 // 2-day splits and PPL_3 cannot reach 2x — that IS the tradeoff, and it
 // is why each is restricted to advanced lifters who accept it.
 const floor=(n<=2||id==='PPL_3')?1:2;
 ck(`${id.padEnd(14)} (${n}d) major movers ${w}x`, w>=floor, `got ${w}, wanted >=${floor}`);
}
ck('PPL_3 really is 1x/week — the documented reason it is advanced-only', freq('PPL_3')===1);
ck('FULL_BODY_3 gets 3x on the same three days', freq('FULL_BODY_3')===3, String(freq('FULL_BODY_3')));
ck('so at 3 days, full body beats PPL on frequency 3:1', freq('FULL_BODY_3')>freq('PPL_3'));

console.log('\nThe 3-day departure from gym convention');
ck('3 days + novice is NOT PPL (that would be 1x/week)', sp(3,'new' as never)!=='PPL_3', sp(3,'new' as never));
ck('3 days + regular is NOT PPL either', sp(3,'regular' as never)!=='PPL_3');
ck('only the advanced lifter gets PPL at 3 days', sp(3,'experienced' as never)==='PPL_3');

console.log('\nHonesty, not silent degradation');
const n6=selectSplit(6,'new' as never,'hypertrophy' as never,'gym' as never);
ck('novice asking for 6 days is given 3', n6.splitId==='FULL_BODY_3');
ck('...and told why', (n6.warning??'').includes('three sessions'), n6.warning??'');
const h2=selectSplit(2,'regular' as never,'hypertrophy' as never,'gym' as never);
ck('2 days + build muscle warns about the ceiling', (h2.warning??'').includes('slowly'), h2.warning??'');
const bw=goalFeasibility('strength' as never,'home' as never,['body only'],4);
ck('bodyweight + get stronger is flagged undeliverable', bw.achievable===false);
ck('...with a real suggestion', (bw.reason??'').includes('backpack'), bw.reason??'');
ck('bands only → progress by reps, not load', progressionMode('home' as never,['bands'])==='reps');
ck('dumbbells at home → load progression', progressionMode('home' as never,['dumbbell'])==='load');

console.log('\nParameters by goal');
const P=(g:string)=>getParameters(g as never,'regular' as never);
ck('strength: low reps, long rest', P('strength').repHigh<=6 && P('strength').restSec>=180);
ck('hypertrophy: 6-12, ~90-120s', P('hypertrophy').repHigh===12 && P('hypertrophy').restSec>=90);
ck('fat loss capped at RPE 8 (recovery is compromised in a deficit)', P('fat_loss').maxRpe===8);
ck('weekly sets land in the 10-20 dose-response band',
  [P('hypertrophy'),P('strength'),P('fat_loss')].every(p=>p.weeklySetsPerMuscle>=10&&p.weeklySetsPerMuscle<=20));
const nov=getParameters('hypertrophy' as never,'new' as never);
ck('novices get less volume and a lower ceiling', nov.weeklySetsPerMuscle<P('hypertrophy').weeklySetsPerMuscle && nov.maxRpe<=8);

console.log('\nSession length → exercise count');
ck('45 min, build muscle → 5 exercises', exerciseCount(P('hypertrophy'),45)===5, String(exerciseCount(P('hypertrophy'),45)));
ck('20 min still floors at 3', exerciseCount(P('hypertrophy'),20)===3);
ck('90 min caps at 8', exerciseCount(P('hypertrophy'),90)===8);

console.log('\nProgression differs by goal');
ck('strength → load', progressionStyle('strength' as never)==='load');
ck('hypertrophy → double', progressionStyle('hypertrophy' as never)==='double');
ck('fat loss → density, NOT load', progressionStyle('fat_loss' as never)==='density');
ck('fat-loss success is framed as holding weight', successFraming('fat_loss' as never).includes('Holding'));

console.log('\n⚠ Rotation advances on COMPLETION, never the calendar');
let q=0; const ev=(t:string,d:string,p:unknown)=>({id:`e${q}`,seq:q++,type:t,occurredAt:'2026-09-01T10:00:00Z',trainingDay:d,schemaVersion:1,prevHash:'x',payload:p}) as never;
const SL=[{exerciseId:'bench-press',name:'B',sets:1,targetReps:8}];
const sess=(id:string,d:string,done:boolean)=>[
 ev('SessionScheduled',d,{sessionId:id,trainingDay:d,planId:null,workoutId:'g',workoutName:'W',exercises:SL,openingNote:'',generationMode:'template_fallback'}),
 ...(done?[ev('SetCompleted',d,{sessionId:id,exerciseId:'bench-press',setIndex:0,weight_kg:60,reps:8}),
   ev('SessionCompleted',d,{sessionId:id,completedAt:'T',completedExercises:1,totalExercises:1})]
  :[ev('SessionSkipped',d,{sessionId:id,trainingDay:d,reason:'time'})])];
const proj=buildSessionsProjection([...sess('A','2026-09-01',true),...sess('B','2026-09-02',false),
 ...sess('C','2026-09-03',false),...sess('D','2026-09-04',true)]);
ck('2 completed + 2 skipped → rotation index 2', selectRotationIndex(proj)===2, String(selectRotationIndex(proj)));
ck('...while the day counter still counts all 4', selectSessionIndex(proj)===4, String(selectSessionIndex(proj)));

console.log('\nResolver precedence');
const base={splitId:'PPL_6' as const,completedCount:0,gapDays:1,hoursSinceDayType:{},daysSinceDayType:{},soreness:[],feel:'ok' as const,totalSessions:20};
ck('nothing sore, feeling fine → the rotation decides, full stop',
  resolveSession(base).dayType==='PUSH' && resolveSession(base).globalVolume===1);
ck('rotation index 2 → leg day', resolveSession({...base,completedCount:2}).dayType==='LEGS');
const sore=resolveSession({...base,soreness:[{muscle:'chest',level:3}] as never});
ck('sore chest on push day does NOT become leg day', sore.dayType==='PUSH', sore.dayType);
ck('...it cuts that muscle to zero instead', sore.muscleVolume['chest']===0);
ck('mild soreness changes nothing', resolveSession({...base,soreness:[{muscle:'chest',level:1}] as never}).muscleVolume['chest']===1);
const rough=resolveSession({...base,feel:'rough'});
ck('rough day cuts volume and caps effort', rough.globalVolume<1 && rough.maxRpe===7);
ck('good day does NOT add volume', resolveSession({...base,feel:'good'}).globalVolume===1);
ck('...it raises the ceiling instead', resolveSession({...base,feel:'good'}).maxRpe===9);
const long=resolveSession({...base,gapDays:30});
ck('30-day gap → full body, half volume', long.dayType==='FB' && long.globalVolume===0.5);
ck('14-day gap → lighter loads, same day', resolveSession({...base,gapDays:14}).loadScale===0.9);
const allSore=resolveSession({...base,soreness:[{muscle:'chest',level:3},{muscle:'shoulders',level:3},{muscle:'triceps',level:3}] as never});
ck('sore everywhere → a real recovery session', allSore.dayType==='RECOVERY');
const newbie=resolveSession({...base,totalSessions:3,soreness:[{muscle:'chest',level:3},{muscle:'shoulders',level:3},{muscle:'triceps',level:3}] as never});
ck('...but not for a novice — being sore all over is just week one', newbie.dayType!=='RECOVERY', newbie.dayType);
const drift=resolveSession({...base,daysSinceDayType:{LEGS:18}});
ck('a starved muscle group forces its way back in', drift.dayType==='LEGS' && drift.globalVolume===0.5);
const gate=resolveSession({...base,hoursSinceDayType:{PUSH:12}});
ck('36h recovery gate moves you on a day', gate.dayType!=='PUSH', gate.dayType);

console.log(f===0?'\nALL PASS\n':`\n${f} FAILURE(S)\n`);
process.exit(f===0?0:1);
