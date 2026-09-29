import { buildSessionDraft } from '../src/session/scheduler';
import { SessionScheduledPayloadSchema } from '../src/events/session';
import { buildSessionsProjection } from '../src/projections/sessions';
import { hashEvent, GENESIS_PREV_HASH } from '../src/events/base';
import { DROP_REASON } from '../src/constants/copy';
import type { Event } from '../src/events';

/**
 * What the scheduler works out must reach the event, and then the screen.
 *
 * buildSessionDraft returned warmup, cooldown, dropped and reasons on every
 * check-in. checkInAndSchedule forwarded five fields and dropped those four,
 * and SessionScheduledPayloadSchema had nowhere to put them — so 137 warm-up
 * movements, the dropped-slot explanations and every reason past the first were
 * computed ~25 times per workout and discarded at the write boundary. No user
 * ever saw one.
 */
let fails = 0;
const ck = (n: string, c: boolean, extra = '') => {
  if (c) console.log(`  ok   ${n}`); else { fails++; console.log(`  FAIL ${n} ${extra}`); }
};

const draft = buildSessionDraft({
  equipment: 'home', rotationIndex: 0,
  checkin: { sessionId: 's1', energy: 6, soreness: [{ muscle: 'chest', level: 3 }] },
  goal: 'hypertrophy', experience: 'new', daysPerWeek: 6, ownedEquipment: ['dumbbell'],
});

console.log('\nThe engine produces them\n');
ck('a warm-up is built', draft.warmup.raise.length + draft.warmup.mobilise.length > 0);
ck('a cool-down is built', draft.cooldown.length > 0);
ck('more than one reason is produced', draft.reasons.length > 1, `${draft.reasons.length}`);
console.log(`       warm-up: ${draft.warmup.raise.length} raise + ${draft.warmup.mobilise.length} mobilise, ~${draft.warmup.minutes} min`);
console.log(`       reasons: ${draft.reasons.length}`);
draft.reasons.forEach((r) => console.log(`         · ${r}`));
if (draft.dropped.length > 0) {
  console.log(`       dropped: ${draft.dropped.map((d) => `${d.name} (${d.reason})`).join(', ')}`);
}

console.log('\nThey survive the event schema\n');
const payload = {
  sessionId: 's1', trainingDay: '2026-09-29', planId: null,
  workoutId: draft.workoutId, workoutName: draft.workoutName,
  exercises: draft.exercises, openingNote: draft.openingNote,
  generationMode: 'template_fallback' as const,
  warmup: {
    raise: draft.warmup.raise.map((w) => ({ id: w.id, name: w.name })),
    mobilise: draft.warmup.mobilise.map((w) => ({ id: w.id, name: w.name })),
    minutes: draft.warmup.minutes,
  },
  cooldown: draft.cooldown.map((w) => ({ id: w.id, name: w.name })),
  dropped: draft.dropped,
  reasons: draft.reasons.filter((r) => r.trim().length > 0).slice(0, 8),
};
const parsed = SessionScheduledPayloadSchema.safeParse(payload);
ck('the payload validates', parsed.success,
  parsed.success ? '' : JSON.stringify(parsed.error.issues[0]));

// Widening, so history written before this still parses — no version bump.
const { warmup, cooldown, dropped, reasons, ...old } = payload;
ck('a pre-2026-09-29 payload with none of them still parses',
  SessionScheduledPayloadSchema.safeParse(old).success);

console.log('\nThey survive the fold into the projection\n');
const e = {
  id: 'id0', seq: 0, type: 'SessionScheduled', occurredAt: '2026-09-29T09:00:00.000Z',
  trainingDay: '2026-09-29', schemaVersion: 1, prevHash: GENESIS_PREV_HASH, payload,
} as unknown as Event;
void hashEvent(e);
const proj = buildSessionsProjection([e]);
const s = proj.byId['s1'];
ck('the warm-up is on the session', (s?.warmup?.raise.length ?? 0) + (s?.warmup?.mobilise.length ?? 0) > 0);
ck('the cool-down is on the session', (s?.cooldown.length ?? 0) > 0);
ck('every reason is on the session', s?.reasons.length === payload.reasons.length,
  `${s?.reasons.length} vs ${payload.reasons.length}`);
ck('the dropped slots are on the session', s?.dropped.length === payload.dropped.length);

console.log('\nEvery drop reason has human copy\n');
for (const r of ['injury', 'soreness', 'nothing_available'] as const) {
  ck(`"${r}" reads as English`, DROP_REASON[r].length > 10 && !DROP_REASON[r].includes('_'),
    DROP_REASON[r]);
}

console.log(fails === 0 ? '\nall passed' : `\n${fails} FAILURE(S)`);
if (fails > 0) process.exit(1);
