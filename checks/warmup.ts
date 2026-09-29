import { WARMUPS, buildWarmup, buildCooldown } from '../src/data/warmups';
import { DAY_MUSCLES } from '../src/program/resolve';
let f=0; const ck=(n:string,c:boolean,d='')=>{c?console.log(`  ok   ${n}`):(console.log(`  FAIL ${n} ${d}`),f++)};

console.log('\nPool');
ck(`${WARMUPS.length} movements loaded`, WARMUPS.length===137, String(WARMUPS.length));
ck('all three kinds present', new Set(WARMUPS.map(w=>w.kind)).size===3);

console.log('\nBefore lifting: dynamic only, never static');
for(const day of ['PUSH','PULL','LEGS','FB'] as const){
 const p=buildWarmup(DAY_MUSCLES[day],'gym');
 ck(`${day.padEnd(5)} warm-up has no static stretching`, p.mobilise.every(w=>w.kind==='dynamic'),
   p.mobilise.filter(w=>w.kind!=='dynamic').map(w=>w.name).join(', '));
 ck(`${day.padEnd(5)} gives something to do`, p.mobilise.length>0);
}
const push=buildWarmup(DAY_MUSCLES.PUSH,'gym');
console.log('  push day →', push.raise.concat(push.mobilise).map(w=>w.name).join(' · '));

console.log('\nAfter lifting: static, matched to what you trained');
const cd=buildCooldown(['chest','shoulders','triceps'],'gym');
ck('all static', cd.every(w=>w.kind==='static'));
ck('targets what was worked', cd.every(w=>[...w.pm,...w.sm].some(m=>['chest','shoulders','triceps'].includes(m.toLowerCase()))),
  cd.map(w=>w.name+':'+w.pm).join(' | '));
ck('not four of the same muscle', new Set(cd.map(w=>w.pm[0])).size===cd.length);
console.log('  after push →', cd.map(w=>w.name).join(' · '));
const legs=buildCooldown(DAY_MUSCLES.LEGS,'gym');
console.log('  after legs →', legs.map(w=>w.name).join(' · '));

console.log('\nHome, owning nothing');
const home=buildWarmup(DAY_MUSCLES.PUSH,'home',[]);
ck('warm-up needs no equipment', home.mobilise.every(w=>w.eq==='body only'), home.mobilise.map(w=>w.eq).join(','));
const hcd=buildCooldown(DAY_MUSCLES.LEGS,'home',[]);
ck('cool-down needs no equipment', hcd.every(w=>w.eq==='body only'), hcd.map(w=>w.eq).join(','));
ck('...and still returns something', hcd.length>0);

console.log(f===0?'\nALL PASS\n':`\n${f} FAILURE(S)\n`);
process.exit(f===0?0:1);
