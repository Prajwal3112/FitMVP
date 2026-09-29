import type { Event } from '../events';
import type {
  Profile, Routine, EquipmentTier, Constraints, Experience, OwnedEquipment,
} from '../events/userContext';

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
  experience: Experience | null;
  ownedEquipment: OwnedEquipment[];
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
  experience: null,
  ownedEquipment: [],
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
      experience: event.payload.experience ?? null,
      ownedEquipment: event.payload.ownedEquipment ?? [],
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
      case 'experience':
        if (typeof after === 'string') next.experience = after as Experience;
        break;
      case 'equipment':
        if (typeof after === 'string') next.equipment = after as EquipmentTier;
        break;
      case 'constraints.sessionMaxMinutes':
        if (typeof after === 'number' && next.constraints) {
          next.constraints = { ...next.constraints, sessionMaxMinutes: after };
        }
        break;
      case 'ownedEquipment':
        if (Array.isArray(after)) next.ownedEquipment = after as OwnedEquipment[];
        break;
      case 'constraints.daysPerWeek':
        if (typeof after === 'number' && next.constraints) {
          next.constraints = { ...next.constraints, daysPerWeek: after };
        }
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
