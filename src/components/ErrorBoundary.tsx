import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { colors } from '../constants/colors';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <ScrollView
          style={styles.safe}
          contentContainerStyle={styles.scroll}
        >
          <Text style={styles.title}>App failed to render</Text>
          <Text style={styles.message}>{this.state.error.message}</Text>
          {this.state.error.stack && (
            <Text style={styles.stack}>{this.state.error.stack}</Text>
          )}
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 24 },
  title: { fontSize: 20, fontWeight: '700', color: colors.destructive, marginBottom: 12 },
  message: { fontSize: 15, color: colors.text, marginBottom: 16 },
  stack: { fontSize: 12, color: colors.textMuted, fontFamily: 'monospace' as never },
});
