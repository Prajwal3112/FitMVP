import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { eventCount, getLastEvent, verifyChain } from './src/events/log';

import OnboardingScreen from './src/screen/OnboardingScreen';
import HomeScreen from './src/screen/HomeScreen';
import GoalScreen from './src/screen/GoalScreen';
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
        <Text style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center' }}>
          {error.message}
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
    <ErrorBoundary>
      <FitnessProvider>
        <StatusBar style="dark" />
        <NavigationContainer>
          <RootNavigator />
        </NavigationContainer>
      </FitnessProvider>
    </ErrorBoundary>
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
        name="Workout"
        component={WorkoutScreen}
        options={{ title: '' }}
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
    </Stack.Navigator>
  );
}
