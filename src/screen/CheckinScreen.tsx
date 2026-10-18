import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { SORENESS_AREAS } from '../data/muscles';
import { typography } from '../constants/typography';
import { PrimaryButton } from '../components/PrimaryButton';
import { useFitness } from '../context/FitnessContext';
import type { RootStackScreenProps } from '../navigation/types';

// Muscle groups the static templates actually load. Kept deliberately
// short — this is signal for the coach, not a body-map picker.
// Was a local array of six words, four of which matched nothing in the
// exercise library — so the screen said "this is what shapes today's
// session" and four chips shaped nothing. Now from the one vocabulary.
const MUSCLES = SORENESS_AREAS;

/**
 * Each one says what it DOES, so the choice is informed rather than guessed.
 * The effects are the real behaviour — verified: rough cuts volume to 12 sets
 * and caps effort at RPE 7; good keeps the sets and raises the ceiling.
 */
const FEEL_OPTIONS = [
  { value: 2, label: 'Rough', sub: 'Tired, stiff, slept badly', effect: 'Fewer sets, nothing heavy' },
  { value: 6, label: 'OK', sub: 'Normal day', effect: 'The session as planned' },
  { value: 9, label: 'Good', sub: 'Strong, ready', effect: 'Same sets, push the hard ones' },
] as const;

export default function CheckinScreen({
  navigation,
  route,
}: RootStackScreenProps<'Checkin'>): React.ReactElement {
  const { submitCheckin } = useFitness();

  // 6 = the 'OK' button, so what is highlighted is what gets written. The
  // old default of 7 highlighted nothing and wrote a value anyway.
  const [energy, setEnergy] = useState<number>(6);
  const [soreness, setSoreness] = useState<Record<string, 1 | 2 | 3>>({});
  const [notes, setNotes] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);

  const cycleSoreness = (muscle: string) => {
    setSoreness((prev) => {
      const next = { ...prev };
      const level = prev[muscle];
      if (level === undefined) next[muscle] = 1;
      else if (level === 1) next[muscle] = 2;
      else if (level === 2) next[muscle] = 3;
      else delete next[muscle];
      return next;
    });
  };

  const handleSubmit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const sessionId = await submitCheckin({
        energy,
        soreness: Object.entries(soreness).map(([muscle, level]) => ({ muscle, level })),
        notes,
        // Set when the user came off the return screen via "I feel fine —
        // full session". Honours the choice instead of quietly overriding it.
        ...(route.params?.full === true ? { ignoreReentry: true } : {}),
      });
      navigation.replace('Workout', { sessionId });
    } catch (e) {
      Alert.alert(
        "Couldn't start the session",
        e instanceof Error ? e.message : String(e),
      );
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[typography.largeTitle, styles.title]}>Quick check-in</Text>
        <Text style={styles.lede}>
          Thirty seconds. This is what shapes today's session.
        </Text>

        {/* THREE BUTTONS, NOT TEN DOTS.
            Ten numbers with no explanation, and measured: only <=3 vs >3
            changed anything, so seven of the ten did nothing. The founder
            flagged it on device — "what do you mean by energy levels, users
            must understand what these numbers define" — and he was right
            twice: it was unexplained AND it was fake.
            The stored value stays a 1-10 number so historical events still
            parse and mean the same thing; these three write 2, 6 and 9. */}
        <Text style={styles.section}>HOW DO YOU FEEL?</Text>
        <View style={styles.feelRow}>
          {FEEL_OPTIONS.map((opt) => {
            const on = energy === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.feel, on && styles.feelOn]}
                onPress={() => setEnergy(opt.value)}
                activeOpacity={0.7}
              >
                <Text style={[styles.feelLabel, on && styles.feelLabelOn]}>{opt.label}</Text>
                <Text style={[styles.feelSub, on && styles.feelSubOn]}>{opt.sub}</Text>
                <Text style={[styles.feelEffect, on && styles.feelSubOn]}>{opt.effect}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.section}>SORE ANYWHERE?</Text>
        <View style={styles.group}>
          <View style={styles.chipWrap}>
            {MUSCLES.map((m) => {
              const level = soreness[m];
              return (
                <TouchableOpacity
                  key={m}
                  style={[styles.chip, level !== undefined && styles.chipOn]}
                  onPress={() => cycleSoreness(m)}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.chipText, level !== undefined && styles.chipTextOn]}>
                    {m}{level !== undefined ? ` ${'·'.repeat(level)}` : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.hint}>Tap to cycle: mild · moderate ·· severe ···</Text>
        </View>

        <Text style={styles.section}>ANYTHING ELSE?</Text>
        <View style={styles.group}>
          <TextInput
            style={styles.input}
            value={notes}
            onChangeText={setNotes}
            placeholder="Slept badly, shoulder feels off, short on time…"
            placeholderTextColor={colors.textTertiary}
            multiline
            maxLength={500}
          />
        </View>

        <PrimaryButton
          title={busy ? 'Building your session…' : "Let's go"}
          onPress={() => { void handleSubmit(); }}
          disabled={busy}
          style={styles.cta}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: 16, paddingBottom: 48, paddingTop: 8 },
  title: { marginTop: 10, marginBottom: 6, marginLeft: 4 },
  lede: {
    fontSize: 15,
    color: colors.textMuted,
    marginLeft: 4,
    marginBottom: 8,
    lineHeight: 20,
  },
  section: {
    ...typography.sectionHeader,
    marginTop: 28,
    marginBottom: 6,
    marginLeft: 16,
  },
  group: {
    backgroundColor: colors.card,
    borderRadius: 10,
    overflow: 'hidden',
  },
  feelRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  feel: {
    flex: 1, minWidth: 96, minHeight: 112, backgroundColor: colors.card,
    borderRadius: 12, borderWidth: 1, borderColor: colors.separator,
    paddingHorizontal: 12, paddingVertical: 14, justifyContent: 'center',
  },
  feelOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  feelLabel: { fontSize: 18, fontWeight: '700', color: colors.text },
  feelLabelOn: { color: colors.onPrimary },
  feelSub: { fontSize: 12, lineHeight: 16, color: colors.textMuted, marginTop: 4 },
  feelSubOn: { color: colors.onPrimary, opacity: 0.82 },
  feelEffect: { fontSize: 11, lineHeight: 15, color: colors.textTertiary, marginTop: 6 },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 12,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.background,
  },
  chipOn: { backgroundColor: colors.primary },
  chipText: { fontSize: 14, color: colors.textMuted },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  hint: {
    fontSize: 12,
    color: colors.textTertiary,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  input: {
    fontSize: 16,
    color: colors.text,
    padding: 16,
    minHeight: 88,
    textAlignVertical: 'top',
  },
  cta: { marginTop: 32 },
});
