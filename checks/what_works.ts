import { selectWhatWorks, selectWhatWorksGap } from '../src/projections/whatWorks';
import { buildSessionsProjection } from '../src/projections/sessions';
import { hashEvent, GENESIS_PREV_HASH } from '../src/events/base';
import type { Event } from '../src/events';

/**
 * "What works for you" must be right, and must shut up when it does not know.
 *
 * An app that says "squats are your best lift" after two sessions teaches the
 * user to ignore everything it says afterwards. So the hard requirement is not
 * that the insights are clever — it is that they never appear early.
 */
let fails = 0;
const ck = (n: string, c: boolean, extra = '') => {
  if (c) console.log(`  ok   ${n}`); else { fails++; console.log(`  FAIL ${n} ${extra}`); }
};

type SessionSpec = {
  day: string;
  status?: 'completed' | 'skipped';
  /** exerciseId -> { prescribed, logged sets, weight } */
  lifts?: Record<string, { sets: number; logged: number; weight: number; reps?: number }>;
  verdict?: 'too_easy' | 'about_right' | 'too_much';
};

function build(specs: SessionSpec[]) {
  const evs: Event[] = [];
  let seq = 0; let prevHash = GENESIS_PREV_HASH;
  const push = (type: string, payload: Record<string, unknown>, day: string) => {
    const e = { id: `i${seq}`, seq, type, occurredAt: `${day}T09:00:00.000Z`,
      trainingDay: day, schemaVersion: 1, prevHash, payload } as unknown as Event;
    evs.push(e); prevHash = hashEvent(e); seq += 1;
  };
  specs.forEach((sp, i) => {
    const sid = `s${i}`;
    const lifts = sp.lifts ?? {};
    const exercises = Object.entries(lifts).map(([id, l]) => ({
      exerciseId: id, name: id, sets: l.sets, targetReps: 8,
    }));
    push('SessionScheduled', { sessionId: sid, trainingDay: sp.day, planId: null,
      workoutId: 'w', workoutName: 'Session', openingNote: '',
      generationMode: 'template_fallback',
      exercises: exercises.length > 0 ? exercises : [{ exerciseId: 'x', name: 'x', sets: 3, targetReps: 8 }] }, sp.day);
    if (sp.status === 'skipped') {
      push('SessionSkipped', { sessionId: sid, trainingDay: sp.day, reason: 'too_tired' }, sp.day);
      return;
    }
    push('SessionStarted', { sessionId: sid, startedAt: `${sp.day}T09:00:00.000Z` }, sp.day);
    for (const [id, l] of Object.entries(lifts)) {
      for (let k = 0; k < l.logged; k++) {
        push('SetCompleted', { sessionId: sid, exerciseId: id, setIndex: k,
          weight_kg: l.weight, reps: l.reps ?? 8, rpe: 8 }, sp.day);
      }
    }
    push('SessionCompleted', { sessionId: sid, completedAt: `${sp.day}T10:00:00.000Z`,
      completedExercises: exercises.length, totalExercises: exercises.length,
      ...(sp.verdict ? { review: { verdict: sp.verdict, gripes: [] } } : {}) }, sp.day);
  });
  return buildSessionsProjection(evs);
}

const say = (p: ReturnType<typeof build>) => selectWhatWorks(p).map((i) => i.text);

console.log('\nIt stays quiet when it does not know\n');
ck('no sessions -> nothing claimed', selectWhatWorks(build([])).length === 0);
ck('...and says why', selectWhatWorksGap(build([])) !== null, String(selectWhatWorksGap(build([]))));

const two = build([
  { day: '2026-01-05', lifts: { bench: { sets: 3, logged: 3, weight: 60 } } },
  { day: '2026-01-07', lifts: { bench: { sets: 3, logged: 3, weight: 65 } } },
]);
ck('two sessions on a lift -> no trend claimed', say(two).length === 0, say(two).join(' | '));
ck('...and explains the gap', selectWhatWorksGap(two) !== null);

console.log('\nProgress, once there is enough of it\n');
// Three sessions spanning >1 week, weight rising.
const rising = build([
  { day: '2026-01-05', lifts: { bench: { sets: 3, logged: 3, weight: 60 } } },
  { day: '2026-01-12', lifts: { bench: { sets: 3, logged: 3, weight: 62.5 } } },
  { day: '2026-01-19', lifts: { bench: { sets: 3, logged: 3, weight: 65 } } },
]);
const r = say(rising);
ck('a rising lift is reported', r.some((t) => /bench/i.test(t) && /60.*65/.test(t)), r.join(' | '));
console.log(`       "${r[0]}"`);

// Same three sessions inside ONE week must NOT count as a trend.
const sameWeek = build([
  { day: '2026-01-05', lifts: { bench: { sets: 3, logged: 3, weight: 60 } } },
  { day: '2026-01-06', lifts: { bench: { sets: 3, logged: 3, weight: 62.5 } } },
  { day: '2026-01-07', lifts: { bench: { sets: 3, logged: 3, weight: 65 } } },
]);
ck('three sessions in one week is NOT a trend', say(sameWeek).length === 0, say(sameWeek).join(' | '));

console.log('\nStalled needs more evidence than moving\n');
const flat4 = build([0, 7, 14, 21].map((d) => ({
  day: `2026-02-${String(1 + d).padStart(2, '0')}`,
  lifts: { squat: { sets: 3, logged: 3, weight: 80 } },
})));
ck('4 flat sessions is not yet "stalled"', !say(flat4).some((t) => /sat at/.test(t)), say(flat4).join(' | '));
const flat5 = build([0, 7, 14, 21, 28].map((d) => ({
  day: `2026-02-${String(1 + d).padStart(2, '0')}`,
  lifts: { squat: { sets: 3, logged: 3, weight: 80 } },
})));
ck('5 flat sessions is', say(flat5).some((t) => /sat at 80/.test(t)), say(flat5).join(' | '));

console.log('\nBodyweight progress is read in reps, not kilos\n');
const bw = build([
  { day: '2026-03-02', lifts: { pushup: { sets: 3, logged: 3, weight: 0, reps: 10 } } },
  { day: '2026-03-09', lifts: { pushup: { sets: 3, logged: 3, weight: 0, reps: 12 } } },
  { day: '2026-03-16', lifts: { pushup: { sets: 3, logged: 3, weight: 0, reps: 15 } } },
]);
ck('a bodyweight lift progressing in reps is reported',
  say(bw).some((t) => /10.*15/.test(t)), say(bw).join(' | '));

console.log('\nThe days you actually train\n');
// Mondays done, Fridays skipped — 2026-01-05 is a Monday.
const days = build([
  ...[5, 12, 19, 26].map((d) => ({ day: `2026-01-${String(d).padStart(2, '0')}`, status: 'completed' as const })),
  ...[9, 16, 23].map((d) => ({ day: `2026-01-${String(d).padStart(2, '0')}`, status: 'skipped' as const })),
]);
const dt = say(days);
ck('the reliable day is named', dt.some((t) => /Monday/.test(t)), dt.join(' | '));
ck('the missed day is named', dt.some((t) => /Friday/.test(t)), dt.join(' | '));
dt.filter((t) => /day/i.test(t)).forEach((t) => console.log(`       "${t}"`));

console.log('\nWhat you quietly avoid — only visible because we log what you DID\n');
const avoid = build([0, 7, 14].map((d) => ({
  day: `2026-04-${String(1 + d).padStart(2, '0')}`,
  lifts: { bench: { sets: 3, logged: 3, weight: 60 }, lunge: { sets: 3, logged: 0, weight: 40 } },
})));
const av = say(avoid);
ck('an exercise prescribed 3x and never logged is surfaced',
  av.some((t) => /lunge/i.test(t) && /not done it once/.test(t)), av.join(' | '));
console.log(`       "${av.find((t) => /lunge/i.test(t))}"`);

console.log('\nAnd what you do extra of\n');
const extra = build([0, 7, 14].map((d) => ({
  day: `2026-05-${String(1 + d).padStart(2, '0')}`,
  lifts: { bench: { sets: 3, logged: 5, weight: 60 } },
})));
ck('extra sets become a preference signal',
  say(extra).some((t) => /more sets than asked/.test(t)), say(extra).join(' | '));

console.log('\nHow the sessions felt\n');
const verdicts = build([0, 7, 14, 21].map((d, i) => ({
  day: `2026-06-${String(1 + d).padStart(2, '0')}`,
  lifts: { bench: { sets: 3, logged: 3, weight: 60 } },
  verdict: (i < 3 ? 'too_easy' : 'about_right') as 'too_easy' | 'about_right',
})));
ck('a consistent "too easy" verdict is reported',
  say(verdicts).some((t) => /too easy/.test(t)), say(verdicts).join(' | '));
const few = build([0, 7].map((d) => ({
  day: `2026-07-${String(1 + d).padStart(2, '0')}`,
  lifts: { bench: { sets: 3, logged: 3, weight: 60 } }, verdict: 'too_easy' as const,
})));
ck('two reviews is not enough to claim a pattern',
  !say(few).some((t) => /too easy/.test(t)), say(few).join(' | '));

console.log('\nEvery claim carries its evidence count\n');
const insights = selectWhatWorks(rising);
ck('basedOn is set and plausible on every insight',
  insights.every((i) => i.basedOn >= 1 && i.basedOn <= 500), JSON.stringify(insights.map((i) => i.basedOn)));
ck('ids are unique (no duplicate rows on screen)',
  new Set(insights.map((i) => i.id)).size === insights.length);

console.log('\nObserve, do not instruct\n');
const everything = [rising, flat5, days, avoid, extra, verdicts].flatMap((p) => say(p)).join(' ');
ck('nothing tells the user what to do',
  !/you should|try to|make sure|we recommend|you must|add weight next/i.test(everything),
  everything.slice(0, 140));

console.log(fails === 0 ? '\nall passed' : `\n${fails} FAILURE(S)`);
if (fails > 0) process.exit(1);
