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

const ENERGY_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export default function CheckinScreen({
  navigation,
  route,
}: RootStackScreenProps<'Checkin'>): React.ReactElement {
  const { submitCheckin } = useFitness();

  const [energy, setEnergy] = useState<number>(7);
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

  const energyLabel =
    energy <= 3 ? 'Running on empty' :
    energy <= 5 ? 'A bit flat' :
    energy <= 7 ? 'Normal' :
    'Ready to go';

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

        <Text style={styles.section}>ENERGY</Text>
        <View style={styles.group}>
          <View style={styles.energyCell}>
            <View style={styles.energyRow}>
              {ENERGY_VALUES.map((n) => (
                <TouchableOpacity
                  key={n}
                  style={[styles.energyDot, energy === n && styles.energyDotOn]}
                  onPress={() => setEnergy(n)}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.energyNum, energy === n && styles.energyNumOn]}>
                    {n}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.energyLabel}>{energyLabel}</Text>
          </View>
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
  energyCell: { paddingHorizontal: 12, paddingVertical: 16 },
  energyRow: { flexDirection: 'row', justifyContent: 'space-between' },
  energyDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  energyDotOn: { backgroundColor: colors.primary },
  energyNum: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  energyNumOn: { color: '#fff', fontWeight: '700' },
  energyLabel: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 14,
  },
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
