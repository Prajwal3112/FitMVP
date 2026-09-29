import { buildSessionsProjection } from '../src/projections/sessions';
import { selectContextCompleteness, weeklyReveal, OBSERVABLE_CEILING } from '../src/context/completeness';
import { canonicalExerciseId as CID } from '../src/data/exercises';
let f=0; const ck=(n:string,c:boolean,d='')=>{c?console.log(`  ok   ${n}`):(console.log(`  FAIL ${n} ${d}`),f++)};
let q=0; const ev=(t:string,d:string,p:unknown)=>({id:`e${q}`,seq:q++,type:t,occurredAt:d+'T10:00:00Z',trainingDay:d,schemaVersion:1,prevHash:'x',payload:p}) as never;

const LIFTS=['bench-press','barbell-squat','deadlift','overhead-press','lat-pulldown','bicep-curl'].map(CID);
function session(i:number, day:string, opts:{rate?:boolean;energy?:number;sore?:boolean;nLifts?:number;weight?:number}={}){
  const id='s'+i, {rate=true,energy=7,sore=false,nLifts=6,weight=60}=opts;
  const slots=LIFTS.slice(0,nLifts).map(x=>({exerciseId:x,name:x,sets:3,targetReps:8}));
  return [
   ev('PreCheckinRecorded',day,{sessionId:id,energy,soreness:sore?[{muscle:'chest',level:2}]:[]}),
   ev('SessionScheduled',day,{sessionId:id,trainingDay:day,planId:null,workoutId:'w',workoutName:'W',exercises:slots,openingNote:'',generationMode:'template_fallback'}),
   ev('SessionStarted',day,{sessionId:id,startedAt:'T'}),
   ...slots.flatMap(s=>[0,1,2].map(k=>ev('SetCompleted',day,{sessionId:id,exerciseId:s.exerciseId,setIndex:k,weight_kg:weight,reps:8,...(rate?{rpe:7}:{})}))),
   ev('SessionCompleted',day,{sessionId:id,completedAt:'T',completedExercises:nLifts,totalExercises:nLifts}),
  ];
}
const day=(n:number)=>new Date(Date.UTC(2026,8,1+n)).toISOString().slice(0,10);

console.log('\nThe bar is earned, not timed');
const nothing=selectContextCompleteness(buildSessionsProjection([]), day(30));
ck('no sessions → 0%', nothing.percent===0, String(nothing.percent));
ck('...even after a month of calendar time', nothing.weeksIn===0 && !nothing.unlocked);

const oneSess=selectContextCompleteness(buildSessionsProjection(session(0,day(0))), day(28));
ck('one session after 4 weeks does NOT unlock', !oneSess.unlocked, `${oneSess.percent}% w${oneSess.weeksIn}`);
console.log(`  1 session, 4 weeks elapsed → ${oneSess.percent}%, unlocked=${oneSess.unlocked}`);

console.log('\nTraining hard but for nine days does NOT unlock either');
const fast=buildSessionsProjection([0,1,2,3,4,5,6,7,8].flatMap(i=>session(i,day(i),{weight:60+i*2.5})));
const f2=selectContextCompleteness(fast, day(9));
ck('coverage high, time short → still locked', !f2.unlocked, `${f2.percent}% w${f2.weeksIn}`);
console.log(`  9 sessions in 9 days → ${f2.percent}%, weeks=${f2.weeksIn}, unlocked=${f2.unlocked}`);

console.log('\nA real four weeks');
const real=buildSessionsProjection([
 ...[0,2,4,7,9,11,14,16,18,21,23,25].flatMap((d,i)=>
   session(i,day(d),{energy:i%3===0?3:i%3===1?7:9,sore:i%2===0,weight:60+Math.floor(i/3)*2.5})),
 ev('SessionSkipped',day(26),{sessionId:'skip1',trainingDay:day(26),reason:'time'}),
]);
const st=selectContextCompleteness(real, day(28));
ck('four weeks of real training unlocks', st.unlocked, `${st.percent}% w${st.weeksIn}`);
ck(`percent in the 60-75 band (${st.percent}%)`, st.percent>=60 && st.percent<=OBSERVABLE_CEILING, String(st.percent));
ck('never exceeds the observable ceiling', st.percent<=OBSERVABLE_CEILING);
console.log(`  12 sessions over 4 weeks → ${st.percent}%`);
st.facets.forEach(x=>console.log(`    ${Math.round(x.have*100).toString().padStart(3)}%  ${x.label}`));

console.log('\nWeekly reveals are derived, not scripted');
for(const w of [0,1,2,3,4]){
  const snap=selectContextCompleteness(buildSessionsProjection(
    [0,2,4,7,9,11,14,16,18,21,23,25].filter(d=>d<=w*7).flatMap((d,i)=>session(i,day(d),{energy:i%3===0?3:7,sore:i%2===0,weight:60+i}))), day(w*7));
  const r=weeklyReveal(snap);
  console.log(`  week ${w}: ${r.title}  (${snap.percent}%)`);
  ck(`week ${w} says something concrete`, r.lines.length>0 && r.lines[0]!.length>10);
}
const full=weeklyReveal(st);
console.log(`\n  "${full.title}"`);
full.lines.forEach(l=>console.log(`    · ${l}`));
// Was asserting "the rest I have to ask you" — an invitation to a
// conversation the app cannot have (no LLM, no chat, nothing behind the
// unlock flag). The promise is removed until Phase 8 can honour it; what
// must survive is the honest statement of the ceiling.
ck('at unlock it states the limit of what watching can show',
  full.lines.some(l=>l.includes('as much as I can learn by watching')), full.lines.join(' | '));
ck('at unlock it does NOT promise a conversation',
  !full.lines.some(l=>/ask you|talk about it|coach is ready/i.test(l)), full.lines.join(' | '));

console.log(f===0?'\nALL PASS\n':`\n${f} FAILURE(S)\n`);
process.exit(f===0?0:1);
