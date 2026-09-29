import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors } from '../constants/colors';
import { PrimaryButton } from '../components/PrimaryButton';
import type { ReentryPolicy } from '../session/reentry';

// ─── The return-after-a-lapse screen ─────────────────────────────────
// ARCHITECTURE §7 RestartFlow. This replaces Home entirely when there's
// been a gap — it is not a banner on top of the normal screen.
//
// Design rules being honoured here:
//  - State the gap plainly. Pretending it didn't happen teaches the user
//    the app wasn't watching.
//  - Reframe with evidence from their own log BEFORE offering a path.
//  - The session is already adjusted when shown. Never ask someone to
//    negotiate their own workout down while they feel bad.
//  - Three exits, all forward. No streak, no adherence, no guilt.
//
// ⚠️ COPY IS PLACEHOLDER (from reentry.ts) pending the founder's own words.

export type ReturnHomeProps = {
  policy: ReentryPolicy;
  onResume: () => void;
  /** Skip the graded reduction — the user says they are fine. */
  onFullSession: () => void;
  onSomethingChanged: () => void;
};

export const ReturnHome: React.FC<ReturnHomeProps> = ({
  policy,
  onResume,
  onFullSession,
  onSomethingChanged,
}) => {
  const reduced = policy.loadMultiplier < 1 || policy.volumeMultiplier < 1;

  return (
    <View style={styles.wrap}>
      <View style={styles.body}>
        <Text style={styles.headline}>{policy.headline}</Text>

        {policy.evidence.map((line) => (
          <Text key={line} style={styles.evidence}>
            {line}
          </Text>
        ))}

        {!!policy.rationale && <Text style={styles.rationale}>{policy.rationale}</Text>}

        {reduced && (
          <View style={styles.adjusted}>
            <Text style={styles.adjustedText}>
              Today's session is already set to {Math.round(policy.loadMultiplier * 100)}% load
              {policy.volumeMultiplier < 1
                ? ` and ${Math.round(policy.volumeMultiplier * 100)}% sets`
                : ''}
              .
            </Text>
          </View>
        )}
      </View>

      <View style={styles.actions}>
        <PrimaryButton
          title={reduced ? 'Start the lighter session' : 'Pick up where I left off'}
          onPress={onResume}
        />
        {reduced ? (
          <PrimaryButton
            title="I feel fine — full session"
            onPress={onFullSession}
            variant="secondary"
            style={{ marginTop: 8 }}
          />
        ) : (
          <PrimaryButton
            title="Ease back in"
            onPress={onFullSession}
            variant="secondary"
            style={{ marginTop: 8 }}
          />
        )}
        <TouchableOpacity style={styles.tertiary} onPress={onSomethingChanged} activeOpacity={0.6}>
          <Text style={styles.tertiaryText}>Something's changed →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12 },
  body: { flex: 1, justifyContent: 'center', paddingVertical: 40 },
  headline: {
    fontSize: 30,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: -0.6,
    marginBottom: 22,
  },
  evidence: { fontSize: 17, color: colors.text, lineHeight: 26, marginBottom: 14 },
  rationale: { fontSize: 16, color: colors.textMuted, lineHeight: 24, marginTop: 6 },
  adjusted: {
    marginTop: 26,
    borderLeftWidth: 2,
    borderLeftColor: colors.primary,
    paddingLeft: 14,
  },
  adjustedText: { fontSize: 15, color: colors.text, lineHeight: 21 },
  actions: { paddingBottom: 8 },
  tertiary: { alignItems: 'center', paddingVertical: 16 },
  tertiaryText: { fontSize: 15, color: colors.textMuted },
});
