import React, { useState } from 'react';
import {
  View, Text, TextInput, ScrollView, StyleSheet,
  SafeAreaView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { PrimaryButton } from '../components/PrimaryButton';
import { ChipSelector, type ChipOption } from '../components/ChipSelector';
import { useFitness, type GoalType } from '../context/FitnessContext';
import type { RootStackScreenProps } from '../navigation/types';

const GOALS: ChipOption<GoalType>[] = [
  { label: 'Lose Fat', value: 'lose' },
  { label: 'Build Muscle', value: 'gain' },
  { label: 'Stay Fit', value: 'maintain' },
];

export default function GoalScreen({
  navigation,
}: RootStackScreenProps<'Goal'>): React.ReactElement {
  const { userData, submitGoal } = useFitness();
  const [goal, setGoal] = useState<GoalType | null>(userData.goal);
  const [why, setWhy] = useState<string>(userData.why);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isValid = goal !== null && why.trim().length > 0;

  const handleSave = async () => {
    if (!isValid || goal === null || submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await submitGoal(goal, why.trim());
      navigation.goBack();
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
          <Text style={[typography.largeTitle, styles.title]}>Your Goal</Text>
          <Text style={[typography.subhead, styles.subtitle]}>
            A clear goal and your "why" is what gets you to Day 3.
          </Text>

          <Text style={styles.section}>GOAL</Text>
          <ChipSelector options={GOALS} selected={goal} onSelect={setGoal} />

          <Text style={styles.section}>WHY</Text>
          <View style={styles.card}>
            <TextInput
              style={styles.textArea}
              placeholder="My wedding is in 3 months. I want to feel confident…"
              placeholderTextColor={colors.textTertiary}
              value={why}
              onChangeText={setWhy}
              multiline
              maxLength={200}
            />
          </View>
          <Text style={styles.counter}>{why.length}/200</Text>

          <PrimaryButton
            title="Save"
            onPress={handleSave}
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
  subtitle: { color: colors.textMuted, marginBottom: 24, lineHeight: 20 },
  section: {
    ...typography.sectionHeader,
    marginTop: 24,
    marginBottom: 6,
    marginLeft: 16,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 10,
    overflow: 'hidden',
  },
  textArea: {
    minHeight: 110,
    padding: 16,
    fontSize: 17,
    color: colors.text,
    textAlignVertical: 'top',
  },
  counter: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'right',
    marginTop: 6,
    marginRight: 4,
  },
  cta: { marginTop: 36 },
  errorText: {
    fontSize: 13,
    color: colors.destructive,
    textAlign: 'center',
    marginTop: 12,
  },
});
