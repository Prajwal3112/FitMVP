# Architecture Spec — Fitness Coach App

> **Living document.** Fill this in as you read. No code in here — only contracts.
> When every section is complete and you can defend each choice, you're ready to build.

---

## 0. Meta

- **App working name:** FitMVP (TBD branding)
- **One-sentence pitch:** A personalized fitness coach that adapts to *your* life, not a generic plan — your goal stays in context for months at a time.
- **Single-user assumption?** Yes for v1. Multi-device sync explicitly out of scope.
- **Target platforms:** iOS / Android (Expo SDK 54+)
- **Target launch:** local-only MVP (cloud LLM) → on-device LLM as v2
- **Document version:** v0.3 — sections 0–8 locked from BLUEPRINT.md
- **Last updated:** 2026-06-07
- **Companion doc:** see `BLUEPRINT.md` for tech stack, lifecycle walkthrough, red-team, and locked algorithms.

---

## 1. Core principles

> The 3–5 opinionated bets your architecture is built on.
> Every other decision must be consistent with these.

**EXAMPLE:**
1. **Truth lives in events, not state.** State is always derived. The past is immutable.
2. **The LLM is a collaborator, not the planner of record.** Planning is deterministic; the LLM stylizes and explains.
3. **Goal is gravity.** It is pinned in every prompt and enforced by validators outside the LLM.
4. **Tools, not chat.** The LLM picks from a finite whitelist of actions. Free chat is the side door, not the front door.
5. **Local-first.** The app must work offline. Cloud is an enhancement, not a dependency.

**YOUR PRINCIPLES:**
1. **Truth lives in events, not state.** State is always derived. The past is immutable.
2. **The LLM is a stylist on top of deterministic logic, not the planner of record.** The constraint solver picks valid moves; the LLM picks the wording.
3. **Goal is gravity.** `GoalAnchor` is pinned in every prompt and enforced by validators *outside* the LLM.
4. **Tools, not chat.** The LLM picks from a finite whitelist. Free-text chat is the side door, not the front door.
5. **Local-first, degraded-gracefully.** App is fully usable offline. Every LLM tool has a deterministic fallback. Cloud LLM is an enhancement.

---

## 2. Event catalog

> Every event the system can record. Append-only. This is your truth.
> Aim for 15–25. Group by domain. Schema each one.

**Conventions:**
- All events have `id`, `seq`, `occurredAt`, `schemaVersion`, `prevHash`.
- Payload schema is TypeScript. Validate on write.

**EXAMPLE entry:**

```ts
type ExerciseSubstituted = {
  type: 'ExerciseSubstituted';
  payload: {
    sessionId: string;
    originalExerciseId: string;
    substituteExerciseId: string;
    reason: 'pain' | 'equipment_unavailable' | 'low_energy' | 'preference' | 'other';
    reasonText?: string;       // free-text user note, optional
    proposedBy: 'user' | 'llm';
    acceptedAt: string;
  };
};
```

**YOUR EVENTS:**

### Base envelope (all events)

```ts
type BaseEvent = {
  id: string;            // ulid
  seq: number;           // monotonic, gapless
  type: string;          // discriminator
  occurredAt: string;    // ISO 8601 UTC
  trainingDay: string;   // YYYY-MM-DD per user's rollover hour
  schemaVersion: number;
  prevHash: string;      // sha256(prev.id + JSON(prev.payload))
};
```

### Onboarding & profile

```ts
type UserContextCreated = BaseEvent & {
  type: 'UserContextCreated';
  payload: {
    profile: { age: number; height_cm: number; weight_kg: number; sex: 'm' | 'f' | 'other' };
    routine: { wakeHour: number; sleepHour: number; sessionWindow: string };
    equipment: 'home' | 'gym' | 'mixed';
    constraints: { daysPerWeek: number; sessionMaxMinutes: number };
    knownInjuries: string[];
    dayRolloverHour: number;       // default 4
  };
};

type UserContextUpdated = BaseEvent & {
  type: 'UserContextUpdated';
  payload: { field: string; before: unknown; after: unknown };
};
```

### Goal

```ts
type GoalCreated = BaseEvent & {
  type: 'GoalCreated';
  payload: {
    goalId: string;
    goalType: 'hypertrophy' | 'strength' | 'fat_loss' | 'endurance' | 'general_fitness';
    why: string;                   // ≤200 chars, user's own words
    targetDate: string;            // ISO date
  };
};

type GoalRevised = BaseEvent & {
  type: 'GoalRevised';
  payload: { goalId: string; field: 'why' | 'targetDate' | 'goalType'; before: unknown; after: unknown };
};
```

### Plan

```ts
type PlanGenerated = BaseEvent & {
  type: 'PlanGenerated';
  payload: {
    planId: string;
    skeleton: PlanSkeleton;        // deterministic, constraint-solved
    weeks: PlanWeek[];             // 4 weeks of sessions w/ exercises + RPE targets
    rationale: string;             // LLM-styled OR template fallback
    generatedFrom: { contextHash: string; goalId: string; mode: 'template_only' | 'llm_styled' };
  };
};

type PlanRevised = BaseEvent & {
  type: 'PlanRevised';
  payload: { planId: string; delta: PlanDelta; reason: string; revisedBy: 'user' | 'llm' };
};

type TrainingBlockStarted = BaseEvent & {
  type: 'TrainingBlockStarted';
  payload: { blockId: string; planId: string; blockName: string; totalWeeks: number; startedAt: string };
};

type TrainingBlockEnded = BaseEvent & {
  type: 'TrainingBlockEnded';
  payload: { blockId: string; endedAt: string; completionRate: number };
};

type DeloadTriggered = BaseEvent & {
  type: 'DeloadTriggered';
  payload: { blockId: string; reason: 'scheduled' | 'fatigue' | 'plateau'; weekOf: string };
};

type ReplanProposed = BaseEvent & {
  type: 'ReplanProposed';
  payload: { reason: 'block_end' | 'low_adherence' | 'plateau' | 'user_request'; details: string };
};

type ReplanForced = BaseEvent & {
  type: 'ReplanForced';
  payload: { reason: 'goal_change' | 'injury_block' | 'equipment_change' };
};
```

### Session

```ts
type SessionScheduled = BaseEvent & {
  type: 'SessionScheduled';
  payload: {
    sessionId: string;
    trainingDay: string;
    planId: string;
    exercises: ExerciseSlot[];     // ordered, w/ RPE targets
    openingNote: string;           // LLM or fallback
    generationMode: 'llm_styled' | 'template_fallback';
  };
};

type SessionStarted = BaseEvent & {
  type: 'SessionStarted';
  payload: { sessionId: string; startedAt: string };
};

type PreCheckinRecorded = BaseEvent & {
  type: 'PreCheckinRecorded';
  payload: {
    sessionId: string;
    energy: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
    soreness: { muscle: string; level: 1 | 2 | 3 }[];
    notes?: string;
  };
};

type SetCompleted = BaseEvent & {
  type: 'SetCompleted';
  payload: {
    sessionId: string;
    exerciseId: string;
    setIndex: number;
    weight_kg: number;
    reps: number;
    rpe?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
    rir?: 0 | 1 | 2 | 3 | 4 | 5;
  };
};

type ExerciseSubstituted = BaseEvent & {
  type: 'ExerciseSubstituted';
  payload: {
    sessionId: string;
    originalExerciseId: string;
    substituteExerciseId: string;
    reason: 'pain' | 'equipment_unavailable' | 'low_energy' | 'preference' | 'other';
    reasonText?: string;
    proposedBy: 'user' | 'llm' | 'fallback';
  };
};

type ExerciseSkipped = BaseEvent & {
  type: 'ExerciseSkipped';
  payload: { sessionId: string; exerciseId: string; reason: string };
};

type SessionCompleted = BaseEvent & {
  type: 'SessionCompleted';
  payload: {
    sessionId: string;
    completedAt: string;
    completedExercises: number;
    totalExercises: number;
    avgRpe?: number;
  };
};

type SessionSkipped = BaseEvent & {
  type: 'SessionSkipped';
  payload: {
    sessionId: string;
    trainingDay: string;
    reason: 'travel' | 'illness' | 'unmotivated' | 'time' | 'other';
    notes?: string;
  };
};

type SessionSummaryGenerated = BaseEvent & {
  type: 'SessionSummaryGenerated';
  payload: {
    sessionId: string;
    summary: string;               // ≤300-char paragraph
    highlights: string[];
    embedding?: number[];          // 384-dim, all-MiniLM-L6-v2
    generationMode: 'llm' | 'extractive_fallback';
  };
};
```

### Signals from the user

```ts
type LowEnergyReported = BaseEvent & {
  type: 'LowEnergyReported';
  payload: { sessionId?: string; trainingDay: string; energy: number };
};

type InjuryReported = BaseEvent & {
  type: 'InjuryReported';
  payload: { injuryId: string; muscleGroup: string; severity: 1 | 2 | 3; notes?: string };
};

type InjuryResolved = BaseEvent & {
  type: 'InjuryResolved';
  payload: { injuryId: string; resolvedAt: string };
};

type MotivationDipReported = BaseEvent & {
  type: 'MotivationDipReported';
  payload: { trainingDay: string; signal: 'explicit' | 'pattern_detected'; notes?: string };
};

type PlateauDetected = BaseEvent & {                  // system-emitted
  type: 'PlateauDetected';
  payload: { exerciseId: string; weeksStuck: number; lastWeight: number };
};
```

### Progression (deterministic, not LLM)

```ts
type ProgressionApplied = BaseEvent & {
  type: 'ProgressionApplied';
  payload: { exerciseId: string; from: { weight: number; rpe: number }; to: { weight: number }; rule: string };
};

type RegressionApplied = BaseEvent & {
  type: 'RegressionApplied';
  payload: { exerciseId: string; from: number; to: number; reason: 'missed_reps' | 'high_rpe' | 'injury' };
};
```

### Compression / mid-term memory

```ts
type WeeklyDigestGenerated = BaseEvent & {
  type: 'WeeklyDigestGenerated';
  payload: { weekStart: string; weekEnd: string; digest: string; embedding?: number[] };
};

type MonthlyThemeGenerated = BaseEvent & {
  type: 'MonthlyThemeGenerated';
  payload: { monthStart: string; theme: string; embedding?: number[] };
};

type BlockReviewGenerated = BaseEvent & {
  type: 'BlockReviewGenerated';
  payload: { blockId: string; review: string };
};

type TrainingArcUpdated = BaseEvent & {
  type: 'TrainingArcUpdated';
  payload: { arc: string; coversThroughDay: string };
};
```

### Semantic facts (LTM, with lifecycle)

```ts
type SemanticFactExtracted = BaseEvent & {
  type: 'SemanticFactExtracted';
  payload: { factId: string; key: string; value: unknown; evidence: string[]; confidence: number };
};

type SemanticFactContradicted = BaseEvent & {
  type: 'SemanticFactContradicted';
  payload: { factId: string; contradictedBy: string; contradictionAt: string };
};

type SemanticFactRetired = BaseEvent & {
  type: 'SemanticFactRetired';
  payload: { factId: string; reason: 'contradicted' | 'decayed' | 'user_corrected' };
};
```

### LLM / agent meta (observability built into the event log)

```ts
type LLMCallObserved = BaseEvent & {
  type: 'LLMCallObserved';
  payload: {
    callId: string;
    tool: string;
    provider: 'groq' | 'gemini' | 'cerebras' | 'fallback';
    model: string;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    latencyMs: number;
    success: boolean;
    outcome: 'accepted'
           | 'rejected_user'
           | 'rejected_validator'
           | 'rejected_safety'
           | 'fallback_used'
           | 'error';
    error?: string;
  };
};
```

**Total: 30 events across 8 domains.** Above the "15–25" rule but each represents a distinct domain action. `LLMSuggestionAccepted`/`Rejected` were folded into `LLMCallObserved.outcome` per BLUEPRINT Part 11 Refinement 2.

---

## 3. Tool whitelist

> The complete set of LLM-callable tools. 5–8 max.
> Each tool: name, when it fires, input schema, output schema, side effects.

**EXAMPLE:**

```ts
tool: proposeSubstitution
when:  user signals can't/won't do an exercise mid-session
input: {
  sessionId: string;
  exerciseId: string;
  reason: SubstitutionReason;
  userNote?: string;
}
output: {
  substituteExerciseId: string;        // must be in equipment-filtered library
  rationale: string;                   // user-facing explanation, ≤200 chars
  preservesGoalIntent: boolean;        // self-check, validated downstream
}
side_effects: emits ExerciseSubstituted event after deterministic validation passes
```

**YOUR TOOLS:**

> 10 tools total. `suggestProgression` was removed (now deterministic RPE autoregulation, not an LLM call).
> `recallEpisode` and `criticPlanDraft` were added per BLUEPRINT.md red-team.
> Every tool has a deterministic fallback so the app works fully offline.

### 1. `craftPlan` *(LLM-backed)*
- **When:** `PlanGenerated` is needed (initial or after `ReplanProposed`). Heaviest LLM call in the system.
- **Input schema:**
  ```ts
  {
    mode: 'rationale_only' | 'full';   // Day 0–14 = rationale_only
    intent: 'initial' | 'revise';
    skeleton: PlanSkeleton;            // already constraint-solved by deterministic planner
    userContext: UserContext;
    goalAnchor: GoalAnchor;
    userRequest?: string;              // for 'revise' intent only
    priorPlanId?: string;              // for 'revise' intent
  }
  ```
- **Output schema:**
  ```ts
  { weeks: PlanWeek[]; rationale: string }    // 'rationale_only' fills rationale only; weeks copied from skeleton
  ```
- **Provider:** Gemini 3 Flash (heavier reasoning needed). Designed cache-friendly for paid tier.
- **Side effects:** emits `PlanGenerated` or `PlanRevised` after validator + critic pass.
- **Deterministic fallback:** select closest template from 18-template library, attach template rationale string.

### 2. `criticPlanDraft` *(LLM-backed)*
- **When:** Immediately after `craftPlan`, before persistence.
- **Input schema:**
  ```ts
  { draft: PlanDraft; goalAnchor: GoalAnchor }
  ```
- **Output schema:**
  ```ts
  {
    issues: { severity: 'block' | 'warn'; field: string; reason: string }[];
    passed: boolean;
  }
  ```
- **Provider:** Gemini 3 Flash (cheap, structured).
- **Side effects:** none. Read-only critic. If `passed=false` with `block` issues → retry `craftPlan` with feedback (max 3).
- **Deterministic fallback:** rule-based checks only — volume/muscle, push/pull balance, equipment match, injury locks.

### 3. `generateTodaysSession` *(LLM-backed)*
- **When:** App opens; no `SessionScheduled` for today's `trainingDay`.
- **Input schema:**
  ```ts
  {
    planSession: PlannedSession;
    checkin: PreCheckin;
    last7Days: TimelineDigest[];
    goalAnchor: GoalAnchor;
  }
  ```
- **Output schema:**
  ```ts
  { exercises: ExerciseSlot[]; openingNote: string; focus: string }
  ```
- **Provider:** Groq `llama-3.3-70b-versatile` (fast, structured outputs).
- **Side effects:** emits `SessionScheduled`.
- **Deterministic fallback:** `planSession` unchanged + template opening note keyed off energy level.

### 4. `proposeSubstitution` *(LLM-backed)*
- **When:** User signals can't/won't do an exercise mid-session.
- **Input schema:**
  ```ts
  {
    sessionId: string;
    exerciseId: string;
    reason: 'pain' | 'equipment_unavailable' | 'low_energy' | 'preference' | 'other';
    userNote?: string;
    allowedSubs: ExerciseId[];   // pre-filtered by equipment + injury graph
    goalAnchor: GoalAnchor;
  }
  ```
- **Output schema:**
  ```ts
  {
    substituteExerciseId: string;
    rationale: string;            // ≤200 chars
    preservesGoalIntent: boolean;
  }
  ```
- **Provider:** Groq.
- **Side effects:** emits `ExerciseSubstituted` after validator.
- **Deterministic fallback:** pick first item from `allowedSubs` (graph-ordered by primary-muscle match).

### 5. `summarizeSession` *(LLM-backed)*
- **When:** Immediately after `SessionCompleted`.
- **Input schema:**
  ```ts
  {
    setEvents: SetCompleted[];
    subs: ExerciseSubstituted[];
    checkin: PreCheckin;
    sessionMeta: { sessionId: string; trainingDay: string };
  }
  ```
- **Output schema:**
  ```ts
  { summary: string; highlights: string[] }   // summary ≤300 chars
  ```
- **Provider:** Groq.
- **Side effects:** emits `SessionSummaryGenerated` + writes embedding row (MiniLM ONNX) + writes FTS5 row.
- **Deterministic fallback:** extractive — "Completed N/M exercises, X total sets, avg RPE Y" + top exercises.

### 6. `extractFactsFromCheckin` *(LLM-backed)*
- **When:** `PreCheckinRecorded` has non-empty `notes`.
- **Input schema:**
  ```ts
  {
    notes: string;
    existingFacts: SemanticFact[];     // for contradiction detection
  }
  ```
- **Output schema:**
  ```ts
  {
    newFacts: { key: string; value: unknown; confidence: number }[];
    contradictions: { factId: string; reason: string }[];
  }
  ```
- **Provider:** Groq.
- **Side effects:** emits `SemanticFactExtracted` and/or `SemanticFactContradicted`.
- **Deterministic fallback:** skip — no extraction this turn.

### 7. `recallEpisode` *(deterministic — NOT an LLM call)*
- **When:** Any tool determines historical recall is needed (e.g., "how did last leg day feel?").
- **Input schema:**
  ```ts
  { query: string; topK: number }
  ```
- **Output schema:**
  ```ts
  { results: { summary: string; trainingDay: string; relevanceScore: number }[] }
  ```
- **Provider:** **None — this is NOT an LLM call.** Pure local retrieval: SQLite FTS5 (BM25) + sqlite-vec (cosine) merged with Reciprocal Rank Fusion (k=60).
- **Side effects:** none.
- **Deterministic fallback:** N/A (always deterministic).

### 8. `writeMotivationalNote` *(LLM-backed)*
- **When:** `MotivationDipReported` or pattern detected (3 skips in 7 days).
- **Input schema:**
  ```ts
  {
    goalAnchor: GoalAnchor;
    recentContext: TimelineDigest[];
    userWords: string;             // user's `why` from goal
  }
  ```
- **Output schema:**
  ```ts
  { note: string }                 // ≤250 chars, no emojis
  ```
- **Provider:** Groq.
- **Side effects:** none. Just shown to user as a card.
- **Deterministic fallback:** template referencing `userWords` verbatim.

### 9. `generateDigest` *(LLM-backed)*
- **When:** Counter triggers — 7 `SessionCompleted` → weekly; 4 weekly → monthly; `TrainingBlockEnded` → block; 12 weeks → arc.
- **Input schema:**
  ```ts
  {
    type: 'weekly' | 'monthly' | 'block' | 'arc';
    sourceEvents: Event[];         // the window being summarized
    priorDigests?: string[];       // for compounding context (monthly reads weekly)
    goalAnchor: GoalAnchor;
  }
  ```
- **Output schema:**
  ```ts
  { digest: string }               // weekly ≤200, monthly ≤300, block ≤400, arc ≤500 chars
  ```
- **Provider:** Groq for weekly/monthly; Gemini for block/arc (more reasoning).
- **Side effects:** emits one of `WeeklyDigestGenerated`, `MonthlyThemeGenerated`, `BlockReviewGenerated`, `TrainingArcUpdated`. Embedding written for retrievable digests.
- **Deterministic fallback:** extractive stats summary.

### 10. `handleReplanRequest` *(LLM-backed)*
- **When:** User accepts a `ReplanProposed` or says "this isn't working."
- **Input schema:**
  ```ts
  {
    reason: string;
    currentState: { adherence: number; weeksIn: number; recentSkips: number };
    goalAnchor: GoalAnchor;
  }
  ```
- **Output schema:**
  ```ts
  {
    mode: 'continue' | 'ease_back' | 'replan';
    rationale: string;
    proposedSkeletonDelta?: PlanSkeletonDelta;     // only if mode='ease_back' or 'replan'
  }
  ```
- **Provider:** Gemini 3 Flash.
- **Side effects:** if `replan` → trigger `craftPlan(mode='initial')`; if `ease_back` → emit `DeloadTriggered`.
- **Deterministic fallback:** rule-based — if adherence <50% → `ease_back`; if `weeksIn >=4` → `replan`; else `continue`.

> All 10 tools are validated against schemas with Zod before any side effect fires.
> The `LLMCallObserved` event is emitted for every call regardless of outcome (built-in observability).

---

## 4. Projections

> Derived views computed from the event stream.
> Each projection: name, input events, shape, recompute cost, cache strategy.

**EXAMPLE:**

```
projection: CurrentGoal
inputs:     GoalCreated, GoalRevised
shape:      { id, type, why, targetDate, version }
cost:       O(events_of_those_types)
cache:      always cached, invalidated on those events
```

**YOUR PROJECTIONS:**

| Name | Input events | Shape | Cache strategy |
|---|---|---|---|
| `UserContext` | `UserContextCreated`, `UserContextUpdated` | `{ profile, routine, equipment, constraints, knownInjuries[], dayRolloverHour }` | Always cached; invalidate on either |
| `CurrentGoal` | `GoalCreated`, `GoalRevised` | `{ goalId, goalType, why, targetDate, version }` | Always cached |
| `ActivePlan` | `PlanGenerated`, `PlanRevised`, `ReplanForced` | `{ planId, weeks[], rationale, generatedAt }` | Always cached; one active plan at a time |
| `CurrentTrainingBlock` | `TrainingBlockStarted`, `TrainingBlockEnded`, `DeloadTriggered` | `{ blockId, blockName, weekIndex, totalWeeks, isDeloadWeek }` | Always cached |
| `TodaysSession` | `SessionScheduled`, `SessionStarted`, `SetCompleted`, `ExerciseSubstituted`, `ExerciseSkipped`, `SessionCompleted`, `SessionSkipped` | `{ sessionId, status, exercises[], setLog[], substitutions[] }` | Cached for current `trainingDay` |
| `Last7DaysTimeline` | `SessionCompleted`, `SessionSkipped`, `SessionSummaryGenerated` | `[{ trainingDay, status, summary, keySignals }]` | Recomputed on each `SessionCompleted`/`Skipped` |
| `StreakStats` | `SessionCompleted` | `{ current, longest, lastCompletedDay }` | Recompute on `SessionCompleted` |
| `AdherenceStats` | `SessionCompleted`, `SessionSkipped` | `{ last7Pct, last30Pct, allTimePct }` | Recompute on either |
| `KnownInjuries` | `InjuryReported`, `InjuryResolved` | `{ active: Injury[], history: Injury[] }` | Cached; invalidate on either |
| `SemanticFacts` | `SemanticFactExtracted`, `SemanticFactContradicted`, `SemanticFactRetired` | `{ active: Fact[], retired: Fact[] }` | Cached |
| `ExerciseHistory` | `SetCompleted`, `ExerciseSubstituted` | `Map<exerciseId, { lastWeight, lastReps, lastRpe, lastDate, sessionsAgo }>` | Cached |
| `ProgressionState` | `SetCompleted`, `ProgressionApplied`, `RegressionApplied` | `Map<exerciseId, { suggestedNextWeight, rpeTrend, stuckWeeks }>` | Recompute on `SetCompleted` |
| `MTMDigests` | `WeeklyDigestGenerated`, `MonthlyThemeGenerated`, `BlockReviewGenerated`, `TrainingArcUpdated` | `{ weekly[], monthly[], blocks[], arc }` | Append-only, never recompute |
| `LLMUsage` | `LLMCallObserved` | `{ today: { calls, tokens, byProvider }, last7d: {...} }` | Recompute on `LLMCallObserved` |

**Recompute strategy:** all projections are recomputable from the event log. On app open, we read the cached `projections` row. If `last_seq` is behind the event log's `max(seq)`, fold forward the delta. Full rebuild only on schema migration.

---

## 5. Goal anchor format

> The exact JSON shape pinned into every LLM prompt.
> This is the gravity. Get it right.

**EXAMPLE:**

```ts
type GoalAnchor = {
  goalId: string;
  goalType: 'hypertrophy' | 'strength' | 'fat_loss' | 'endurance' | 'general_fitness';
  why: string;                          // user's own words, ≤200 chars
  targetDate: string;                   // ISO date
  weeksRemaining: number;
  hardConstraints: {
    daysPerWeek: number;
    sessionMaxMinutes: number;
    equipment: 'home' | 'gym' | 'mixed';
    knownInjuries: string[];            // active only
  };
  currentBlock: {
    name: string;                       // e.g., "Hypertrophy Block 2"
    weekIndex: number;
    totalWeeks: number;
  };
};
```

**YOUR GOAL ANCHOR:**

```ts
type GoalAnchor = {
  goalId: string;
  goalType: 'hypertrophy' | 'strength' | 'fat_loss' | 'endurance' | 'general_fitness';
  why: string;                          // user's own words, ≤200 chars, verbatim
  targetDate: string;                   // ISO
  weeksRemaining: number;
  hardConstraints: {
    daysPerWeek: number;
    sessionMaxMinutes: number;
    equipment: 'home' | 'gym' | 'mixed';
    knownInjuries: string[];            // active only, lowercase muscle/joint tags
  };
  currentBlock: {
    blockId: string;
    name: string;
    weekIndex: number;
    totalWeeks: number;
    isDeloadWeek: boolean;
  };
  rolloverHour: number;                 // for the LLM to interpret day boundaries correctly
};
```

**Rules for the anchor:**
- Always present in the system prompt of every LLM call.
- Maximum size: **~250 tokens** (measured: ~210 tokens typical).
- Part of the **cacheable prefix** in Gemini context caching.
- Updated only when an event in `{GoalCreated, GoalRevised, TrainingBlockStarted, TrainingBlockEnded, InjuryReported, InjuryResolved, UserContextUpdated}` is appended.
- Visible to user in app under "What your coach knows about you" — trust + control.

---

## 6. Memory tiers

> Four tiers. Each with a clear rule for what belongs there.

**EXAMPLE:**

| Tier | Contents | Size budget | Loaded when | Source of truth? |
|---|---|---|---|---|
| Core | Goal anchor, hard constraints | ~500 tokens | Every prompt | Yes |
| Working | Last 7 days timeline, current week of plan, today's checkin | ~1500 tokens | Every prompt | Yes (derived) |
| Episodic | Past sessions, indexed by embedding | ~variable | On retrieval (tool call) | Yes (event-backed) |
| Semantic | Distilled facts: "user prefers dumbbells over barbells" | ~300 tokens | When relevant fact key matches | No (with evidence pointers) |

**YOUR TIERS** (LightMem-style STM / MTM / LTM, see BLUEPRINT.md Part 7):

| Tier | Contents | Size budget | Loaded when | Source of truth? |
|---|---|---|---|---|
| **Core (STM, cached)** | `GoalAnchor`, tool whitelist, system instructions | ~1,200 tokens | Every prompt — cached prefix | Yes (derived from events) |
| **Working (STM, live)** | Today's checkin, `Last7DaysTimeline`, current week of plan | ~1,500 tokens | Every prompt | Yes (derived) |
| **MTM (retrieved)** | `WeeklyDigest`, `MonthlyTheme`, `BlockReview`, `TrainingArc` | variable | On `recallEpisode` call OR when relevant | Yes (event-backed) |
| **LTM raw + index** | Full event log + sqlite-vec embeddings + FTS5 keyword index | unbounded | On `recallEpisode` call | Yes (canonical) |
| **Semantic facts** | Distilled `{key, value, evidence_event_ids[], confidence}` | ~400 tokens when injected | Auto-injected if `key` matches task | No (with evidence pointers) |

**Semantic fact lifecycle:**
- **Created by** `extractFactsFromCheckin` tool when user notes contain durable signal. Confidence starts at 0.5, increases on repeat evidence.
- **Contradicted** when a new fact directly conflicts → emit `SemanticFactContradicted`. Fact moves to "candidate review" state.
- **Retired** in three ways:
  1. Contradiction with confidence > 0.8 on the contradicting fact → auto-retire.
  2. **Time decay**: facts with no supporting evidence in 90+ days → confidence × 0.5 each month.
  3. User correction in the "What your coach knows about you" screen → immediate retire with `reason: 'user_corrected'`.
- **Evidence pointer model:** `evidence: string[]` is a list of event IDs. The LLM cannot drop them — when asked "why do you think X?", we render the evidence trail.

---

## 7. Session state machine

> Every state, every transition, every failure mode.
> Draw it on paper first, then transcribe.

**EXAMPLE states:**
`scheduled` → `active` → `completed`
`scheduled` → `skipped`
`active` → `abandoned` (app closed, no completion)
`abandoned` → `resumed` → `active`

**Transitions:**

| From | To | Trigger | Event emitted | Guard conditions |
|---|---|---|---|---|
| scheduled | active | user taps Start | SessionStarted | preCheckin recorded |
| active | completed | user taps Done | SessionCompleted | ≥1 set logged |
| active | abandoned | app backgrounded ≥4h | (no event yet) | — |
| abandoned | active | app reopened same day | SessionResumed | within session window |
| abandoned | skipped | next day boundary | SessionSkipped | — |
| scheduled | skipped | user explicit skip | SessionSkipped | — |

**YOUR STATE MACHINE:**

```
states: scheduled | active | abandoned | completed | skipped

transitions:
  scheduled  → active     trigger: user taps Start           emit: SessionStarted     guard: PreCheckinRecorded for this sessionId
  active     → completed  trigger: user taps Done            emit: SessionCompleted   guard: ≥1 SetCompleted exists
  active     → abandoned  trigger: app backgrounded ≥4h     emit: (none)             guard: no completion yet
  abandoned  → active     trigger: app reopened same tDay   emit: SessionResumed     guard: within trainingDay window
  abandoned  → skipped    trigger: trainingDay rollover     emit: SessionSkipped     guard: 0 SetCompleted (else auto-complete partial)
  scheduled  → skipped    trigger: user explicit skip       emit: SessionSkipped     guard: —
  any        → any        trigger: ReplanForced             emit: ReplanForced       cancels current session
```

**Failure modes:**
- **LLM unavailable when generating today's session** → deterministic fallback: emit `SessionScheduled` with `generationMode: 'template_fallback'`, use plan's prescribed session unchanged, opening note from template library keyed off energy.
- **App crashes mid-session** → all `SetCompleted` events are already on disk; on reopen, `TodaysSession` projection rebuilds. User sees session in `active` state with their logged sets.
- **User force-closes during active session** → same as crash. No state lost because state is event-derived, not in-memory.
- **Clock skew / timezone changes** → all events stamp `trainingDay` at write-time using `trainingDayOf(now, userRolloverHour)`. Timezone is the *device's* timezone at the moment of write. Travel produces deterministic, traceable behavior.
- **User opens app for first time in 14 days** → `TodaysSession` projection notices gap > 2 days. Triggers `RestartFlow` UI (not a state of the session machine — sits *above* it). Asks "ease back in / resume normal / replan." Flow then creates the appropriate session.
- **LLM returns invalid JSON** → retry with error feedback (max 3). If exhausted → deterministic fallback fires.
- **LLM output violates invariant** → reject, emit `LLMSuggestionRejected { reason: 'validator_rejected' }`, retry once with rejection feedback, then fallback.

---

## 8. Invariants

> Rules the system must never violate, expressed as English assertions.
> These are the bumpers around the LLM. Validators enforce them.

**EXAMPLE:**
1. Streak can only be incremented by `SessionCompleted` events.
2. An `ExerciseSubstituted` event requires both the original and the substitute to exist in the equipment-filtered library.
3. The LLM cannot output an exercise outside the user's current `equipment` filter.
4. Goal text is immutable within a training block. Changing it forces a `Replan`.
5. No two `SessionCompleted` events can exist for the same calendar day.
6. Volume increase per week ≤ 10% (deterministic, not LLM-judged).
7. If `KnownInjuries` includes `knee`, no exercise tagged `knee_loading` may be prescribed.
8. Every `LLMSuggestionAccepted` event must reference the prompt and tool used.

**YOUR INVARIANTS:**

**Streak & completion**
1. `StreakStats.current` can only be incremented by `SessionCompleted` events.
2. No two `SessionCompleted` events may share the same `(sessionId)` OR the same `(trainingDay)`.
3. `SessionCompleted` requires at least one `SetCompleted` for the same `sessionId`.

**Plan & block integrity**
4. Goal text (`why`, `goalType`) is immutable within a `TrainingBlock`. Changing it must emit `ReplanForced { reason: 'goal_change' }`.
5. Only one `ActivePlan` may exist at any time. A new `PlanGenerated` must be preceded by `TrainingBlockEnded` or `ReplanForced`.
6. Volume increase per week ≤ 10% (computed across muscle groups, enforced deterministically — LLM cannot override).

**Safety**
7. If `KnownInjuries` includes a muscle/joint tag, no exercise tagged as loading that tag may appear in a `SessionScheduled` event.
8. The LLM cannot output an exercise that is not in the equipment-filtered library for the user's current `equipment`.
9. The LLM cannot directly emit any event in `{GoalCreated, GoalRevised, PlanGenerated, SetCompleted, SessionCompleted, SessionSkipped, ProgressionApplied, RegressionApplied}` — only tool handlers can, after validation.

**LLM observability**
10. Every LLM tool invocation must emit one `LLMCallObserved` event, regardless of success.
11. Every accepted LLM suggestion must reference its `callId` via `LLMSuggestionAccepted`.

**Event log integrity**
12. Every event must have a valid `prevHash` chaining to the previous event by `seq`. A broken chain means tampering or corruption → app enters read-only debug mode.
13. `seq` is monotonic and gapless. Inserts are transactional with projection updates — both succeed or both fail.

**Semantic facts**
14. Every `SemanticFact` must carry ≥1 `evidence` event ID. A fact whose evidence array becomes empty must be retired.

**Progression**
15. `ProgressionApplied` weight increase per exercise per week ≤ 5% (heuristic ceiling on RPE-suggested progression).

---

## 9. Test scenarios

> Multi-week stories the architecture must handle gracefully.
> For each: starting state, sequence of events, expected behavior.

**EXAMPLE:**

### Scenario A: The travel skip
- **Setup:** User has 14-day clean streak. Hypertrophy goal, week 3 of 4.
- **Event sequence:**
  - Day 15: SessionSkipped (reason: 'travel')
  - Day 16: SessionSkipped
  - Day 17: SessionSkipped
  - Day 18: SessionSkipped
  - Day 19: SessionSkipped
  - Day 20: app reopened
- **Expected behavior:**
  - System does NOT continue plan as if days 15–19 were rest.
  - On Day 20 open: app explicitly acknowledges the gap.
  - LLM offers: "ease back in" / "resume normal" / "extend the block" — structured choice.
  - No streak-shaming, no guilt, no "you failed."
  - If user picks "ease back in," the planner generates a deload-style session.

**YOUR SCENARIOS:**

### Scenario A: The travel skip

### Scenario B: The injury mid-block

### Scenario C: The motivation dip ("is this even working?")

### Scenario D: The plateau (3 weeks same weight)

### Scenario E: The mid-block goal change

### Scenario F: The cold restart (14 days dormant)

### Scenario G: The equipment surprise (gym closed, home only today)

### Scenario H: The Day-1 user (no events at all)

> If you can't tell a clean story for each, the architecture isn't ready.

---

## 10. Hard questions — answered

> The questions the references don't answer for you. You must.

**1. When does the deterministic planner take over vs the LLM?**
The deterministic planner *always* runs first and produces a complete, valid skeleton. The LLM only gets the skeleton with empty exercise-name slots, then fills exercise selections from a filtered library and writes prose rationale. The LLM never picks structure (split, days/week, set/rep schemes) — only flavor.

**2. What triggers a re-plan vs a single-session adaptation?**
- **Single-session adaptation** (no re-plan): low energy, sub one exercise, skip one day, missed reps, sore muscle, equipment unavailable today.
- **Re-plan** (`ReplanProposed`): 4-week block complete (auto), adherence < 50% over last 7 days (auto), 3 weeks same weight on a key lift (auto), user explicitly asks (manual).
- **Re-plan forced** (`ReplanForced`): goal change, new injury blocking >40% of programmed volume, equipment change (e.g., gym → home).

**3. How does a semantic fact get retired?**
See §6 lifecycle: contradiction with confidence > 0.8, time decay after 90 days no supporting evidence, or user correction. All three emit `SemanticFactRetired`.

**4. What happens when the LLM call fails?** (Offline, rate-limited, garbage output.)
Tiered fallback chain inside `LLMClient`:
1. Try **Groq** (or **Gemini** for heavy tools) first.
2. On 429/5xx → try **Cerebras** with the same prompt.
3. On all-cloud failure → emit `LLMSuggestionRejected` with `reason: 'safety_block'` and fire the tool's deterministic fallback (see §3 tool specs).
The app never blocks the user on a network call. UI shows a spinner for max 6 seconds, then degraded path runs.

**5. What's the cold-start session?** (Day 1, no history, no embeddings — what does the LLM see?)
Day 0–14 = **template mode**. The deterministic planner picks one of 18 templates from the static library based on `(goalType × equipment × experience)`. The LLM is asked only to write a 2-sentence rationale referencing the user's `why` — nothing more. After 14 days of events, the LLM is allowed to participate in `craftPlan` for re-plans.

**6. What's the cost model?** (Cloud LLM calls/day per user × cents per call. Does it pencil?)
Per-user steady-state: ~3–6 LLM calls/day. With Gemini context caching of the ~1,200-token prefix, effective tokens per call ~600 (non-cached) + 1,200 (cached @ 10% cost). Groq free tier = 1,000 RPD; Gemini free tier = 1,500 RPD. **Free tier holds for hundreds of daily users** before we'd need paid. At paid rates (Gemini Flash, Groq llama-3.3-70b), worst-case cost is < $0.02 per user per day.

**7. What's the privacy story?** (Where does data live? What goes to cloud LLM? Data export/delete?)
- Local-first: all events, projections, embeddings live in on-device SQLite.
- Cloud LLM sees: `GoalAnchor`, recent `Last7DaysTimeline` digests, today's check-in, current tool input. **Never** the raw `profile.weight_kg`/`age` unless explicitly needed (only `equipment` and `goalType`-derived parameters).
- No cloud account, no server, no telemetry beyond Expo's defaults.
- Export: dump SQLite file. Delete: clear app data → wipe.

**8. How do you migrate the event schema in v2?** (Old events still need to replay.)
Every event has `schemaVersion`. Upcasters live in `src/events/migrations/{type}/v1_to_v2.ts` as pure functions `(oldPayload) => newPayload`. On replay, the projection engine pipes each event through the upcaster chain before reducing. Replay test: load 6 months of v1 events, verify all projections rebuild without error.

**6. What's the cost model?** (Cloud LLM calls/day per user × cents per call. Does it pencil?)

**7. What's the privacy story?** (Where does data live? What goes to cloud LLM? Data export/delete?)

**8. How do you migrate the event schema in v2?** (Old events still need to replay.)

---

## 11. Cold start

> The first 60 seconds of a brand-new install.

- What does the user see first?
- What's the minimum data needed before the LLM is invoked?
- What's the Day-1 session look like, with zero history?
- How does the app feel useful on Day 1, before any personalization?
- When is the user told "this will get smarter as you use it"?

---

## 12. Failure modes

> What breaks gracefully vs what fails the user.

| Failure | Handling | User-visible behavior |
|---|---|---|
| No internet, cloud LLM needed | Deterministic fallback for the active tool | "Coach is offline — using your plan as-is. Tap to add a note." |
| LLM returns invalid JSON | Retry × 3 with error feedback, then fallback | Spinner ≤6s, then degraded path |
| LLM returns valid JSON but violates invariant | Reject, log `LLMSuggestionRejected`, retry × 1, then fallback | Same as above |
| LLM rate-limited (429) | Try next provider in tier chain (Groq → Cerebras → Gemini → fallback) | Transparent unless all fail |
| SQLite write fails | Transaction rolls back; event NOT appended | Error toast: "Couldn't save. Retry?" |
| Event hash chain breaks | App enters read-only debug mode; flag for support | Banner: "Detected data integrity issue — recovery mode." |
| App crashes mid-session | All events on disk; projection rebuilds on next open | Session resumes in `active` state with logged sets visible |
| User changes phone, restores backup | SQLite restored; projections rebuild on first open | Slight delay (1–3s) on first open, no data loss |

---

## 13. Cost model

> Be honest. Math out the worst case before you build.

- LLM calls per active user per day (worst case): **10** (1 session-gen, 2 substitutions, 1 summary, 1 checkin parse, 1 digest, 4 buffer)
- Average input tokens per call: **2,000** uncached → **800** with caching (60% cache hit ratio)
- Average output tokens per call: **300**
- Provider + model: **Groq llama-3.3-70b-versatile** (fast tools) + **Gemini 3 Flash** (heavy tools)
- Cost per call (paid, with caching): **~$0.0015** worst case
- Cost per user per day: **~$0.015** worst case, **$0** on free tier
- Cost per user per month: **~$0.45** worst case
- At what user count does this matter? **~150 DAU** before Groq RPD ceiling hits; **~300 DAU** before we'd need paid tier
- On-device migration target: **month 6+** (after enough usage to size the model decision)

---

## 14. Privacy

- **Data stored on-device:** all events, projections, embeddings, FTS5 indexes, semantic facts. Single SQLite file.
- **Data sent to cloud LLM:** `GoalAnchor`, today's `PreCheckin`, last 7 days digest, current tool input. Goal text `why` is sent verbatim (it's the anchor).
- **Data NOT sent to cloud LLM (ever):** raw `profile.age` / `profile.weight_kg` / `profile.height_cm` unless an exercise calculation specifically requires it. Personal notes from check-ins are sent only when `extractFactsFromCheckin` is invoked and the user has it enabled.
- **Data export format:** `.sqlite` file dump + JSON export of all events.
- **Data deletion behavior:** clear app data → full wipe, no server-side residue (because there's no server).
- **Privacy policy in plain English:** "Your training data stays on your phone. We send the minimum context needed to your AI provider (Groq, Google) to coach you in the moment. Nothing is stored on our servers because we don't have any. Delete the app to delete everything."

---

## 15. Schema migration

> Events live forever. Their schemas evolve. Plan for it.

- **Versioning strategy:** per-event `schemaVersion: number` field on the envelope.
- **Migration model:** forward-only upcasters from v(n) to v(n+1), one file per event type per version step.
- **Where upcasters live:** `src/events/migrations/{EventType}/v{n}_to_v{n+1}.ts` — pure function `(oldPayload) => newPayload`.
- **Replay engine:** on projection rebuild, every event passes through the upcaster chain to current version before reducing.
- **Test for migration:** integration test that loads 6 months of synthetic v1 events, runs full replay to v2, asserts all projection shapes still produce sane output.
- **Schema bump rule:** any payload change requires a version bump + migration + test, even for additive optional fields.

---

## 16. Ready-to-build checklist

Tick each only when you can defend it out loud.

- [ ] All 5 core principles written and defensible.
- [ ] Event catalog complete; no event feels duplicate or vague.
- [ ] Every tool has input/output schema and a clear "when it fires" rule.
- [ ] Every projection has a defined input set and cache strategy.
- [ ] Goal anchor schema fits in <500 tokens.
- [ ] All four memory tiers have explicit rules and budgets.
- [ ] Session state machine has been drawn AND walked through every failure mode.
- [ ] At least 8 invariants written; each is enforceable in code.
- [ ] All 8 test scenarios have a clear, written expected behavior.
- [ ] Every "hard question" has a written answer.
- [ ] Cold-start flow is described end to end.
- [ ] Cost math has been done and pencils.
- [ ] Privacy model is clear enough to write a policy from.
- [ ] Schema migration story exists.

---

## 17. Risks I'm carrying

> The 3 things most likely to kill this. Acknowledged, not solved.

1. **Free-tier ceiling hits before product-market fit.** Cerebras + Groq + Gemini together give us ~few hundred DAU runway. If retention spikes, costs spike before we can monetize. Mitigation: prompt caching + on-device migration plan, but the runway is real.
2. **The "look like a coach" gap.** Even with all this architecture, the LLM may produce sessions that *technically* satisfy validators but feel generic. The "holy shit it gets me" moment isn't guaranteed by the system; it emerges from prompt craft + the substitution graph quality + the templates. This is the part that needs taste, not engineering.
3. **Event-sourcing cognitive overhead.** Every feature requires thinking in events. If a future contributor (or sleepy-you) shortcuts with mutable state, the whole invariant story collapses. Mitigation: lint rules + clear docs + replay tests as guardrails.

---

## 18. What's explicitly NOT in scope

> Saying no is part of the spec. Future work, not v1.

- Multi-user / social features
- Apple Watch / wearable integration
- Form-check video / CV
- Nutrition
- Sleep tracking
- Cloud sync across devices
-

---

## Reading log

> Track as you go. One entry per reference.

| # | Reference | Date read | Core idea (3 sentences) | How it applies | What I'd do differently |
|---|---|---|---|---|---|
| 1 | ReAct paper | | | | |
| 2 | OpenAI function calling docs | | | | |
| 3 | Greg Young, CQRS Documents | | | | |
| 4 | MemGPT paper | | | | |
| 5 | Anthropic prompt engineering | | | | |
| 6 | Drizzle + expo-sqlite tutorial | | | | |
| 7 | A real strength program | | | | |
| 8 | Zod / structured outputs | | | | |
