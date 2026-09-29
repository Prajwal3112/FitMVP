import { z } from 'zod';
import { EventSchema } from '../src/events';
import { hashEvent, GENESIS_PREV_HASH } from '../src/events/base';

// ── 1. What happens to a historical v1 event once its schema bumps to v2?
const v1 = {
  id: 'id0', seq: 0, type: 'SessionStarted', occurredAt: '2020-01-01T00:00:00.000Z',
  trainingDay: '2020-01-01', schemaVersion: 1, prevHash: '__genesis__',
  payload: { sessionId: 's1', startedAt: '2020-01-01T00:00:00.000Z' },
};
console.log('v1 parses today:', EventSchema.safeParse(v1).success);

// Simulate the bump the way the codebase does it: schemaVersion: z.literal(N)
const Bumped = z.object({
  id: z.string(), seq: z.number(), type: z.literal('SessionStarted'),
  occurredAt: z.string(), trainingDay: z.string(), prevHash: z.string(),
  schemaVersion: z.literal(2),                       // <- the only change
  payload: z.object({ sessionId: z.string(), startedAt: z.string(), device: z.string() }),
});
const r = Bumped.safeParse(v1);
console.log('same event after a v2 bump:', r.success ? 'parses' : 'REJECTED -> ' + r.error.issues.map(i=>i.path.join('.')+': '+i.message).join(' | '));

// ── 2. The hash chain — both holes it used to have
// Until 2026-09-29 `hashEvent` covered {id, payload} only, and excluded the
// event's own prevHash. Two consequences, both now asserted closed.
let chainFails = 0;
const ckChain = (n: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ok   ${n}`);
  else { chainFails++; console.log(`  FAIL ${n} ${extra}`); }
};

type Row = {
  id: string; seq: number; type: string; occurredAt: string;
  trainingDay: string; schemaVersion: number; prevHash: string; payload: { x: number };
};

/** Five rows, so a forgery in the middle has successors to cascade into. */
function buildChain(): Row[] {
  const rows: Row[] = [];
  let prevHash = GENESIS_PREV_HASH;
  for (let i = 0; i < 5; i++) {
    const r: Row = {
      id: String.fromCharCode(97 + i), seq: i, type: 'SetCompleted',
      occurredAt: `2020-01-0${i + 1}T09:00:00.000Z`,
      trainingDay: `2020-01-0${i + 1}`, schemaVersion: 1, prevHash,
      payload: { x: i },
    };
    rows.push(r);
    prevHash = hashEvent(r);
  }
  return rows;
}

const verify = (rs: Row[]): string => {
  let exp = GENESIS_PREV_HASH;
  for (const r of rs) {
    if (r.prevHash !== exp) return `BROKEN at seq ${r.seq}`;
    exp = hashEvent(r);
  }
  return 'ok';
};

const rows = buildChain();
ckChain('an untouched chain verifies', verify(rows) === 'ok', verify(rows));

// HOLE 1 — the envelope was outside the hash. trainingDay is the most
// load-bearing field in the system: adherence, gap detection, the weekday
// signal, the rotation and sessionIdByDay all read it.
for (const field of ['trainingDay', 'type', 'occurredAt', 'schemaVersion'] as const) {
  const t = JSON.parse(JSON.stringify(rows)) as Row[];
  (t[2] as unknown as Record<string, unknown>)[field] =
    field === 'schemaVersion' ? 99 : 'TAMPERED';
  ckChain(`rewriting ${field} in the database is detected`, verify(t) !== 'ok', verify(t));
}

// HOLE 2 — because event N's hash excluded N's own prevHash, forging one
// event needed exactly ONE field patched on its successor, not a recompute
// of the tail. Tampering was O(1) to hide instead of O(N).
const forged = JSON.parse(JSON.stringify(rows)) as Row[];
forged[1]!.payload = { x: 999 };
forged[2]!.prevHash = hashEvent(forged[1]!);   // the single patch that used to suffice
ckChain('forging one event and patching only its successor is detected',
  verify(forged) !== 'ok', verify(forged));

// And the cascade is real: hiding it requires rewriting every later event.
const cascaded = JSON.parse(JSON.stringify(rows)) as Row[];
cascaded[1]!.payload = { x: 999 };
let h = hashEvent(cascaded[1]!);
for (let i = 2; i < cascaded.length; i++) { cascaded[i]!.prevHash = h; h = hashEvent(cascaded[i]!); }
ckChain('...and only a full rewrite of the tail can hide it (O(N), as intended)',
  verify(cascaded) === 'ok', verify(cascaded));

// Canonical JSON: content, not key order, determines the hash.
const kA = hashEvent({ ...rows[0]!, payload: { x: 1, y: 2 } as unknown as { x: number } });
const kB = hashEvent({ ...rows[0]!, payload: { y: 2, x: 1 } as unknown as { x: number } });
ckChain('key order does not change the hash', kA === kB);

if (chainFails > 0) { console.log(`\n${chainFails} FAILURE(S)`); process.exit(1); }
