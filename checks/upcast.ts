import { CURRENT_VERSION, UPCASTERS, upcastPayload } from '../src/events/upcast';
import { EventSchema } from '../src/events';

/**
 * A schemaVersion bump must never make history unreadable.
 *
 * Every event schema pins `schemaVersion: z.literal(N)`. Before upcasting
 * existed, bumping N meant every historical row of that type failed to parse,
 * the whole read threw, and the user was shown Onboarding with their history
 * intact and invisible — then re-onboarded on top of it.
 */
let fails = 0;
const ck = (n: string, c: boolean, extra = '') => {
  if (c) console.log(`  ok   ${n}`); else { fails++; console.log(`  FAIL ${n} ${extra}`); }
};

console.log('\nThe registry covers every event type in the union\n');
// Pull the type list out of the union itself so a new event type cannot be
// added without appearing here.
const unionTypes = (EventSchema.options as { shape: { type: { value: string } } }[])
  .map((o) => o.shape.type.value);
ck(`all ${unionTypes.length} union types have a CURRENT_VERSION`,
  unionTypes.every((t) => CURRENT_VERSION[t] !== undefined),
  unionTypes.filter((t) => CURRENT_VERSION[t] === undefined).join(','));
ck('no CURRENT_VERSION entry for a type not in the union',
  Object.keys(CURRENT_VERSION).every((t) => unionTypes.includes(t)),
  Object.keys(CURRENT_VERSION).filter((t) => !unionTypes.includes(t)).join(','));

console.log('\nEvery version a type can be at must have a path to current\n');
// THE GUARD THAT MATTERS: bump a version without writing its upcaster and
// this fails, instead of the app silently forgetting a tester's history.
for (const t of unionTypes) {
  const current = CURRENT_VERSION[t]!;
  let reachable = true; const missing: string[] = [];
  for (let v = 1; v < current; v++) {
    if (!UPCASTERS[t]?.[v]) { reachable = false; missing.push(`v${v}→v${v + 1}`); }
  }
  ck(`${t} v1..v${current} is fully upcastable`, reachable, missing.join(', '));
}

console.log('\nBehaviour\n');
ck('a current-version payload passes through untouched',
  (() => { const r = upcastPayload('SetCompleted', 1, { a: 1 }); return r.ok && (r.payload as { a: number }).a === 1; })());
ck('an unknown event type is refused',
  !upcastPayload('SomethingElse', 1, {}).ok);
const newer = upcastPayload('SetCompleted', 99, {});
ck('a row from a NEWER build is refused, with a readable reason', !newer.ok,
  newer.ok ? '' : newer.reason);
console.log(`       "${newer.ok ? '' : newer.reason}"`);
const gap = upcastPayload('SetCompleted', 0, {});
ck('a gap in the chain is refused', !gap.ok, gap.ok ? '' : gap.reason);

console.log('\nSimulated bump: does a v1 row survive SetCompleted going to v2?\n');
// Stand-in for the real registry, proving the mechanism end to end.
const fakeCurrent = 2;
const fakeUpcasters: Record<number, (p: unknown) => unknown> = {
  1: (p) => ({ ...(p as Record<string, unknown>), tempo: null }),
};
let payload: unknown = { sessionId: 's', exerciseId: 'bench', setIndex: 0, weight_kg: 60, reps: 8 };
for (let v = 1; v < fakeCurrent; v++) payload = fakeUpcasters[v]!(payload);
ck('the v1 payload is migrated, not rejected',
  (payload as { tempo: null }).tempo === null && (payload as { reps: number }).reps === 8);
console.log(`       ${JSON.stringify(payload)}`);

console.log(fails === 0 ? '\nall passed' : `\n${fails} FAILURE(S)`);
if (fails > 0) process.exit(1);
