import { RECOVERY_HOURS } from '../program/resolve';
import { trainingDayOf } from '../events/base';

// ─── "When can I do the next one?" ───────────────────────────────────
// Asked out loud after an hour on a real phone, and the app had no answer
// anywhere. It could not have had one: it never asked how many days a week
// (hardcoded 4) until the onboarding rebuild, and it has no calendar — THE
// ROTATION ADVANCES ON COMPLETION, NEVER THE DATE. So there is no "your next
// session is Thursday" to give, and inventing one would be the first lie in
// an app whose whole pitch is that it does not pretend to know things.
//
// What can be said honestly, from data already in the log:
//   - the floor: 36h before the same muscles are loaded again, which is the
//     figure resolveSession already enforces
//   - the rhythm: a 4-day week is a session every ~1.75 days
//   - the fact that going sooner is allowed, because the next day in the
//     rotation trains something else

const DAYS_PER_WEEK = 7;

export type NextSession = {
  /** Hours until the recovery floor clears. 0 when it already has. */
  hoursToFloor: number;
  /** One line for the screen. */
  label: string;
  /** Why that, in the user's terms. Never a promise about a date. */
  detail: string;
};

/**
 * @param lastCompletedAt ISO timestamp of the last completed session, or null.
 * @param daysPerWeek     What they said they could realistically do.
 * @param now             Injected, so this is testable and so the 4am
 *                        rollover cannot drift out from under it.
 */
export function selectNextSession(
  lastCompletedAt: string | null,
  daysPerWeek: number,
  now: Date,
  rolloverHour = 4,
): NextSession {
  if (lastCompletedAt === null) {
    return {
      hoursToFloor: 0,
      label: 'Whenever you are ready',
      detail: 'Nothing logged yet, so there is nothing to recover from.',
    };
  }

  const last = new Date(lastCompletedAt);
  const elapsedHours = (now.getTime() - last.getTime()) / 3_600_000;
  if (!Number.isFinite(elapsedHours)) {
    return {
      hoursToFloor: 0,
      label: 'Whenever you are ready',
      detail: 'Nothing is holding you back.',
    };
  }

  // The rhythm their own answer implies. 3 days → every 2.3 days; 6 → daily.
  // A RANGE when the figure is not a whole number of days, because rounding
  // lied: 7/2 = 3.5 rounded to "every 4 days", which is 1.75 sessions a week,
  // not the two they committed to.
  const spacingDays = DAYS_PER_WEEK / Math.max(1, daysPerWeek);
  const lo = Math.floor(spacingDays);
  const hi = Math.ceil(spacingDays);
  const every = lo === hi ? `${lo} days` : `${lo} to ${hi} days`;
  const rhythm = spacingDays <= 1.2
    ? 'Your week is most days, so tomorrow is the plan.'
    : `${daysPerWeek} days a week works out at a session every ${
        spacingDays < 2 ? 'other day or so' : every
      }.`;

  const hoursToFloor = Math.max(0, RECOVERY_HOURS - elapsedHours);
  if (hoursToFloor <= 0) {
    const days = Math.floor(elapsedHours / 24);
    return {
      hoursToFloor: 0,
      label: 'Ready when you are',
      detail: `It has been ${days} day${days === 1 ? '' : 's'}. ${rhythm}`,
    };
  }

  // Under the floor.
  //
  // THE LABEL ANSWERS "WHEN CAN I TRAIN", NOT "WHEN CAN I REPEAT TODAY".
  // Those are different questions and conflating them produced a direct
  // contradiction: a 6-day lifter was shown "The day after tomorrow" over a
  // line reading "your week is most days, so tomorrow is the plan". The
  // rotation trains something else tomorrow, so tomorrow is always available
  // — the 36h floor is about the same muscle group, which is the detail's job.
  //
  // Never "in 14 hours", which invites someone to train at 2am to beat a
  // counter. The same-muscle day is measured in DAYS on the 4am boundary via
  // trainingDayOf, not in hours-remaining: finishing at 5pm Sunday puts the
  // floor at 5am Tuesday, which no hours-vs-24 comparison gets right.
  const floorAt = new Date(last.getTime() + RECOVERY_HOURS * 3_600_000);
  const dayDelta = Math.round(
    (Date.parse(trainingDayOf(floorAt, rolloverHour))
      - Date.parse(trainingDayOf(now, rolloverHour))) / 86_400_000,
  );
  const sameMuscleDay =
    dayDelta <= 0 ? 'later today' : dayDelta === 1 ? 'tomorrow' : 'the day after tomorrow';
  // The headline has to agree with the rhythm line under it. "Tomorrow" over
  // "2 days a week works out at a session every 3 to 4 days" is the same kind
  // of contradiction, one layer down.
  const SPARSE_WEEK_DAYS = 2.5;
  return {
    hoursToFloor: Math.ceil(hoursToFloor),
    label: spacingDays >= SPARSE_WEEK_DAYS
      ? 'In a day or two'
      : dayDelta <= 0 ? 'Later today' : 'Tomorrow',
    detail:
      `${rhythm} Today's muscles want about ${RECOVERY_HOURS} hours, so ` +
      `${sameMuscleDay} before you load them again — tomorrow trains something else.`,
  };
}
