import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView,
  Animated, ScrollView,
} from 'react-native';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { PrimaryButton } from '../components/PrimaryButton';
import { motivationalMessages } from '../constants/workouts';
import { useFitness } from '../context/FitnessContext';
import type { RootStackScreenProps } from '../navigation/types';

export default function CompletionScreen({
  navigation,
}: RootStackScreenProps<'Completion'>): React.ReactElement {
  const { userData, currentDay, streak, history } = useFitness();
  const completedDay = currentDay - 1;

  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const goalJustHit = streak === 3;
  const pastGoal = streak > 3;

  const completionMessages = motivationalMessages.completion;
  const fallbackIndex = completedDay % completionMessages.length;
  const fallbackMessage = completionMessages[fallbackIndex] ?? completionMessages[0]!;

  const heroSub = goalJustHit
    ? 'You hit the goal. Three days in a row.'
    : pastGoal
      ? "Past Day 3. This is who you are now."
      : fallbackMessage;

  const adherencePercent = Math.round((streak / Math.max(history.length, 1)) * 100);

  const handleContinue = () => {
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={[styles.hero, { opacity: fadeAnim }]}>
          {goalJustHit && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>GOAL REACHED</Text>
            </View>
          )}
          <Text style={styles.heroDay}>Day {completedDay}</Text>
          <Text style={styles.heroSub}>Complete</Text>
          <Text style={styles.heroMsg}>{heroSub}</Text>
        </Animated.View>

        <Text style={styles.section}>STATS</Text>
        <View style={styles.group}>
          <View style={[styles.cell, styles.border]}>
            <Text style={styles.cellLabel}>Streak</Text>
            <Text style={styles.cellValue}>{streak}</Text>
          </View>
          <View style={[styles.cell, styles.border]}>
            <Text style={styles.cellLabel}>Adherence</Text>
            <Text style={styles.cellValue}>{adherencePercent}%</Text>
          </View>
          <View style={styles.cell}>
            <Text style={styles.cellLabel}>Days logged</Text>
            <Text style={styles.cellValue}>{history.length}</Text>
          </View>
        </View>

        {!!userData.why && (
          <>
            <Text style={styles.section}>YOUR WHY</Text>
            <View style={styles.group}>
              <View style={styles.whyCell}>
                <Text style={styles.whyText}>"{userData.why}"</Text>
              </View>
            </View>
          </>
        )}

        <PrimaryButton
          title="Back to Home"
          onPress={handleContinue}
          style={styles.cta}
        />

        {streak >= 7 && (
          <Text style={styles.footnote}>
            7 days logged. You've built the habit.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: 16, paddingBottom: 48, paddingTop: 24 },
  hero: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 16,
  },
  badge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 20,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 1.4,
  },
  heroDay: {
    fontSize: 56,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -1.5,
    lineHeight: 60,
  },
  heroSub: {
    fontSize: 20,
    fontWeight: '500',
    color: colors.textMuted,
    marginTop: 2,
  },
  heroMsg: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 20,
    maxWidth: 300,
    lineHeight: 21,
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
  cell: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    minHeight: 44,
  },
  border: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  cellLabel: { fontSize: 17, color: colors.text },
  cellValue: { fontSize: 17, color: colors.textMuted },
  whyCell: { padding: 16 },
  whyText: {
    fontSize: 16,
    color: colors.text,
    fontStyle: 'italic',
    lineHeight: 22,
  },
  cta: { marginTop: 32 },
  footnote: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 12,
  },
});
