import { workingSets, type SessionState } from '../projections/sessions';
import type { SessionSummaryPayload } from '../events/session';

// ─── Extractive summary (deterministic fallback) ─────────────────────
// ARCHITECTURE §3 tool 5's fallback path. Step 8 puts the Groq call in
// front of this; this function stays as the offline/failure path, so the
// app produces a real SessionSummaryGenerated event either way.

const MAX_SUMMARY_CHARS = 300;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Mean RPE across every logged set that carried one. */
export function averageRpe(session: SessionState): number | undefined {
  const rpes = workingSets(session.setLog)
    .map((s) => s.rpe)
    .filter((r): r is number => typeof r === 'number');
  if (rpes.length === 0) return undefined;
  const mean = rpes.reduce((a, b) => a + b, 0) / rpes.length;
  return Math.round(mean * 10) / 10;
}

/** Exercises with at least one logged set. */
export function completedExerciseIds(session: SessionState): string[] {
  return [...new Set(workingSets(session.setLog).map((s) => s.exerciseId))];
}

export function buildExtractiveSummary(session: SessionState): SessionSummaryPayload {
  const done = completedExerciseIds(session);
  const total = session.exercises.length;
  const working = workingSets(session.setLog);
  const totalSets = working.length;
  const avgRpe = averageRpe(session);

  const parts: string[] = [
    `${session.workoutName}: ${done.length}/${total} exercises, ${totalSets} sets.`,
  ];
  if (avgRpe !== undefined) parts.push(`Avg RPE ${avgRpe}.`);
  if (session.checkin) parts.push(`Energy ${session.checkin.energy}/10.`);
  if (session.skippedExerciseIds.length > 0) {
    parts.push(`Skipped ${session.skippedExerciseIds.length}.`);
  }

  const highlights: string[] = [];
  const topSet = [...working]
    .filter((s) => s.weight_kg > 0)
    .sort((a, b) => b.weight_kg - a.weight_kg)[0];
  if (topSet) {
    const name =
      session.exercises.find((e) => e.exerciseId === topSet.exerciseId)?.name ??
      topSet.exerciseId;
    highlights.push(`Top set: ${name} ${topSet.weight_kg}kg × ${topSet.reps}`);
  }
  if (avgRpe !== undefined && avgRpe <= 7 && totalSets > 0) {
    highlights.push('Left reps in reserve — room to add load next time.');
  }

  return {
    sessionId: session.sessionId,
    summary: truncate(parts.join(' '), MAX_SUMMARY_CHARS),
    highlights,
    generationMode: 'extractive_fallback',
  };
}
