import type { SessionsProjection } from '../projections/sessions';
import { workingSets } from '../projections/sessions';
import type { ContextState } from '../context/completeness';
import type { UserContextProjection } from '../projections/userContext';

/**
 * A compact, human-readable dump of everything a tester's log knows.
 *
 * Deliberately NOT the raw event JSON. Three reasons: the raw log for four
 * weeks is ~100KB, which Android's share sheet silently truncates; nobody
 * reads JSON in a WhatsApp thread; and the raw log carries the free-text
 * "why" a tester wrote down, which they did not agree to hand over. This
 * keeps behaviour and drops prose.
 *
 * Behavioural data beats opinions — a tester who says "it was fine" and a
 * digest showing they stopped after session 3 are telling you two very
 * different things, and only one of them is true.
 */
export function buildDigest(
  sessions: SessionsProjection,
  ctx: ContextState,
  profile: UserContextProjection,
  appVersion: string,
  unreadable: { seq: number; type: string; reason: string }[] = [],
): string {
  const all = sessions.order
    .map((id) => sessions.byId[id])
    .filter((s): s is NonNullable<typeof s> => !!s);
  const completed = all.filter((s) => s.status === 'completed');
  const skipped = all.filter((s) => s.status === 'skipped');
  const abandoned = all.filter((s) => s.status === 'active' || s.status === 'scheduled');

  const L: string[] = [];
  L.push(`FitMVP test data · build ${appVersion}`);
  L.push(`generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
  L.push('');
  L.push(`SETUP`);
  L.push(`  experience: ${profile.experience ?? '—'}`);
  L.push(`  days/week: ${profile.constraints?.daysPerWeek ?? '—'}   session cap: ${profile.constraints?.sessionMaxMinutes ?? '—'} min`);
  L.push(`  trains at: ${profile.equipment ?? '—'}`);
  L.push(`  owns: ${profile.ownedEquipment.length > 0 ? profile.ownedEquipment.join(', ') : '—'}`);
  L.push(`  injuries: ${profile.knownInjuries.length > 0 ? profile.knownInjuries.join(', ') : 'none'}`);
  L.push(`  bodyweight: ${profile.profile?.weight_kg ?? '—'} kg`);
  L.push('');
  if (unreadable.length > 0) {
    L.push(`⚠ ${unreadable.length} UNREADABLE ROW(S) — projections below are incomplete`);
    for (const u of unreadable.slice(0, 5)) L.push(`    seq ${u.seq} ${u.type}: ${u.reason}`);
    L.push('');
  }
  // Verdict tally up top — it is the first thing worth reading.
  const reviewed = completed.filter((s) => s.review !== null);
  if (reviewed.length > 0) {
    const tally = (v: string) => reviewed.filter((s) => s.review?.verdict === v).length;
    L.push(`VERDICTS  ${tally('too_easy')} too easy · ${tally('about_right')} about right · ${tally('too_much')} too much`);
    const allGripes = reviewed.flatMap((s) => s.review?.gripes ?? []);
    if (allGripes.length > 0) {
      const counts = new Map<string, number>();
      for (const g of allGripes) counts.set(g, (counts.get(g) ?? 0) + 1);
      L.push(`GRIPES    ${[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g}×${n}`).join(' · ')}`);
    }
    L.push('');
  }
  L.push(`SESSIONS  ${completed.length} done · ${skipped.length} skipped · ${abandoned.length} started-not-finished`);
  L.push(`  context: ${Math.round(ctx.percent)}% · week ${ctx.weeksIn} · ${ctx.unlocked ? 'unlocked' : 'locked'}`);
  L.push('');

  for (const s of all) {
    const w = workingSets(s.setLog);
    const mark = s.status === 'completed' ? '✓' : s.status === 'skipped' ? '×' : '…';
    L.push(`${mark} ${s.trainingDay}  ${s.workoutName}  [${s.status}]`);
    if (s.checkin) {
      const sore = s.checkin.soreness.map((x) => `${x.muscle}${x.level}`).join(' ');
      L.push(`    energy ${s.checkin.energy}${sore ? ` · sore: ${sore}` : ''}`);
    }
    if (s.skipReason) L.push(`    reason: ${s.skipReason}`);
    // THE REASON THIS FILE EXISTS. Everything else here is derived; this is
    // the tester's own judgement of whether the session was any good, which
    // is the one thing the engine cannot work out for itself.
    if (s.review) {
      L.push(`    ▸ VERDICT: ${s.review.verdict}`);
      if (s.review.gripes.length > 0) L.push(`      gripes: ${s.review.gripes.join(', ')}`);
      if (s.review.note) L.push(`      "${s.review.note}"`);
    } else if (s.status === 'completed') {
      L.push(`    ▸ no review (completed before reviews were required)`);
    }
    // Prescribed vs logged is the number that matters — it shows where in
    // the session people actually stop.
    const prescribed = s.exercises.reduce((n, e) => n + e.sets, 0);
    if (s.exercises.length > 0) {
      L.push(`    prescribed ${s.exercises.length} exercises / ${prescribed} sets · logged ${w.length} sets`);
    }
    for (const e of s.exercises) {
      const mine = w.filter((x) => x.exerciseId === e.exerciseId);
      if (mine.length === 0) {
        L.push(`      · ${e.name} — nothing logged`);
        continue;
      }
      const detail = mine
        .map((x) => `${x.weight_kg || 'bw'}×${x.reps}${x.rpe !== undefined ? `@${x.rpe}` : ''}`)
        .join(' ');
      L.push(`      · ${e.name}: ${detail}`);
    }
    for (const sub of s.substitutions) {
      L.push(`      swapped ${sub.originalExerciseId} → ${sub.substituteExerciseId} (${sub.reason})`);
    }
    L.push('');
  }

  if (all.length === 0) L.push('(no sessions logged yet)');
  return L.join('\n');
}
