import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, Share } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { eventCount, getLastEvent, verifyChain, enterReadOnlyMode } from './src/events/log';
import { APP_BUILD } from './src/constants/build';

import OnboardingScreen from './src/screen/OnboardingScreen';
import HomeScreen from './src/screen/HomeScreen';
import GoalScreen from './src/screen/GoalScreen';
import SetupScreen from './src/screen/SetupScreen';
import ReviewScreen from './src/screen/ReviewScreen';
import CheckinScreen from './src/screen/CheckinScreen';
import DevScreen from './src/screen/DevScreen';
import WorkoutScreen from './src/screen/WorkoutScreen';
import CompletionScreen from './src/screen/CompletionScreen';
import { FitnessProvider, useFitness } from './src/context/FitnessContext';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { colors } from './src/constants/colors';
import type { RootStackParamList } from './src/navigation/types';
import { db } from './src/db/client';
import migrations from './drizzle/migrations';

const Stack = createStackNavigator<RootStackParamList>();

const screenOptions = {
  headerStyle: {
    backgroundColor: colors.background,
    shadowColor: 'transparent',
    elevation: 0,
  },
  headerTintColor: colors.primary,
  headerTitleStyle: { fontWeight: '600' as const, fontSize: 17, color: colors.text },
  headerBackTitleVisible: false,
  cardStyle: { backgroundColor: colors.background },
  gestureEnabled: true,
};

export default function App(): React.ReactElement {
  const { success, error } = useMigrations(db, migrations);
  const [integrity, setIntegrity] = React.useState<null | { brokenAtSeq: number; reason: string }>(null);

  // Boot debug — verify chain + log event count once migrations succeed.
  useEffect(() => {
    if (!success) return;
    void (async () => {
      try {
        const [count, last, chain] = await Promise.all([
          eventCount(),
          getLastEvent(),
          verifyChain(),
        ]);
        // eslint-disable-next-line no-console
        console.log('[boot] events:', { count, lastType: last?.type ?? null, chain });
        // ARCHITECTURE §12 — a broken hash chain means the log has been
        // tampered with or corrupted. Stop writing to it.
        if (!chain.ok) {
          enterReadOnlyMode({ brokenAtSeq: chain.brokenAtSeq, reason: chain.reason });
          setIntegrity({ brokenAtSeq: chain.brokenAtSeq, reason: chain.reason });
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[boot] event log check failed:', e);
      }
    })();
  }, [success]);

  if (error) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: colors.background }}>
        <Text style={{ fontSize: 17, fontWeight: '600', color: colors.destructive, marginBottom: 8 }}>
          Database migration failed
        </Text>
        <Text style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center', marginBottom: 24 }}>
          {error.message}
        </Text>
        <TouchableOpacity
          onPress={() => {
            void Share.share({ message: `FitMVP migration failure\nbuild ${APP_BUILD}\n${error.message}` })
              .catch(() => { /* dismissed */ });
          }}
          activeOpacity={0.7}
          style={{ backgroundColor: colors.primary, borderRadius: 12, minHeight: 52, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '600' }}>Send the report</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (integrity !== null) {
    // This was a terminal screen with no button. If it ever fires on a
    // tester's phone their app is dead and you find out weeks later, if at
    // all. It stays read-only — writing onto a broken chain buries the
    // break — but they can now tell you it happened.
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 28, backgroundColor: colors.background }}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: colors.destructive, marginBottom: 10 }}>
          Something's wrong with your training log
        </Text>
        <Text style={{ fontSize: 16, color: colors.text, lineHeight: 23, marginBottom: 14 }}>
          Your history doesn't match its own record from session {integrity.brokenAtSeq} onward.
          Nothing has been lost — but the app has stopped writing, so nothing gets worse.
        </Text>
        <Text style={{ fontSize: 16, color: colors.text, lineHeight: 23, marginBottom: 20 }}>
          Send this to me and I can tell you what happened. Please don't
          reinstall — that would delete the history I need to look at.
        </Text>
        <TouchableOpacity
          onPress={() => {
            void Share.share({
              message: `FitMVP integrity failure\nbuild ${APP_BUILD}\nbroken at seq ${integrity.brokenAtSeq}\nreason: ${integrity.reason}`,
            }).catch(() => { /* dismissed */ });
          }}
          activeOpacity={0.7}
          style={{ backgroundColor: colors.primary, borderRadius: 12, minHeight: 52, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '600' }}>Send the report</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 13, color: colors.textMuted, lineHeight: 19, marginTop: 24 }}>
          Technical detail: {integrity.reason}
        </Text>
      </View>
    );
  }

  if (!success) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <FitnessProvider>
          <StatusBar style="dark" />
          <NavigationContainer>
            <RootNavigator />
          </NavigationContainer>
        </FitnessProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

function RootNavigator(): React.ReactElement {
  const { isHydrated, isOnboarded } = useFitness();

  // Wait for the event-log replay before deciding which screen to mount.
  if (!isHydrated) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <Stack.Navigator
      initialRouteName={isOnboarded ? 'Home' : 'Onboarding'}
      screenOptions={screenOptions}
    >
      <Stack.Screen
        name="Onboarding"
        component={OnboardingScreen}
        options={{ headerShown: false, gestureEnabled: false }}
      />

      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{ headerShown: false, gestureEnabled: false }}
      />

      <Stack.Screen
        name="Goal"
        component={GoalScreen}
        options={{ title: '' }}
      />

      <Stack.Screen
        name="Checkin"
        component={CheckinScreen}
        options={{ title: '' }}
      />

      <Stack.Screen
        name="Workout"
        component={WorkoutScreen}
        options={{ title: '' }}
      />

      {/* No header back arrow and no swipe: the session is not saved until
          the review is submitted, and leaving would strand an active session
          with no route back here. ReviewScreen also traps the Android back
          button and explains why. */}
      <Stack.Screen
        name="Review"
        component={ReviewScreen}
        options={{ title: '', headerLeft: () => null, gestureEnabled: false }}
      />

      <Stack.Screen
        name="Completion"
        component={CompletionScreen}
        options={{
          title: '',
          headerLeft: () => null,
          gestureEnabled: false,
        }}
      />

      <Stack.Screen name="Setup" component={SetupScreen} options={{ title: '' }} />

      {__DEV__ && (
        <Stack.Screen name="Dev" component={DevScreen} options={{ title: '' }} />
      )}
    </Stack.Navigator>
  );
}
