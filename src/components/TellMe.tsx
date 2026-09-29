import React, { useState } from 'react';
import { Text, TouchableOpacity, StyleSheet, Share, Alert, View } from 'react-native';
import { colors } from '../constants/colors';
import { APP_BUILD } from '../constants/build';

/**
 * A way out for a tester who is stuck.
 *
 * Every feedback path used to sit on Home or on a crash screen — so someone
 * who stalled during onboarding or the goal flow, which is exactly where people
 * stall, had no way to tell anyone. The most valuable report in a first test is
 * "I couldn't get past the second screen", and it was the one report the app
 * made impossible.
 *
 * `where` names the screen, because "it didn't work" without a location is a
 * report you cannot act on.
 */
export function TellMe({
  where,
  label = 'Something wrong? Tell me',
  detail,
}: {
  where: string;
  label?: string;
  /** Extra context for the report — never shown to the user. */
  detail?: () => string;
}): React.ReactElement {
  const [sent, setSent] = useState(false);

  const send = () => {
    const body = [
      `FitMVP — stuck on: ${where}`,
      `build ${APP_BUILD}`,
      `time ${new Date().toISOString()}`,
      '',
      detail ? detail() : '',
      '',
      '--- what happened? (type below) ---',
      '',
    ].join('\n');
    void Share.share({ message: body })
      .then(() => setSent(true))
      .catch(() => {
        Alert.alert(
          'Could not open sharing',
          `Screenshot this screen and send it instead. You were on: ${where} (build ${APP_BUILD}).`,
        );
      });
  };

  return (
    <View>
      <TouchableOpacity onPress={send} activeOpacity={0.6} style={styles.row}>
        <Text style={styles.text}>{sent ? 'Thanks — send as many as you like' : label}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  text: { fontSize: 14, color: colors.primary, textAlign: 'center' },
});
