import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';

// ─── Rest timer ──────────────────────────────────────────────────────
// Auto-starts when a working set is logged. On-screen only for now: a
// timer that fires with the app backgrounded needs expo-notifications,
// which isn't a dependency yet. Flagged for the habit-layer step.

const DEFAULT_REST_SEC = 150;
const STEP_SEC = 30;

export type RestTimerHandle = {
  restSec: number;
  remaining: number | null;
  start: () => void;
  stop: () => void;
  adjust: (delta: number) => void;
};

export function useRestTimer(): RestTimerHandle {
  const [restSec, setRestSec] = useState<number>(DEFAULT_REST_SEC);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const restRef = useRef<number>(DEFAULT_REST_SEC);
  restRef.current = restSec;

  useEffect(() => {
    if (endsAt === null) {
      setRemaining(null);
      return;
    }
    // Derive from wall-clock rather than counting ticks, so the display
    // stays honest if the JS thread stalls mid-set.
    const tick = () => {
      const left = Math.ceil((endsAt - Date.now()) / 1000);
      setRemaining(left > 0 ? left : 0);
      if (left <= 0) setEndsAt(null);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt]);

  const start = useCallback(() => {
    setEndsAt(Date.now() + restRef.current * 1000);
  }, []);

  const stop = useCallback(() => setEndsAt(null), []);

  const adjust = useCallback((delta: number) => {
    setRestSec((prev) => {
      const next = Math.max(STEP_SEC, Math.min(600, prev + delta));
      restRef.current = next;
      return next;
    });
    setEndsAt((prev) => (prev === null ? null : prev + delta * 1000));
  }, []);

  return { restSec, remaining, start, stop, adjust };
}

function format(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const RestTimerBar: React.FC<{ timer: RestTimerHandle }> = ({ timer }) => {
  const { restSec, remaining, start, stop, adjust } = timer;
  // Android gesture nav and the iOS home indicator both eat the bottom
  // edge; a hardcoded pad puts the controls underneath them.
  const insets = useSafeAreaInsets();
  const running = remaining !== null;
  const done = remaining === 0;

  return (
    <View
      style={[
        styles.bar,
        { paddingBottom: Math.max(insets.bottom, 12) + 10 },
        done && styles.barDone,
      ]}
    >
      <TouchableOpacity
        style={styles.stepBtn}
        onPress={() => adjust(-STEP_SEC)}
        activeOpacity={0.6}
        hitSlop={8}
      >
        <Text style={styles.stepText}>−30</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.center}
        onPress={running ? stop : start}
        activeOpacity={0.7}
      >
        <Text style={[styles.time, done && styles.timeDone]}>
          {running ? format(remaining) : format(restSec)}
        </Text>
        <Text style={styles.caption}>
          {done ? 'Rest done — go' : running ? 'Tap to stop' : 'Rest timer'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.stepBtn}
        onPress={() => adjust(STEP_SEC)}
        activeOpacity={0.6}
        hitSlop={8}
      >
        <Text style={styles.stepText}>+30</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  barDone: { backgroundColor: colors.primary },
  center: { alignItems: 'center', flex: 1 },
  time: {
    fontSize: 30,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
  },
  timeDone: { color: '#fff' },
  caption: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  stepBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.background,
  },
  stepText: { fontSize: 15, fontWeight: '600', color: colors.textMuted },
});
