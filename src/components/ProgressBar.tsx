import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../constants/colors';

export type ProgressBarProps = {
  progress: number;
  style?: StyleProp<ViewStyle>;
};

export const ProgressBar: React.FC<ProgressBarProps> = ({ progress, style }) => {
  const clamped = Math.min(Math.max(progress, 0), 1);
  return (
    <View style={[styles.track, style]}>
      <View style={[styles.fill, { width: `${clamped * 100}%` }]} />
    </View>
  );
};

const styles = StyleSheet.create({
  track: {
    height: 4,
    backgroundColor: colors.disabledFill,
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
});
