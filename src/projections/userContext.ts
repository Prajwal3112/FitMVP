import type { Event } from '../events';
import type { Profile, Routine, EquipmentTier, Constraints } from '../events/userContext';

// ─── Projection state ────────────────────────────────────────────────
// The "current view" of who the user is. Derived from events, never set directly.

export type UserContextProjection = {
  isOnboarded: boolean;
  profile: Profile | null;
  routine: Routine | null;
  equipment: EquipmentTier | null;
  constraints: Constraints | null;
  knownInjuries: string[];
  dayRolloverHour: number;
  lastSeq: number;            // last event seq folded into this state
};

export const INITIAL_USER_CONTEXT: UserContextProjection = {
  isOnboarded: false,
  profile: null,
  routine: null,
  equipment: null,
  constraints: null,
  knownInjuries: [],
  dayRolloverHour: 4,
  lastSeq: -1,
};

// ─── Reducer ─────────────────────────────────────────────────────────
// Pure function: state + event → new state.
// Events this projection doesn't care about pass through unchanged.

export function applyUserContextEvent(
  state: UserContextProjection,
  event: Event,
): UserContextProjection {
  if (event.type === 'UserContextCreated') {
    return {
      isOnboarded: true,
      profile: event.payload.profile,
      routine: event.payload.routine,
      equipment: event.payload.equipment,
      constraints: event.payload.constraints,
      knownInjuries: event.payload.knownInjuries,
      dayRolloverHour: event.payload.dayRolloverHour,
      lastSeq: event.seq,
    };
  }

  if (event.type === 'UserContextUpdated') {
    // Minimal field-level patch. Handles top-level keys only for v1.
    // Dotted-path support (e.g., "profile.weight_kg") comes when we
    // actually need it from the LLM-driven adaptation flow.
    const { field, after } = event.payload;
    const next: UserContextProjection = { ...state, lastSeq: event.seq };
    switch (field) {
      case 'knownInjuries':
        if (Array.isArray(after)) {
          next.knownInjuries = after.filter((x): x is string => typeof x === 'string');
        }
        break;
      case 'dayRolloverHour':
        if (typeof after === 'number') next.dayRolloverHour = after;
        break;
      default:
        // Unknown field — log via dev tools but don't crash the projection.
        // eslint-disable-next-line no-console
        console.warn(`[userContext.projection] unhandled UserContextUpdated field: ${field}`);
    }
    return next;
  }

  return state;
}

// ─── Builder ─────────────────────────────────────────────────────────
// Fold a stream of events into the current projection state.

export function buildUserContextProjection(events: Event[]): UserContextProjection {
  return events.reduce(applyUserContextEvent, INITIAL_USER_CONTEXT);
}
