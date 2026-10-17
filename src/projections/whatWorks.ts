import type { SessionsProjection } from './sessions';
import { selectExerciseHistory, selectWeekdayStats, workingSets } from './sessions';
import { exerciseName } from '../data/exercises';

/**
 * "What works for you" — read back from your own log.
 *
 * The founder's three verbs for this app (2026-10-17): keep a record, see what
 * you have been doing for long, and learn what works for you. The first was
 * built. This is the third, and it needs no AI, no network and no per-user
 * cost — every sentence below is arithmetic over events the app already has.
 *
 * TWO RULES THIS FILE OBEYS.
 *
 * 1. NEVER SPEAK WITHOUT ENOUGH DATA. Every insight carries a minimum and a
 *    `basedOn` count that the UI shows, so the user can judge the claim rather
 *    than trust it. An app that says "squats are your best lift" after two
 *    sessions has taught the user to ignore it.
 * 2. OBSERVE, DO NOT INSTRUCT. The stated posture is observational — the user
 *    drives, the app notices. So these are statements about what happened, not
 *    advice about what to do next. A lifter put the failure mode precisely:
 *    "an app is a product of how its designer thinks about training."
 */

export type InsightKind = 'progress' | 'stalled' | 'rhythm' | 'avoided' | 'extra' | 'effort';

export type Insight = {
  id: string;
  kind: InsightKind;
  /** One plain sentence. Shown verbatim. */
  text: string;
  /** Sessions or occurrences behind it. Rendered, so the claim is judgeable. */
  basedOn: number;
};

/** Minimum evidence before each kind of claim is allowed to appear. */
const MIN = {
  /** Sessions on one lift before its direction means anything. */
  liftSessions: 3,
  /** Sessions on one lift before calling it stalled. Higher — absence of
   *  movement is weaker evidence than movement. */
  stalledSessions: 5,
  /** Attempts on a weekday before its completion rate means anything. */
  weekdayAttempts: 3,
  /** Times an exercise was prescribed before "you skip this" is fair. */
  prescribedBeforeAvoided: 3,
  /** Reviewed sessions before the verdict spread means anything. */
  reviews: 4,
} as const;

const weekOf = (d: string): number => Math.floor(Date.parse(`${d}T00:00:00Z`) / 604_800_000);

export function selectWhatWorks(p: SessionsProjection): Insight[] {
  const out: Insight[] = [];
  const all = p.order
    .map((id) => p.byId[id])
    .filter((s): s is NonNullable<typeof s> => !!s);
  const completed = all.filter((s) => s.status === 'completed');
  const history = selectExerciseHistory(p);

  // ── Lifts that moved, and lifts that have not ──────────────────────
  // `selectExerciseHistory` keeps 5 deep, newest first.
  const moved: { name: string; from: number; to: number; n: number }[] = [];
  const stalled: { name: string; at: number; n: number }[] = [];

  for (const [id, perf] of Object.entries(history)) {
    if (perf.length < MIN.liftSessions) continue;
    const newest = perf[0];
    const oldest = perf[perf.length - 1];
    if (!newest || !oldest) continue;
    // A trend needs time behind it, not two different numbers in one week.
    if (weekOf(newest.trainingDay) - weekOf(oldest.trainingDay) < 1) continue;

    const loaded = newest.weight_kg > 0 || oldest.weight_kg > 0;
    const from = loaded ? oldest.weight_kg : oldest.reps;
    const to = loaded ? newest.weight_kg : newest.reps;

    if (to > from) {
      moved.push({ name: exerciseName(id), from, to, n: perf.length });
    } else if (to === from && perf.length >= MIN.stalledSessions) {
      stalled.push({ name: exerciseName(id), at: to, n: perf.length });
    }
  }

  moved.sort((a, b) => (b.to - b.from) - (a.to - a.from));
  for (const m of moved.slice(0, 3)) {
    out.push({
      id: `progress:${m.name}`,
      kind: 'progress',
      text: `${m.name} has gone from ${m.from} to ${m.to}.`,
      basedOn: m.n,
    });
  }
  for (const s of stalled.slice(0, 2)) {
    out.push({
      id: `stalled:${s.name}`,
      kind: 'stalled',
      // Stated as an observation. Whether to change it is the user's call.
      text: `${s.name} has sat at ${s.at} for ${s.n} sessions.`,
      basedOn: s.n,
    });
  }

  // ── The days you actually train ────────────────────────────────────
  const weekdays = selectWeekdayStats(p)
    .filter((w) => w.completed + w.skipped >= MIN.weekdayAttempts && w.rate !== null);
  if (weekdays.length >= 2) {
    const best = [...weekdays].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))[0];
    const worst = [...weekdays].sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0))[0];
    if (best && (best.rate ?? 0) >= 0.8) {
      out.push({
        id: 'rhythm:best',
        kind: 'rhythm',
        text: `${best.name} is your most reliable day — ${best.completed} of ${best.completed + best.skipped}.`,
        basedOn: best.completed + best.skipped,
      });
    }
    // Only when it is clearly a pattern and not just the same day as `best`.
    if (worst && worst.weekday !== best?.weekday && (worst.rate ?? 1) < 0.5) {
      out.push({
        id: 'rhythm:worst',
        kind: 'rhythm',
        text: `${worst.name} rarely happens — ${worst.completed} of ${worst.completed + worst.skipped}.`,
        basedOn: worst.completed + worst.skipped,
      });
    }
  }

  // ── What you quietly avoid, and what you do extra of ───────────────
  // Only meaningful because the app records what you DID rather than what it
  // asked for: before suggest-not-enforce, an extra set could not be logged
  // and so could never become evidence of a preference.
  const prescribed = new Map<string, number>();
  const everLogged = new Map<string, number>();
  const didExtra = new Map<string, number>();

  for (const s of completed) {
    const sets = workingSets(s.setLog);
    for (const slot of s.exercises) {
      prescribed.set(slot.exerciseId, (prescribed.get(slot.exerciseId) ?? 0) + 1);
      const mine = sets.filter((x) => x.exerciseId === slot.exerciseId).length;
      if (mine > 0) everLogged.set(slot.exerciseId, (everLogged.get(slot.exerciseId) ?? 0) + 1);
      if (mine > slot.sets) didExtra.set(slot.exerciseId, (didExtra.get(slot.exerciseId) ?? 0) + 1);
    }
  }

  for (const [id, times] of prescribed) {
    if (times >= MIN.prescribedBeforeAvoided && (everLogged.get(id) ?? 0) === 0) {
      out.push({
        id: `avoided:${id}`,
        kind: 'avoided',
        text: `${exerciseName(id)} has come up ${times} times and you have not done it once.`,
        basedOn: times,
      });
    }
  }
  for (const [id, times] of [...didExtra.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)) {
    if (times >= 2) {
      out.push({
        id: `extra:${id}`,
        kind: 'extra',
        text: `You have done more sets than asked on ${exerciseName(id)} ${times} times.`,
        basedOn: times,
      });
    }
  }

  // ── How the sessions have actually felt ────────────────────────────
  const reviewed = completed.filter((s) => s.review !== null);
  if (reviewed.length >= MIN.reviews) {
    const n = (v: string) => reviewed.filter((s) => s.review?.verdict === v).length;
    const easy = n('too_easy');
    const much = n('too_much');
    const right = n('about_right');
    if (easy > right + much) {
      out.push({
        id: 'effort:easy',
        kind: 'effort',
        text: `You have called ${easy} of your last ${reviewed.length} sessions too easy.`,
        basedOn: reviewed.length,
      });
    } else if (much > right + easy) {
      out.push({
        id: 'effort:much',
        kind: 'effort',
        text: `You have called ${much} of your last ${reviewed.length} sessions too much.`,
        basedOn: reviewed.length,
      });
    } else if (right >= reviewed.length / 2) {
      out.push({
        id: 'effort:right',
        kind: 'effort',
        text: `${right} of your last ${reviewed.length} sessions landed about right.`,
        basedOn: reviewed.length,
      });
    }
  }

  return out;
}

/**
 * What is still missing, so the screen can say why it is quiet rather than
 * showing an empty space. Silence without explanation reads as a broken app.
 */
export function selectWhatWorksGap(p: SessionsProjection): string | null {
  const completed = p.order
    .map((id) => p.byId[id])
    .filter((s): s is NonNullable<typeof s> => !!s && s.status === 'completed').length;
  if (completed === 0) return 'Log a session and this fills in.';
  if (completed < MIN.liftSessions) {
    return `${completed} session${completed === 1 ? '' : 's'} so far. Patterns need about ${MIN.liftSessions} before they mean anything.`;
  }
  return null;
}
