export const colors = {
  background: '#F2F2F7',
  card: '#FFFFFF',
  text: '#000000',
  textMuted: '#6C6C70',
  textTertiary: '#8E8E93',
  primary: '#007AFF',
  destructive: '#FF3B30',
  separator: 'rgba(60, 60, 67, 0.18)',
  disabledFill: '#E5E5EA',
} as const;

export type ColorName = keyof typeof colors;
