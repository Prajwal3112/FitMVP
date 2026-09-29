import React from 'react';
import { View, Text, StyleSheet, ScrollView, Share, TouchableOpacity } from 'react-native';
import { colors } from '../constants/colors';

type Props = { children: React.ReactNode };
type State = { error: Error | null; stack: string | null };

/**
 * What a tester sees when the app breaks.
 *
 * Three things a crash screen has to do that the old one didn't: say it in
 * words a friend understands, give them a way back in without force-quitting
 * (a dead end gets the app deleted, and you never hear why), and let them
 * send the error rather than describe it. `Share` is React Native core —
 * no dependency, and it opens whatever they already message you on.
 *
 * Their training log is on disk and untouched by a render crash; saying so
 * is the difference between "I'll try again" and "I've lost everything".
 */
export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null, stack: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, stack: error.stack ?? null };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info.componentStack);
    this.setState({ stack: `${error.stack ?? error.message}\n--- component ---${info.componentStack ?? ''}` });
  }

  private send = (): void => {
    const { error, stack } = this.state;
    void Share.share({
      message: `FitMVP crashed.\n\n${error?.message ?? 'unknown'}\n\n${(stack ?? '').slice(0, 3500)}`,
    }).catch(() => { /* share sheet dismissed — nothing to do */ });
  };

  private retry = (): void => this.setState({ error: null, stack: null });

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <ScrollView style={styles.safe} contentContainerStyle={styles.scroll}>
          <Text style={styles.title}>Something broke</Text>
          <Text style={styles.body}>
            This is a bug in the app, not something you did. Your training log is
            saved on this phone and none of it is lost.
          </Text>
          <Text style={styles.body}>
            Send me what happened and I can fix it — it takes one tap.
          </Text>

          <TouchableOpacity style={styles.primary} onPress={this.send} activeOpacity={0.7}>
            <Text style={styles.primaryText}>Send the error report</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={this.retry} activeOpacity={0.7}>
            <Text style={styles.secondaryText}>Try again</Text>
          </TouchableOpacity>

          <Text style={styles.detailLabel}>Technical detail</Text>
          <Text style={styles.stack}>{this.state.error.message}</Text>
          {this.state.stack !== null && (
            <Text style={styles.stack}>{this.state.stack.slice(0, 2000)}</Text>
          )}
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 24, paddingTop: 72 },
  title: { fontSize: 26, fontWeight: '700', color: colors.text, marginBottom: 14 },
  body: { fontSize: 16, lineHeight: 23, color: colors.textMuted, marginBottom: 14 },
  primary: {
    backgroundColor: colors.primary, borderRadius: 12, minHeight: 52,
    alignItems: 'center', justifyContent: 'center', marginTop: 10,
  },
  primaryText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  secondary: {
    backgroundColor: colors.card, borderRadius: 12, minHeight: 52,
    alignItems: 'center', justifyContent: 'center', marginTop: 10,
  },
  secondaryText: { color: colors.primary, fontSize: 17, fontWeight: '600' },
  detailLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1, color: colors.textTertiary,
    marginTop: 36, marginBottom: 8,
  },
  stack: { fontSize: 11, lineHeight: 16, color: colors.textTertiary, marginBottom: 12 },
});
