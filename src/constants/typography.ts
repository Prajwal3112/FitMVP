import { StyleSheet } from 'react-native';
import { colors } from './colors';

export const typography = StyleSheet.create({
  largeTitle: { fontSize: 34, fontWeight: '700', color: colors.text, letterSpacing: -0.5 },
  title1: { fontSize: 28, fontWeight: '700', color: colors.text, letterSpacing: -0.3 },
  title2: { fontSize: 22, fontWeight: '700', color: colors.text },
  title3: { fontSize: 20, fontWeight: '600', color: colors.text },
  headline: { fontSize: 17, fontWeight: '600', color: colors.text },
  body: { fontSize: 17, fontWeight: '400', color: colors.text },
  callout: { fontSize: 16, fontWeight: '400', color: colors.text },
  subhead: { fontSize: 15, fontWeight: '400', color: colors.text },
  footnote: { fontSize: 13, fontWeight: '400', color: colors.textMuted },
  caption: { fontSize: 12, fontWeight: '400', color: colors.textMuted },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '400',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
});
