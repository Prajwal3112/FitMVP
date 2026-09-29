import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { Equipment } from '../constants/workouts';
import { readEvents, appendEvent, unreadableEventCount, unreadableEventDetail } from '../events/log';
import type { Event } from '../events';
import {
  draftUserContextCreated, draftUserContextUpdated,
  type Experience, type OwnedEquipment,
} from '../events/userContext';
import { draftGoalCreated, type GoalKind } from '../events/goal';
import {
  validateOnboardingForm, formToOnboardingPayload, emptyOnboardingForm,
  type OnboardingForm,
} from '../onboarding/form';
export {
  validateOnboardingForm, formToOnboardingPayload, emptyOnboardingForm,
  type OnboardingForm,
};
import { newEventId, trainingDayOf } from '../events/base';
import type { SkipReason, SessionReview } from '../events/session';
import {
  buildUserContextProjection,
  applyUserContextEvent,
  INITIAL_USER_CONTEXT,
  type UserContextProjection,
} from '../projections/userContext';
import {
  buildGoalProjection,
  applyGoalEvent,
  INITIAL_GOAL,
  type CurrentGoalProjection,
} from '../projections/goal';
import {
  buildSessionsProjection,
  applySessionEvent,
  selectSessionForDay,
  selectSessionIndex,
  selectExerciseHistory,
  selectAdherenceWindow,
  selectGap,
  selectRotationIndex,
  selectKnownExerciseIds,
  INITIAL_SESSIONS,
  type SessionsProjection,
  type SessionState,
  type ExerciseHistory,
  type AdherenceWindow,
} from '../projections/sessions';
import {
  buildStreakProjection,
  applyStreakEvent,
  selectAdherencePct,
  selectDaysLogged,
  INITIAL_STREAK,
  type StreakProjection,
} from '../projections/streak';
import { suggestSession, type LoadSuggestion } from '../session/progression';
import { reentryPolicy, scaleLoad, type ReentryPolicy } from '../session/reentry';
import { buildSessionDraft, type ScheduledSessionDraft } from '../session/scheduler';
import { buildDigest } from '../dev/digest';
import { exportLogToFile, type ExportResult } from '../dev/exportFile';
import { APP_BUILD } from '../constants/build';
import {
  selectContextCompleteness,
  weeklyReveal,
  type ContextState,
} from '../context/completeness';
import {
  checkInAndSchedule,
  startSession,
  logSet,
  skipExercise,
  completeSession,
  skipSession,
  type SessionContext as CommandContext,
  type CheckinInput,
  type LogSetInput,
} from '../session/commands';

// ─── Public types ────────────────────────────────────────────────────

export type GoalType = 'lose' | 'gain' | 'maintain';
export type InjuryTag = 'none' | 'knee' | 'back' | 'shoulder';

/** Legacy UI shape — derived from projections. */
export type UserData = {
  weight: string;
  goal: GoalType | null;
  why: string;
  workoutTime: string;
  equipment: Equipment | null;
  injury: InjuryTag;
};


export type FitnessContextValue = {
  userData: UserData;
  isOnboarded: boolean;
  isHydrated: boolean;

  // ── Session surface (event-derived; nothing here is in-memory state) ──
  /** Today's session, or null if the day hasn't been checked into yet. */
  todaysSession: SessionState | null;
  /** The session just completed — survives navigation to Completion. */
  lastCompletedSession: SessionState | null;
  /** 1-indexed day label. Derived from sessions completed + skipped. */
  currentDay: number;
  streak: StreakProjection;
  adherencePct: number;
  daysLogged: number;
  /** Last completed performance per exerciseId — the "last: 102.5 × 8 @ 8" line. */
  exerciseHistory: ExerciseHistory;
  /** "You've hit 17 of your last 20." Replaces the consecutive-day streak. */
  adherence: AdherenceWindow;
  /** RPE-derived load suggestions for today's session, by exerciseId. */
  suggestions: Record<string, LoadSuggestion>;
  /** Graded re-entry after a gap. `speak: false` means there is no gap worth naming. */
  reentry: ReentryPolicy;
  /**
   * What today's session will be, built by the real engine from a neutral
   * check-in. Home shows this BEFORE check-in so the preview and the
   * session agree; the check-in can only scale it, never change the day.
   * null if the engine could not build one (see `previewError`).
   */
  preview: ScheduledSessionDraft | null;
  /** Why there is no session today, in the user's words. */
  previewError: string | null;
  /** How much the app knows, and what it learned this week. */
  contextState: ContextState;
  /** The weekly card's contents. */
  reveal: { title: string; lines: string[] };
  /** A shareable text dump of this tester's whole log. */
  exportDigest: () => string;
  /**
   * Write the full event log to a file and offer it to the share sheet. This
   * is the restorable copy; `exportDigest` is prose and rebuilds nothing.
   */
  exportBackup: () => Promise<ExportResult>;
  /**
   * Rows this build could not read. Non-zero means the projections are
   * INCOMPLETE and writes are blocked. It must be visible: the same state
   * used to present as a brand-new app with the history still on disk.
   */
  logHealth: { unreadable: number; detail: { seq: number; type: string; reason: string }[] };
  /**
   * Change one onboarding answer after the fact. Appends
   * UserContextUpdated — onboarding is never re-run, so the original
   * answers stay in the log and the change is dated.
   */
  updateSetup: (field: string, after: unknown) => Promise<void>;
  /** Raw setup, for the screen that edits it. */
  setup: {
    equipment: UserContextProjection['equipment'];
    ownedEquipment: OwnedEquipment[];
    experience: Experience | null;
    knownInjuries: string[];
    daysPerWeek: number;
    sessionMaxMinutes: number;
  };

  submitOnboarding: (form: OnboardingForm) => Promise<void>;
  submitGoal: (goal: GoalType, why: string) => Promise<void>;

  submitCheckin: (input: CheckinInput) => Promise<string>;
  beginSession: (sessionId: string) => Promise<void>;
  recordSet: (input: Omit<LogSetInput, 'sessionId'> & { sessionId: string }) => Promise<void>;
  dropExercise: (sessionId: string, exerciseId: string) => Promise<void>;
  /** Requires the user's review — see completeSession. */
  finishSession: (sessionId: string, review: SessionReview) => Promise<void>;
  skipToday: (reason: SkipReason, notes?: string) => Promise<void>;
  /** Dev-only: re-fold every projection from the log. */
  devReload: () => Promise<void>;
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
  const [sessions, setSessions] = useState<SessionsProjection>(INITIAL_SESSIONS);
  const [streak, setStreak] = useState<StreakProjection>(INITIAL_STREAK);
  const [isHydrated, setIsHydrated] = useState<boolean>(false);
  const [logHealth, setLogHealth] = useState<{
    unreadable: number; detail: { seq: number; type: string; reason: string }[];
  }>({ unreadable: 0, detail: [] });

  // The session id most recently completed, so CompletionScreen can read
  // it after `todaysSession` has already rolled on.
  const [lastCompletedId, setLastCompletedId] = useState<string | null>(null);

  // Commands need the projection as of *now*, not as of last render.
  // Appends happen in sequence, so a ref is the honest read.
  const sessionsRef = useRef<SessionsProjection>(INITIAL_SESSIONS);
  // Adherence is computed below; the re-entry memo quotes last render's value
  // rather than creating a circular dependency between the two.

  const applyEvents = useCallback((events: Awaited<ReturnType<typeof readEvents>>) => {
    const nextSessions = buildSessionsProjection(events);
    sessionsRef.current = nextSessions;
    setUserContext(buildUserContextProjection(events));
    setGoalProjection(buildGoalProjection(events));
    setSessions(nextSessions);
    setStreak(buildStreakProjection(events));
  }, []);

  /**
   * Fold ONE new event onto the projections already in memory.
   *
   * Every command used to call refreshProjections(), which re-read the entire
   * log out of SQLite, Zod-parsed every row, and rebuilt all four projections
   * — after each individual logged set. Measured on this reducer: a full fold
   * is ~0.5–1s at 1,000 sessions on desktop V8 (Hermes on a mid-range Android
   * is 3–10× slower), against ~0.08ms to fold a single event. A logging
   * session is ~25 appends, so the old path spent tens of seconds of blocked
   * main thread per workout, arriving as a freeze after every ✓ tap.
   *
   * The reducers are pure and total, so folding forward is exactly equivalent
   * to replaying — that is the property event sourcing buys, and nothing here
   * needed rewriting to use it.
   */
  const applyOneEvent = useCallback((event: Event) => {
    sessionsRef.current = applySessionEvent(sessionsRef.current, event);
    setSessions(sessionsRef.current);
    setUserContext((prev) => applyUserContextEvent(prev, event));
    setGoalProjection((prev) => applyGoalEvent(prev, event));
    setStreak((prev) => applyStreakEvent(prev, event));
  }, []);

  // Hydrate every projection from the event log on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const events = await readEvents();
        if (cancelled) return;
        applyEvents(events);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[FitnessProvider] hydrate failed:', e);
      } finally {
        if (!cancelled) {
          // readEvents() skips rows it cannot parse and records them. Surface
          // the count — silently proceeding with partial projections is what
          // made a full history look like a fresh install.
          setLogHealth({ unreadable: unreadableEventCount(), detail: unreadableEventDetail() });
          setIsHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyEvents]);

  /**
   * Full re-read and replay. Kept for boot, the dev panel (which writes
   * events straight to the log, bypassing the command layer) and as a
   * recovery path — NOT for the per-command hot path. See applyOneEvent.
   */
  const refreshProjections = useCallback(async () => {
    const events = await readEvents();
    applyEvents(events);
  }, [applyEvents]);

  // ── Onboarding + goal ──────────────────────────────────────────────

  const submitOnboarding = useCallback(
    async (form: OnboardingForm) => {
      const payload = formToOnboardingPayload(form);
      await appendEvent(draftUserContextCreated(payload), {
        rolloverHour: payload.dayRolloverHour,
      });
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

  // ── Session commands ───────────────────────────────────────────────

  const equipment: Equipment = userContext.equipment === 'mixed'
    ? 'gym'
    : (userContext.equipment ?? 'home');
  const rolloverHour = userContext.dayRolloverHour;
  const injuries = userContext.knownInjuries;
  const ownedEquipment = userContext.ownedEquipment;

  const reentryRef = useRef<ReentryPolicy | null>(null);

  // The engine is only as good as what reaches it. Before 2026-09-26 none
  // of these four were passed, so selectSplit() saw (4, null, null) and
  // handed every single user an Upper/Lower 4-day split regardless of what
  // they answered in onboarding. Grep for the consumer AND check its args.
  const goalKind: GoalKind | null = goalProjection.goalType;
  const experience = userContext.experience;
  const daysPerWeek = userContext.constraints?.daysPerWeek ?? 4;
  const sessionMaxMinutes = userContext.constraints?.sessionMaxMinutes ?? 60;

  const commandCtx = useCallback(
    (): CommandContext => ({
      sessions: sessionsRef.current,
      equipment,
      rolloverHour,
      goal: goalKind,
      experience,
      daysPerWeek,
      sessionMaxMinutes,
      ...(reentryRef.current ? { reentry: reentryRef.current } : {}),
      ...(injuries.length > 0 ? { injuries } : {}),
      ...(ownedEquipment.length > 0 ? { ownedEquipment } : {}),
    }),
    [equipment, rolloverHour, injuries, ownedEquipment,
     goalKind, experience, daysPerWeek, sessionMaxMinutes],
  );

  const submitCheckin = useCallback(
    async (input: CheckinInput) => {
      const sessionId = await checkInAndSchedule(commandCtx(), input);
      await refreshProjections();
      return sessionId;
    },
    [commandCtx, refreshProjections],
  );

  const beginSession = useCallback(
    async (sessionId: string) => {
      await startSession(commandCtx(), sessionId);
      await refreshProjections();
    },
    [commandCtx, refreshProjections],
  );

  const recordSet = useCallback(
    async (input: LogSetInput) => {
      // Folds the one new event forward rather than replaying the log. The
      // other commands happen once per session, so they keep the full
      // refresh; this one runs on every set and was the whole problem.
      const event = await logSet(commandCtx(), input);
      applyOneEvent(event);
    },
    [commandCtx, applyOneEvent],
  );

  const dropExercise = useCallback(
    async (sessionId: string, exerciseId: string) => {
      await skipExercise(commandCtx(), sessionId, exerciseId);
      await refreshProjections();
    },
    [commandCtx, refreshProjections],
  );

  const finishSession = useCallback(
    async (sessionId: string, review: SessionReview) => {
      await completeSession(commandCtx(), sessionId, review);
      setLastCompletedId(sessionId);
      await refreshProjections();
    },
    [commandCtx, refreshProjections],
  );

  const skipToday = useCallback(
    async (reason: SkipReason, notes?: string) => {
      await skipSession(commandCtx(), reason, notes);
      await refreshProjections();
    },
    [commandCtx, refreshProjections],
  );

  // Android keeps RN apps alive for days. `todaysSession` is derived from
  // trainingDayOf(new Date()), inside a useMemo keyed on the projection —
  // and neither the projection nor the key changes when the wall clock
  // rolls past 4am. A tester who trained Monday and reopened the app on
  // Tuesday saw "Logged. / Done for today" and a dead button, with
  // force-quit the only cure and nothing on screen to suggest it.
  const [dayTick, setDayTick] = useState(() => trainingDayOf(new Date(), rolloverHour));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = () => {
      const d = trainingDayOf(new Date(), rolloverHour);
      setDayTick((prev) => (prev === d ? prev : d));
    };

    /**
     * Wake ONCE, when the boundary actually arrives.
     *
     * This was `setInterval(check, 60_000)` — 1,440 wake-ups a day to notice a
     * single moment, each one dragging the JS thread out of idle. The rollover
     * time is known exactly, so schedule for it: one timer per day, and the
     * AppState listener covers the case where the process was asleep through
     * it. Capped at 30 min per hop because JS timers drift badly once the
     * device sleeps, so a long one cannot be trusted to fire on time.
     */
    const scheduleNext = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(rolloverHour, 0, 5, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      const wait = Math.min(next.getTime() - now.getTime(), 30 * 60 * 1000);
      timer = setTimeout(() => { check(); scheduleNext(); }, Math.max(1000, wait));
    };

    const sub = AppState.addEventListener('change', (st: AppStateStatus) => {
      // Returning to the app is when a missed boundary gets noticed — and it
      // is when it matters, because nothing on screen is read while away.
      if (st === 'active') { check(); if (timer) clearTimeout(timer); scheduleNext(); }
    });
    scheduleNext();
    return () => { sub.remove(); if (timer) clearTimeout(timer); };
  }, [rolloverHour]);

  // ── Derived reads ──────────────────────────────────────────────────

  const userData = useMemo(
    () => projectionToUserData(userContext, goalProjection),
    [userContext, goalProjection],
  );

  const todaysSession = useMemo(
    () => selectSessionForDay(sessions, dayTick),
    [sessions, dayTick],
  );

  const lastCompletedSession = useMemo(
    () => (lastCompletedId ? (sessions.byId[lastCompletedId] ?? null) : null),
    [sessions, lastCompletedId],
  );

  const currentDay = useMemo(() => selectSessionIndex(sessions) + 1, [sessions]);
  const exerciseHistory = useMemo(() => selectExerciseHistory(sessions), [sessions]);
  const reentry = useMemo(() => {
    const gap = selectGap(sessions, dayTick);
    return reentryPolicy({
      gapDays: gap.gapDays,
      skipReasons: gap.skipReasons,
      sessionsBefore: gap.sessionsBefore,
      daysPerWeek,
      // Trailing adherence measured up to the LAST COMPLETED DAY, not today.
      // Passing the current window meant the number was mostly gap, so the
      // screen said "You'd hit 0 of your last 12" while promising no guilt.
      ...(gap.lastCompletedDay
        ? {
            adherenceBefore: selectAdherenceWindow(
              sessions, gap.lastCompletedDay, daysPerWeek,
            ),
          }
        : {}),
      ...(gap.bestLift
        ? {
            bestLift: {
              name: gap.bestLift.exerciseId.replace(/-/g, ' '),
              weight_kg: gap.bestLift.weight_kg,
              reps: gap.bestLift.reps,
            },
          }
        : {}),
    });
  }, [sessions, rolloverHour]);

  const suggestions = useMemo(() => {
    if (!todaysSession) return {};
    const bw = userContext.profile?.weight_kg ?? 0;
    const base = suggestSession(
      todaysSession.exercises,
      exerciseHistory,
      bw > 0 ? { bodyweightKg: bw, experience: userContext.experience } : undefined,
    );
    // ReturnHome says "today's session is already set to 85% load". Only
    // sets were ever scaled — scaleLoad had no callers at all — so that
    // line was simply untrue, and coming back after three weeks to your
    // old working weight is exactly what the graded re-entry exists to
    // prevent. This makes the promise true.
    if (!reentry.speak || reentry.loadMultiplier >= 1) return base;
    const scaled: Record<string, LoadSuggestion> = {};
    for (const [id, sg] of Object.entries(base)) {
      scaled[id] = sg.suggestedWeight !== undefined && sg.suggestedWeight > 0
        ? {
            ...sg,
            suggestedWeight: scaleLoad(sg.suggestedWeight, reentry),
            reason: `Eased back to ${Math.round(reentry.loadMultiplier * 100)}% while you return.`,
          }
        : sg;
    }
    return scaled;
  }, [todaysSession, exerciseHistory, userContext.profile, userContext.experience, reentry]);

  // ── The Home preview ────────────────────────────────────────────────
  // Built by the SAME engine that will build the real session, from a
  // neutral check-in (energy 6, nothing sore). The check-in can only scale
  // volume or swap around soreness — it never changes the day type — so
  // this preview is honest about what you are walking into.
  const preview = useMemo<{ draft: ScheduledSessionDraft | null; error: string | null }>(() => {
    if (todaysSession) return { draft: null, error: null }; // real session exists
    if (!userContext.isOnboarded) return { draft: null, error: null };
    const gap = selectGap(sessions, dayTick);
    try {
      const draft = buildSessionDraft({
        equipment,
        rotationIndex: selectRotationIndex(sessions),
        checkin: { sessionId: 'preview', energy: 6, soreness: [] },
        goal: goalKind,
        experience,
        daysPerWeek,
        sessionMaxMinutes,
        gapDays: gap.gapDays,
        totalSessions: gap.sessionsBefore,
        knownExerciseIds: selectKnownExerciseIds(sessions),
        ...(injuries.length > 0 ? { injuries } : {}),
        ...(ownedEquipment.length > 0 ? { ownedEquipment } : {}),
      });
      if (draft.exercises.length === 0) {
        return {
          draft: null,
          error: "I could not build a session from what you've told me about your kit and injuries. Tell me and I'll fix it.",
        };
      }
      return { draft, error: null };
    } catch (e) {
      // A preview must never take the app down. But a silent catch here
      // already hid one real bug (a missing import throwing ReferenceError
      // on every render, nulling the preview for everyone) — so it logs.
      // eslint-disable-next-line no-console
      console.error('[preview] buildSessionDraft failed:', e);
      return { draft: null, error: null };
    }
  }, [sessions, todaysSession, equipment, goalKind, experience, daysPerWeek,
      sessionMaxMinutes, injuries, ownedEquipment, dayTick,
      userContext.isOnboarded]);

  const contextState = useMemo(
    () => selectContextCompleteness(sessions, dayTick),
    [sessions, dayTick],
  );
  const reveal = useMemo(() => weeklyReveal(contextState), [contextState]);
  const updateSetup = useCallback(
    async (field: string, after: unknown) => {
      const before = (userContext as unknown as Record<string, unknown>)[field] ?? null;
      await appendEvent(
        draftUserContextUpdated({ field, before, after }),
        { rolloverHour: userContext.dayRolloverHour },
      );
      await refreshProjections();
    },
    [refreshProjections, userContext],
  );

  const exportBackup = useCallback(() => exportLogToFile(), []);

  const exportDigest = useCallback(
    () => buildDigest(sessions, contextState, userContext, APP_BUILD, logHealth.detail),
    [sessions, contextState, userContext, logHealth],
  );

  const adherence = useMemo(
    () => selectAdherenceWindow(
      sessions,
      dayTick,
      userContext.constraints?.daysPerWeek ?? 4,
    ),
    [sessions, dayTick, userContext.constraints],
  );
  const adherencePct = useMemo(() => selectAdherencePct(streak), [streak]);
  const daysLogged = useMemo(() => selectDaysLogged(streak), [streak]);
  reentryRef.current = reentry;

  const value: FitnessContextValue = useMemo(
    () => ({
      userData,
      isOnboarded: userContext.isOnboarded,
      isHydrated,
      todaysSession,
      lastCompletedSession,
      currentDay,
      streak,
      adherencePct,
      daysLogged,
      exerciseHistory,
      adherence,
      suggestions,
      reentry,
      preview: preview.draft,
      previewError: preview.error,
      contextState,
      reveal,
      exportDigest,
      exportBackup,
      logHealth,
      updateSetup,
      setup: {
        equipment: userContext.equipment,
        ownedEquipment: userContext.ownedEquipment,
        experience: userContext.experience,
        knownInjuries: userContext.knownInjuries,
        daysPerWeek,
        sessionMaxMinutes,
      },
      submitOnboarding,
      submitGoal,
      submitCheckin,
      beginSession,
      recordSet,
      dropExercise,
      finishSession,
      skipToday,
      devReload: refreshProjections,
    }),
    [
      userData,
      userContext.isOnboarded,
      isHydrated,
      todaysSession,
      lastCompletedSession,
      currentDay,
      streak,
      adherencePct,
      daysLogged,
      exerciseHistory,
      adherence,
      suggestions,
      reentry,
      preview,
      contextState,
      reveal,
      exportDigest,
      exportBackup,
      logHealth,
      updateSetup,
      userContext,
      daysPerWeek,
      sessionMaxMinutes,
      submitOnboarding,
      submitGoal,
      submitCheckin,
      beginSession,
      recordSet,
      dropExercise,
      finishSession,
      skipToday,
    ],
  );

  return <FitnessContext.Provider value={value}>{children}</FitnessContext.Provider>;
};

export const useFitness = (): FitnessContextValue => {
  const ctx = useContext(FitnessContext);
  if (!ctx) throw new Error('useFitness must be used inside <FitnessProvider>');
  return ctx;
};
