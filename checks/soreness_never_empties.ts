import { buildSessionDraft } from '../src/session/scheduler';
let empty=0, thin=0, total=0; const bad:string[]=[];
const areas=['chest','back','shoulders','arms','legs','core','knee','hip','glutes','lower back','elbow','wrist','neck'];
for (const tier of ['gym','home'] as const)
 for (const exp of ['new','returning','regular','experienced'] as const)
  for (const d of [2,3,4,5,6])
   for (let rot=0; rot<6; rot++)
    for (const area of areas)
     for (const level of [2,3] as const)
      for (const ts of [2,10]) {
        total++;
        const dr = buildSessionDraft({ equipment:tier, rotationIndex:rot,
          checkin:{sessionId:'x',energy:6,soreness:[{muscle:area,level}]},
          goal:'hypertrophy', experience:exp, daysPerWeek:d, totalSessions:ts,
          ownedEquipment: tier==='home'?['dumbbell']:[] });
        if (dr.exercises.length===0){empty++; if(bad.length<8) bad.push(`${tier} ${exp} ${d}d rot${rot} ${area} lvl${level} sess${ts} -> ${dr.dayType}`);}
        else if (dr.exercises.length<3) thin++;
      }
console.log(`combinations: ${total}`);
console.log(`EMPTY sessions : ${empty}`);
console.log(`thin (<3 ex)   : ${thin}`);
if(bad.length) console.log('\n'+bad.join('\n'));

// An empty session is not a bad day — it throws in checkInAndSchedule, and
// because the rotation advances on completion only, it cannot be skipped
// past. This must stay at zero.
if (empty > 0) { console.log(`${empty} FAILURE(S)`); process.exit(1); }
console.log('all passed');
