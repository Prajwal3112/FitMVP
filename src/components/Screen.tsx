import React from 'react';
import { View, ScrollView, StyleSheet, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { useLayout } from '../constants/layout';

/**
 * The outer shell every screen sits in.
 *
 * Exists so that responsive behaviour is written once rather than in ten
 * screens' StyleSheets — and so adding an eleventh screen cannot forget it.
 *
 * On a phone it is a plain padded column. On anything 600dp or wider it
 * centres a 640dp column, because the thing that breaks on a tablet is not
 * clipping but a 1000px line of text.
 */
export function Screen({
  children,
  scroll = true,
  contentStyle,
  footer,
}: {
  children: React.ReactNode;
  /** False for screens that manage their own scrolling (e.g. a SectionList). */
  scroll?: boolean;
  contentStyle?: ViewStyle;
  /** Pinned below the scroll area — a primary action that must stay reachable. */
  footer?: React.ReactNode;
}): React.ReactElement {
  const layout = useLayout();

  const column: ViewStyle = {
    width: '100%',
    ...(layout.maxContentWidth !== undefined
      ? { maxWidth: layout.maxContentWidth, alignSelf: 'center' }
      : {}),
  };

  const body = (
    <View style={[column, contentStyle]}>{children}</View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            {
              paddingHorizontal: layout.gutter,
              paddingTop: layout.isShort ? 8 : 16,
              paddingBottom: layout.isShort ? 32 : 48,
            },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {body}
        </ScrollView>
      ) : (
        <View style={[styles.flex, { paddingHorizontal: layout.gutter }]}>{body}</View>
      )}
      {footer !== undefined && (
        <View
          style={[
            styles.footer,
            { paddingHorizontal: layout.gutter, paddingBottom: layout.isShort ? 8 : 16 },
          ]}
        >
          <View style={column}>{footer}</View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  // alignItems centres the column on wide screens; on phones the column is
  // 100% wide so this is a no-op.
  scroll: { alignItems: 'center' },
  footer: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    paddingTop: 12,
    backgroundColor: colors.background,
  },
});
