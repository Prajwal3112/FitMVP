import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import type { Equipment } from '../constants/workouts';
import { readEvents, appendEvent } from '../events/log';
import { draftUserContextCreated } from '../events/userContext';
import { draftGoalCreated, type GoalKind } from '../events/goal';
import { newEventId } from '../events/base';
import {
  buildUserContextProjection,
  INITIAL_USER_CONTEXT,
  type UserContextProjection,
} from '../projections/userContext';
import {
  buildGoalProjection,
  INITIAL_GOAL,
  type CurrentGoalProjection,
} from '../projections/goal';

// ─── Public types ────────────────────────────────────────────────────

export type GoalType = 'lose' | 'gain' | 'maintain';
export type InjuryTag = 'none' | 'knee' | 'back' | 'shoulder';

/** Legacy UI shape — derived from projections. */
export type UserData = {
  age: string;
  weight: string;
  goal: GoalType | null;
  why: string;
  workoutTime: string;
  equipment: Equipment | null;
  injury: InjuryTag;
};

export type SessionOutcome = 'done' | 'skipped';

export type OnboardingForm = {
  age: string;
  weight: string;
  workoutTime: string;
  equipment: Equipment | null;
  injury: InjuryTag;
};

export type FitnessContextValue = {
  userData: UserData;
  isOnboarded: boolean;
  isHydrated: boolean;
  currentDay: number;
  streak: number;
  history: SessionOutcome[];
  submitOnboarding: (form: OnboardingForm) => Promise<void>;
  /** Async — appends a GoalCreated event. */
  submitGoal: (goal: GoalType, why: string) => Promise<void>;
  completeWorkout: () => void;
  skipWorkout: () => void;
};

const FitnessContext = createContext<FitnessContextValue | null>(null);

// ─── Mapping helpers ────────────────────────────────────────────────

const DEFAULT_HEIGHT_CM = 170;
const DEFAULT_SEX = 'other' as const;
const DEFAULT_WAKE_HOUR = 7;
const DEFAULT_SLEEP_HOUR = 23;
const DEFAULT_DAYS_PER_WEEK = 4;
const DEFAULT_SESSION_MAX_MINUTES = 60;
const DEFAULT_ROLLOVER_HOUR = 4;
const DEFAULT_GOAL_HORIZON_MONTHS = 3;

function formToOnboardingPayload(form: OnboardingForm) {
  const ageNum = Number(form.age);
  const weightNum = Number(form.weight);
  if (!Number.isFinite(ageNum) || ageNum <= 0) throw new Error('Invalid age');
  if (!Number.isFinite(weightNum) || weightNum <= 0) throw new Error('Invalid weight');
  if (form.equipment === null) throw new Error('Equipment is required');

  return {
    profile: {
      age: Math.floor(ageNum),
      height_cm: DEFAULT_HEIGHT_CM,
      weight_kg: weightNum,
      sex: DEFAULT_SEX,
    },
    routine: {
      wakeHour: DEFAULT_WAKE_HOUR,
      sleepHour: DEFAULT_SLEEP_HOUR,
      sessionWindow: form.workoutTime,
    },
    equipment: form.equipment,
    constraints: {
      daysPerWeek: DEFAULT_DAYS_PER_WEEK,
      sessionMaxMinutes: DEFAULT_SESSION_MAX_MINUTES,
    },
    knownInjuries: form.injury === 'none' ? [] : [form.injury],
    dayRolloverHour: DEFAULT_ROLLOVER_HOUR,
  };
}

const UI_TO_GOAL_KIND: Record<GoalType, GoalKind> = {
  lose: 'fat_loss',
  gain: 'hypertrophy',
  maintain: 'general_fitness',
};

const GOAL_KIND_TO_UI: Partial<Record<GoalKind, GoalType>> = {
  fat_loss: 'lose',
  hypertrophy: 'gain',
  general_fitness: 'maintain',
};

function defaultTargetDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + DEFAULT_GOAL_HORIZON_MONTHS);
  return d.toISOString().slice(0, 10);
}

function projectionToUserData(
  ctx: UserContextProjection,
  goalP: CurrentGoalProjection,
): UserData {
  const knownInjury = ctx.knownInjuries[0];
  const injury: InjuryTag =
    knownInjury === 'knee' || knownInjury === 'back' || knownInjury === 'shoulder'
      ? knownInjury
      : 'none';

  const uiGoal = goalP.goalType ? (GOAL_KIND_TO_UI[goalP.goalType] ?? null) : null;

  return {
    age: ctx.profile ? String(ctx.profile.age) : '',
    weight: ctx.profile ? String(ctx.profile.weight_kg) : '',
    goal: uiGoal,
    why: goalP.why,
    workoutTime: ctx.routine?.sessionWindow ?? '07:00',
    equipment: ctx.equipment === 'mixed' ? 'gym' : (ctx.equipment ?? null),
    injury,
  };
}

// ─── Provider ────────────────────────────────────────────────────────

export const FitnessProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [userContext, setUserContext] = useState<UserContextProjection>(INITIAL_USER_CONTEXT);
  const [goalProjection, setGoalProjection] = useState<CurrentGoalProjection>(INITIAL_GOAL);
  const [isHydrated, setIsHydrated] = useState<boolean>(false);

  // Session progression still in-memory for now (becomes events in a later step).
  const [currentDay, setCurrentDay] = useState<number>(1);
  const [streak, setStreak] = useState<number>(0);
  const [history, setHistory] = useState<SessionOutcome[]>([]);

  // Hydrate both projections from the event log on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const events = await readEvents();
        if (cancelled) return;
        setUserContext(buildUserContextProjection(events));
        setGoalProjection(buildGoalProjection(events));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[FitnessProvider] hydrate failed:', e);
      } finally {
        if (!cancelled) setIsHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshProjections = useCallback(async () => {
    const events = await readEvents();
    setUserContext(buildUserContextProjection(events));
    setGoalProjection(buildGoalProjection(events));
  }, []);

  const submitOnboarding = useCallback(
    async (form: OnboardingForm) => {
      const payload = formToOnboardingPayload(form);
      const draft = draftUserContextCreated(payload);
      await appendEvent(draft, { rolloverHour: payload.dayRolloverHour });
      await refreshProjections();
    },
    [refreshProjections],
  );

  const submitGoal = useCallback(
    async (goal: GoalType, why: string) => {
      const draft = draftGoalCreated({
        goalId: newEventId(),
        goalType: UI_TO_GOAL_KIND[goal],
        why: why.trim(),
        targetDate: defaultTargetDate(),
      });
      await appendEvent(draft, { rolloverHour: userContext.dayRolloverHour });
      await refreshProjections();
    },
    [refreshProjections, userContext.dayRolloverHour],
  );

  const completeWorkout = useCallback(() => {
    setStreak((s) => s + 1);
    setHistory((h) => [...h, 'done']);
    setCurrentDay((d) => d + 1);
  }, []);

  const skipWorkout = useCallback(() => {
    setHistory((h) => [...h, 'skipped']);
    setCurrentDay((d) => d + 1);
  }, []);

  const userData = useMemo(
    () => projectionToUserData(userContext, goalProjection),
    [userContext, goalProjection],
  );

  const value: FitnessContextValue = useMemo(
    () => ({
      userData,
      isOnboarded: userContext.isOnboarded,
      isHydrated,
      currentDay,
      streak,
      history,
      submitOnboarding,
      submitGoal,
      completeWorkout,
      skipWorkout,
    }),
    [
      userData,
      userContext.isOnboarded,
      isHydrated,
      currentDay,
      streak,
      history,
      submitOnboarding,
      submitGoal,
      completeWorkout,
      skipWorkout,
    ],
  );

  return <FitnessContext.Provider value={value}>{children}</FitnessContext.Provider>;
};

export const useFitness = (): FitnessContextValue => {
  const ctx = useContext(FitnessContext);
  if (!ctx) throw new Error('useFitness must be used inside <FitnessProvider>');
  return ctx;
};
