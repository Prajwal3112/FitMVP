import raw from './warmups.json';
import type { EquipmentTier } from '../events/userContext';

// ─── Warm-up and cool-down ───────────────────────────────────────────
// 137 movements the strength import had thrown away: 123 stretches and
// 14 cardio, covering all 16 muscle groups.
//
// THE DISTINCTION THAT MATTERS: dynamic movement goes BEFORE lifting,
// held stretches go AFTER. Static stretching immediately before strength
// work transiently reduces force output — the opposite of what a warm-up
// is for. Everything here is split on that line.

export type WarmupKind = 'cardio' | 'dynamic' | 'static';

export type Warmup = {
  id: string;
  name: string;
  eq: string;
  tier: 'home' | 'gym';
  kind: WarmupKind;
  pm: string[];
  sm: string[];
};

export const WARMUPS = raw as Warmup[];

const available = (w: Warmup, tier: EquipmentTier, owned: string[]) =>
  tier !== 'home' || w.eq === 'body only' || owned.includes(w.eq);

/** Does this movement touch any of the day's muscles? */
const touches = (w: Warmup, muscles: string[]) => {
  const set = new Set(muscles.map((m) => m.toLowerCase()));
  return [...w.pm, ...w.sm].some((m) => set.has(m.toLowerCase()));
};

export type WarmupPlan = {
  /** 3–5 minutes of general movement to raise temperature. */
  raise: Warmup[];
  /** Dynamic mobility for the muscles today will actually load. */
  mobilise: Warmup[];
  /** Minutes the whole thing should take. */
  minutes: number;
};

/**
 * Before the session: raise temperature, then mobilise what you're about
 * to train. The *specific* warm-up — ramping sets of the day's actual
 * lifts — is prescribed separately by the scheduler, because the best
 * preparation for benching is lighter benching.
 */
export function buildWarmup(
  dayMuscles: string[],
  tier: EquipmentTier,
  owned: string[] = [],
  count = 4,
): WarmupPlan {
  const pool = WARMUPS.filter((w) => available(w, tier, owned));
  const raise = pool.filter((w) => w.kind === 'cardio').slice(0, 1);
  const mobilise = pool
    .filter((w) => w.kind === 'dynamic' && touches(w, dayMuscles))
    .slice(0, count);

  // Not enough dynamic work tagged for these muscles — widen to any
  // dynamic movement rather than fall back to static, which would be
  // actively counterproductive before lifting.
  if (mobilise.length < count) {
    for (const w of pool.filter((x) => x.kind === 'dynamic')) {
      if (mobilise.length >= count) break;
      if (!mobilise.includes(w)) mobilise.push(w);
    }
  }
  return { raise, mobilise, minutes: 5 };
}

/**
 * After the session: held stretches for what you just trained.
 * Optional by design — skipping it must never read as failure.
 */
export function buildCooldown(
  workedMuscles: string[],
  tier: EquipmentTier,
  owned: string[] = [],
  count = 4,
): Warmup[] {
  const pool = WARMUPS.filter(
    (w) => w.kind === 'static' && available(w, tier, owned) && touches(w, workedMuscles),
  );
  // One per muscle where possible, so it isn't four hamstring stretches.
  const seen = new Set<string>();
  const picked: Warmup[] = [];
  for (const w of pool) {
    const key = w.pm[0] ?? 'other';
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(w);
    if (picked.length >= count) break;
  }
  return picked;
}
