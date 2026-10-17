import React, { useMemo, useState } from 'react';
import { View, Text, SectionList, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { useFitness } from '../context/FitnessContext';
import { workingSets } from '../projections/sessions';
import { exerciseName } from '../data/exercises';
import type { RootStackScreenProps } from '../navigation/types';

/**
 * Your record, read back.
 *
 * The founder's own words for what this app is for (2026-10-17): "so that
 * people can keep a record of things they have been doing, and they get to see
 * what they had been doing for long, and what works for them". The record was
 * built; this is the other two thirds, and until now the app had NINE routes
 * and not one of them was a log.
 *
 * It is also the thing the research pointed at: the people who sustain
 * LLM-assisted training keep the durable log outside the chat, and the one
 * thing that reliably breaks chat-as-log is dates. Every row here is dated
 * from `trainingDay`, which is on every event.
 *
 * Deliberately a list of what happened, not a dashboard. No charts, no scores,
 * no streak. A lifter's warning worth designing against: "an app is a product
 * of how its designer thinks about training."
 */

type Row =
  | { kind: 'session'; sessionId: string }
  | { kind: 'insight'; id: string; text: string; basedOn: number }
  | { kind: 'gap'; text: string };

export default function HistoryScreen({
  navigation,
}: RootStackScreenProps<'History'>): React.ReactElement {
  const { sessions, whatWorks, whatWorksGap } = useFitness();
  const [openId, setOpenId] = useState<string | null>(null);

  const sections = useMemo(() => {
    // Newest first: the last session is the one you want to see.
    const ids = [...sessions.order].reverse();
    const sessionRows: Row[] = ids.map((id) => ({ kind: 'session', sessionId: id }));
    const insightRows: Row[] = whatWorks.length > 0
      ? whatWorks.map((i) => ({ kind: 'insight', id: i.id, text: i.text, basedOn: i.basedOn }))
      : whatWorksGap !== null
        ? [{ kind: 'gap', text: whatWorksGap }]
        : [];
    return [
      { title: 'WHAT WORKS FOR YOU', data: insightRows },
      { title: `EVERY SESSION · ${ids.length}`, data: sessionRows },
    ];
  }, [sessions, whatWorks, whatWorksGap]);

  const renderSession = (sessionId: string) => {
    const s = sessions.byId[sessionId];
    if (!s) return null;
    const sets = workingSets(s.setLog);
    const open = openId === sessionId;
    const volume = sets.reduce((n, x) => n + x.weight_kg * x.reps, 0);

    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => setOpenId(open ? null : sessionId)}
        activeOpacity={0.6}
      >
        <View style={styles.rowTop}>
          <Text style={styles.day}>{s.trainingDay}</Text>
          <Text
            style={[
              styles.status,
              s.status === 'completed' && styles.statusDone,
              s.status === 'skipped' && styles.statusSkipped,
            ]}
          >
            {s.status === 'completed' ? 'done'
              : s.status === 'skipped' ? `skipped${s.skipReason ? ` · ${s.skipReason}` : ''}`
              : 'unfinished'}
          </Text>
        </View>
        <Text style={styles.name}>{s.workoutName || '—'}</Text>
        {s.status === 'completed' && (
          <Text style={styles.meta}>
            {sets.length} set{sets.length === 1 ? '' : 's'}
            {volume > 0 ? ` · ${Math.round(volume).toLocaleString()} kg moved` : ''}
            {s.review ? ` · felt ${s.review.verdict.replace(/_/g, ' ')}` : ''}
          </Text>
        )}
        {s.skipNotes !== null && <Text style={styles.quote}>"{s.skipNotes}"</Text>}
        {s.review?.note !== undefined && <Text style={styles.quote}>"{s.review.note}"</Text>}

        {open && sets.length > 0 && (
          <View style={styles.detail}>
            {s.exercises.map((slot) => {
              const mine = sets.filter((x) => x.exerciseId === slot.exerciseId);
              if (mine.length === 0) {
                return (
                  <Text key={slot.exerciseId} style={styles.detailSkipped}>
                    {slot.name} — not done
                  </Text>
                );
              }
              return (
                <Text key={slot.exerciseId} style={styles.detailLine}>
                  <Text style={styles.detailName}>{slot.name}  </Text>
                  {mine
                    .sort((a, b) => a.setIndex - b.setIndex)
                    .map((x) => `${x.weight_kg > 0 ? `${x.weight_kg}×` : ''}${x.reps}${x.rpe !== undefined ? `@${x.rpe}` : ''}`)
                    .join('   ')}
                </Text>
              );
            })}
          </View>
        )}
        {open && sets.length === 0 && (
          <Text style={styles.detailSkipped}>Nothing was logged.</Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <SectionList
        sections={sections}
        keyExtractor={(item: Row, i: number) =>
          item.kind === 'session' ? item.sessionId : item.kind === 'insight' ? item.id : `gap${i}`}
        contentContainerStyle={styles.scroll}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <Text style={[typography.largeTitle, styles.title]}>Your record</Text>
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.section}>{section.title}</Text>
        )}
        renderItem={({ item }) => {
          if (item.kind === 'session') return renderSession(item.sessionId);
          if (item.kind === 'gap') return <Text style={styles.gap}>{item.text}</Text>;
          return (
            <View style={styles.insight}>
              <Text style={styles.insightText}>{item.text}</Text>
              {/* The evidence count is shown so the claim can be judged
                  rather than trusted. */}
              <Text style={styles.basedOn}>
                from {item.basedOn} session{item.basedOn === 1 ? '' : 's'}
              </Text>
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.gap}>Nothing logged yet.</Text>
        }
        ListFooterComponent={
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            activeOpacity={0.6}
            style={styles.back}
          >
            <Text style={styles.backText}>Done</Text>
          </TouchableOpacity>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: 20, paddingBottom: 48, paddingTop: 8 },
  title: { marginTop: 8, marginBottom: 6 },
  section: {
    ...typography.sectionHeader, marginTop: 26, marginBottom: 10, marginLeft: 2,
  },
  insight: {
    backgroundColor: colors.card, borderRadius: 10, padding: 15, marginBottom: 8,
  },
  insightText: { fontSize: 16, lineHeight: 22, color: colors.text },
  basedOn: { fontSize: 12, color: colors.textTertiary, marginTop: 6 },
  gap: { fontSize: 15, lineHeight: 22, color: colors.textMuted, paddingVertical: 4 },
  row: {
    backgroundColor: colors.card, borderRadius: 10, padding: 15, marginBottom: 8,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  day: { fontSize: 13, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  status: { fontSize: 12, color: colors.textTertiary },
  statusDone: { color: colors.primary },
  statusSkipped: { color: colors.caution },
  name: { fontSize: 17, fontWeight: '600', color: colors.text, marginTop: 4 },
  meta: { fontSize: 14, color: colors.textMuted, marginTop: 3 },
  quote: {
    fontSize: 14, lineHeight: 20, color: colors.textMuted,
    fontStyle: 'italic', marginTop: 8,
  },
  detail: {
    marginTop: 12, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator,
  },
  detailLine: { fontSize: 14, lineHeight: 22, color: colors.textMuted },
  detailName: { color: colors.text, fontWeight: '500' },
  detailSkipped: { fontSize: 14, lineHeight: 22, color: colors.textTertiary, marginTop: 8 },
  back: { marginTop: 32, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 17, fontWeight: '600', color: colors.primary },
});
