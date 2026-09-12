import type { Event } from '../events';
import type { GoalKind } from '../events/goal';

// ─── Projection state ────────────────────────────────────────────────

export type CurrentGoalProjection = {
  goalId: string | null;
  goalType: GoalKind | null;
  why: string;                  // empty when not set
  targetDate: string | null;    // ISO YYYY-MM-DD
  revisionCount: number;        // bumps on each GoalRevised
  lastSeq: number;
};

export const INITIAL_GOAL: CurrentGoalProjection = {
  goalId: null,
  goalType: null,
  why: '',
  targetDate: null,
  revisionCount: 0,
  lastSeq: -1,
};

// ─── Reducer ─────────────────────────────────────────────────────────

export function applyGoalEvent(
  state: CurrentGoalProjection,
  event: Event,
): CurrentGoalProjection {
  if (event.type === 'GoalCreated') {
    return {
      goalId: event.payload.goalId,
      goalType: event.payload.goalType,
      why: event.payload.why,
      targetDate: event.payload.targetDate,
      revisionCount: 0,
      lastSeq: event.seq,
    };
  }

  if (event.type === 'GoalRevised') {
    // Only apply if it targets the currently active goal.
    if (state.goalId !== event.payload.goalId) return state;

    const next: CurrentGoalProjection = {
      ...state,
      revisionCount: state.revisionCount + 1,
      lastSeq: event.seq,
    };
    switch (event.payload.field) {
      case 'why':
        if (typeof event.payload.after === 'string') next.why = event.payload.after;
        break;
      case 'targetDate':
        if (typeof event.payload.after === 'string') next.targetDate = event.payload.after;
        break;
      case 'goalType':
        if (typeof event.payload.after === 'string') {
          next.goalType = event.payload.after as GoalKind;
        }
        break;
    }
    return next;
  }

  return state;
}

// ─── Builder ─────────────────────────────────────────────────────────

export function buildGoalProjection(events: Event[]): CurrentGoalProjection {
  return events.reduce(applyGoalEvent, INITIAL_GOAL);
}
