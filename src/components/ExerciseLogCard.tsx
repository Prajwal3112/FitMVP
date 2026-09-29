import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { colors } from '../constants/colors';
import type { ExerciseSlot } from '../events/session';
import type { LoggedSet, ExercisePerformance } from '../projections/sessions';
import type { LoadSuggestion } from '../session/progression';
import { exerciseName } from '../data/exercises';

// Working range for autoregulation, in half-steps. Below 6 isn't a
// meaningful rating on a working set.
const RPE_CHOICES = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10] as const;

export type LogSetArgs = {
  setIndex: number;
  isWarmup?: boolean;
  weight_kg: number;
  reps: number;
  durationSec?: number;
  rpe?: number;
};

export type ExerciseLogCardProps = {
  slot: ExerciseSlot;
  index: number;
  isLast: boolean;
  loggedSets: LoggedSet[];
  isSkipped: boolean;
  last: ExercisePerformance | undefined;
  suggestion: LoadSuggestion | undefined;
  onLogSet: (args: LogSetArgs) => void;
  onSkip: () => void;
};

type RowDraft = { weight: string; reps: string };

export const ExerciseLogCard: React.FC<ExerciseLogCardProps> = ({
  slot,
  index,
  isLast,
  loggedSets,
  isSkipped,
  last,
  suggestion,
  onLogSet,
  onSkip,
}) => {
  const isHold = slot.targetDurationSec !== undefined;

  // Prefill order: what you did last time > what the template prescribes.
  // Hitting the same numbers as last session is what progressive overload
  // looks like most weeks, so the common case must cost zero typing.
  // Prefill order: today's suggestion > what you did last time > the
  // template's target. The suggestion is the whole reason RPE is collected,
  // so it has to land in the box the user actually taps.
  const defaultWeight =
    suggestion?.suggestedWeight && suggestion.suggestedWeight > 0
      ? String(suggestion.suggestedWeight)
      : last?.weight_kg && last.weight_kg > 0
        ? String(last.weight_kg)
        : '';
  const defaultReps =
    suggestion?.suggestedReps && suggestion.suggestedReps > 0
      ? String(suggestion.suggestedReps)
      : last?.reps && last.reps > 0
        ? String(last.reps)
        : slot.targetReps !== undefined
          ? String(slot.targetReps)
          : '';

  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [rpeOpenFor, setRpeOpenFor] = useState<string | null>(null);
  const [warmupCount, setWarmupCount] = useState<number>(0);

  const keyOf = (setIndex: number, isWarmup: boolean) =>
    `${isWarmup ? 'w' : 's'}${setIndex}`;

  /**
   * The draft for a row, or the stored values if it has one, or the prefill.
   *
   * The stored-values fallback matters: `commit` reads this, and for an
   * already-logged row it used to fall through to the PREFILL — so tapping ✓
   * a second time (the obvious undo gesture, since there is no undo)
   * silently overwrote a real logged set with the suggested numbers.
   */
  const draftFor = (key: string): RowDraft => {
    const existing = drafts[key];
    if (existing) return existing;
    const stored = loggedByKey.get(key);
    if (stored) {
      return { weight: String(stored.weight_kg), reps: String(stored.reps) };
    }
    return { weight: defaultWeight, reps: defaultReps };
  };

  /** Has the user typed into this row since it was logged? */
  const isDirty = (key: string): boolean => {
    const d = drafts[key];
    if (!d) return false;
    const stored = loggedByKey.get(key);
    if (!stored) return true;
    return d.weight !== String(stored.weight_kg) || d.reps !== String(stored.reps);
  };

  const setDraft = (key: string, patch: Partial<RowDraft>) =>
    setDrafts((prev) => ({ ...prev, [key]: { ...draftFor(key), ...patch } }));

  const logged = (setIndex: number, isWarmup: boolean) =>
    loggedSets.find((s) => s.setIndex === setIndex && s.isWarmup === isWarmup);

  const loggedByKey = new Map<string, (typeof loggedSets)[number]>(
    loggedSets.map((x) => [keyOf(x.setIndex, x.isWarmup), x]),
  );

  const commit = (setIndex: number, isWarmup: boolean, rpe?: number) => {
    const key = keyOf(setIndex, isWarmup);
    const d = draftFor(key);
    const existing = logged(setIndex, isWarmup);
    const w = Number(d.weight);
    const r = Number(d.reps);
    // Tapping the ✓ on an empty row is the most natural gesture on this
    // screen, and it used to log 0 kg × 0 reps. That set counts as a
    // working set AND makes selectExerciseHistory read max(weight)=0, which
    // progression.ts treats as bodyweight — so the lift never gets a load
    // suggestion again. A rep count is the minimum that makes a set real.
    const reps = isHold ? 0 : (Number.isFinite(r) && r > 0 ? Math.floor(r) : 0);
    if (!isHold && reps === 0) return;
    onLogSet({
      setIndex,
      ...(isWarmup ? { isWarmup: true } : {}),
      weight_kg: Number.isFinite(w) && w > 0 ? w : 0,
      reps,
      ...(isHold && slot.targetDurationSec !== undefined
        ? { durationSec: slot.targetDurationSec }
        : {}),
      ...(rpe !== undefined ? { rpe } : existing?.rpe !== undefined ? { rpe: existing.rpe } : {}),
    });
  };

  const target = isHold
    ? `${slot.sets} × ${slot.targetDurationSec}s`
    : `${slot.sets} × ${slot.targetReps ?? 0}`;

  const lastLine = last
    ? `last: ${last.weight_kg > 0 ? `${last.weight_kg}kg × ` : ''}${
        last.durationSec !== undefined ? `${last.durationSec}s` : last.reps
      }${last.avgRpe !== undefined ? ` @ ${last.avgRpe}` : ''}`
    : 'last: —';

  const renderRow = (setIndex: number, isWarmup: boolean) => {
    const key = keyOf(setIndex, isWarmup);
    const entry = logged(setIndex, isWarmup);
    const done = entry !== undefined;
    const d = draftFor(key);
    const rpeOpen = rpeOpenFor === key;

    return (
      <View key={key}>
        <View style={[styles.row, done && styles.rowDone]}>
          <Text style={[styles.setNo, isWarmup && styles.warmupNo]}>
            {isWarmup ? 'W' : setIndex + 1}
          </Text>

          <TextInput
            style={[styles.cell, styles.numCell]}
            value={d.weight}
            onChangeText={(v) => setDraft(key, { weight: v })}
            onEndEditing={() => { if (done && isDirty(key)) commit(setIndex, isWarmup); }}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.textTertiary}
            maxLength={6}
            selectTextOnFocus
          />
          <Text style={styles.unit}>kg</Text>

          {!isHold ? (
            <>
              <Text style={styles.times}>×</Text>
              <TextInput
                style={[styles.cell, styles.repCell]}
                value={d.reps}
                onChangeText={(v) => setDraft(key, { reps: v })}
                onEndEditing={() => { if (done && isDirty(key)) commit(setIndex, isWarmup); }}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={colors.textTertiary}
                maxLength={3}
                selectTextOnFocus
              />
            </>
          ) : (
            <Text style={styles.holdText}>{slot.targetDurationSec}s</Text>
          )}

          {!isWarmup && (
            <TouchableOpacity
              style={[styles.rpeCell, rpeOpen && styles.rpeCellOpen]}
              onPress={() => setRpeOpenFor(rpeOpen ? null : key)}
              activeOpacity={0.6}
            >
              <Text style={[styles.rpeVal, entry?.rpe === undefined && styles.rpeEmpty]}>
                {entry?.rpe ?? '–'}
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.check, done && styles.checkOn]}
            // A logged row only re-commits when the numbers were edited.
            // Tapping ✓ again used to overwrite a real set with the prefill,
            // which is the obvious "undo" gesture and there is no undo.
            onPress={() => {
              if (done && !isDirty(key)) return;
              commit(setIndex, isWarmup);
            }}
            activeOpacity={0.6}
            hitSlop={6}
          >
            <Text style={[styles.checkText, done && styles.checkTextOn]}>
              {done ? '✓' : '○'}
            </Text>
          </TouchableOpacity>
        </View>

        {rpeOpen && (
          <View style={styles.rpeStrip}>
            {RPE_CHOICES.map((n) => (
              <TouchableOpacity
                key={n}
                style={[styles.rpeChip, entry?.rpe === n && styles.rpeChipOn]}
                onPress={() => {
                  commit(setIndex, isWarmup, n);
                  setRpeOpenFor(null);
                }}
                activeOpacity={0.6}
              >
                <Text style={[styles.rpeChipText, entry?.rpe === n && styles.rpeChipTextOn]}>
                  {n}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.card, !isLast && styles.border, isSkipped && styles.dim]}>
      <View style={styles.header}>
        <Text style={styles.index}>{index + 1}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, isSkipped && styles.strike]}>{slot.name}</Text>
          {slot.swappedFrom !== undefined && (
            <Text style={styles.swapNote}>
              swapped from {exerciseName(slot.swappedFrom)}
              {slot.swapReason === 'injury'
                ? ' — loads a flagged injury'
                : slot.swapReason === 'soreness'
                  ? " — you're sore there"
                  : ''}
            </Text>
          )}
          <Text style={styles.lastLine}>
            {lastLine}
            <Text style={styles.targetInline}>{`   ·   target ${target}`}</Text>
          </Text>
          {suggestion !== undefined && suggestion.kind !== 'no_history' && (
            <Text
              style={[
                styles.suggestion,
                suggestion.kind === 'increase' && styles.suggestionUp,
              ]}
            >
              {suggestion.reason}
            </Text>
          )}
        </View>
        {!isSkipped && loggedSets.length === 0 && (
          <TouchableOpacity onPress={onSkip} activeOpacity={0.6} hitSlop={8}>
            <Text style={styles.skipLink}>Skip</Text>
          </TouchableOpacity>
        )}
      </View>

      {isSkipped ? (
        <Text style={styles.skippedNote}>Skipped</Text>
      ) : (
        <View style={styles.rows}>
          {Array.from({ length: warmupCount }, (_, i) => renderRow(i, true))}
          {Array.from({ length: slot.sets }, (_, i) => renderRow(i, false))}

          <TouchableOpacity
            style={styles.addWarmup}
            onPress={() => setWarmupCount((n) => Math.min(8, n + 1))}
            activeOpacity={0.6}
          >
            <Text style={styles.addWarmupText}>+ warmup set</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { paddingHorizontal: 12, paddingVertical: 14 },
  border: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  dim: { opacity: 0.55 },
  header: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 4 },
  index: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.primary,
    width: 22,
    marginTop: 1,
  },
  name: { fontSize: 17, color: colors.text, fontWeight: '500' },
  strike: { textDecorationLine: 'line-through' },
  lastLine: { fontSize: 13, color: colors.textMuted, marginTop: 3 },
  targetInline: { color: colors.textTertiary },
  swapNote: { fontSize: 12, color: colors.primary, marginTop: 3 },
  suggestion: { fontSize: 13, color: colors.textMuted, marginTop: 5, lineHeight: 18 },
  suggestionUp: { color: colors.primary, fontWeight: '500' },
  skipLink: { fontSize: 14, color: colors.textMuted },
  skippedNote: {
    fontSize: 14,
    color: colors.textTertiary,
    marginLeft: 26,
    marginTop: 8,
  },
  rows: { marginTop: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingLeft: 22,
  },
  rowDone: { opacity: 0.85 },
  setNo: {
    width: 20,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  warmupNo: { color: colors.textTertiary, fontWeight: '500' },
  cell: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    backgroundColor: colors.background,
    borderRadius: 7,
    paddingVertical: 7,
    paddingHorizontal: 8,
    textAlign: 'center',
  },
  numCell: { minWidth: 62 },
  repCell: { minWidth: 48 },
  unit: { fontSize: 12, color: colors.textMuted, marginLeft: 3 },
  times: { fontSize: 14, color: colors.textTertiary, marginHorizontal: 5 },
  holdText: { fontSize: 15, color: colors.textMuted, marginLeft: 8 },
  rpeCell: {
    minWidth: 40,
    paddingVertical: 7,
    borderRadius: 7,
    backgroundColor: colors.background,
    alignItems: 'center',
    marginLeft: 8,
  },
  rpeCellOpen: { backgroundColor: colors.text },
  rpeVal: { fontSize: 14, fontWeight: '600', color: colors.text },
  rpeEmpty: { color: colors.textTertiary },
  check: {
    width: 38,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
    backgroundColor: colors.background,
  },
  checkOn: { backgroundColor: colors.primary },
  checkText: { fontSize: 17, color: colors.textTertiary, fontWeight: '600' },
  checkTextOn: { color: '#fff' },
  rpeStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingLeft: 42,
    paddingRight: 4,
    paddingBottom: 8,
    paddingTop: 2,
  },
  rpeChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: colors.background,
  },
  rpeChipOn: { backgroundColor: colors.text },
  rpeChipText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  rpeChipTextOn: { color: colors.background },
  addWarmup: { paddingLeft: 42, paddingVertical: 8 },
  addWarmupText: { fontSize: 13, color: colors.textMuted },
});
