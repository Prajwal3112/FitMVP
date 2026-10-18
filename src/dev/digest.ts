import type { SessionsProjection } from '../projections/sessions';
import { workingSets, selectSessionProgress } from '../projections/sessions';
import { exerciseName } from '../data/exercises';
import type { CurrentGoalProjection } from '../projections/goal';
import type { ContextState } from '../context/completeness';
import type { UserContextProjection } from '../projections/userContext';

/**
 * A compact, human-readable dump of everything a tester's log knows.
 *
 * Deliberately NOT the raw event JSON: four weeks is ~100KB, which Android's
 * share sheet silently truncates, and nobody reads JSON in a chat thread.
 *
 * Behavioural data beats opinions — a tester who says "it was fine" and a
 * digest showing they stopped after session 3 are telling you two very
 * different things, and only one of them is true.
 *
 * ON FREE TEXT. The original comment here said this "keeps behaviour and
 * drops prose", which was never true — skip notes and review notes were
 * always printed — and is further from true now that the goal's `why` and the
 * check-in notes are too. They are the most useful lines in the file and the
 * reason the review gate exists. So the honest version is not to omit them
 * but to SAY SO: the digest names what it contains, in the first few lines,
 * and the tester reads the whole thing in the share sheet before it goes
 * anywhere. `exportLogToFile` remains the separate, complete copy.
 */
export function buildDigest(
  sessions: SessionsProjection,
  ctx: ContextState,
  profile: UserContextProjection,
  appVersion: string,
  unreadable: { seq: number; type: string; reason: string }[] = [],
  goal: CurrentGoalProjection | null = null,
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
  L.push('Includes your setup, your goal and why, every session, and anything');
  L.push('you typed into a check-in, a skip or a review. Read it before sending.');
  L.push('');
  L.push(`SETUP`);
  L.push(`  experience: ${profile.experience ?? '—'}`);
  L.push(`  days/week: ${profile.constraints?.daysPerWeek ?? '—'}   session cap: ${profile.constraints?.sessionMaxMinutes ?? '—'} min`);
  L.push(`  trains at: ${profile.equipment ?? '—'}`);
  L.push(`  owns: ${profile.ownedEquipment.length > 0 ? profile.ownedEquipment.join(', ') : '—'}`);
  L.push(`  injuries: ${profile.knownInjuries.length > 0 ? profile.knownInjuries.join(', ') : 'none'}`);
  L.push(`  bodyweight: ${profile.profile?.weight_kg ?? '—'} kg`);
  // ── Added 2026-10-18 ──
  // These were asked at onboarding and then absent from the only artefact
  // that comes back. A verdict of "too much" means nothing without knowing
  // whether it came from a 58-year-old novice or a 24-year-old who lifts.
  const pr = profile.profile;
  L.push(`  age/height/sex: ${pr?.age ?? '—'} · ${pr?.height_cm ?? '—'}cm · ${pr?.sex ?? '—'}`);
  L.push(`  day: up ${profile.routine?.wakeHour ?? '—'} · bed ${profile.routine?.sleepHour ?? '—'} · trains ${profile.routine?.sessionWindow ?? '—'}`);
  if (profile.declaredLifts !== undefined && Object.keys(profile.declaredLifts).length > 0) {
    L.push(`  declared: ${Object.entries(profile.declaredLifts)
      .map(([id, kg]) => `${exerciseName(id)} ${kg}kg`).join(' · ')}`);
  }
  L.push('');
  // THE GOAL, which was missing entirely. "Goal is gravity" is principle #3
  // and the one piece of context every verdict has to be read against — a
  // session judged "too much" by someone cutting is a different finding from
  // the same word out of someone trying to add size.
  L.push(`GOAL`);
  L.push(`  ${goal?.goalType ?? '— not set —'}${
    goal !== null && goal.revisionCount > 0 ? `  (revised ${goal.revisionCount}×)` : ''
  }`);
  if (goal?.why) L.push(`  why: "${goal.why}"`);
  if (goal?.targetDate) L.push(`  by: ${goal.targetDate}`);
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
      // The energy figure is now one of three buttons (rough 2 / ok 6 /
      // good 9), so print the word as well — a bare "6" in a report read
      // months later is the same unexplained number the screen used to show.
      const feel = s.checkin.energy <= 3 ? 'rough' : s.checkin.energy >= 9 ? 'good' : 'ok';
      L.push(`    feel ${feel} (${s.checkin.energy})${sore ? ` · sore: ${sore}` : ''}`);
      // PreCheckinRecorded has carried an optional `notes` since 7a and the
      // digest never printed it — a tester typing "shoulder still bad, slept
      // 4 hours" into the check-in had it vanish from the only thing that
      // comes back.
      if (s.checkin.notes) L.push(`      "${s.checkin.notes}"`);
    }
    if (s.skipReason) L.push(`    reason: ${s.skipReason}`);
    if (s.skipNotes) L.push(`      "${s.skipNotes}"`);
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
      L.push(`    prescribed ${s.exercises.length} exercises / ${prescribed} sets · logged ${w.length} set${w.length === 1 ? '' : 's'}`);
    }
    // A SKIPPED session gets no per-exercise breakdown: three lines of
    // "nothing logged" is noise, and the prescribed line above already says
    // what was on offer. Only sessions someone actually opened get the detail.
    for (const e of (s.status === 'skipped' ? [] : s.exercises)) {
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
      // Names, not library ids. `Barbell_Bench_Press_-_Medium_Grip` is not
      // something anyone reads in a chat thread.
      L.push(`      swapped ${exerciseName(sub.originalExerciseId)} → ${exerciseName(sub.substituteExerciseId)} (${sub.reason})`);
    }
    // WHERE THEY STOPPED. A session left `active` is the most informative row
    // in the file — it is someone walking out mid-workout — and it was
    // reported only as "[active]" with no indication of how far they got.
    if (s.status === 'active' || s.status === 'scheduled') {
      const pg = selectSessionProgress(s);
      L.push(`    stopped after ${pg.exercisesDone}/${pg.exercisesTotal} exercises${
        pg.nextExerciseName !== null ? ` · next would have been ${pg.nextExerciseName}` : ''
      }`);
    }
    L.push('');
  }

  if (all.length === 0) L.push('(no sessions logged yet)');
  return L.join('\n');
}
