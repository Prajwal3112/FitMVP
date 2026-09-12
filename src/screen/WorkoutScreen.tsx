import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  SafeAreaView, TouchableOpacity,
} from 'react-native';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { ExerciseCard } from '../components/ExerciseCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { getTodaysWorkout, motivationalMessages } from '../constants/workouts';
import { useFitness } from '../context/FitnessContext';
import type { RootStackScreenProps } from '../navigation/types';

export default function WorkoutScreen({
  navigation,
}: RootStackScreenProps<'Workout'>): React.ReactElement {
  const { userData, currentDay, streak, completeWorkout, skipWorkout } = useFitness();
  const [confirmSkip, setConfirmSkip] = useState<boolean>(false);

  const equipment = userData.equipment ?? 'home';
  const { why } = userData;
  const workout = getTodaysWorkout(equipment, currentDay);
  const exercises = workout.exercises;

  const isDay3 = currentDay === 3;
  const totalSets = exercises.reduce((acc, e) => acc + e.sets, 0);
  const estimatedMinutes = Math.round(totalSets * 1.5 + exercises.length * 0.5);

  const handleDone = () => {
    completeWorkout();
    navigation.navigate('Completion');
  };

  const handleSkip = () => {
    skipWorkout();
    setConfirmSkip(false);
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  };

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

        <Text style={[typography.largeTitle, styles.title]}>{workout.name}</Text>
        <Text style={styles.meta}>
          Day {currentDay} · ~{estimatedMinutes} min · {exercises.length} exercises
        </Text>

        {isDay3 && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              {motivationalMessages.day3[0]}
            </Text>
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
          {exercises.map((exercise, i) => (
            <ExerciseCard
              key={i}
              exercise={exercise}
              index={i}
              isLast={i === exercises.length - 1}
            />
          ))}
        </View>

        {!confirmSkip ? (
          <>
            <PrimaryButton
              title="Done"
              onPress={handleDone}
              style={styles.doneBtn}
            />
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
              This day will be logged as skipped.
            </Text>
            <PrimaryButton
              title="Skip Today"
              onPress={handleSkip}
              variant="destructive"
              style={{ marginTop: 16 }}
            />
            <PrimaryButton
              title="Cancel"
              onPress={() => setConfirmSkip(false)}
              variant="secondary"
              style={{ marginTop: 8 }}
            />
          </View>
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
  },
});
