import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { PrimaryButton } from '../components/PrimaryButton';
import { useFitness } from '../context/FitnessContext';
import { seedHistory, wipeAllEvents } from '../dev/seed';
import { eventCount, verifyChain } from '../events/log';
import { trainingDayOf } from '../events/base';
import type { RootStackScreenProps } from '../navigation/types';

// ─── Dev panel ───────────────────────────────────────────────────────
// DEV BUILDS ONLY — reached by long-pressing the day label on Home.
// Exists so a multi-week test fits in an afternoon: the things worth
// testing (prefill, rotation, adherence, the return-after-a-lapse screen)
// are all invisible on a freshly installed app.

type Preset = {
  label: string;
  detail: string;
  sessions: number;
  gapDays: number;
};

const PRESETS: Preset[] = [
  {
    label: 'Trained yesterday',
    detail: '4 sessions, last one yesterday. Prefill and rotation are live.',
    sessions: 4,
    gapDays: 1,
  },
  {
    label: 'A month in',
    detail: '14 sessions ending yesterday. Adherence is meaningful, loads have ramped.',
    sessions: 14,
    gapDays: 1,
  },
  {
    label: 'Lapsed 9 days',
    detail: '14 sessions, then nothing for 9 days. The return case.',
    sessions: 14,
    gapDays: 9,
  },
  {
    label: 'Lapsed 10 weeks',
    detail: '20 sessions, then a 70-day gap. Deep re-entry.',
    sessions: 20,
    gapDays: 70,
  },
];

export default function DevScreen({
  navigation,
}: RootStackScreenProps<'Dev'>): React.ReactElement {
  const { userData, devReload, todaysSession, currentDay, adherence, streak } = useFitness();
  const [busy, setBusy] = useState<string | null>(null);
  const [diag, setDiag] = useState<string>('');

  const equipment = userData.equipment ?? 'home';

  const runDiagnostics = useCallback(async () => {
    const [count, chain] = await Promise.all([eventCount(), verifyChain()]);
    setDiag(
      [
        `events: ${count}`,
        `chain: ${chain.ok ? 'ok' : `BROKEN at seq ${chain.brokenAtSeq} (${chain.reason})`}`,
        `today: ${trainingDayOf(new Date(), 4)}`,
        `session today: ${todaysSession?.status ?? 'none'}`,
        `day label: ${currentDay}`,
        `adherence: ${adherence.completed}/${adherence.expected}${adherence.meaningful ? '' : ' (not yet meaningful)'}`,
        `completed all-time: ${streak.totalCompleted}, skipped: ${streak.totalSkipped}`,
      ].join('\n'),
    );
  }, [todaysSession, currentDay, adherence, streak]);

  const applyPreset = (p: Preset) => {
    Alert.alert(
      p.label,
      `This wipes all existing data, then seeds ${p.sessions} sessions ending ${p.gapDays} day(s) ago.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Do it',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(p.label);
              try {
                await wipeAllEvents();
                await devReload();
                const res = await seedHistory({
                  sessions: p.sessions,
                  gapDays: p.gapDays,
                  equipment,
                });
                await devReload();
                Alert.alert(
                  'Seeded',
                  `${res.completed} completed, ${res.skipped} skipped, ${res.events} events.\n\nOnboarding and goal were seeded too — go Back and you're in a working app.`,
                );
                await runDiagnostics();
              } catch (e) {
                Alert.alert('Seed failed', e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(null);
              }
            })();
          },
        },
      ],
    );
  };

  const wipe = () => {
    Alert.alert('Wipe everything?', 'Deletes every event. Back to a fresh install.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Wipe',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy('wipe');
            try {
              await wipeAllEvents();
              await devReload();
              setDiag('');
              Alert.alert('Wiped', 'Restart the app to go back through onboarding.');
            } catch (e) {
              Alert.alert('Wipe failed', e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(null);
            }
          })();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={[typography.largeTitle, styles.title]}>Dev</Text>
        <Text style={styles.lede}>
          Seeds backdated events through the real validators and hash chain — a seeded
          log is indistinguishable from a real one.
        </Text>

        <Text style={styles.section}>SEED A HISTORY</Text>
        <View style={styles.group}>
          {PRESETS.map((p, i) => (
            <TouchableOpacity
              key={p.label}
              style={[styles.cell, i < PRESETS.length - 1 && styles.border]}
              onPress={() => applyPreset(p)}
              disabled={busy !== null}
              activeOpacity={0.6}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.cellTitle}>{p.label}</Text>
                <Text style={styles.cellSub}>{p.detail}</Text>
              </View>
              {busy === p.label ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={styles.chevron}>›</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.footnote}>
          Equipment: {equipment}. Seeded loads ramp 2.5kg per cycle so progression has a trend.
        </Text>

        <Text style={styles.section}>DIAGNOSTICS</Text>
        <View style={styles.group}>
          <TouchableOpacity style={styles.cell} onPress={() => { void runDiagnostics(); }} activeOpacity={0.6}>
            <Text style={styles.cellTitle}>Run checks</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        </View>
        {diag.length > 0 && (
          <View style={[styles.group, { marginTop: 8 }]}>
            <Text style={styles.mono}>{diag}</Text>
          </View>
        )}

        <Text style={styles.section}>DANGER</Text>
        <PrimaryButton
          title="Wipe all data"
          onPress={wipe}
          variant="destructive"
          disabled={busy !== null}
        />

        <PrimaryButton
          title="Back"
          onPress={() => navigation.goBack()}
          variant="secondary"
          style={{ marginTop: 12 }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: 16, paddingBottom: 48, paddingTop: 8 },
  title: { marginTop: 10, marginBottom: 6, marginLeft: 4 },
  lede: { fontSize: 14, color: colors.textMuted, marginLeft: 4, lineHeight: 19 },
  section: { ...typography.sectionHeader, marginTop: 28, marginBottom: 6, marginLeft: 16 },
  group: { backgroundColor: colors.card, borderRadius: 10, overflow: 'hidden' },
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 56,
  },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  cellTitle: { fontSize: 17, fontWeight: '500', color: colors.text, flex: 1 },
  cellSub: { fontSize: 13, color: colors.textMuted, marginTop: 3, lineHeight: 18 },
  chevron: { fontSize: 20, color: colors.textTertiary, marginLeft: 8 },
  mono: { fontSize: 13, color: colors.text, padding: 16, lineHeight: 20 },
  footnote: { fontSize: 12, color: colors.textTertiary, marginTop: 8, marginLeft: 4 },
});
