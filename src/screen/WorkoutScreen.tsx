import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { DROP_REASON } from '../constants/copy';
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
  // Local, not persisted — see the PREP comment below.
  const [prepDone, setPrepDone] = useState<string[]>([]);
  const [coolDone, setCoolDone] = useState<string[]>([]);
  const warmup = session.warmup;
  const cooldown = session.cooldown;

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

        {/* PREP. Built on every check-in since 2026-09-25 and rendered
            nowhere: 137 movements, the whole dynamic-before/static-after
            argument, zero pixels. Ticks are local state on purpose — they are
            a within-session convenience, not a fact worth an event type, and
            pretending otherwise would put un-replayable UI state in the log. */}
        {warmup !== null && (warmup.raise.length > 0 || warmup.mobilise.length > 0) && (
          <>
            <Text style={styles.section}>
              PREP {warmup.minutes > 0 ? `· ~${warmup.minutes} MIN` : ''}
            </Text>
            <View style={styles.group}>
              <View style={styles.prepNote}>
                <Text style={styles.prepNoteText}>
                  Movement, not stretching. Held stretches before lifting
                  temporarily cut how much force you can produce — those are at
                  the end.
                </Text>
              </View>
              {[...warmup.raise, ...warmup.mobilise].map((m, i) => {
                const on = prepDone.includes(m.id);
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.mobRow, i > 0 && styles.mobDivider]}
                    onPress={() => setPrepDone((prev) =>
                      prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id])}
                    activeOpacity={0.6}
                  >
                    <View style={[styles.tick, on && styles.tickOn]}>
                      <Text style={[styles.tickMark, on && styles.tickMarkOn]}>✓</Text>
                    </View>
                    <Text style={[styles.mobName, on && styles.mobNameDone]}>{m.name}</Text>
                  </TouchableOpacity>
                );
              })}
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

        {/* COOL DOWN. Held stretches, and only here — buildCooldown returns
            one per muscle actually worked, so it is not four hamstring
            stretches. Shown once there is something to cool down from. */}
        {cooldown.length > 0 && canFinish && (
          <>
            <Text style={styles.section}>COOL DOWN</Text>
            <View style={styles.group}>
              <View style={styles.coolNote}>
                <Text style={styles.prepNoteText}>
                  Hold each one 20–30 seconds. Now is when stretching helps.
                </Text>
              </View>
              {cooldown.map((m, i) => {
                const on = coolDone.includes(m.id);
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.mobRow, i > 0 && styles.mobDivider]}
                    onPress={() => setCoolDone((prev) =>
                      prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id])}
                    activeOpacity={0.6}
                  >
                    <View style={[styles.tick, on && styles.tickOn]}>
                      <Text style={[styles.tickMark, on && styles.tickMarkOn]}>✓</Text>
                    </View>
                    <Text style={[styles.mobName, on && styles.mobNameDone]}>{m.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {/* What the engine wanted to prescribe and could not. Silence here
            reads as a thin session the app never explained. */}
        {session.dropped.length > 0 && (
          <>
            <Text style={styles.section}>LEFT OUT</Text>
            <View style={styles.group}>
              {session.dropped.map((d, i) => (
                <View key={i} style={[styles.mobRow, i > 0 && styles.mobDivider]}>
                  <View style={{ flex: 1, paddingVertical: 10 }}>
                    <Text style={styles.mobName}>{d.name}</Text>
                    <Text style={styles.prepNoteText}>{DROP_REASON[d.reason]}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

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
  prepNote: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 },
  prepNoteText: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
  mobRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, minHeight: 56,
  },
  mobDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  tick: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 1.5,
    borderColor: colors.separator, alignItems: 'center', justifyContent: 'center',
  },
  tickOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  tickMark: { fontSize: 14, color: 'transparent' },
  tickMarkOn: { color: '#FFFFFF' },
  mobName: { flex: 1, fontSize: 16, color: colors.text },
  mobNameDone: { color: colors.textTertiary, textDecorationLine: 'line-through' },
  coolNote: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 },
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
