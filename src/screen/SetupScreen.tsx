import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { useFitness } from '../context/FitnessContext';
import type { OwnedEquipment, Experience } from '../events/userContext';
import { INJURY_AREAS, areaLabel } from '../data/muscles';
import type { RootStackScreenProps } from '../navigation/types';

/**
 * Change an onboarding answer after the fact.
 *
 * Onboarding answers were previously frozen for life: the Onboarding screen
 * is only reachable while `isOnboarded` is false. Over a multi-week test
 * that is fatal — people join a gym, buy dumbbells, hurt a shoulder, drop
 * from four days to two. Every one of those changes what the engine should
 * build, and none of them could be told to it.
 *
 * Each change appends UserContextUpdated rather than rewriting onboarding,
 * so the original answers stay in the log and the change is dated. That is
 * also the record of what someone's life actually did over four weeks,
 * which is worth more to you than the setting itself.
 */

const TIERS: { label: string; value: 'home' | 'gym' }[] = [
  { label: 'At home', value: 'home' },
  { label: 'At a gym', value: 'gym' },
];

const KIT: { label: string; value: OwnedEquipment }[] = [
  { label: 'Dumbbells', value: 'dumbbell' },
  { label: 'Resistance bands', value: 'bands' },
  { label: 'Kettlebells', value: 'kettlebells' },
  { label: 'Exercise ball', value: 'exercise ball' },
  { label: 'Barbell', value: 'barbell' },
  { label: 'Pull-up bar', value: 'pullup bar' },
];

const LEVELS: { label: string; value: Experience }[] = [
  { label: 'New to this', value: 'new' },
  { label: 'Coming back', value: 'returning' },
  { label: 'Train regularly', value: 'regular' },
  { label: 'Years of training', value: 'experienced' },
];

// Was a local list of joint names; 'knee', 'elbow' and 'hip' matched no
// muscle in the library and removed zero exercises, under copy promising
// they were safe. And 'shoulder' (singular) did not match Onboarding's
// 'shoulders', so a flagged injury read as OFF here and tapping it
// appended a duplicate. One list now, and every entry provably filters.

export default function SetupScreen({
  navigation,
}: RootStackScreenProps<'Setup'>): React.ReactElement {
  const { setup, updateSetup } = useFitness();
  const [busy, setBusy] = useState(false);

  const save = (field: string, after: unknown) => {
    if (busy) return;
    setBusy(true);
    void updateSetup(field, after)
      .catch((e: unknown) => {
        Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
      })
      .finally(() => setBusy(false));
  };

  const toggleKit = (v: OwnedEquipment) => {
    const next = setup.ownedEquipment.includes(v)
      ? setup.ownedEquipment.filter((x) => x !== v)
      : [...setup.ownedEquipment, v];
    save('ownedEquipment', next);
  };

  const toggleInjury = (v: string) => {
    const next = setup.knownInjuries.includes(v)
      ? setup.knownInjuries.filter((x) => x !== v)
      : [...setup.knownInjuries, v];
    save('knownInjuries', next);
  };

  const Pill = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => (
    <TouchableOpacity
      style={[styles.pill, on && styles.pillOn]}
      onPress={onPress}
      activeOpacity={0.6}
      disabled={busy}
    >
      <Text style={[styles.pillText, on && styles.pillTextOn]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={[typography.largeTitle, styles.title]}>Your setup</Text>
        <Text style={styles.intro}>
          Change any of this whenever it changes. Your next session is built
          from it — so if you buy dumbbells or tweak a shoulder, tell me here.
        </Text>

        <Text style={styles.section}>WHERE YOU TRAIN</Text>
        <View style={styles.row}>
          {TIERS.map((t) => (
            <Pill key={t.value} label={t.label} on={setup.equipment === t.value}
              onPress={() => save('equipment', t.value)} />
          ))}
        </View>

        {setup.equipment === 'home' && (
          <>
            <Text style={styles.section}>WHAT YOU OWN</Text>
            <Text style={styles.hint}>
              A pull-up bar matters more than it sounds — without one there is
              no pulling exercise in the whole library you can do at home.
            </Text>
            <View style={styles.row}>
              {KIT.map((k) => (
                <Pill key={k.value} label={k.label} on={setup.ownedEquipment.includes(k.value)}
                  onPress={() => toggleKit(k.value)} />
              ))}
            </View>
          </>
        )}

        <Text style={styles.section}>DAYS A WEEK</Text>
        <Text style={styles.hint}>
          Days you will actually train, not days you would like to. This picks
          your split — three real days beats five you skip.
        </Text>
        <View style={styles.row}>
          {[2, 3, 4, 5, 6].map((d) => (
            <Pill key={d} label={String(d)} on={setup.daysPerWeek === d}
              onPress={() => save('constraints.daysPerWeek', d)} />
          ))}
        </View>

        <Text style={styles.section}>TIME PER SESSION</Text>
        <View style={styles.row}>
          {[30, 45, 60, 90].map((m) => (
            <Pill key={m} label={`${m} min`} on={setup.sessionMaxMinutes === m}
              onPress={() => save('constraints.sessionMaxMinutes', m)} />
          ))}
        </View>

        <Text style={styles.section}>EXPERIENCE</Text>
        <View style={styles.row}>
          {LEVELS.map((l) => (
            <Pill key={l.value} label={l.label} on={setup.experience === l.value}
              onPress={() => save('experience', l.value)} />
          ))}
        </View>

        <Text style={styles.section}>ANYTHING HURTING</Text>
        <Text style={styles.hint}>
          Nothing that loads a flagged area will be put in a session. Take it
          off when it settles, or you will train around it forever.
        </Text>
        <View style={styles.row}>
          {INJURY_AREAS.map((a) => (
            <Pill key={a} label={areaLabel(a)} on={setup.knownInjuries.includes(a)}
              onPress={() => toggleInjury(a)} />
          ))}
        </View>

        <TouchableOpacity style={styles.done} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={styles.doneText}>Done</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: 20, paddingBottom: 56, paddingTop: 8 },
  title: { marginTop: 8, marginBottom: 10 },
  intro: { fontSize: 15, lineHeight: 22, color: colors.textMuted, marginBottom: 8 },
  section: {
    ...typography.sectionHeader, marginTop: 30, marginBottom: 8,
  },
  hint: { fontSize: 13, lineHeight: 19, color: colors.textTertiary, marginBottom: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    minHeight: 48, paddingHorizontal: 16, justifyContent: 'center',
    borderRadius: 24, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.separator,
  },
  pillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { fontSize: 15, color: colors.text },
  pillTextOn: { color: '#FFFFFF', fontWeight: '600' },
  done: {
    marginTop: 44, minHeight: 52, borderRadius: 12,
    backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center',
  },
  doneText: { fontSize: 17, fontWeight: '600', color: colors.primary },
});
