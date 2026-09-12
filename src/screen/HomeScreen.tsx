import React from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  SafeAreaView, TouchableOpacity,
} from 'react-native';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { PrimaryButton } from '../components/PrimaryButton';
import { ProgressBar } from '../components/ProgressBar';
import { getTodaysWorkout } from '../constants/workouts';
import { useFitness, type GoalType } from '../context/FitnessContext';
import type { RootStackScreenProps } from '../navigation/types';

const GOAL_LABELS: Record<GoalType, string> = {
  lose: 'Lose Fat',
  gain: 'Build Muscle',
  maintain: 'Stay Fit',
};

export default function HomeScreen({
  navigation,
}: RootStackScreenProps<'Home'>): React.ReactElement {
  const { userData, currentDay, streak } = useFitness();
  const goalSet = userData.goal !== null && userData.why.length > 0;

  const equipment = userData.equipment ?? 'home';
  const goalKey: GoalType = userData.goal ?? 'maintain';
  const workout = getTodaysWorkout(equipment, currentDay);
  const totalSets = workout.exercises.reduce((acc, e) => acc + e.sets, 0);
  const estimatedMinutes = Math.round(totalSets * 1.5 + workout.exercises.length * 0.5);

  const greeting =
    streak === 0 ? "Let's start." :
    streak < 3 ? 'Keep going.' :
    streak === 3 ? 'Goal hit.' :
    'Still going.';

  const streakProgress = Math.min(streak / 3, 1);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <Text style={styles.dayTag}>Day {currentDay}</Text>
          <Text style={styles.streakText}>🔥 {streak}</Text>
        </View>

        <Text style={[typography.largeTitle, styles.title]}>{greeting}</Text>

        <View style={styles.progressRow}>
          <Text style={styles.progressLabel}>3-Day Streak Goal</Text>
          <Text style={[
            styles.progressNum,
            streak >= 3 && { color: colors.primary, fontWeight: '600' as const },
          ]}>
            {Math.min(streak, 3)}/3
          </Text>
        </View>
        <ProgressBar progress={streakProgress} style={{ marginBottom: 4 }} />

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
              <Text style={styles.cellTitle}>{workout.name}</Text>
              <Text style={styles.cellSubPlain}>
                Day {currentDay} · ~{estimatedMinutes} min · {workout.exercises.length} exercises
              </Text>
            </View>
          </View>
        </View>

        <PrimaryButton
          title="Start Workout"
          onPress={() => navigation.navigate('Workout')}
          disabled={!goalSet}
          style={styles.cta}
        />
        {!goalSet && (
          <Text style={styles.footnote}>Set a goal first.</Text>
        )}
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
  chevron: { fontSize: 20, color: colors.textTertiary, marginLeft: 8 },
  cta: { marginTop: 32 },
  footnote: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 10,
  },
});
