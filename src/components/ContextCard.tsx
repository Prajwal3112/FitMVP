import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../constants/colors';
import { OBSERVABLE_CEILING, type ContextState } from '../context/completeness';

/**
 * The weekly reveal, as a permanent card on Home.
 *
 * Deliberately NOT a dismissible modal or a once-a-week popup. Two reasons:
 * a popup needs somewhere to record "seen", which means a new event type or
 * a new table for a cosmetic flag; and the card doubles as the honest
 * answer to "how much does this thing actually know about me", which a
 * tester should be able to check any day, not only on the day it changed.
 *
 * Every line in it is a claim the app can defend from the log. If it says
 * it can call your next jump on four lifts, four lifts have suggestions.
 */
export function ContextCard({ state, reveal }: {
  state: ContextState;
  reveal: { title: string; lines: string[] };
}): React.ReactElement {
  const pct = Math.round(state.percent);
  const filled = Math.min(1, pct / OBSERVABLE_CEILING);
  // What it knows now vs what it is still waiting on. The last line out of
  // weeklyReveal() is always the "still missing" one.
  const known = reveal.lines.slice(0, -1);
  // Before the first session the "missing" line is arithmetic on an empty
  // log ("0 of 4 lifts have a trend I can read yet") — technically true and
  // a miserable first thing to read. The headline is the right opener until
  // there is something to actually be missing.
  const missing = state.sessions === 0
    ? state.headline
    : (reveal.lines[reveal.lines.length - 1] ?? '');

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        {/* Was "YOUR COACH IS READY" at unlock. There is no coach yet — no
            LLM, no chat, nothing behind the flag but this label. Promising a
            conversation the app cannot have is the overclaim completeness.ts
            was written to avoid; it just moved the lie one level up. The card
            now reports what it genuinely does: what it has worked out. */}
        <Text style={styles.eyebrow}>WHAT I'VE WORKED OUT</Text>
        <Text style={styles.pct}>{pct}%</Text>
      </View>

      <View style={styles.track}>
        <View style={[styles.fill, { flex: filled }]} />
        <View style={{ flex: 1 - filled }} />
      </View>

      <Text style={styles.title}>{reveal.title}</Text>

      {known.length > 0 ? (
        known.map((line, i) => (
          <View key={i} style={styles.row}>
            <Text style={styles.tick}>✓</Text>
            <Text style={styles.line}>{line}</Text>
          </View>
        ))
      ) : (
        <Text style={styles.line}>
          Nothing yet — log a session and I'll start with what you lift.
        </Text>
      )}

      {missing.length > 0 && <Text style={styles.missing}>{missing}</Text>}

      {/* No countdown to a feature that does not exist. The weekly reveal is
          the payoff, and it pays out from week one. */}
      <Text style={styles.foot}>
        {state.unlocked
          ? 'This is about as much as I can tell from watching you train.'
          : 'Every session you log adds to this.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: colors.primary,
  },
  pct: { fontSize: 19, fontWeight: '700', color: colors.primary },
  track: {
    flexDirection: 'row',
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.disabledFill,
    marginTop: 10,
    overflow: 'hidden',
  },
  fill: { backgroundColor: colors.primary, borderRadius: 4 },
  title: { fontSize: 17, fontWeight: '600', color: colors.text, marginTop: 13 },
  row: { flexDirection: 'row', marginTop: 9 },
  tick: { color: colors.primary, fontWeight: '700', width: 18, fontSize: 15 },
  line: { flex: 1, fontSize: 15, lineHeight: 21, color: colors.text },
  missing: { fontSize: 14, lineHeight: 20, color: colors.textMuted, marginTop: 13 },
  foot: { fontSize: 13, lineHeight: 18, color: colors.textTertiary, marginTop: 12 },
});
