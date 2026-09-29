import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { ExerciseLogCard, type LogSetArgs } from '../components/ExerciseLogCard';
import { RestTimerBar, useRestTimer } from '../components/RestTimer';
import { PrimaryButton } from '../components/PrimaryButton';
import { motivationalMessages } from '../constants/workouts';
import { useFitness } from '../context/FitnessContext';
import type { RootStackScreenProps } from '../navigation/types';
import type { SkipReason } from '../events/session';

export default function WorkoutScreen({
  navigation,
  route,
}: RootStackScreenProps<'Workout'>): React.ReactElement {
  const {
    userData, todaysSession, currentDay, adherence, exerciseHistory, suggestions,
    beginSession, recordSet, dropExercise, finishSession, skipToday,
  } = useFitness();

  const timer = useRestTimer();

  const [confirmSkip, setConfirmSkip] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  // The effect below re-runs whenever the projection refreshes. Without
  // this latch, a refresh landing while the append is still in flight
  // would fire a second SessionStarted for the same session.
  const startingRef = useRef<string | null>(null);

  const sessionId = route.params?.sessionId ?? todaysSession?.sessionId ?? null;
  const session = todaysSession && todaysSession.sessionId === sessionId
    ? todaysSession
    : null;

  // scheduled → active. Guarded in the command layer on the check-in.
  useEffect(() => {
    if (!session || session.status !== 'scheduled') return;
    if (startingRef.current === session.sessionId) return;
    startingRef.current = session.sessionId;
    void beginSession(session.sessionId).catch((e: unknown) => {
      startingRef.current = null; // let a retry through
      // eslint-disable-next-line no-console
      console.error('[WorkoutScreen] start failed:', e);
    });
  }, [session, beginSession]);

  if (!session) {
    // A bare spinner here is not always "loading". If the 4am rollover
    // lands mid-session the projection nulls today's session out and this
    // spins forever, with only the header arrow to escape — and nothing on
    // screen says so. Give it words and a way back after a beat.
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.waitText}>Loading your session…</Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('Home')}
            activeOpacity={0.6}
            style={styles.waitBtn}
          >
            <Text style={styles.waitLink}>Taking too long? Go back home</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const { why } = userData;
  const exercises = session.exercises;
  const isDay3 = currentDay === 3;
  const working = session.setLog.filter((s) => !s.isWarmup);
  const loggedCount = new Set(working.map((s) => s.exerciseId)).size;
  const canFinish = working.length > 0;

  const handleLogSet = (exerciseId: string) => (args: LogSetArgs) => {
    const alreadyLogged = session.setLog.some(
      (s) => s.exerciseId === exerciseId &&
        s.setIndex === args.setIndex &&
        s.isWarmup === (args.isWarmup === true),
    );
    void recordSet({ sessionId: session.sessionId, exerciseId, ...args })
      .then(() => {
        // Only a *new* working set starts the clock — editing a logged
        // set or rating it shouldn't restart your rest.
        if (!alreadyLogged && args.isWarmup !== true) timer.start();
      })
      .catch((e: unknown) => {
        Alert.alert("Couldn't log that set", e instanceof Error ? e.message : String(e));
      });
  };

  const handleSkipExercise = (exerciseId: string) => () => {
    void dropExercise(session.sessionId, exerciseId).catch((e: unknown) => {
      Alert.alert("Couldn't skip that", e instanceof Error ? e.message : String(e));
    });
  };

  // Done no longer completes the session — the review does. The session stays
  // `active` until then, so a tester who quits here can resume from Home
  // rather than losing the workout. `completeSession` refuses without a review
  // (see its InvariantViolation), so this cannot be routed around.
  const handleDone = () => {
    if (busy) return;
    navigation.navigate('Review', { sessionId: session.sessionId });
  };

  const handleSkipDay = (reason: SkipReason) => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      try {
        await skipToday(reason);
        setConfirmSkip(false);
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      } catch (e) {
        Alert.alert("Couldn't skip today", e instanceof Error ? e.message : String(e));
        setBusy(false);
      }
    })();
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
        keyboardDismissMode="interactive"
      >
        <View style={styles.topBar}>
          <Text style={styles.dayTag}>Day {currentDay}</Text>
          <Text style={styles.streakText}>
            {adherence.meaningful
              ? `${adherence.completed} of your last ${adherence.expected}`
              : `${adherence.completed} logged`}
          </Text>
        </View>

        <Text style={[typography.largeTitle, styles.title]}>{session.workoutName}</Text>
        <Text style={styles.meta}>
          {loggedCount}/{exercises.length} exercises · {working.length} working sets
        </Text>

        {!!session.openingNote && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{session.openingNote}</Text>
          </View>
        )}

        {isDay3 && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{motivationalMessages.day3[0]}</Text>
          </View>
        )}

        {!!why && (
          <>
            <Text style={styles.section}>YOUR WHY</Text>
            <View style={styles.group}>
              <View style={styles.whyCell}>
                <Text style={styles.whyText}>"{why}"</Text>
              </View>
            </View>
          </>
        )}

        <Text style={styles.section}>EXERCISES</Text>
        <View style={styles.group}>
          {exercises.map((slot, i) => (
            <ExerciseLogCard
              key={slot.exerciseId}
              slot={slot}
              index={i}
              isLast={i === exercises.length - 1}
              loggedSets={session.setLog.filter((s) => s.exerciseId === slot.exerciseId)}
              isSkipped={session.skippedExerciseIds.includes(slot.exerciseId)}
              last={exerciseHistory[slot.exerciseId]?.[0]}
              suggestion={suggestions[slot.exerciseId]}
              onLogSet={handleLogSet(slot.exerciseId)}
              onSkip={handleSkipExercise(slot.exerciseId)}
            />
          ))}
        </View>

        {!confirmSkip ? (
          <>
            <PrimaryButton
              title="Done"
              onPress={handleDone}
              disabled={!canFinish || busy}
              style={styles.doneBtn}
            />
            {!canFinish && (
              <Text style={styles.footnote}>Log at least one set to finish.</Text>
            )}
            <TouchableOpacity
              style={styles.skipBtn}
              onPress={() => setConfirmSkip(true)}
              activeOpacity={0.6}
            >
              <Text style={styles.skipText}>Skip today</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitle}>Skip today's workout?</Text>
            <Text style={styles.confirmSub}>
              Why? This is what your coach learns from.
            </Text>
            {(['time', 'unmotivated', 'illness', 'travel', 'other'] as const).map((r) => (
              <PrimaryButton
                key={r}
                title={SKIP_LABELS[r]}
                onPress={() => handleSkipDay(r)}
                variant="secondary"
                disabled={busy}
                style={{ marginTop: 8 }}
              />
            ))}
            <PrimaryButton
              title="Cancel"
              onPress={() => setConfirmSkip(false)}
              variant="secondary"
              style={{ marginTop: 16 }}
            />
          </View>
        )}
      </ScrollView>
      {!confirmSkip && <RestTimerBar timer={timer} />}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const SKIP_LABELS: Record<SkipReason, string> = {
  time: 'No time today',
  unmotivated: 'Not feeling it',
  illness: 'Sick',
  travel: 'Travelling',
  other: 'Something else',
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  waitText: { fontSize: 15, color: colors.textMuted, marginTop: 16 },
  waitBtn: { marginTop: 24, minHeight: 44, justifyContent: 'center' },
  waitLink: { fontSize: 15, color: colors.primary },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 16, paddingBottom: 48, paddingTop: 8 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  dayTag: { fontSize: 13, color: colors.textMuted },
  streakText: { fontSize: 15, fontWeight: '600', color: colors.text },
  title: { marginTop: 10, marginBottom: 6, marginLeft: 4 },
  meta: {
    fontSize: 15,
    color: colors.textMuted,
    marginLeft: 4,
    marginBottom: 20,
  },
  banner: {
    backgroundColor: colors.card,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    padding: 14,
    borderRadius: 10,
    marginBottom: 12,
  },
  bannerText: {
    fontSize: 15,
    color: colors.text,
    lineHeight: 20,
    fontWeight: '500',
  },
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
  whyCell: { padding: 16 },
  whyText: {
    fontSize: 16,
    color: colors.text,
    fontStyle: 'italic',
    lineHeight: 22,
  },
  doneBtn: { marginTop: 32 },
  footnote: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 10,
  },
  skipBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  skipText: { fontSize: 15, color: colors.textMuted },
  confirmBox: {
    marginTop: 32,
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 20,
  },
  confirmTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  confirmSub: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
});
