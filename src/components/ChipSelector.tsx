import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../constants/colors';

export type ChipOption<T extends string> = {
  label: string;
  value: T;
};

export type ChipSelectorProps<T extends string> = {
  options: ChipOption<T>[];
  selected: T | null;
  onSelect: (value: T) => void;
};

export function ChipSelector<T extends string>({
  options,
  selected,
  onSelect,
}: ChipSelectorProps<T>): React.ReactElement {
  return (
    <View style={styles.group}>
      {options.map((opt, i) => {
        const isLast = i === options.length - 1;
        const isSelected = selected === opt.value;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[styles.cell, !isLast && styles.cellBorder]}
            onPress={() => onSelect(opt.value)}
            activeOpacity={0.5}
          >
            <Text style={[styles.label, isSelected && styles.labelSelected]}>
              {opt.label}
            </Text>
            {isSelected && <Text style={styles.check}>✓</Text>}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    backgroundColor: colors.card,
    borderRadius: 10,
    overflow: 'hidden',
  },
  cell: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    minHeight: 44,
  },
  cellBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  label: { fontSize: 17, color: colors.text },
  labelSelected: { color: colors.primary, fontWeight: '500' },
  check: { fontSize: 17, color: colors.primary, fontWeight: '600' },
});
