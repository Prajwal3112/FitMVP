import type { StackScreenProps } from '@react-navigation/stack';

export type RootStackParamList = {
  Onboarding: undefined;
  Home: undefined;
  Goal: undefined;
  /**
   * Pre-session check-in. Records PreCheckinRecorded, then schedules.
   * `full: true` means the user came off the return screen and said they
   * feel fine — the graded re-entry reduction is skipped. Without this the
   * button labelled "I feel fine — full session" handed back the reduced
   * session anyway.
   */
  Checkin: { full?: boolean } | undefined;
  /**
   * `sessionId` is passed straight from the check-in so the screen doesn't
   * race the projection refresh. Omitted when resuming from Home, where
   * today's session is read from the projection instead.
   */
  Workout: { sessionId: string } | undefined;
  /**
   * The mandatory end-of-session review. Reached from Workout's Done button;
   * the session is NOT completed until this is submitted, so this screen has
   * no back route by design.
   */
  Review: { sessionId: string };
  Completion: undefined;
  /** Change an onboarding answer after the fact. */
  Setup: undefined;
  /** Dev-only. Registered and reachable only when __DEV__ is true. */
  Dev: undefined;
};

export type RootStackScreenProps<T extends keyof RootStackParamList> =
  StackScreenProps<RootStackParamList, T>;
