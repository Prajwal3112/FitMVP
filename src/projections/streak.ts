import type { Event } from '../events';

// ─── Projection state ────────────────────────────────────────────────
// ARCHITECTURE §4 StreakStats + the adherence counters CompletionScreen
// needs. Invariant §8.1: `current` moves only on SessionCompleted.
//
// Skips do NOT break the streak — BLUEPRINT Phase 6 is explicit about
// that ("no streak break, per your spec"), and it matches the behaviour
// the legacy in-memory counter had. Note this leaves `current` monotonic,
// which sits awkwardly with the name; revisit when ARCHITECTURE §9
// pins down the streak story.

export type StreakProjection = {
  current: number;
  longest: number;
  lastCompletedDay: string | null;
  totalCompleted: number;
  totalSkipped: number;
  lastSeq: number;
};

export const INITIAL_STREAK: StreakProjection = {
  current: 0,
  longest: 0,
  lastCompletedDay: null,
  totalCompleted: 0,
  totalSkipped: 0,
  lastSeq: -1,
};

// ─── Reducer ─────────────────────────────────────────────────────────

export function applyStreakEvent(
  state: StreakProjection,
  event: Event,
): StreakProjection {
  if (event.type === 'SessionCompleted') {
    const current = state.current + 1;
    return {
      current,
      longest: Math.max(state.longest, current),
      lastCompletedDay: event.trainingDay,
      totalCompleted: state.totalCompleted + 1,
      totalSkipped: state.totalSkipped,
      lastSeq: event.seq,
    };
  }

  if (event.type === 'SessionSkipped') {
    // A skip deliberately does NOT reset `current` (BLUEPRINT Phase 6).
    // That makes `longest` identical to `totalCompleted` — which looks like
    // a bug and isn't: this app refuses to punish the lapse, because the
    // lapse is the exact moment a person decides whether to come back.
    // The display is what needs fixing, not this.
    return {
      ...state,
      totalSkipped: state.totalSkipped + 1,
      lastSeq: event.seq,
    };
  }

  return state;
}

// ─── Builder ─────────────────────────────────────────────────────────

export function buildStreakProjection(events: Event[]): StreakProjection {
  return events.reduce(applyStreakEvent, INITIAL_STREAK);
}

// ─── Selectors ───────────────────────────────────────────────────────

/** Completed / (completed + skipped), as a percentage. 0 when no days logged. */
export function selectAdherencePct(p: StreakProjection): number {
  const logged = p.totalCompleted + p.totalSkipped;
  if (logged === 0) return 0;
  return Math.round((p.totalCompleted / logged) * 100);
}

/** Total days logged either way. */
export function selectDaysLogged(p: StreakProjection): number {
  return p.totalCompleted + p.totalSkipped;
}
