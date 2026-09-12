import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../constants/colors';
import type { Exercise } from '../constants/workouts';

export type ExerciseCardProps = {
  exercise: Exercise;
  index: number;
  isLast: boolean;
};

export const ExerciseCard: React.FC<ExerciseCardProps> = ({ exercise, index, isLast }) => {
  const reps = exercise.duration
    ? exercise.duration
    : `${exercise.sets} × ${exercise.reps ?? 0}`;

  return (
    <View style={[styles.cell, !isLast && styles.border]}>
      <Text style={styles.index}>{index + 1}</Text>
      <View style={styles.content}>
        <Text style={styles.name}>{exercise.name}</Text>
        <Text style={styles.reps}>{reps}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 56,
  },
  border: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  index: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.primary,
    width: 24,
  },
  content: { flex: 1 },
  name: { fontSize: 17, color: colors.text, fontWeight: '500' },
  reps: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
});
