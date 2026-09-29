import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Share, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { PrimaryButton } from '../components/PrimaryButton';
import { ProgressBar } from '../components/ProgressBar';
import { ReturnHome } from '../components/ReturnHome';
import { ContextCard } from '../components/ContextCard';
import { useFitness, type GoalType } from '../context/FitnessContext';
import { APP_BUILD } from '../constants/build';
import type { RootStackScreenProps } from '../navigation/types';

const GOAL_LABELS: Record<GoalType, string> = {
  lose: 'Lose Fat',
  gain: 'Build Muscle',
  maintain: 'Stay Fit',
};

export default function HomeScreen({
  navigation,
}: RootStackScreenProps<'Home'>): React.ReactElement {
  const {
    userData, todaysSession, currentDay, streak, adherence, reentry,
    preview, previewError, contextState, reveal, exportDigest, exportBackup, logHealth,
  } = useFitness();
  const goalSet = userData.goal !== null && userData.why.length > 0;

  const goalKey: GoalType = userData.goal ?? 'maintain';

  // Both branches now come from the same engine. Before 2026-09-26 this
  // previewed `getTodaysWorkout(equipment, day % 3)` — a three-template
  // rotation that had nothing to do with the session the check-in would
  // actually build. The preview lied about what you were walking into.
  const shown = todaysSession ?? preview;
  const workoutName = shown?.workoutName ?? null;
  const exercises = shown?.exercises ?? [];
  const exerciseCount = exercises.length;
  const totalSets = exercises.reduce((acc, e) => acc + e.sets, 0);
  const estimatedMinutes = Math.round(totalSets * 1.5 + exerciseCount * 0.5);
  // Only the preview carries the engine's reasoning; a scheduled session
  // keeps its opening note instead.
  const splitName = todaysSession ? null : (preview?.splitName ?? null);
  const why = todaysSession ? null : (preview?.reasons[0] ?? null);

  const status = todaysSession?.status ?? null;
  const isDone = status === 'completed';
  const isSkipped = status === 'skipped';
  const inProgress = status === 'scheduled' || status === 'active';

  const greeting =
    isDone ? 'Logged.' :
    streak.totalCompleted === 0 ? "Let's start." :
    'Ready when you are.';

  // Sessions hit vs sessions due over a trailing 4 weeks. Unlike a
  // consecutive-day streak this doesn't punish programmed rest days, and
  // it's the number the lapse message will need later.
  const adherenceProgress = adherence.expected > 0
    ? Math.min(adherence.completed / adherence.expected, 1)
    : 0;

  const ctaTitle =
    isDone ? 'Done for today' :
    isSkipped ? 'Skipped today' :
    inProgress ? 'Resume Workout' :
    'Start Workout';

  // Testers are not going to write bug reports. This gives them one tap to
  // hand over what actually happened, in whatever app they already message
  // on. Behavioural data beats "yeah it was alright".
  const handleShare = () => {
    void Share.share({ message: exportDigest() })
      .catch(() => { /* dismissed */ });
  };

  // The restorable copy. Separate from "Send my training data" on purpose:
  // that one is prose for reading, this one is the bytes for keeping.
  const [backingUp, setBackingUp] = useState(false);
  const handleBackup = () => {
    if (backingUp) return;
    setBackingUp(true);
    void exportBackup()
      .then((r) => {
        if (!r.ok) { Alert.alert('Backup failed', r.reason); return; }
        if (!r.shared) {
          Alert.alert(
            'Backup saved',
            `${r.eventCount} events (${Math.round(r.bytes / 1024)} KB).\n\nThis phone could not open a share sheet, so the file is at:\n${r.uri}`,
          );
        }
      })
      .finally(() => setBackingUp(false));
  };

  const handleStart = () => {
    if (inProgress && todaysSession) {
      navigation.navigate('Workout', { sessionId: todaysSession.sessionId });
    } else {
      navigation.navigate('Checkin');
    }
  };

  // After a gap the return flow REPLACES home — it is not a banner on top
  // of the usual screen. Suppressed once today's session is underway.
  if (reentry.speak && todaysSession === null && goalSet) {
    return (
      <SafeAreaView style={styles.safe}>
        <ReturnHome
          policy={reentry}
          // These were both `navigate('Checkin')` — two buttons, identical
          // behaviour, one of them labelled "I feel fine — full session".
          onResume={() => navigation.navigate('Checkin')}
          onFullSession={() => navigation.navigate('Checkin', { full: true })}
          // Was 'Goal'. The two things that actually changed after a gap are
          // an injury and a change of kit, and both live in Setup — which was
          // unreachable while this screen replaced Home.
          onSomethingChanged={() => navigation.navigate('Setup')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <Text
            style={styles.dayTag}
            onLongPress={() => { if (__DEV__) navigation.navigate('Dev'); }}
            suppressHighlighting
          >
            Day {currentDay}
          </Text>
          <Text style={styles.streakText}>{streak.totalCompleted} sessions</Text>
        </View>

        {/* Loud on purpose. Unreadable rows mean the projections below are
            incomplete and writing is blocked — the same state that used to
            render as a brand-new app with the history still on disk. */}
        {logHealth.unreadable > 0 && (
          <View style={styles.alarm}>
            <Text style={styles.alarmTitle}>
              {logHealth.unreadable} of your records could not be read
            </Text>
            <Text style={styles.alarmBody}>
              Everything below is incomplete, and I have stopped writing so
              nothing gets worse. Nothing has been deleted. Please don't
              reinstall — that would remove the history I need to look at.
            </Text>
            <TouchableOpacity onPress={handleShare} activeOpacity={0.6}>
              <Text style={styles.alarmAction}>Send me the details</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={[typography.largeTitle, styles.title]}>{greeting}</Text>

        <View style={styles.progressRow}>
          <Text style={styles.progressLabel}>
            {adherence.meaningful ? 'Last 4 weeks' : 'Sessions logged'}
          </Text>
          <Text style={[
            styles.progressNum,
            adherenceProgress >= 0.8 && { color: colors.primary, fontWeight: '600' as const },
          ]}>
            {adherence.meaningful
              ? `${adherence.completed} of ${adherence.expected}`
              : String(adherence.completed)}
          </Text>
        </View>
        <ProgressBar progress={adherenceProgress} style={{ marginBottom: 4 }} />
        {adherence.meaningful && adherenceProgress >= 0.8 && (
          <Text style={styles.adherenceNote}>
            You've hit {adherence.completed} of your last {adherence.expected}. That holds.
          </Text>
        )}

        {goalSet && (
          <View style={styles.contextWrap}>
            <ContextCard state={contextState} reveal={reveal} />
          </View>
        )}

        <Text style={styles.section}>GOAL</Text>
        <TouchableOpacity
          style={styles.group}
          onPress={() => navigation.navigate('Goal')}
          activeOpacity={0.5}
        >
          <View style={styles.cell}>
            <View style={{ flex: 1 }}>
              {goalSet ? (
                <>
                  <Text style={styles.cellTitle}>{GOAL_LABELS[goalKey]}</Text>
                  <Text style={styles.cellSub}>"{userData.why}"</Text>
                </>
              ) : (
                <>
                  <Text style={[styles.cellTitle, { color: colors.primary }]}>
                    Set your goal
                  </Text>
                  <Text style={styles.cellSub}>
                    A clear why gets you to Day 3.
                  </Text>
                </>
              )}
            </View>
            <Text style={styles.chevron}>›</Text>
          </View>
        </TouchableOpacity>

        <Text style={styles.section}>TODAY</Text>
        <View style={styles.group}>
          <View style={styles.cell}>
            <View style={{ flex: 1 }}>
              {workoutName !== null ? (
                <>
                  <Text style={styles.cellTitle}>{workoutName}</Text>
                  <Text style={styles.cellSubPlain}>
                    Day {currentDay} · ~{estimatedMinutes} min · {exerciseCount} exercises
                    {splitName !== null ? ` · ${splitName}` : ''}
                  </Text>
                  {why !== null && <Text style={styles.cellSub}>{why}</Text>}
                </>
              ) : (
                <>
                  <Text style={styles.cellTitle}>
                    {previewError !== null ? 'Nothing safe to give you' : 'Ready to build'}
                  </Text>
                  <Text style={styles.cellSubPlain}>
                    {previewError ?? 'Check in and I\'ll put today together.'}
                  </Text>
                </>
              )}
            </View>
          </View>
        </View>

        {isDone && !!todaysSession?.summary && (
          <>
            <Text style={styles.section}>TODAY'S SUMMARY</Text>
            <View style={styles.group}>
              <View style={styles.summaryCell}>
                <Text style={styles.summaryText}>{todaysSession.summary}</Text>
              </View>
            </View>
          </>
        )}

        <PrimaryButton
          title={ctaTitle}
          onPress={handleStart}
          disabled={!goalSet || isDone || isSkipped || previewError !== null}
          style={styles.cta}
        />
        {!goalSet && <Text style={styles.footnote}>Set a goal first.</Text>}
        {isSkipped && (
          <Text style={styles.footnote}>
            Today's logged as skipped. Back at it tomorrow.
          </Text>
        )}

        <TouchableOpacity onPress={handleBackup} activeOpacity={0.6} style={styles.shareRow}>
          <Text style={styles.shareText}>
            {backingUp ? 'Saving a backup…' : 'Save a backup of my training log'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.backupNote}>
          Keep this somewhere off your phone. Uninstalling the app, or clearing
          its data, deletes your history permanently — a backup is the only way
          to get it back.
        </Text>

        <TouchableOpacity
          onPress={() => navigation.navigate('Setup')}
          activeOpacity={0.6}
          style={styles.shareRow}
        >
          <Text style={styles.shareText}>Change my setup</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleShare} activeOpacity={0.6} style={styles.shareRowTight}>
          <Text style={styles.shareText}>Send my training data to Prajwal</Text>
        </TouchableOpacity>
        <Text style={styles.build}>{APP_BUILD}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
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
  title: { marginTop: 10, marginBottom: 24, marginLeft: 4 },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  progressLabel: { fontSize: 13, color: colors.textMuted },
  progressNum: { fontSize: 13, color: colors.textMuted },
  adherenceNote: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 8,
    marginLeft: 4,
  },
  contextWrap: { marginTop: 28 },
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
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 56,
  },
  cellTitle: { fontSize: 17, fontWeight: '500', color: colors.text },
  cellSub: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 4,
    fontStyle: 'italic',
    lineHeight: 19,
  },
  cellSubPlain: { fontSize: 14, color: colors.textMuted, marginTop: 4 },
  summaryCell: { padding: 16 },
  summaryText: { fontSize: 15, color: colors.text, lineHeight: 21 },
  chevron: { fontSize: 20, color: colors.textTertiary, marginLeft: 8 },
  cta: { marginTop: 32 },
  alarm: {
    backgroundColor: colors.card,
    borderColor: colors.destructive,
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    marginTop: 12,
  },
  alarmTitle: { fontSize: 16, fontWeight: '700', color: colors.destructive },
  alarmBody: { fontSize: 14, lineHeight: 20, color: colors.text, marginTop: 8 },
  alarmAction: { fontSize: 15, fontWeight: '600', color: colors.primary, marginTop: 12 },
  shareRow: { marginTop: 40, minHeight: 44, justifyContent: 'center' },
  backupNote: {
    fontSize: 12, lineHeight: 17, color: colors.textTertiary,
    textAlign: 'center', marginTop: 4, paddingHorizontal: 12,
  },
  shareRowTight: { marginTop: 4, minHeight: 44, justifyContent: 'center' },
  shareText: { fontSize: 14, color: colors.primary, textAlign: 'center' },
  build: { fontSize: 11, color: colors.textTertiary, textAlign: 'center', marginTop: 6 },
  footnote: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 10,
  },
});
