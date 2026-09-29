import { serializeLog, parseBackup, describeBackup } from '../src/dev/backup';
import { hashEvent, GENESIS_PREV_HASH } from '../src/events/base';
import type { Event } from '../src/events';

/**
 * A backup that cannot be restored is not a backup.
 *
 * The share-sheet digest is prose and rebuilds nothing; uninstall or
 * "Clear data" wipes the SQLite file silently and permanently. So this format
 * has to round-trip exactly, and it has to REFUSE anything it cannot verify
 * rather than half-restore it onto a working log.
 */
let fails = 0;
const ck = (n: string, c: boolean, extra = '') => {
  if (c) console.log(`  ok   ${n}`); else { fails++; console.log(`  FAIL ${n} ${extra}`); }
};

/** Build a chain-valid log the same way appendEvent does. */
function makeLog(n: number): Event[] {
  const out: Event[] = [];
  let prevHash = GENESIS_PREV_HASH;
  for (let i = 0; i < n; i++) {
    const payload = {
      sessionId: `sess${i}`, trainingDay: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      planId: null, workoutId: 'w', workoutName: 'Upper body',
      exercises: [{ exerciseId: 'bench', name: 'Bench', sets: 3, targetReps: 8 }],
      openingNote: 'Upper body.', generationMode: 'template_fallback' as const,
    };
    const e = {
      id: `id${String(i).padStart(6, '0')}`, seq: i, type: 'SessionScheduled' as const,
      occurredAt: `2026-01-01T0${i % 10}:00:00.000Z`,
      trainingDay: payload.trainingDay, schemaVersion: 1, prevHash, payload,
    } as Event;
    out.push(e);
    prevHash = hashEvent(e);
  }
  return out;
}

console.log('\nRound trip\n');
const log = makeLog(40);
const json = serializeLog(log);
const back = parseBackup(json);
ck('a valid log round-trips', back.ok, back.ok ? '' : back.reason);
if (back.ok) {
  ck('every event survives byte-for-byte',
    JSON.stringify(back.events) === JSON.stringify(log));
  ck('event count preserved', back.events.length === 40);
  console.log(`       ${describeBackup(back.events, back.exportedAt)}`);
}
ck('an empty log round-trips', parseBackup(serializeLog([])).ok);

console.log('\nRefuses what it cannot verify\n');
ck('not JSON', !parseBackup('{oh no').ok);
ck('wrong shape', !parseBackup('{"format":1}').ok);
ck('unknown future format', !parseBackup(JSON.stringify({ ...JSON.parse(json), format: 99 })).ok);

// truncation — the classic partial-transfer failure
const truncated = JSON.parse(json);
truncated.events = truncated.events.slice(0, 20);
const t = parseBackup(JSON.stringify(truncated));
ck('a truncated file is refused, not half-restored', !t.ok, t.ok ? '' : t.reason);

// tampering — a changed payload must break the chain
const tampered = JSON.parse(json);
tampered.events[10].payload.workoutName = 'Leg day';
const tam = parseBackup(JSON.stringify(tampered));
ck('an edited payload is caught by the chain', !tam.ok, tam.ok ? '' : tam.reason);

// a reordered log
const reordered = JSON.parse(json);
[reordered.events[3], reordered.events[4]] = [reordered.events[4], reordered.events[3]];
ck('a reordered log is refused', !parseBackup(JSON.stringify(reordered)).ok);

// a dropped middle event
const holed = JSON.parse(json);
holed.events.splice(15, 1);
holed.eventCount = holed.events.length;
ck('a missing middle event is refused', !parseBackup(JSON.stringify(holed)).ok);

console.log('\nSize — this has to survive being moved off a phone\n');
const big = serializeLog(makeLog(1200));
console.log(`       1200 events ≈ ${Math.round(big.length / 1024)} KB`);
ck('a 1200-event log round-trips', parseBackup(big).ok);

console.log(fails === 0 ? '\nall passed' : `\n${fails} FAILURE(S)`);
if (fails > 0) process.exit(1);
