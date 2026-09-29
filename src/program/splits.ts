import type { GoalKind } from '../events/goal';
import type { Experience, EquipmentTier } from '../events/userContext';

// ─── Split selection ─────────────────────────────────────────────────
// Specced by a strength coach, 2026-09-25. Evidence markers kept from the
// source: [E] controlled research, [C] convention, [X] judgement call.
//
// GOVERNING PRINCIPLE: frequency per muscle is what matters, not the
// name of the split. 2x/week beats 1x when weekly volume is equated [E];
// past 2x the gain is small and inconsistent [E]. Every row below falls
// out of "hit each muscle ~2x within the days available".

export type DayType = 'FB' | 'UPPER' | 'LOWER' | 'PUSH' | 'PULL' | 'LEGS' | 'RECOVERY';

export type SplitId =
  | 'FULL_BODY_2' | 'FULL_BODY_3'
  | 'UPPER_LOWER_2' | 'UPPER_LOWER_4' | 'UPPER_LOWER_5'
  | 'PPL_3' | 'PPL_UL_5' | 'PPL_6';

export const SPLITS: Record<SplitId, { name: string; sequence: DayType[] }> = {
  FULL_BODY_2:   { name: 'Full body',            sequence: ['FB', 'FB'] },
  FULL_BODY_3:   { name: 'Full body',            sequence: ['FB', 'FB', 'FB'] },
  UPPER_LOWER_2: { name: 'Upper / Lower',        sequence: ['UPPER', 'LOWER'] },
  PPL_3:         { name: 'Push / Pull / Legs',   sequence: ['PUSH', 'PULL', 'LEGS'] },
  UPPER_LOWER_4: { name: 'Upper / Lower',        sequence: ['UPPER', 'LOWER', 'UPPER', 'LOWER'] },
  UPPER_LOWER_5: { name: 'Upper / Lower + full', sequence: ['UPPER', 'LOWER', 'UPPER', 'LOWER', 'FB'] },
  PPL_UL_5:      { name: 'Push / Pull / Legs + Upper / Lower', sequence: ['PUSH', 'PULL', 'LEGS', 'UPPER', 'LOWER'] },
  PPL_6:         { name: 'Push / Pull / Legs ×2', sequence: ['PUSH', 'PULL', 'LEGS', 'PUSH', 'PULL', 'LEGS'] },
};

/** Experience collapses to three tiers for programming purposes. */
export type Tier = 'novice' | 'intermediate' | 'advanced';

export function tierOf(exp: Experience | null): Tier {
  if (exp === 'experienced') return 'advanced';
  if (exp === 'regular') return 'intermediate';
  return 'novice'; // 'new', 'returning', or unknown
}

export type SplitChoice = {
  splitId: SplitId;
  /** Display name, e.g. "Push / Pull / Legs". */
  name?: string;
  /** Shown to the user, in their words. */
  why: string;
  /** Something the app must say out loud rather than degrade silently. */
  warning?: string;
};

export function selectSplit(
  daysPerWeek: number,
  experience: Experience | null,
  goal: GoalKind | null,
  equipment: EquipmentTier,
  sessionMaxMinutes = 60,
): SplitChoice {
  const named = (c: SplitChoice): SplitChoice => ({ ...c, name: SPLITS[c.splitId].name });
  const tier = tierOf(experience);
  const days = Math.max(2, Math.min(6, Math.round(daysPerWeek)));

  // Fat loss at low frequency biases to full body: total expenditure and
  // frequency beat per-session specialisation. [C]
  const fatLossBias = goal === 'fat_loss' && days <= 3;

  switch (days) {
    case 2:
      // Two sessions must cover everything — any split leaves muscles at
      // 1x or 0.5x. No exceptions for novices.
      if (tier === 'advanced' && !fatLossBias && sessionMaxMinutes < 75) {
        return named({
          splitId: 'UPPER_LOWER_2',
          why: 'Two days, so we split upper and lower to keep each session a sensible length.',
        });
      }
      return named({
        splitId: 'FULL_BODY_2',
        why: 'Two days a week means full body both times — it is the only way to train everything twice.',
        ...(goal === 'hypertrophy'
          ? { warning: 'At two days a week you can reach about 8–10 sets per muscle. That works, but it builds muscle slowly. A third day would change that more than anything else you could do.' }
          : {}),
      });

    case 3:
      // Departure from gym convention: PPL at 3 days gives every muscle
      // 1x/week, the WORST frequency available at that day count. [E]
      // It is popular because it is easy to remember, not because it works.
      if (tier === 'advanced' && !fatLossBias) {
        return named({ splitId: 'PPL_3', why: 'Three days of push, pull and legs — enough volume per session at your level.' });
      }
      return named({
        splitId: 'FULL_BODY_3',
        why: 'Three full-body days. Each muscle gets trained three times a week, which beats splitting them up at this frequency.',
      });

    case 4:
      return named({ splitId: 'UPPER_LOWER_4', why: 'Upper and lower, twice each. Everything gets trained twice a week.' });

    case 5:
      if (tier === 'advanced') {
        return named({ splitId: 'PPL_UL_5', why: 'Push, pull and legs, then an upper and lower day — sharper focus per session.' });
      }
      return named({ splitId: 'UPPER_LOWER_5', why: 'Upper and lower twice each, plus a full-body day to finish the week.' });

    default: // 6
      if (tier === 'novice') {
        return named({
          splitId: 'FULL_BODY_3',
          why: 'Three full-body days to start with.',
          warning: 'You said six days. Starting there almost never lasts — three sessions you actually do beat six you abandon. You can change this whenever you want.',
        });
      }
      return named({ splitId: 'PPL_6', why: 'Push, pull and legs twice through. Everything twice a week.' });
  }
}

// ─── Honesty checks ──────────────────────────────────────────────────
// Some goal/equipment combinations cannot be delivered. Say so at
// onboarding rather than letting someone find out at month four.

export type Feasibility = { achievable: boolean; reason?: string };

export function goalFeasibility(
  goal: GoalKind | null,
  equipment: EquipmentTier,
  ownedEquipment: string[],
  daysPerWeek: number,
): Feasibility {
  const loadable = equipment !== 'home' ||
    ownedEquipment.some((e) => e !== 'body only' && e !== 'bands');

  if (goal === 'strength' && !loadable) {
    return {
      achievable: false,
      reason: 'You can build real strength with bodyweight for a few months. After that you need something to add load to — even a backpack works.',
    };
  }
  if (goal === 'hypertrophy' && daysPerWeek <= 2) {
    return {
      achievable: true,
      reason: 'Two days a week builds muscle, just slowly. Worth knowing up front.',
    };
  }
  return { achievable: true };
}

/** Bands give ascending resistance and no readable load — reps, not kilos. */
export function progressionMode(
  equipment: EquipmentTier,
  ownedEquipment: string[],
): 'load' | 'reps' {
  if (equipment !== 'home') return 'load';
  const hasLoad = ownedEquipment.some((e) =>
    ['dumbbell', 'kettlebells', 'barbell', 'e-z curl bar', 'machine'].includes(e));
  return hasLoad ? 'load' : 'reps';
}
