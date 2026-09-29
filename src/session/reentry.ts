import type { SkipReason } from '../events/session';

// ─── Re-entry policy (ARCHITECTURE §9 Scenario F) ────────────────────
// Deterministic. Code picks the numbers; wording is separate and
// replaceable. Re-entry is GRADED, not binary — "restart vs continue" is
// the wrong frame.
//
// The bands follow detraining research: strength holds for ~2-3 weeks,
// meaningful loss by 4-8 weeks, muscle memory makes regain much faster
// than the original build. The ramp exists to protect connective tissue,
// which deconditions slower than muscle AND re-adapts slower — post-layoff
// injuries come from doing too much on day one, not from being weak.
//
// ⚠️ ALL USER-FACING STRINGS BELOW ARE PLACEHOLDERS pending the founder's
// own words after he lives through a real gap.

export type ReentryMode =
  | 'none'       // not a gap. Say nothing at all
  | 'continue'   // nothing measurable lost
  | 'ease_back'  // small loss, back to normal within 1-3 weeks
  | 'rebuild'    // real loss, ramp over 3-4 weeks
  | 'restart';   // new block, conservative start

export type ReentryInput = {
  gapDays: number;
  /** Reasons recorded during the gap, if the user logged any. */
  skipReasons: SkipReason[];
  /** Completed sessions before the gap — evidence for the reframe. */
  sessionsBefore: number;
  /** Trailing adherence before the gap, as completed/expected. */
  adherenceBefore?: { completed: number; expected: number };
  /** Best lift of the last completed session, for the "you were strong" line. */
  bestLift?: { name: string; weight_kg: number; reps: number };
  /**
   * The user's own training frequency. Without it, "a gap" is an absolute
   * number of days and a twice-a-week trainer is treated as lapsed every
   * week. Defaults to 4 when unknown.
   */
  daysPerWeek?: number;
};

export type ReentryPolicy = {
  mode: ReentryMode;
  /** Multiply prescribed loads by this. 1 = unchanged. */
  loadMultiplier: number;
  /** Multiply prescribed sets by this. */
  volumeMultiplier: number;
  /** Weeks to ramp back to full. 0 = already there. */
  rampWeeks: number;
  /** Whether the app should say anything at all. */
  speak: boolean;
  /** PLACEHOLDER — the opening statement. Founder to rewrite. */
  headline: string;
  /** PLACEHOLDER — evidence lines that reframe the gap. Founder to rewrite. */
  evidence: string[];
  /** Why the ramp exists, if there is one. PLACEHOLDER. */
  rationale: string;
};

type Band = {
  maxDays: number;
  mode: ReentryMode;
  load: number;
  volume: number;
  ramp: number;
};

// Upper bound of each band, in days since the last completed session.
const BANDS: Band[] = [
  { maxDays: 3,     mode: 'none',      load: 1.0,  volume: 1.0,  ramp: 0 },
  { maxDays: 10,    mode: 'continue',  load: 1.0,  volume: 1.0,  ramp: 0 },
  { maxDays: 21,    mode: 'ease_back', load: 0.93, volume: 0.9,  ramp: 1 },
  { maxDays: 56,    mode: 'ease_back', load: 0.85, volume: 0.8,  ramp: 2 },
  { maxDays: 120,   mode: 'rebuild',   load: 0.75, volume: 0.75, ramp: 3 },
  { maxDays: 99999, mode: 'restart',   load: 0.65, volume: 0.7,  ramp: 4 },
];

function bandFor(gapDays: number): Band {
  return BANDS.find((b) => gapDays <= b.maxDays) ?? BANDS[BANDS.length - 1]!;
}

/** The dominant reason given during the gap, if any. */
function dominantReason(reasons: SkipReason[]): SkipReason | undefined {
  if (reasons.length === 0) return undefined;
  const counts = new Map<SkipReason, number>();
  for (const r of reasons) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * Whether the gap was physiological or narrative.
 *
 * This is the split that matters most: someone off with illness genuinely
 * lost capacity. Someone who simply stopped lost almost nothing — and for
 * them the right response is PROOF OF RETENTION, not sympathy.
 */
export function isPhysiological(reason: SkipReason | undefined): boolean {
  return reason === 'illness';
}

export function reentryPolicy(input: ReentryInput): ReentryPolicy {
  const { gapDays, skipReasons, sessionsBefore, adherenceBefore, bestLift } = input;
  let band = bandFor(gapDays);

  // A GAP IS ONLY A GAP RELATIVE TO YOUR OWN RHYTHM. The bands are absolute
  // days, so 'continue' fired from four days off — which is the NORMAL
  // spacing for someone training twice a week (Mon/Thu). Because this screen
  // replaces Home entirely, a 2-day-a-week user met the lapse screen every
  // single Monday, with no route to their goal, their setup, or the session
  // preview. Suppress it until the gap is genuinely longer than their week.
  const perWeek = input.daysPerWeek ?? 4;
  const normalGap = 7 / Math.max(1, perWeek);
  // Two conditions, both required: more than twice their usual spacing, AND
  // at least five days. The second stops a 6x/week user being told they
  // lapsed after three days off.
  if (band.mode === 'continue' && (gapDays < 5 || gapDays <= normalGap * 2)) {
    band = BANDS[0]!; // 'none' — nothing worth saying
  }
  const reason = dominantReason(skipReasons);

  // Illness costs more than the calendar alone implies.
  const illnessPenalty = isPhysiological(reason) ? 0.95 : 1;
  const loadMultiplier = Math.round(band.load * illnessPenalty * 100) / 100;

  if (band.mode === 'none') {
    return {
      mode: 'none',
      loadMultiplier: 1,
      volumeMultiplier: 1,
      rampWeeks: 0,
      speak: false,
      headline: '',
      evidence: [],
      rationale: '',
    };
  }

  // ── PLACEHOLDER COPY — founder to replace after a real gap ──────────
  const headline =
    gapDays <= 10
      ? `${gapDays} days off.`
      : `You've been away ${gapDays} days.`;

  const evidence: string[] = [];
  if (sessionsBefore > 0) {
    evidence.push(
      sessionsBefore === 1
        ? `You trained once before that. Second sessions are the hard ones.`
        : `Before that you trained ${sessionsBefore} times. That's the pattern — this is the exception.`,
    );
  }
  // Only when it says something encouraging AND is about the period BEFORE
  // the gap. The caller used to pass the CURRENT trailing window, which by
  // construction is mostly gap — so this printed "You'd hit 0 of your last
  // 12" on a screen whose own header promises no guilt.
  if (adherenceBefore && adherenceBefore.expected > 0 && adherenceBefore.completed > 0) {
    evidence.push(
      `You'd hit ${adherenceBefore.completed} of your last ${adherenceBefore.expected}.`,
    );
  }
  if (bestLift) {
    evidence.push(
      `Your last session had ${bestLift.name} at ${bestLift.weight_kg}kg × ${bestLift.reps}.`,
    );
  }

  let rationale: string;
  if (band.mode === 'continue') {
    rationale = "Nothing measurable is gone. Pick up where you left off.";
  } else if (isPhysiological(reason)) {
    rationale = `Being ill costs more than the days do. Starting at ${Math.round(loadMultiplier * 100)}% and building back over ${band.ramp} week${band.ramp === 1 ? '' : 's'}.`;
  } else if (reason === 'travel') {
    rationale = `Travel costs less than it feels like. ${Math.round(loadMultiplier * 100)}% today, back to full inside ${band.ramp} week${band.ramp === 1 ? '' : 's'}.`;
  } else {
    // The narrative case — the body barely changed; lead with retention.
    rationale = `You've lost less than it feels like. Starting at ${Math.round(loadMultiplier * 100)}% — not because you're weak, but because tendons re-adapt slower than muscle.`;
  }

  return {
    mode: band.mode,
    loadMultiplier,
    volumeMultiplier: band.volume,
    rampWeeks: band.ramp,
    speak: true,
    headline,
    evidence,
    rationale,
  };
}

/** Apply the policy to a prescribed load. Never rounds up. */
export function scaleLoad(weight: number, policy: ReentryPolicy): number {
  if (weight <= 0) return 0;
  return Math.floor((weight * policy.loadMultiplier) / 1.25) * 1.25;
}

/** Apply the policy to prescribed sets. Never drops below one. */
export function scaleSets(sets: number, policy: ReentryPolicy): number {
  return Math.max(1, Math.round(sets * policy.volumeMultiplier));
}
