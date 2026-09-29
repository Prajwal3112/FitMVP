import { buildSessionsProjection, selectWeekdayStats, selectScheduleAdvice } from '../src/projections/sessions';
let f=0; const ck=(n:string,c:boolean,d='')=>{c?console.log(`  ok   ${n}`):(console.log(`  FAIL ${n} ${d}`),f++)};
let q=0; const ev=(t:string,d:string,p:unknown)=>({id:`e${q}`,seq:q++,type:t,occurredAt:'2026-09-01T10:00:00Z',trainingDay:d,schemaVersion:1,prevHash:'x',payload:p}) as never;
const SL=[{exerciseId:'bench-press',name:'B',sets:1,targetReps:8}];
const sess=(id:string,d:string,done:boolean)=>[
 ev('SessionScheduled',d,{sessionId:id,trainingDay:d,planId:null,workoutId:'g',workoutName:'W',exercises:SL,openingNote:'',generationMode:'template_fallback'}),
 ...(done?[ev('SetCompleted',d,{sessionId:id,exerciseId:'bench-press',setIndex:0,weight_kg:60,reps:8}),
  ev('SessionCompleted',d,{sessionId:id,completedAt:'T',completedExercises:1,totalExercises:1})]
 :[ev('SessionSkipped',d,{sessionId:id,trainingDay:d,reason:'time'})])];

// Mondays and Wednesdays done, Fridays missed — four weeks running.
const MON=['2026-09-07','2026-09-14','2026-09-21','2026-09-28'];
const WED=['2026-09-09','2026-09-16','2026-09-23','2026-09-30'];
const FRI=['2026-09-04','2026-09-11','2026-09-18','2026-09-25'];
const log=[...MON.flatMap((d,i)=>sess('m'+i,d,true)),
           ...WED.flatMap((d,i)=>sess('w'+i,d,true)),
           ...FRI.flatMap((d,i)=>sess('f'+i,d,false))];
const p=buildSessionsProjection(log);
const stats=selectWeekdayStats(p);
const by=(n:string)=>stats.find(s=>s.name===n)!;

console.log('\nWeekday stats');
ck('Monday 4/4', by('Monday').completed===4 && by('Monday').rate===1, JSON.stringify(by('Monday')));
ck('Wednesday 4/4', by('Wednesday').completed===4);
ck('Friday 0/4 — all skipped', by('Friday').completed===0 && by('Friday').skipped===4);
ck('untouched days report null, not zero', by('Sunday').rate===null);
ck('all seven days present', stats.length===7);
stats.filter(s=>s.rate!==null).forEach(s=>console.log(`  ${s.name.padEnd(10)} ${s.completed}/${s.completed+s.skipped}`));

console.log('\nSchedule advice');
const a=selectScheduleAdvice(p,3);
ck('spots the pattern', a.kind==='drop_day', a.kind);
ck('names the right day', a.kind==='drop_day' && a.weekday==='Friday', JSON.stringify(a));
ck('suggests dropping to 2 days', a.kind==='drop_day' && a.suggestedDays===2);
ck('phrases it without blame', a.kind==='drop_day' && a.message.includes('one less thing'), a.kind==='drop_day'?a.message:'');
if(a.kind==='drop_day') console.log(`  → "${a.message}"`);

console.log('\nIt stays quiet without real evidence');
const thin=buildSessionsProjection([...sess('a','2026-09-07',true),...sess('b','2026-09-11',false)]);
ck('two sessions is not a pattern', selectScheduleAdvice(thin,4).kind==='none');
const good=buildSessionsProjection([...MON.flatMap((d,i)=>sess('m'+i,d,true)),...WED.flatMap((d,i)=>sess('w'+i,d,true))]);
ck('no advice when nothing is being missed', selectScheduleAdvice(good,2).kind==='none');
ck('never suggests below 2 days', selectScheduleAdvice(p,2).kind==='none');

console.log(f===0?'\nALL PASS\n':`\n${f} FAILURE(S)\n`);
process.exit(f===0?0:1);
