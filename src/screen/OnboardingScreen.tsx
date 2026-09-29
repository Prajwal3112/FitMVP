import React, { useState } from 'react';
import {
  View, Text, TextInput, ScrollView, StyleSheet, KeyboardAvoidingView,
  Platform, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { TellMe } from '../components/TellMe';
import { INJURY_AREAS, areaLabel } from '../data/muscles';
import { typography } from '../constants/typography';
import { PrimaryButton } from '../components/PrimaryButton';
import { ChipSelector, type ChipOption } from '../components/ChipSelector';
import { useFitness } from '../context/FitnessContext';
import {
  validateOnboardingForm, emptyOnboardingForm, type OnboardingForm,
} from '../onboarding/form';
import type { Experience, OwnedEquipment } from '../events/userContext';
import type { Equipment } from '../constants/workouts';
import type { RootStackScreenProps } from '../navigation/types';

// ─── Onboarding ──────────────────────────────────────────────────────
// Rule held throughout: every question must visibly change something in
// the user's FIRST session. The previous version asked nine things and
// only one of them affected any behaviour.
//
// What each question now drives:
//   experience     → starting-load estimates, beginner exercise capping
//   daysPerWeek    → the adherence denominator (was hardcoded to 4)
//   equipment      → which of the 743 exercises are offered
//   ownedEquipment → home users with dumbbells stop being given burpees
//   injuries       → §8.7 locks; unsafe exercises are swapped or dropped
//   weight         → the Day-1 load estimate

const EXPERIENCE: ChipOption<Experience>[] = [
  { label: "New to this", value: 'new' },
  { label: 'Coming back after a break', value: 'returning' },
  { label: 'Train fairly regularly', value: 'regular' },
  { label: 'Years of training', value: 'experienced' },
];

const EQUIPMENT: ChipOption<Equipment>[] = [
  { label: 'At home', value: 'home' },
  { label: 'At a gym', value: 'gym' },
];

const HOME_KIT: { label: string; value: OwnedEquipment }[] = [
  { label: 'Dumbbells', value: 'dumbbell' },
  { label: 'Resistance bands', value: 'bands' },
  { label: 'Kettlebells', value: 'kettlebells' },
  { label: 'Exercise ball', value: 'exercise ball' },
  { label: 'Barbell', value: 'barbell' },
  // Without this, every pull-up/chin-up/dip/inverted-row is filtered out
  // for home users — which leaves a PULL day with literally nothing in it.
  { label: 'Pull-up bar', value: 'pullup bar' },
];

// Was 14 raw library muscle names ('lats', 'abdominals', 'forearms') shown
// to a person under "anything that hurts?" — nobody thinks "my lats hurt" —
// and it omitted knee and elbow, two of the three commonest complaints.
// Same list as Setup now, so an injury set here still reads as set there.

const DAYS = [2, 3, 4, 5, 6];

export default function OnboardingScreen({
  navigation,
}: RootStackScreenProps<'Onboarding'>): React.ReactElement {
  const { userData, submitOnboarding } = useFitness();
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Spread over the shared initial state so a field added to the form type
  // can never be silently left unseeded here — which is how `age: ''` got
  // into the payload with no input to fill it.
  const [form, setForm] = useState<OnboardingForm>({
    ...emptyOnboardingForm(),
    weight: userData.weight,
    workoutTime: userData.workoutTime,
    equipment: userData.equipment,
    experience: null,
    daysPerWeek: null,
    ownedEquipment: [],
    injuries: [],
  });

  const update = <K extends keyof OnboardingForm>(key: K, value: OnboardingForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const toggleKit = (v: OwnedEquipment) =>
    setForm((p) => ({
      ...p,
      ownedEquipment: p.ownedEquipment.includes(v)
        ? p.ownedEquipment.filter((x) => x !== v)
        : [...p.ownedEquipment, v],
    }));

  const toggleInjury = (v: string) =>
    setForm((p) => ({
      ...p,
      injuries: p.injuries.includes(v)
        ? p.injuries.filter((x) => x !== v)
        : [...p.injuries, v],
    }));

  // Asks the writer rather than re-stating its rules. See
  // validateOnboardingForm — the two used to disagree and the button
  // enabled a submit that always threw.
  const invalidReason = validateOnboardingForm(form);
  const isValid = invalidReason === null;

  const handleContinue = async () => {
    if (!isValid || submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await submitOnboarding(form);
      navigation.reset({ index: 0, routes: [{ name: 'Goal' }] });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[typography.largeTitle, styles.title]}>Let's set you up</Text>
          <Text style={styles.lede}>
            Five questions. Each one changes what you get in your first session.
          </Text>

          <Text style={styles.section}>HOW LONG HAVE YOU BEEN TRAINING?</Text>
          <ChipSelector
            options={EXPERIENCE}
            selected={form.experience}
            onSelect={(v) => update('experience', v)}
          />
          <Text style={styles.why}>
            Sets your starting weights, and keeps the exercises appropriate.
          </Text>

          <Text style={styles.section}>REALISTICALLY, HOW MANY DAYS A WEEK?</Text>
          <View style={styles.pillRow}>
            {DAYS.map((d) => (
              <TouchableOpacity
                key={d}
                style={[styles.pill, form.daysPerWeek === d && styles.pillOn]}
                onPress={() => update('daysPerWeek', d)}
                activeOpacity={0.6}
              >
                <Text style={[styles.pillText, form.daysPerWeek === d && styles.pillTextOn]}>
                  {d}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.why}>
            Be honest, not aspirational — this is what you'll be measured against.
          </Text>

          <Text style={styles.section}>WHERE WILL YOU TRAIN?</Text>
          <ChipSelector
            options={EQUIPMENT}
            selected={form.equipment}
            onSelect={(v) => update('equipment', v)}
          />

          {form.equipment === 'home' && (
            <>
              <Text style={styles.section}>ANYTHING AT HOME?</Text>
              <View style={styles.wrapRow}>
                {HOME_KIT.map((k) => (
                  <TouchableOpacity
                    key={k.value}
                    style={[styles.tag, form.ownedEquipment.includes(k.value) && styles.tagOn]}
                    onPress={() => toggleKit(k.value)}
                    activeOpacity={0.6}
                  >
                    <Text
                      style={[
                        styles.tagText,
                        form.ownedEquipment.includes(k.value) && styles.tagTextOn,
                      ]}
                    >
                      {k.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.why}>
                Without this you'd only get bodyweight work.
              </Text>
            </>
          )}

          <Text style={styles.section}>YOUR WEIGHT (KG)</Text>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              value={form.weight}
              onChangeText={(v) => update('weight', v)}
              keyboardType="decimal-pad"
              placeholder="70"
              placeholderTextColor={colors.textTertiary}
              maxLength={5}
            />
          </View>
          <Text style={styles.why}>
            Only used to estimate your starting weights. Never shown as a target.
          </Text>

          <Text style={styles.section}>ANYTHING THAT HURTS?</Text>
          <View style={styles.wrapRow}>
            {INJURY_AREAS.map((a) => (
              <TouchableOpacity
                key={a}
                style={[styles.tag, form.injuries.includes(a) && styles.tagInjured]}
                onPress={() => toggleInjury(a)}
                activeOpacity={0.6}
              >
                <Text
                  style={[styles.tagText, form.injuries.includes(a) && styles.tagTextOn]}
                >
                  {areaLabel(a)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.why}>
            Pick as many as apply. Anything loading these gets swapped out, not just flagged.
          </Text>

          {submitError !== null && <Text style={styles.error}>{submitError}</Text>}

          <PrimaryButton
            title={submitting ? 'Saving…' : 'Continue'}
            onPress={() => { void handleContinue(); }}
            disabled={!isValid || submitting}
            style={styles.cta}
          />
          {/* A disabled button with no explanation is a dead end that reads
              as a broken app. Say which answer is still missing. */}
          {!isValid && !submitting && (
            <Text style={styles.needs}>{invalidReason}</Text>
          )}
          {/* The only screen every tester must pass, and until now the only
              one with no way to report being stuck on it. */}
          <TellMe
            where="Onboarding"
            label="Stuck here? Tell me"
            detail={() => `form: ${JSON.stringify(form)}\nblocked by: ${invalidReason ?? 'nothing'}`}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: 16, paddingBottom: 48, paddingTop: 8 },
  needs: {
    fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: 10,
  },
  title: { marginTop: 10, marginBottom: 6, marginLeft: 4 },
  lede: { fontSize: 15, color: colors.textMuted, marginLeft: 4, lineHeight: 20 },
  section: { ...typography.sectionHeader, marginTop: 28, marginBottom: 6, marginLeft: 16 },
  why: { fontSize: 13, color: colors.textTertiary, marginTop: 8, marginLeft: 4, lineHeight: 18 },
  pillRow: { flexDirection: 'row', gap: 8 },
  pill: {
    flex: 1, height: 52, borderRadius: 10, alignItems: 'center',
    justifyContent: 'center', backgroundColor: colors.card,
  },
  pillOn: { backgroundColor: colors.primary },
  pillText: { fontSize: 18, fontWeight: '600', color: colors.text },
  pillTextOn: { color: '#fff' },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
    backgroundColor: colors.card,
  },
  tagOn: { backgroundColor: colors.primary },
  tagInjured: { backgroundColor: colors.destructive },
  tagText: { fontSize: 14, color: colors.textMuted },
  tagTextOn: { color: '#fff', fontWeight: '600' },
  inputWrap: { backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 16 },
  input: { fontSize: 17, color: colors.text, paddingVertical: 14 },
  error: { fontSize: 14, color: colors.destructive, marginTop: 20, textAlign: 'center' },
  cta: { marginTop: 32 },
});
