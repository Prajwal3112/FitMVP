import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors } from '../constants/colors';

export type PrimaryButtonVariant = 'primary' | 'secondary' | 'destructive';

export type PrimaryButtonProps = {
  title: string;
  onPress: () => void;
  variant?: PrimaryButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export const PrimaryButton: React.FC<PrimaryButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
}) => {
  const isSecondary = variant === 'secondary';
  const isDestructive = variant === 'destructive';

  return (
    <TouchableOpacity
      style={[
        styles.button,
        isSecondary && styles.secondary,
        isDestructive && styles.destructive,
        disabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={loading || disabled}
    >
      {loading ? (
        <ActivityIndicator color={isSecondary || isDestructive ? colors.primary : '#fff'} />
      ) : (
        <Text
          style={[
            styles.text,
            isSecondary && styles.textSecondary,
            isDestructive && styles.textDestructive,
          ]}
        >
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 15,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  secondary: {
    backgroundColor: colors.card,
  },
  destructive: {
    backgroundColor: colors.card,
  },
  disabled: {
    backgroundColor: colors.disabledFill,
  },
  text: { fontSize: 17, fontWeight: '600', color: '#fff' },
  textSecondary: { color: colors.primary },
  textDestructive: { color: colors.destructive },
});
