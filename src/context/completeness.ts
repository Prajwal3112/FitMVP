import type { SessionsProjection } from '../projections/sessions';
import {
  selectWeekdayStats, selectExerciseHistory, workingSets,
} from '../projections/sessions';

// ─── How well the app knows you ──────────────────────────────────────
// The number shown to the user MUST be computed from real coverage, not
// from days elapsed. A bar that fills on a timer is a lie the user will
// eventually catch, and catching it retroactively discredits everything
// else the app claims to know.
//
// So: eight facets, each with an actual test against the event log. The
// bar moves because you trained, not because time passed.
//
// It caps at 75%. The last quarter is not observable from behaviour at
// all — why this matters to you, what your week is really like, why your
// back actually goes. That is obtainable only by asking, which is where
// the conversation earns its place rather than decorating one.

export const OBSERVABLE_CEILING = 75;

export type Facet = {
  id: string;
  /** Plain language. No jargon — this is shown to the user. */
  label: string;
  weight: number;
  /** 0..1 */
  have: number;
  /** What's known, or what's still missing. */
  detail: string;
  /** Which week this is expected to complete in. */
  week: 1 | 2 | 3 | 4;
};

export type ContextState = {
  /** 0..75 before the conversation opens. */
  percent: number;
  facets: Facet[];
  /** Completed sessions. */
  sessions: number;
  /** Whole weeks since the first session. */
  weeksIn: number;
  unlocked: boolean;
  /** What's newly known, for the weekly reveal. */
  headline: string;
  /** The single biggest thing still missing. */
  missing: string;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function selectContextCompleteness(
  p: SessionsProjection,
  todayTrainingDay: string,
): ContextState {
  const completed = p.order
    .map((id) => p.byId[id])
    .filter((s): s is NonNullable<typeof s> => !!s && s.status === 'completed');
  const skipped = p.order
    .map((id) => p.byId[id])
    .filter((s): s is NonNullable<typeof s> => !!s && s.status === 'skipped');

  const first = completed[0]?.trainingDay;
  const weeksIn = first
    ? Math.max(0, Math.floor(
        (Date.parse(`${todayTrainingDay}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 604_800_000))
    : 0;

  // Distinct calendar weeks a condition held. This is what makes the
  // later facets genuinely time-gated: you cannot see three weeks of
  // recovery pattern by training nine times in nine days.
  const weekOf = (d: string): number =>
    Math.floor(Date.parse(`${d}T00:00:00Z`) / 604_800_000);
  const weeksWith = (days: string[]) => new Set(days.map(weekOf)).size;

  const history = selectExerciseHistory(p);
  const exercisesSeen = Object.keys(history).length;
  const allSets = completed.flatMap((s) => workingSets(s.setLog));
  const ratedSets = allSets.filter((x) => x.rpe !== undefined);
  // Five sessions on a lift, not three. Three is one week for anyone
  // training regularly, and "how you respond to load" is not a one-week
  // observation.
  const exercisesWellKnown = Object.values(history)
    .filter((h) => h.filter((x) => x.avgRpe !== undefined).length >= 5).length;
  const checkins = completed.filter((s) => s.checkin !== null).map((s) => s.checkin!);
  // WEEKS OBSERVED, not weeks-in-which-you-were-sore. Scoring the latter
  // meant a client who recovers well could never fill this facet: four weeks
  // of honest "nothing is sore" scored ZERO, and with weight 12 that alone
  // pushed a flawless user under the 60 gate. "Nothing hurts" IS the
  // information — the app learned how this person recovers.
  const recoveryWeeks = weeksWith(
    completed.filter((s) => s.checkin !== null).map((s) => s.trainingDay),
  );
  const energies = new Set(checkins.map((c) => c.energy));
  const weekdaysRepeated = selectWeekdayStats(p)
    .filter((w) => w.completed + w.skipped >= 2).length;
  // This facet used to require a rough day AND a skip — so someone who never
  // missed a session and never had a bad week was permanently docked 9 points
  // for consistency. What the app actually needs is a spread of conditions to
  // compare, which four weeks of any honest reporting provides. A genuine
  // rough day or skip still completes it faster, because it is more
  // informative; their absence no longer blocks it.
  const roughDay = checkins.some((c) => c.energy <= 3);
  const missedOne = skipped.length > 0;
  const frictionWeeks = weeksWith(completed.map((s) => s.trainingDay));
  const frictionSeen = Math.min(1,
    (roughDay ? 0.5 : 0) + (missedOne ? 0.5 : 0) + clamp01(frictionWeeks / 4) * 0.75);
  const progressed = Object.values(history).filter((h) => {
    if (h.length < 3) return false;
    const newest = h[0];
    const oldest = h[h.length - 1];
    if (!newest || !oldest) return false;
    // A trend needs time behind it, not just two different numbers.
    if (weekOf(newest.trainingDay) - weekOf(oldest.trainingDay) < 1) return false;
    // Bodyweight work progresses in REPS. Comparing weight_kg only meant a
    // home user with no equipment had weight_kg = 0 forever, so this facet
    // (weight 13, the heaviest) was unreachable by construction and capped
    // them at 50 of a 60 gate — for training exactly as prescribed.
    if (newest.weight_kg === 0 && oldest.weight_kg === 0) {
      return newest.reps !== oldest.reps;
    }
    return newest.weight_kg !== oldest.weight_kg;
  }).length;

  const facets: Facet[] = [
    { id: 'lifts', week: 1, weight: 9,
      label: 'What you lift',
      have: clamp01(exercisesSeen / 6),
      detail: exercisesSeen >= 6
        ? `${exercisesSeen} exercises with real numbers against them.`
        : `${exercisesSeen} of 6 exercises baselined — a few more sessions.` },

    { id: 'effort', week: 1, weight: 6,
      label: 'How hard it feels',
      have: clamp01(ratedSets.length / 24),
      detail: ratedSets.length >= 24
        ? `Enough sets rated that I know what "solid" means for you.`
        : `${ratedSets.length} of 24 sets rated — tap Easy/Solid/Hard more often.` },

    { id: 'response', week: 2, weight: 10,
      label: 'How you respond to more weight',
      have: clamp01(exercisesWellKnown / 4),
      detail: exercisesWellKnown >= 4
        ? `I can call the next weight on ${exercisesWellKnown} lifts with confidence.`
        : `${exercisesWellKnown} of 4 lifts seen enough times — that's what lets me move the weight.` },

    { id: 'rhythm', week: 2, weight: 8,
      label: 'Which days you actually train',
      // Repeats, not distinct days — a pattern needs the same day twice.
      have: clamp01(weekdaysRepeated / 3),
      detail: weekdaysRepeated >= 3
        ? `Your week has a shape now.`
        : `${weekdaysRepeated} of 3 days seen more than once — I need repeats to spot a pattern.` },

    { id: 'recovery', week: 3, weight: 12,
      label: 'How you recover',
      have: clamp01(recoveryWeeks / 4),
      detail: recoveryWeeks >= 4
        ? `I know how you recover — where you get sore, and how fast it clears.`
        : `${recoveryWeeks} of 4 weeks of recovery data — this one only comes with time.` },

    { id: 'energy', week: 3, weight: 8,
      label: 'Your good days and bad days',
      have: clamp01(Math.min(energies.size / 3, checkins.length / 12)),
      detail: energies.size >= 3 && checkins.length >= 12
        ? `I've seen you rough, fine and good — and often enough to tell them apart.`
        : `${checkins.length} check-ins so far. I need to see you on more kinds of day.` },

    { id: 'trend', week: 4, weight: 13,
      label: "Whether it's working",
      have: clamp01(progressed / 4),
      detail: progressed >= 4
        ? `${progressed} lifts have moved over time. I can see the direction now.`
        : `${progressed} of 4 lifts have a trend I can read yet.` },

    { id: 'friction', week: 4, weight: 9,
      label: 'What you do on a bad week',
      have: frictionSeen,
      detail: frictionSeen >= 1
        ? `I've seen you train through a rough day and skip one. Both tell me something.`
        : roughDay
          ? `I've seen you train on a bad day. I haven't seen you miss one yet.`
          : `I haven't seen a bad week yet — and I'd rather learn that from a real one than guess.` },
  ];

  const earned = facets.reduce((n, f) => n + f.weight * f.have, 0);
  const percent = Math.round(Math.min(OBSERVABLE_CEILING, earned));

  // Both gates must pass: four weeks of calendar AND enough coverage.
  // Time alone would let someone unlock by waiting; coverage alone would
  // let a six-day-a-week user unlock in nine days, before the app has
  // seen a single bad week.
  const unlocked = weeksIn >= 4 && percent >= 60;

  const weakest = [...facets].filter((f) => f.have < 1)
    .sort((a, b) => b.weight * (1 - b.have) - a.weight * (1 - a.have))[0];

  const thisWeek = Math.min(4, weeksIn + 1) as 1 | 2 | 3 | 4;
  const done = facets.filter((f) => f.week <= thisWeek && f.have >= 1);

  return {
    percent, facets, sessions: completed.length, weeksIn, unlocked,
    headline: done.length > 0
      ? done[done.length - 1]!.detail
      : 'Just getting started — every set you log tells me something.',
    missing: weakest ? weakest.detail : 'I have what I need.',
  };
}

/** What the app says at the end of each week. Derived, not scripted. */
export function weeklyReveal(state: ContextState): { title: string; lines: string[] } {
  const w = Math.min(4, state.weeksIn) as 0 | 1 | 2 | 3 | 4;
  const ready = state.facets.filter((f) => f.week <= Math.max(1, w) && f.have >= 1);
  const titles: Record<number, string> = {
    0: 'Week one underway',
    1: 'One week in — I know what you lift',
    2: 'Two weeks — I know how you respond',
    3: 'Three weeks — I know your rhythm',
    4: 'Four weeks — I know how you train',
  };
  return {
    title: titles[w] ?? titles[4]!,
    lines: [
      ...ready.map((f) => f.detail),
      // The "the rest I have to ask you" line promised a conversation. Kept
      // the honest half; the invitation returns when there is something to
      // accept it (Phase 8).
      state.unlocked
        ? 'That is about as much as I can learn by watching you train.'
        : state.missing,
    ],
  };
}
