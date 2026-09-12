import React, { useState } from 'react';
import {
  View, Text, TextInput, ScrollView, StyleSheet,
  SafeAreaView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { PrimaryButton } from '../components/PrimaryButton';
import { ChipSelector, type ChipOption } from '../components/ChipSelector';
import {
  useFitness,
  type OnboardingForm,
  type InjuryTag,
} from '../context/FitnessContext';
import type { Equipment } from '../constants/workouts';
import type { RootStackScreenProps } from '../navigation/types';

const EQUIPMENT: ChipOption<Equipment>[] = [
  { label: 'Home', value: 'home' },
  { label: 'Gym', value: 'gym' },
];

const INJURIES: ChipOption<InjuryTag>[] = [
  { label: 'None', value: 'none' },
  { label: 'Knee', value: 'knee' },
  { label: 'Back', value: 'back' },
  { label: 'Shoulder', value: 'shoulder' },
];

const TIMES: ChipOption<string>[] = ['06:00', '07:00', '08:00', '12:00', '18:00', '20:00']
  .map((t) => ({ label: t, value: t }));

export default function OnboardingScreen({
  navigation,
}: RootStackScreenProps<'Onboarding'>): React.ReactElement {
  const { userData, submitOnboarding } = useFitness();
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [form, setForm] = useState<OnboardingForm>({
    age: userData.age,
    weight: userData.weight,
    workoutTime: userData.workoutTime,
    equipment: userData.equipment,
    injury: userData.injury,
  });

  const update = <K extends keyof OnboardingForm>(key: K, value: OnboardingForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const isValid =
    form.age.length > 0 &&
    form.weight.length > 0 &&
    form.equipment !== null;

  const handleContinue = async () => {
    if (!isValid || submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await submitOnboarding(form);
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[typography.largeTitle, styles.title]}>Set up</Text>
          <Text style={[typography.subhead, styles.subtitle]}>
            Quick profile. You'll set your goal next.
          </Text>

          <Text style={styles.section}>STATS</Text>
          <View style={styles.group}>
            <View style={[styles.inputCell, styles.border]}>
              <Text style={styles.inputLabel}>Age</Text>
              <TextInput
                style={styles.input}
                placeholder="25"
                placeholderTextColor={colors.textTertiary}
                keyboardType="number-pad"
                value={form.age}
                onChangeText={(v) => update('age', v)}
                maxLength={3}
              />
            </View>
            <View style={styles.inputCell}>
              <Text style={styles.inputLabel}>Weight</Text>
              <TextInput
                style={styles.input}
                placeholder="70 kg"
                placeholderTextColor={colors.textTertiary}
                keyboardType="number-pad"
                value={form.weight}
                onChangeText={(v) => update('weight', v)}
                maxLength={4}
              />
            </View>
          </View>

          <Text style={styles.section}>EQUIPMENT</Text>
          <ChipSelector
            options={EQUIPMENT}
            selected={form.equipment}
            onSelect={(v) => update('equipment', v)}
          />

          <Text style={styles.section}>INJURIES</Text>
          <ChipSelector
            options={INJURIES}
            selected={form.injury}
            onSelect={(v) => update('injury', v)}
          />

          <Text style={styles.section}>PREFERRED TIME</Text>
          <ChipSelector
            options={TIMES}
            selected={form.workoutTime}
            onSelect={(v) => update('workoutTime', v)}
          />

          <PrimaryButton
            title="Continue"
            onPress={handleContinue}
            disabled={!isValid || submitting}
            loading={submitting}
            style={styles.cta}
          />
          {submitError !== null && (
            <Text style={styles.errorText}>{submitError}</Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: 16, paddingBottom: 48, paddingTop: 16 },
  title: { marginBottom: 6 },
  subtitle: { color: colors.textMuted, marginBottom: 24 },
  section: {
    ...typography.sectionHeader,
    marginTop: 24,
    marginBottom: 6,
    marginLeft: 16,
  },
  group: {
    backgroundColor: colors.card,
    borderRadius: 10,
    overflow: 'hidden',
  },
  inputCell: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    minHeight: 44,
  },
  border: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  inputLabel: { fontSize: 17, color: colors.text, width: 88 },
  input: {
    flex: 1,
    fontSize: 17,
    color: colors.text,
    textAlign: 'right',
    paddingVertical: 12,
  },
  cta: { marginTop: 40 },
  errorText: {
    fontSize: 13,
    color: colors.destructive,
    textAlign: 'center',
    marginTop: 12,
  },
});
