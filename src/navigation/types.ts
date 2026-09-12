import type { StackScreenProps } from '@react-navigation/stack';

export type RootStackParamList = {
  Onboarding: undefined;
  Home: undefined;
  Goal: undefined;
  Workout: undefined;
  Completion: undefined;
};

export type RootStackScreenProps<T extends keyof RootStackParamList> =
  StackScreenProps<RootStackParamList, T>;
