import React, { useState } from 'react';
import {
  View, Text, TextInput, ScrollView, StyleSheet, KeyboardAvoidingView,
  Platform, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { TellMe } from '../components/TellMe';
import { INJURY_AREAS, areaLabel } from '../data/muscles';
import {
  ANCHOR_LIFTS, implausibleDeclaredLift,
} from '../onboarding/declaredLifts';
import { useLayout } from '../constants/layout';
import { typography } from '../constants/typography';
import { PrimaryButton } from '../components/PrimaryButton';
import { ChipSelector, type ChipOption } from '../components/ChipSelector';
import { useFitness } from '../context/FitnessContext';
import {
  validateOnboardingForm, emptyOnboardingForm, onboardingSteps, stepBlocker,
  type OnboardingForm, type OnboardingStepId, type Sex,
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
//   height/age/sex → the calorie and macro targets, which showed nothing
//                    for everyone while these were defaulted
//   wake/sleep     → what "when can I train next" is allowed to say
//   declaredLifts  → a real number beats our formula by a factor of three
//
// ONE QUESTION PER SCREEN, 2026-10-18. It was nine sections on a single
// scroll: the keyboard covered the field being typed into, and "WHAT DO YOU
// LIFT NOW?" sat BELOW the Continue button, so an experienced lifter tapped
// Continue and never saw it. The step list and every gate live in
// src/onboarding/form.ts, which a check can import and drive.

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

const SEXES: { label: string; value: Sex }[] = [
  { label: 'Male', value: 'm' },
  { label: 'Female', value: 'f' },
  { label: 'Rather not say', value: 'other' },
];

const WAKE_HOURS = [5, 6, 7, 8, 9, 10];
const SLEEP_HOURS = [21, 22, 23, 0, 1];

const WHEN: ChipOption<string>[] = [
  { label: 'Morning', value: 'morning' },
  { label: 'Afternoon', value: 'afternoon' },
  { label: 'Evening', value: 'evening' },
];

/** The question itself, so the screen is never unlabelled. */
const STEP_TITLE: Record<OnboardingStepId, string> = {
  experience: 'Where are you starting from?',
  days: 'How many days a week, realistically?',
  place: 'Where will you train?',
  body: 'A bit about you',
  rhythm: 'When does your day run?',
  injuries: 'Anything that hurts?',
  lifts: 'What do you lift now?',
};

const hourLabel = (h: number): string =>
  h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;

export default function OnboardingScreen({
  navigation,
}: RootStackScreenProps<'Onboarding'>): React.ReactElement {
  const { userData, submitOnboarding } = useFitness();
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Spread over the shared initial state so a field added to the form type
  // can never be silently left unseeded here — which is how `age: ''` got
  // into the payload with no input to fill it.
  const layout = useLayout();
  const [form, setForm] = useState<OnboardingForm>({
    ...emptyOnboardingForm(),
    weight: userData.weight,
    workoutTime: userData.workoutTime,
    equipment: userData.equipment,
  });
  const [stepIndex, setStepIndex] = useState<number>(0);

  const steps = onboardingSteps(form);
  // `lifts` appears and disappears with the experience answer, so the index
  // can outrun the list. Clamp rather than crash on an undefined step.
  const index = Math.min(stepIndex, steps.length - 1);
  const step = steps[index]!;
  const isLast = index === steps.length - 1;

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

  // Asks the writer rather than re-stating its rules. See form.ts — the two
  // used to disagree and the button enabled a submit that always threw.
  const blocked = stepBlocker(form, step);
  const canAdvance = blocked === null;

  const handleSubmit = async () => {
    const invalid = validateOnboardingForm(form);
    if (invalid !== null || submitting) return;
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

  const next = () => {
    if (!canAdvance) return;
    if (isLast) { void handleSubmit(); return; }
    setStepIndex(index + 1);
  };

  const Tag = ({ label, on, onPress, bad }: {
    label: string; on: boolean; onPress: () => void; bad?: boolean;
  }) => (
    <TouchableOpacity
      style={[styles.tag, on && (bad === true ? styles.tagInjured : styles.tagOn)]}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <Text style={[styles.tagText, on && styles.tagTextOn]}>{label}</Text>
    </TouchableOpacity>
  );

  const renderStep = () => {
    switch (step) {
      case 'experience':
        return (
          <>
            <ChipSelector
              options={EXPERIENCE}
              selected={form.experience}
              onSelect={(v) => update('experience', v)}
            />
            <Text style={styles.why}>
              Sets your starting weights, and keeps the exercises appropriate.
              Coming back after a break is treated differently from starting
              fresh — you keep your old numbers, scaled down.
            </Text>
          </>
        );

      case 'days':
        return (
          <>
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
              Be honest, not aspirational — this is what you'll be measured
              against, and it decides the whole shape of your week.
            </Text>
          </>
        );

      case 'place':
        return (
          <>
            <ChipSelector
              options={EQUIPMENT}
              selected={form.equipment}
              onSelect={(v) => update('equipment', v)}
            />
            {form.equipment === 'home' && (
              <>
                <Text style={styles.sub}>What have you got?</Text>
                <View style={styles.wrapRow}>
                  {HOME_KIT.map((k) => (
                    <Tag
                      key={k.value}
                      label={k.label}
                      on={form.ownedEquipment.includes(k.value)}
                      onPress={() => toggleKit(k.value)}
                    />
                  ))}
                </View>
                <Text style={styles.why}>
                  Without this you'd only get bodyweight work. Say nothing and
                  that is exactly what you'll get — which is fine, it just
                  won't offer you weights you don't own.
                </Text>
              </>
            )}
            {form.equipment === 'gym' && (
              <Text style={styles.why}>
                A gym opens all 743 exercises. Nothing else to answer here.
              </Text>
            )}
          </>
        );

      case 'body':
        return (
          <>
            <Text style={styles.sub}>Your weight (kg)</Text>
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
              Used to estimate your starting weights. Never shown as a target.
            </Text>

            {/* OPTIONAL, and said so. These three are the entire input to the
                calorie and macro targets. They were defaulted to 170cm /
                'other' / absent and only askable from a Setup screen nobody
                opens, so nutrition showed nothing for every tester. */}
            <Text style={styles.sub}>Height, age and sex — optional</Text>
            <Text style={styles.hint}>
              These three are only used to work out a calorie and protein
              target. Skip them and everything else still works; you just
              won't get that number.
            </Text>
            <View style={styles.pairRow}>
              <View style={styles.pairCell}>
                <Text style={styles.pairLabel}>Height (cm)</Text>
                <View style={styles.inputWrap}>
                  <TextInput
                    style={styles.input}
                    value={form.heightCm}
                    onChangeText={(v) => update('heightCm', v)}
                    keyboardType="number-pad"
                    placeholder="175"
                    placeholderTextColor={colors.textTertiary}
                    maxLength={3}
                  />
                </View>
              </View>
              <View style={styles.pairCell}>
                <Text style={styles.pairLabel}>Age</Text>
                <View style={styles.inputWrap}>
                  <TextInput
                    style={styles.input}
                    value={form.age}
                    onChangeText={(v) => update('age', v)}
                    keyboardType="number-pad"
                    placeholder="28"
                    placeholderTextColor={colors.textTertiary}
                    maxLength={3}
                  />
                </View>
              </View>
            </View>
            <View style={styles.wrapRow}>
              {SEXES.map((s) => (
                <Tag
                  key={s.value}
                  label={s.label}
                  on={form.sex === s.value}
                  onPress={() => update('sex', form.sex === s.value ? null : s.value)}
                />
              ))}
            </View>
          </>
        );

      case 'rhythm':
        return (
          <>
            <Text style={styles.hint}>
              All optional. It decides what the app is allowed to say about
              when you could train next — without it, it stays quiet.
            </Text>
            <Text style={styles.sub}>You're usually up at</Text>
            <View style={styles.wrapRow}>
              {WAKE_HOURS.map((h) => (
                <Tag
                  key={h}
                  label={hourLabel(h)}
                  on={form.wakeHour === h}
                  onPress={() => update('wakeHour', form.wakeHour === h ? null : h)}
                />
              ))}
            </View>
            <Text style={styles.sub}>In bed around</Text>
            <View style={styles.wrapRow}>
              {SLEEP_HOURS.map((h) => (
                <Tag
                  key={h}
                  label={hourLabel(h)}
                  on={form.sleepHour === h}
                  onPress={() => update('sleepHour', form.sleepHour === h ? null : h)}
                />
              ))}
            </View>
            <Text style={styles.sub}>You'd rather train in the</Text>
            <ChipSelector
              options={WHEN}
              selected={form.workoutTime}
              onSelect={(v) => update('workoutTime', v)}
            />
          </>
        );

      case 'injuries':
        return (
          <>
            <Text style={styles.hint}>
              Anything that hurts, aches or you're protecting — not just a
              diagnosed injury. Pick as many as apply, or none.
            </Text>
            <View style={styles.wrapRow}>
              {INJURY_AREAS.map((a) => (
                <Tag
                  key={a}
                  label={areaLabel(a)}
                  on={form.injuries.includes(a)}
                  onPress={() => toggleInjury(a)}
                  bad
                />
              ))}
            </View>
            <Text style={styles.why}>
              Anything loading these gets swapped out, not just flagged. You
              can turn it off from Setup when it settles — leave it on and
              you'll train around it forever.
            </Text>
          </>
        );

      case 'lifts':
        return (
          <>
            {/* Only asked of people who have numbers to give. A beginner has
                none, and asking invites a guess worse than our estimate.
                Without this, a regular lifter who squats 140kg was offered
                47.5kg on the first screen they saw — wrong by a factor of
                three, from a formula, about their own body.

                It used to sit BELOW the Continue button, so the people it
                exists for tapped Continue and never saw it. */}
            <Text style={styles.hint}>
              Roughly, for a working set. Skip any you don't know — I'll guess
              those from your bodyweight, and guessing is worse.
            </Text>
            {ANCHOR_LIFTS.map((lift) => {
              const raw = form.declaredLifts[lift.exerciseId];
              const err = raw !== undefined ? implausibleDeclaredLift(raw) : null;
              return (
                <View key={lift.exerciseId}>
                  <View style={styles.liftRow}>
                    <Text style={styles.liftLabel}>{lift.label}</Text>
                    <View style={styles.liftInputWrap}>
                      <TextInput
                        style={[styles.liftInput, err !== null && styles.liftInputBad]}
                        value={raw !== undefined ? String(raw) : ''}
                        onChangeText={(v) => {
                          const n = Number(v);
                          setForm((prev) => {
                            const next = { ...prev.declaredLifts };
                            if (v.trim() === '' || !Number.isFinite(n)) {
                              delete next[lift.exerciseId];
                            } else {
                              next[lift.exerciseId] = n;
                            }
                            return { ...prev, declaredLifts: next };
                          });
                        }}
                        keyboardType="decimal-pad"
                        placeholder="—"
                        placeholderTextColor={colors.textTertiary}
                        maxLength={5}
                        selectTextOnFocus
                      />
                      <Text style={styles.liftUnit}>kg</Text>
                    </View>
                  </View>
                  {err !== null && <Text style={styles.liftErr}>{err}</Text>}
                </View>
              );
            })}
          </>
        );
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Progress, so "five questions" is a promise the screen keeps. */}
        <View style={[styles.topBar, { paddingHorizontal: layout.gutter }]}>
          {index > 0 ? (
            <TouchableOpacity
              onPress={() => setStepIndex(index - 1)}
              hitSlop={12}
              activeOpacity={0.6}
            >
              <Text style={styles.back}>Back</Text>
            </TouchableOpacity>
          ) : (
            <View />
          )}
          <Text style={styles.count}>{index + 1} of {steps.length}</Text>
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${((index + 1) / steps.length) * 100}%` }]} />
        </View>

        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingHorizontal: layout.gutter },
            layout.maxContentWidth !== undefined && {
              maxWidth: layout.maxContentWidth, alignSelf: 'center', width: '100%',
            },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Text style={[typography.largeTitle, styles.title]}>{STEP_TITLE[step]}</Text>
          {renderStep()}

          {submitError !== null && <Text style={styles.error}>{submitError}</Text>}

          {/* The only screen every tester must pass, and until the last build
              the only one with no way to report being stuck on it. */}
          <TellMe
            where={`Onboarding/${step}`}
            label="Stuck here? Tell me"
            detail={() =>
              `step ${index + 1}/${steps.length} (${step})\n` +
              `form: ${JSON.stringify(form)}\nblocked by: ${blocked ?? 'nothing'}`
            }
          />
        </ScrollView>

        {/* Pinned, so it is never below the fold and never under the keyboard. */}
        <View style={[styles.footer, { paddingHorizontal: layout.gutter }]}>
          {!canAdvance && <Text style={styles.needs}>{blocked}</Text>}
          <PrimaryButton
            title={submitting ? 'Saving…' : isLast ? 'Build my first session' : 'Next'}
            onPress={next}
            disabled={!canAdvance || submitting}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingBottom: 32, paddingTop: 4 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 44,
  },
  back: { fontSize: 16, color: colors.primary, fontWeight: '600' },
  count: { fontSize: 13, color: colors.textTertiary },
  track: { height: 3, backgroundColor: colors.card, marginBottom: 8 },
  fill: { height: 3, backgroundColor: colors.primary },
  footer: {
    paddingTop: 10, paddingBottom: 12,
    borderTopWidth: 1, borderTopColor: colors.separator,
    backgroundColor: colors.background,
  },
  hint: { fontSize: 14, lineHeight: 20, color: colors.textMuted, marginBottom: 14 },
  liftRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.card, borderRadius: 10,
    paddingHorizontal: 14, minHeight: 56, marginBottom: 8,
  },
  liftLabel: { fontSize: 16, color: colors.text, flexShrink: 1 },
  liftInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liftInput: {
    minWidth: 68, textAlign: 'right', fontSize: 19, fontWeight: '600',
    color: colors.text, paddingVertical: 8,
  },
  liftInputBad: { color: colors.destructive },
  liftUnit: { fontSize: 14, color: colors.textMuted },
  liftErr: { fontSize: 13, color: colors.destructive, marginTop: -4, marginBottom: 8 },
  needs: {
    fontSize: 13, color: colors.textMuted, textAlign: 'center', marginBottom: 8,
  },
  title: { marginTop: 14, marginBottom: 18 },
  sub: {
    fontSize: 15, fontWeight: '600', color: colors.text,
    marginTop: 26, marginBottom: 10,
  },
  why: { fontSize: 13, color: colors.textTertiary, marginTop: 14, lineHeight: 19 },
  pillRow: { flexDirection: 'row', gap: 8 },
  pill: {
    flex: 1, height: 56, borderRadius: 10, alignItems: 'center',
    justifyContent: 'center', backgroundColor: colors.card,
  },
  pillOn: { backgroundColor: colors.primary },
  pillText: { fontSize: 18, fontWeight: '600', color: colors.text },
  // Dark on the accent, not white — the accent is a light sage and white on
  // it fails contrast. Was '#fff' here and in tagTextOn.
  pillTextOn: { color: colors.onPrimary },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pairRow: { flexDirection: 'row', gap: 12 },
  pairCell: { flex: 1 },
  pairLabel: { fontSize: 13, color: colors.textMuted, marginBottom: 6 },
  tag: {
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999,
    backgroundColor: colors.card, minHeight: 44, justifyContent: 'center',
  },
  tagOn: { backgroundColor: colors.primary },
  tagInjured: { backgroundColor: colors.destructive },
  tagText: { fontSize: 14, color: colors.textMuted },
  tagTextOn: { color: colors.onPrimary, fontWeight: '600' },
  inputWrap: { backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 16 },
  input: { fontSize: 17, color: colors.text, paddingVertical: 14 },
  error: { fontSize: 14, color: colors.destructive, marginTop: 20, textAlign: 'center' },
});
