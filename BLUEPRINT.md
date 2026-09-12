# Blueprint — Fitness Coach App

> The implementation blueprint built from `ARCHITECTURE.md`.
> Finalized tech stack + complete lifecycle walkthrough + state model.
> Last updated: 2026-06-06.

---

## Part 1 — Tech Stack (finalized)

All choices below are based on what actually ships in mid-2026 and what's free.

### Core runtime
| Layer | Choice | Why |
|---|---|---|
| Framework | Expo SDK 54+ | Already in use; Expo's `react-native-executorch` path opens later |
| Language | **TypeScript (strict)** | Discriminated unions on events are the spine of the system |
| Navigation | React Navigation v7 | Already in use |
| UI state | React Context (kept minimal) | Persisted state lives in SQLite, not Context |

### Persistence layer
| Choice | Notes |
|---|---|
| **expo-sqlite (latest)** | Stable, fast, WAL-mode supported on mobile |
| **Drizzle ORM** | Type-safe SQL, `useLiveQuery` hook for auto re-renders, painless migrations |
| **Zod** | Runtime validation for events, LLM outputs, projections. One schema → one type → one validator |

Schema: just **two tables** to start — `events` and `projections`. `snapshots` later if performance demands.

### LLM strategy — Hybrid Groq + Gemini

This is the part where the research mattered. Free-tier reality as of mid-2026:

| Provider | Free tier limits | Model picks | Job |
|---|---|---|---|
| **Groq** | 30 RPM, 6K TPM, 1,000 RPD (1B tokens/month overall) | `llama-3.3-70b-versatile`, `qwen3-32b` | Fast/cheap/frequent calls — substitutions, summaries, check-in parsing |
| **Gemini 3 Flash** | 10 RPM, 250K TPM, 1,500 RPD | `gemini-3-flash` | Heavy reasoning — initial plan generation, re-plan, structured output |
| **Cerebras** (backup) | 30 RPM, 1M tokens/day | `llama-3.3-70b`, `qwen3-235b` | Fallback if Groq throttles |

Both support **JSON schema-bound structured outputs** (with Zod). That's non-negotiable for this app — we never accept free text from the LLM where structure is expected.

**Budget math (single user):**
- ~3–6 LLM calls/day in steady state (1 plan/month, 1 session-gen/day, 0–2 substitutions, 1 summary, 1 check-in parse)
- Groq's 1,000 RPD covers that comfortably
- Gemini's 1,500 RPD covers plan generation with massive headroom
- Free tier holds for **hundreds of daily users** before we'd need paid

### No agent framework — DIY agent loop

Vercel AI SDK 6, Mastra, LangGraph all looked interesting in the research. **We are not using any of them for v1.**

Reasons:
1. They're all built for Next.js / serverless backends — none has first-class React Native support.
2. Our agent loop is ~150 lines: read state → build prompt → call LLM → validate → emit event. Wrapping that in a framework adds indirection.
3. The safety logic (constraint solver, validators) lives outside the LLM. Frameworks abstract LLM calls; we need control over what goes around them.

If we ever ship a backend server (push notifs, etc.), revisit Mastra. Not now.

### Observability — defer to v1.1

| Tool | Free tier | When |
|---|---|---|
| Langfuse | 50K observations/month, self-hostable | When user count grows |
| Helicone | 10K req/month, proxy-style | If we add a server proxy |

**For v1:** log every LLM call to the `events` table as an `LLMCallObserved` event. Build a debug screen that reads it. That's the observability stack.

### On-device LLM — the future path

Not for v1. But locked in as the migration target:

| Option | Status mid-2026 | Use when |
|---|---|---|
| **`@1mt/rn-on-device-ai`** | Wraps Apple FM (iOS 26+) + Gemini Nano (Android) | Cross-platform on-device |
| **`react-native-executorch`** | Llama 3.2 1B/3B, Qwen 3, hooks like `useLLM` | When we want model choice |
| **`@react-native-ai/apple`** | iOS 26+ only, ~3B Apple Foundation Model | iOS-only flagship experience |
| **`llama.rn`** | llama.cpp binding, GPU/NPU accel | Maximum control, ~3GB model files |

**Switch path:** the `LLMClient` interface in v1 has `complete(prompt, schema)` as the only public method. Swap `CloudLLMClient` → `DeviceLLMClient`, same interface, app code doesn't change.

### Storage for memory tiers
- Core + Working + Semantic = SQLite rows / JSON blobs in `projections`
- Episodic (later) = `sqlite-vec` extension when we add embeddings
- No external vector DB. Everything local.

---

## Part 2 — The Complete Lifecycle

Every phase. Every event. Every LLM call. Every state read/write.

### Phase 0: Cold install

```
USER ACTION             SYSTEM                    EVENTS    LLM
─────────────           ──────                    ──────    ───
Install + open app  →   Drizzle runs migrations    none     none
                        Creates `events` table
                        Creates `projections` table
                        Loads empty projections
                        Shows Onboarding screen
```

**State after:** Empty DB, no events, no projections, user on Onboarding.

---

### Phase 1: Onboarding — building UserContext

```
USER ACTION                       SYSTEM                              EVENTS                       LLM
─────────────                     ──────                              ──────                       ───
Enters age, weight, height,   →   Validate with Zod                   UserContextCreated           none
equipment, available time,        Append event to `events` table      { profile, equipment,
known injuries                    Run UserContextProjection.apply()     constraints }
                                  Update `projections` row
                                  Navigate to Goal screen
```

**Backend flow:**
1. `eventLog.append(UserContextCreated.parse(formData))`
2. `projections.userContext = userContextReducer(currentState, event)`
3. SQLite write (transaction: append + project)
4. UI re-renders via `useLiveQuery` on projections table

**State after:** 1 event in log, UserContext projection populated.

---

### Phase 2: Goal setting

```
USER ACTION                       SYSTEM                              EVENTS                LLM
─────────────                     ──────                              ──────                ───
Picks goal type, writes        →  Validate                            GoalCreated           none
"why" in own words,               Append event                        { goalType, why,
sets target date                  Run GoalProjection.apply()            targetDate }
                                  Navigate to PlanGeneration screen
```

**State after:** 2 events, UserContext + Goal projections populated.

---

### Phase 3: Initial plan generation (heaviest LLM call of the lifecycle)

```
USER SEES               SYSTEM                                                    EVENTS               LLM
─────────               ──────                                                    ──────               ───
"Generating your   →    1. Read projections: UserContext, Goal                                         
 plan..."               2. Build GoalAnchor:
 (loading state)           { goalId, goalType, why, targetDate, weeksRemaining,
                              hardConstraints: { daysPerWeek, equipment, injuries }}
                        3. Build prompt:
                           SYSTEM: "You are a fitness planner. Tools: [...].
                                   Output JSON matching this schema."
                           ANCHOR: GoalAnchor JSON
                           CONTEXT: UserContext JSON
                           TASK:    "Generate a 4-week training block."
                        4. Call Gemini 3 Flash with JSON schema                                        ← 1 LLM call
                           response_format: zod-to-json-schema(PlanSchema)
                        5. Parse response with Zod
                        6. Run DeterministicValidator:
                           - All exercises in equipment-filtered library?
                           - Weekly volume within bounds (10-20 sets/muscle)?
                           - No injury-locked exercises?
                           - Goal-appropriate rep ranges?
                        7. If invalid → retry with error feedback (max 3 attempts)
                        8. If exhausted → fall back to template plan + flag warning
                        9. Emit PlanGenerated event                              PlanGenerated
                        10. Update ActivePlan projection                          { plan, rationale,
                                                                                   generatedFrom }
                        11. Show plan to user

Plan shown.       →    User can chat: "can we do 4 days not 5?"
                        Each tweak → call Gemini with `revisePlan` tool         PlanRevised          ← LLM call/tweak
                                                                                 { delta, rationale }

User taps "Start  →    Emit TrainingBlockStarted                                TrainingBlockStarted
 my training"           Update CurrentTrainingBlock projection                    { blockId, startedAt }
                        Navigate to Home
```

**State after Phase 3:** 4+ events, ActivePlan + CurrentTrainingBlock projections populated.

---

### Phase 4: First daily session (Day 1)

```
USER ACTION             SYSTEM                                                  EVENTS                  LLM
─────────────           ──────                                                  ──────                  ───
Opens app    →          1. Read projections:                                                            
                           - CurrentTrainingBlock → week 1, today is "Push Day"
                           - UserContext, Goal anchor
                           - Last7DaysTimeline → empty
                        2. Check: is today's session already generated? No.
                        3. Show "Quick check-in" sheet

Fills check-in:  →     1. Validate                                            PreCheckinRecorded
energy=7, sore=1,       2. Emit event                                           { sessionId, energy,
no issues               3. Update TodaysContext projection                        soreness, notes }

(Auto-trigger:   →     1. Read: plan's session for today + checkin
 generate session)         + last 7 days (empty)
                        2. Deterministic preprocessing:
                           - If energy <4 → reduce volume 20%
                           - If sore tag → swap affected muscle
                           - Apply known injuries
                        3. Call Groq llama-3.3-70b:                                                    ← 1 LLM call
                           - Tool: generateTodaysSession
                           - Anchor: GoalAnchor
                           - Input: skeleton from step 2
                           - Output: { exercises[], openingNote, focus }
                        4. Validate output (Zod + safety rules)
                        5. Emit event                                          SessionScheduled
                        6. Show session list                                     { sessionId, exercises,
                                                                                  openingNote }

Taps "Start"     →     Emit event, update SessionState=active                  SessionStarted

Logs set 1,2,3   →     3× events                                               SetCompleted x N
on each exercise        Update SessionProgress projection                        { exerciseId, setIdx,
                                                                                  weight, reps, RPE? }

Mid-session:     →     1. Open substitution modal
"Bench off,             2. Read: current session + KnownInjuries
 swap it"               3. Call Groq:                                                                  ← 1 LLM call
                           - Tool: proposeSubstitution
                           - Input: { exerciseId, reason }
                           - Output: { substituteId, rationale }
                        4. Validate substitute is in library, equipment match
                        5. Show user proposal
                        6. User accepts → emit event                           ExerciseSubstituted
                                                                                 { original, substitute,
                                                                                   reason, acceptedAt }
                        7. Update session.exercises in projection

Finishes,        →     1. Emit                                                 SessionCompleted
taps "Done"             2. Call Groq:                                                                  ← 1 LLM call
                           - Tool: summarizeSession
                           - Input: full session + sets + substitutions
                           - Output: { summary: "...", highlights: [...] }
                        3. Emit                                                SessionSummaryGenerated
                        4. Update projections (in transaction):
                           - StreakStats (+1)
                           - AdherenceStats
                           - TimelineProjection (append day entry)
                           - ExerciseHistoryProjection
                        5. Show Completion screen with summary
```

**Total LLM calls on Day 1: ~3–4** (1 session gen, 0–1 substitution, 1 summary; plus the heavy plan generation done once on Day 0).

**State after Day 1:** ~15-25 events, all projections active and current.

---

### Phase 5: Day N — steady state (Days 2 through ~30)

Same as Day 1 with these differences:

- `Last7DaysTimeline` is now populated → LLM gets real recent context.
- **Progression check:** the deterministic layer checks `ExerciseHistoryProjection`:
  - Did user hit top of rep range last 2 sessions? → suggest +2.5kg.
  - Did user fail reps last session? → repeat weight.
- **Plateau detection:** if same weight × same reps × 3 sessions → emit `PlateauDetected`, may trigger substitution.

Day-N LLM context (what's stuffed into every prompt):

```
SYSTEM PROMPT (always):
  - Tools whitelist
  - Output format rules
  - GoalAnchor (gravity, ~200 tokens)
  - Hard constraints

WORKING MEMORY (~1500 tokens):
  - CurrentTrainingBlock summary (week X of Y)
  - Today's planned session
  - PreCheckin (energy, soreness)
  - Last 7 days digest (1 line per day)

EPISODIC (on demand, tool call):
  - "How did last leg day feel?" → query timeline, return raw

SEMANTIC (auto-injected if matching):
  - "User prefers DB over barbell" — only if relevant
```

---

### Phase 6: Adaptation events (anytime)

These events can fire any day, any session, on user signal:

| Event | Trigger | Side effect |
|---|---|---|
| `ExerciseSubstituted` | User can't / won't do exercise | LLM proposes, validator approves, event emitted |
| `SessionSkipped` | User taps "skip today" | TimelineProjection records gap, no streak break (per your spec) |
| `LowEnergyReported` | Pre-check-in energy ≤3 | Volume cut 20-30% applied deterministically |
| `InjuryReported` | User adds injury during check-in | Locks affected muscle groups; substitutions auto-applied for remainder of block |
| `MotivationDipReported` | User flags via check-in | Triggers LLM to write a personalized note referencing their `why` |

---

### Phase 7: Re-plan triggers (background watcher)

A deterministic watcher runs after every `SessionCompleted` or `SessionSkipped`:

| Condition | Result |
|---|---|
| 4-week block complete | Emit `ReplanProposed { reason: block_end }` |
| Adherence < 50% over 7d | Emit `ReplanProposed { reason: low_adherence }` |
| 3 weeks same weight on key lift | Emit `ReplanProposed { reason: plateau }` |
| User taps "this isn't working" | Emit `ReplanProposed { reason: user_request }` |
| Goal changed | Emit `ReplanForced { reason: goal_change }` |

When user accepts a re-plan → Phase 3 runs again with current state. Old plan archived (not deleted — events are immutable). New plan starts a new `TrainingBlock`.

---

## Part 3 — State Management

Three distinct layers. Each layer has a clear job.

### Layer 1: UI State (React Context)
Only ephemeral things. Survives a screen mount, NOT an app close.

- Current screen, modal open/closed
- Form input intermediate state
- Animations
- "Confirm skip" boolean
- Toast messages

**Lives in:** `FitnessUIContext` (renamed from current FitnessContext).
**Never persists. Never authoritative.**

### Layer 2: Persisted State (SQLite via Drizzle)

The truth. Two tables, two responsibilities.

```sql
events
  id, seq, type, occurred_at, payload (JSON), schema_version, prev_hash
  → append-only, never mutated

projections
  name (PK), last_seq, state (JSON), updated_at
  → cache; recomputable from events
```

**Read pattern:**
1. App opens → load all projections into in-memory map.
2. UI components use `useLiveQuery(projections)` from Drizzle → auto re-render on change.

**Write pattern (transactional):**
```ts
await db.transaction(async (tx) => {
  await tx.insert(events).values(event);
  await tx.update(projections).set({ state: nextState, last_seq: event.seq });
});
```

Single SQLite transaction = either both succeed or both fail. Event log can't diverge from projections.

**Authoritative.** If the projections cache is ever wrong, drop it and rebuild from events.

### Layer 3: LLM Context (built per call, never stored)

Built fresh for every LLM call. Composed of:

- **Anchor block:** GoalAnchor (immutable for the call duration)
- **Working block:** last 7 days digest + today's checkin + current block position
- **Episodic block:** retrieved on demand (when LLM calls a `recall_*` tool)
- **Semantic block:** auto-injected if facts match the task

After the LLM call, context is discarded. The *result* (event emitted) is what persists.

---

## Part 4 — Per-Day Context: How "today" feeds tomorrow and the end goal

This is the heart of your question. How does each day stay coherent with all other days?

### Daily session context — what gets saved per day

Every day, after `SessionCompleted` (or `SessionSkipped`), the system writes:

1. **Raw events** (always) — every set, every substitution, every checkin signal.
2. **Day summary** (LLM-generated 1–2 sentences) — emitted as `SessionSummaryGenerated`.
3. **Updated projections:**
   - `TimelineProjection` — append today's entry: `{ date, sessionId, status, summary, key_signals }`
   - `StreakStats` — incremented
   - `AdherenceStats` — recomputed
   - `ExerciseHistoryProjection` — last weights/reps per exercise updated

### How each day feeds the NEXT day

When tomorrow's session is generated, the LLM sees:

```
LAST 7 DAYS DIGEST:
  Day -6 (Mon): Push, 4/4 exercises, energy 7, swapped OHP→landmine
  Day -5 (Tue): Skipped (travel)
  Day -4 (Wed): Pull, 4/4, energy 8, PR on deadlift
  ...
  Day -1 (Sun): Rest
  TODAY: Push planned, checkin: energy 6, soreness low

PROGRESSION FLAGS:
  - Bench: hit 8x3 last 2 sessions → ready for +2.5kg
  - Deadlift: missed reps last session → repeat
```

Tomorrow's session is generated *against* yesterday's reality. Not against the abstract plan.

### How days accumulate toward the end goal — the compression hierarchy

The trick is hierarchical projections that summarize as data ages:

```
Day 1-7         Raw timeline (every set, every event)
Day 8-30        Raw timeline kept; weekly digests generated (LLM, 1 paragraph/week)
Day 31-90       Monthly themes generated; weekly digests; last 7 days raw
Day 91-180      Quarterly summary; monthly themes; last week raw
Day 180+        "Training arc" generated; quarterly summaries; etc.
```

Each level is a separate projection. Raw events never deleted. LLM context for "what's tomorrow" pulls:

```
GOAL ANCHOR (always)            → ~200 tokens
CURRENT BLOCK (week X of Y)     → ~150 tokens
LAST 7 DAYS DIGEST              → ~500 tokens
THIS WEEK'S THEME (LLM-summed)  → ~100 tokens
RELEVANT MONTHLY THEMES         → ~200 tokens
TODAY'S CHECKIN                 → ~100 tokens
                                  ────────
                                  ~1250 tokens, fits easily in any model
```

**The end goal stays in context because:**
1. `GoalAnchor` is pinned in **every** prompt — system message, first thing the LLM sees.
2. `CurrentTrainingBlock` tells the LLM "we're in week 3 of 4 of the hypertrophy block aimed at your goal."
3. Validators reject any LLM output that contradicts the goal type (e.g., suggesting endurance work when goal is strength).

**The day never goes out of context because:**
- Raw events live forever — you can always reconstruct "what happened on Day 47."
- Embeddings later (sqlite-vec) make this queryable: "find sessions where I felt similar to today."

### Worked example: how Day 90's session "knows" about Day 1

User on Day 90, opening the app. LLM call for today's session sees:

- **GoalAnchor:** "Build muscle. Why: 'I want to feel strong.' Target: 2026-12-15."
- **Training arc** (LLM-generated, refreshed monthly):
  > "User started untrained, completed 3 hypertrophy blocks. Strong adherence (78%). Two short travel gaps (week 4, week 9). Pressing has progressed steadily; squat slowed in block 2 due to knee sensitivity, resolved by substituting hack squat."
- **Last month's theme:**
  > "Volume push block. Bench +10kg, deadlift +15kg. Right shoulder briefly aggravated week 11, fully recovered."
- **Last 7 days digest:** raw recent context.
- **Today's checkin:** today's signal.

That's the trick. Day 1 isn't in the prompt as raw events. It's been distilled into the training arc. But you can always *retrieve* it via the `recallEpisode` tool if the LLM needs the detail.

---

## Part 5 — What's locked, what's open

### Locked (build on these)
- Event-sourced, append-only timeline
- Two SQLite tables: events + projections
- Drizzle ORM + Zod
- Hybrid Groq + Gemini 3 Flash, structured outputs only
- DIY agent loop (no framework)
- Tool whitelist (5–8 tools)
- GoalAnchor pinned in every prompt
- Three-layer state model (UI / SQLite / LLM context)
- Hierarchical projections for long-range coherence

### Still open (need answers before v1.1)
- Exact list of tools (currently 8 placeholders in ARCHITECTURE.md)
- Semantic fact lifecycle (decay, contradiction)
- Cold-start: what does the LLM see on Day 0 when the user hasn't picked a goal yet?
- Embedding model choice (when episodic memory kicks in)
- Migration path to on-device LLM
- Notification system (workout reminders)
- Multi-device sync (probably "no" forever, but state the policy)

### Explicitly NOT in v1
- Cloud user accounts, social features
- Wearable integration
- Form-check CV
- Nutrition
- Sleep tracking

---

## Sources used in this finalization

- [Groq Free Tier 2026: 30 RPM, 6K TPM, 14.4K Req/Day](https://tokenmix.ai/blog/groq-free-tier-limits-2026)
- [Groq Rate Limits Docs](https://console.groq.com/docs/rate-limits)
- [Gemini API Free Tier 2026: 1,500 Req/Day, 1M TPM](https://tokenmix.ai/blog/gemini-api-free-tier-limits)
- [Gemini Structured Outputs](https://ai.google.dev/gemini-api/docs/structured-output)
- [Free LLM APIs 2026: Every Provider Tested](https://tokenmix.ai/blog/free-llm-apis-2026-every-provider-free-tier-tested)
- [Drizzle ORM + Expo SQLite Setup](https://orm.drizzle.team/docs/connect-expo-sqlite)
- [Modern SQLite for React Native (Expo)](https://expo.dev/blog/modern-sqlite-for-react-native-apps)
- [sqlite-vec — vector search SQLite extension](https://github.com/asg017/sqlite-vec)
- [react-native-executorch (Software Mansion)](https://docs.swmansion.com/react-native-executorch/)
- [@1mt/rn-on-device-ai — Apple FM + Gemini Nano wrapper](https://github.com/1mt/rn-on-device-ai)
- [@react-native-ai/apple — Apple Foundation Models](https://github.com/deveix/react-native-apple-llm)
- [llama.rn — llama.cpp binding for React Native](https://github.com/mybigday/llama.rn)
- [Mastra vs LangGraph vs Vercel AI SDK: TypeScript Agents in 2026](https://particula.tech/blog/mastra-vs-langgraph-vs-vercel-ai-sdk-typescript-agents)
- [Langfuse free tier (50K observations/month)](https://langfuse.com/)
- [Helicone free tier (10K requests/month)](https://www.buildmvpfast.com/blog/llm-observability-stack-langfuse-helicone-portkey-2026)

---

# Part 6 — Red Team: weaknesses in the blueprint above

> Honest self-criticism. Each weakness is paired with a fix. If you ship the v1 above without these fixes, you'll hit walls.

### 🚩 Weakness 1: Gemini 3 Flash may not be smart enough for plan generation

**Problem:** Plan generation is multi-constraint reasoning (volume per muscle × recovery windows × equipment × injuries × progression curves × user preferences). Flash-tier models look fluent but are weak at this kind of structured reasoning. The output will *look* like a plan but violate basic training principles in subtle ways the validator won't catch ("includes 12 sets of bench in one week" is caught; "imbalanced push:pull ratio across the block" is not).

**Fix:** Do constraint satisfaction in **code first**, give the LLM a near-finished skeleton.
- Deterministic planner outputs: `{ split: 'PPL', daysPerWeek, mesocycleTemplate, exerciseSlots: [...] }`
- LLM only fills exercise names from a filtered library + writes the rationale.
- This collapses "LLM reasons about everything" into "LLM picks 3 valid names per slot."
- A second pass (using same Gemini call) acts as a critic, checking for 5 specific issues.

### 🚩 Weakness 2: Hierarchical projections are hand-waved

**Problem:** The original blueprint says "weekly digests generated" but never says by what, when, or how.

**Fix:** Specify the compression pipeline:
- After every `SessionCompleted` → deterministic counter checks: `(sessionsThisWeek === 7) ? emit_weekly_digest_task : noop`
- Digest generation happens **inline** on the next app open, NOT as a background job (Expo + background jobs is a known pain).
- Each digest is itself an event: `WeeklyDigestGenerated`, `MonthlyThemeGenerated`, `BlockReviewGenerated`, `TrainingArcGenerated`.
- Digests are deterministic projections of LLM output → stored, never re-run.
- This makes the compression hierarchy fully append-only and replay-safe.

### 🚩 Weakness 3: Cold start is unsolved

**Problem:** Day 0, the user just installed. No events. No projections. No anchor history. The LLM call for the first plan has nothing to ground on except the form they just filled.

**Fix:** **Day 0 mode** — explicit, separate from steady state:
- The first plan is generated from a **deterministic template library** (3 splits × 3 experience levels × 2 goal types = 18 templates).
- LLM's only job on Day 0 is to write the rationale ("here's why this plan, based on what you told me").
- The user sees a plan within ~3 seconds, even if Gemini is slow.
- LLM enriches, never invents, on Day 0.
- After 14 days of events, the LLM is allowed to generate plans from scratch on re-plan triggers.

### 🚩 Weakness 4: No graceful degradation when LLM is unavailable

**Problem:** Free tiers throttle. Networks fail. The blueprint quietly assumes the LLM works.

**Fix:** Every LLM tool has a **deterministic fallback**:

| Tool | LLM-first behavior | Deterministic fallback |
|---|---|---|
| `generateInitialPlan` | Template + LLM rationale | Template-only (no rationale) |
| `generateTodaysSession` | LLM-styled session | Plan's prescribed session, unchanged |
| `proposeSubstitution` | LLM picks from filtered list | Rule-based: pick from substitution graph, same primary muscle |
| `summarizeSession` | LLM 1-paragraph | Extractive: list of exercises + sets done |
| `extractFactsFromCheckin` | LLM-extracted facts | Skip — accept that no facts extracted today |

The app must be **fully usable offline** with degraded but coherent behavior. This is also the spec for the eventual on-device migration.

### 🚩 Weakness 5: Progression algorithm hand-waved

**Problem:** "If user hit top of rep range → +2.5kg" is a toy heuristic. Real strength training uses **RPE-based autoregulation** (research shows it equals or beats fixed-load programming in the majority of studies).

**Fix:** Adopt **RPE/RIR (Reps in Reserve)** as the progression substrate:
- Plan prescribes: `3 sets × 5 reps @ RPE 8` instead of `3×5 @ 100kg`
- User logs: weight used + actual RPE
- Progression rules (deterministic):
  - If avg RPE ≤ 7 for 2 sessions on the same exercise → suggest +2.5kg next session
  - If avg RPE ≥ 9 for 2 sessions → repeat weight, examine fatigue
  - If user fails to hit prescribed reps → next session = same weight, RPE target -1
- This makes the system robust to fatigue/sleep/stress without an LLM call.

### 🚩 Weakness 6: No prompt caching = burning free tier

**Problem:** Every LLM call rebuilds the system prompt + tools whitelist + GoalAnchor from scratch. These three blocks are ~80% identical across calls. We're paying tokens we don't have to pay.

**Fix (REVISED 2026-06-07 after fact-check):** Gemini's context caching is **NOT available on the free tier** — it's a paid-tier feature only. Updated plan:
- **v1 on free tier:** accept full-token cost per call. The math still works because Gemini free tier gives us 250K TPM and 1,500 RPD; we use ~2,000 tokens × 6 calls/day per user = 12K tokens/day per user — comfortably under limits even without caching.
- **When we go paid:** enable Gemini context caching. 90% input cost savings + cached tokens cost ~10% of base. Single config change in the `LLMClient`.
- **Alternative interim option:** Anthropic Claude Haiku supports prompt caching even on its paid pay-as-you-go entry tier (no monthly commit). Worth considering for a hybrid: Claude Haiku for high-frequency cached calls, Groq/Gemini for everything else.
- **Groq:** no caching available as of 2026-06; doesn't matter — we already use it only for cheap fast calls.

### 🚩 Weakness 7: Free tier RPD limits could hit ceiling

**Problem:** A user doing 3 substitutions + 5 check-ins + 1 session-gen + 1 summary = 10 calls/day. Multiply by user count, you hit Groq's 1000 RPD before user #100.

**Fix:** Tiered fallback chain inside `LLMClient`:
1. Try **Groq** first (fastest, cheapest).
2. On 429 or 5xx → try **Cerebras** (1M tokens/day free, similar Llama models).
3. On Cerebras fail → try **Gemini 3 Flash** for the same prompt.
4. On all-cloud fail → use deterministic fallback (Weakness 4 fix).

The interface stays the same; the client handles routing. Single point of swap.

### 🚩 Weakness 8: No evaluation strategy

**Problem:** How do you know the system is working over 6 months? "Vibes" isn't enough.

**Fix:** Codify the 8 test scenarios in `ARCHITECTURE.md` §9 as **automated replay tests**:
- Each scenario = a list of synthetic events injected into a fresh event log.
- Run projections, assert expected state.
- Run LLM calls with frozen seed, assert output passes validator.
- This is unit testing for event-sourced systems and costs almost nothing to run.

### 🚩 Weakness 9: Embeddings deferred — but long-range coherence depends on them

**Problem:** The blueprint said "embeddings later." But the "Day 90 recalls Day 12" promise requires retrieval that hierarchical compression can't provide on its own.

**Fix:** Bring embeddings into v1 — they're now cheap enough.
- Model: **all-MiniLM-L6-v2 quantized to ~6MB via ONNX**.
- Embed on `SessionSummaryGenerated` (one embedding per day = trivial).
- Storage: **sqlite-vec** extension (single SQLite file, no service).
- Retrieval: **hybrid BM25 (SQLite FTS5) + vector + RRF** — research shows hybrid gives 15-30% better recall than either alone.
- This is the *minimum* viable RAG and it adds maybe 8MB to app size.

### 🚩 Weakness 10: Day boundaries vague

**Problem:** When does "today" become "yesterday"? Timezones? 2am check-ins? Users who work nights?

**Fix:** Explicit **training-day boundary**:
- User configures their day-rollover hour during onboarding (default: 4am local time).
- All session/projection logic uses `trainingDayOf(timestamp, rolloverHour)` not raw calendar date.
- Stored as `trainingDay: YYYY-MM-DD` in event payloads.
- Solves jet lag, night shifts, and "is this still Tuesday's workout?" edge cases.

---

# Part 7 — Revised Context Architecture (research-driven)

The hierarchical-projections approach in Part 4 was right but under-specified. Here's the locked-in architecture, informed by 2026 research (LightMem, HiMem, hybrid FTS5+vector patterns).

## Three memory tiers (LightMem-style)

```
┌──────────────────────────────────────────────────────────────┐
│  STM — Short-Term Memory (in-prompt, rebuilt every call)     │
│  • GoalAnchor (pinned, immutable per session)                │
│  • Today's check-in                                          │
│  • Last 7 raw-day digests                                    │
│  • Current training block week info                          │
│  Budget: ~1,500 tokens                                       │
└──────────────────────────────────────────────────────────────┘
                            ▲
                  retrieves │
                            │
┌──────────────────────────────────────────────────────────────┐
│  MTM — Mid-Term Memory (projections, queried)                │
│  • WeeklyDigest (1 paragraph/week)                           │
│  • MonthlyTheme (1 paragraph/month)                          │
│  • BlockReview (1 paragraph/training block)                  │
│  • SessionSummaries (1 paragraph/session, embedded)          │
│  Budget: ~variable, retrieved on tool call                   │
└──────────────────────────────────────────────────────────────┘
                            ▲
                  derives   │
                            │
┌──────────────────────────────────────────────────────────────┐
│  LTM — Long-Term Memory (semantic facts + raw events)        │
│  • Semantic facts: { key, value, evidence_event_ids[] }      │
│    e.g., "User prefers DB over barbell"                       │
│  • Raw event log (the canonical truth, never compressed)     │
│  • Embeddings index (sqlite-vec)                             │
│  • Keyword index (SQLite FTS5)                               │
└──────────────────────────────────────────────────────────────┘
```

## Retrieval algorithm: hybrid BM25 + vector + RRF

When the LLM calls `recallEpisode(query)`:

```
1. BM25 search:    SQLite FTS5 query on session summaries
                   → ranked list of summary_ids
2. Vector search:  sqlite-vec cosine similarity on embeddings
                   → ranked list of summary_ids
3. RRF merge:      score(id) = sum_over_retrievers( 1 / (k + rank_in_retriever) )
                   k = 60 (standard)
                   → final ranked list
4. Top 3-5 hits → injected into next LLM call
```

The RRF formula is one line and gives 15–30% recall improvement over either retriever alone. Source: confirmed in production by multiple 2026 case studies (ZeroClaw, hybrid-search references).

## Compression cadence (locked)

| Trigger | Output | Mechanism |
|---|---|---|
| `SessionCompleted` | `SessionSummaryGenerated` (1 paragraph) + embedding row | LLM if available, extractive fallback |
| Every 7 `SessionCompleted` | `WeeklyDigestGenerated` (1 paragraph) | LLM |
| `TrainingBlockEnded` | `BlockReviewGenerated` (1 paragraph) | LLM |
| Every 4 `WeeklyDigestGenerated` | `MonthlyThemeGenerated` (1 paragraph) | LLM |
| Every 3 months active | `TrainingArcUpdated` (1 paragraph) | LLM |

All are events. All are append-only. All are computed inline on app open (no background jobs).

## Prompt caching strategy

Every prompt has this shape:

```
[REUSABLE PREFIX — designed to be cache-friendly]
  system instructions      ~400 tokens
  tool definitions         ~600 tokens
  GoalAnchor               ~200 tokens
[VARIABLE BODY]
  STM block                ~1500 tokens
  task-specific input      ~200 tokens
```

**v1 (free tier):** No caching — Gemini free tier doesn't support context caching. The architecture still **designs the prompt to be cache-friendly** (stable prefix, variable suffix) so that flipping the switch when we go paid is one config change.

**Paid tier (when ready):** Gemini context caching → 90% discount on cached tokens, latency drops from ~2s to ~600ms.

**Free tier reality:** Gemini gives us 250K TPM / 1,500 RPD. At ~2,000 tokens × 6 calls/day per user = 12K tokens/day per user. We have ~15× headroom before TPM matters and ~20× before RPD matters. Caching is a "later optimization," not a v1 blocker.

---

# Part 8 — Lightweight Algorithms & Models Toolkit

What to use so the app stays small (<60MB total) and snappy.

## Embedding model — locked

**`all-MiniLM-L6-v2` (ONNX, quantized INT8)**
- Size: ~6MB quantized (22MB FP32)
- Output: 384-dim vectors
- Speed: ~10-30ms per embedding on modern phones
- Quality: industry workhorse, used everywhere
- Runtime: `onnxruntime-react-native` or ExecuTorch
- License: Apache 2.0

Alternative if size matters MORE than quality: **Model2Vec** distilled models — ~1MB but lower recall.

## Keyword index — locked

**SQLite FTS5 (built into expo-sqlite)**
- Size: 0 (built in)
- Algorithm: BM25 with porter stemming
- Speed: sub-millisecond on session summaries
- Zero setup beyond `CREATE VIRTUAL TABLE … USING fts5(...)`

## Vector index — locked

**sqlite-vec extension**
- Size: ~500KB native
- Algorithm: brute-force cosine + linear scan (fine for our scale)
- 1 year of daily sessions = 365 rows; brute force is instant
- Single-file deployment, no service

## Retrieval algorithm — locked

**Reciprocal Rank Fusion (RRF), k=60**
- Implementation: 10 lines of TypeScript
- No tuning required, robust across query types
- Combines BM25 + vector results

## Progression algorithm — locked

**RPE-based autoregulation**
- Plan prescribes RPE/RIR target, not weight
- Deterministic progression rules update prescribed weight based on logged RPE
- Validated by 2020 systematic review (Greig et al.): equal or superior to fixed-load in majority of studies
- Implementation: pure functions over `ExerciseHistoryProjection`

## Substitution algorithm — locked

**Static substitution graph + filter**
- Hand-built directed graph: `Exercise → [valid substitutes]`
- Filter by: equipment available, injury locks, current session's other exercises
- LLM picks the final choice from the filtered set (or deterministic top-1 in fallback)
- Maybe 200-400 exercises × 5-10 subs each in the static graph (small JSON)

## Day boundary — locked

`trainingDayOf(timestamp, rolloverHour)` — pure function
- Configurable per user (default 4am)
- Stored as `trainingDay: 'YYYY-MM-DD'` in every event
- Solves timezone, night shift, late-night logging

## Hash chain (event integrity) — locked

Each event has `prev_hash = sha256(prev_event.id + prev_event.payload)`.
- Detects tampering / corruption
- Allows clean replay verification
- Built-in JS, no library

---

# Part 9 — What changed since v1 of this blueprint

| Decision | v1 | v2 (now) | Why |
|---|---|---|---|
| Plan generation | LLM-first | Deterministic skeleton + LLM stylizer | Flash too weak for unconstrained planning |
| Compression jobs | "happen somewhere" | Inline on app open after counter trigger | Expo background jobs are painful |
| Cold start | hand-waved | Explicit Day 0 mode w/ template library | First impression matters |
| LLM failure | hand-waved | Tiered fallback chain + deterministic fallbacks | Free tiers throttle |
| Progression | "+2.5kg if top of range" | RPE-based autoregulation | Research-backed |
| Caching | not mentioned | Gemini context caching for static prefix | 90% cost / 85% latency saved |
| Embeddings | "later" | In v1, all-MiniLM-L6-v2 quantized | Long-range coherence needs them |
| Retrieval | "embeddings only later" | Hybrid FTS5 + vector + RRF in v1 | 15-30% recall gain, cheap |
| Day boundary | implicit calendar day | Configurable rollover hour | Real users have edge cases |
| Evaluation | none | 8 scenarios as automated replay tests | Otherwise you ship blind |

---

# Part 10 — App size budget

Total target: **< 60 MB** (excluding JS bundle which Expo handles).

| Component | Size |
|---|---|
| Expo SDK 54 base runtime | ~25 MB |
| expo-sqlite + Drizzle | ~2 MB |
| sqlite-vec native | ~0.5 MB |
| all-MiniLM-L6-v2 INT8 ONNX | ~6 MB |
| onnxruntime-react-native | ~10 MB |
| Static exercise library + sub graph | <1 MB |
| Static plan templates | <0.5 MB |
| App code (JS) | ~3 MB |
| **Subtotal** | **~48 MB** |
| Buffer | ~12 MB |

This stays under typical 100 MB cellular download warnings on iOS and Android. If we eventually add on-device LLM (Llama 3.2 1B ~1.5 GB), it becomes an **optional opt-in download** post-install, not bundled.

---

# Additional sources (Part 6–10)

- [LightMem: Lightweight and Efficient Memory-Augmented Generation](https://arxiv.org/pdf/2510.18866)
- [HiMem: Hierarchical Long-Term Memory for LLM Long-Horizon Agents](https://arxiv.org/pdf/2601.06377)
- [H-MEM: Hierarchical Memory for Long-Term Reasoning (ACL 2026)](https://aclanthology.org/2026.eacl-long.15/)
- [Lightweight LLM Agent Memory with Small Language Models](https://arxiv.org/abs/2604.07798)
- [Practical Guide to Memory for Autonomous LLM Agents (TDS)](https://towardsdatascience.com/a-practical-guide-to-memory-for-autonomous-llm-agents/)
- [AI Agent Memory Architecture for Production (Pockit)](https://pockit.tools/blog/ai-agent-memory-architecture-production-guide/)
- [Prompt Caching with OpenAI, Anthropic, and Google (PromptHub)](https://www.prompthub.us/blog/prompt-caching-with-openai-anthropic-and-google-models)
- [Prompt Caching in 2026: Anthropic, OpenAI, Azure Compared](https://technspire.com/en/blog/prompt-caching-2026-real-cost-wins)
- [Gemini Context Caching Guide](https://www.marketingscoop.com/ai/gemini-context-caching-how-prompt-reuse-lowers-cost-and-when-explicit-caches-are-worth-it/)
- [Anthropic Prompt Caching Announcement](https://www.anthropic.com/news/prompt-caching)
- [Hybrid Search: SQLite FTS5 + Vector + RRF](https://ceaksan.com/en/hybrid-search-fts5-vector-rrf)
- [Hybrid Memory: SQLite + FTS5 + Vectors beats Dedicated Vector DBs](https://zeroclaws.io/blog/zeroclaw-sqlite-fts5-vector-hybrid-memory-explained/)
- [Hybrid Local Memory: BM25 + Vectors + sqlite-vec](https://www.clawsetup.co.uk/articles/hybrid-local-memory-openclaw-bm25-vectors-sqlite-vec-local-embeddings/)
- [Sentence-Embeddings-Android: MiniLM, BGE, Model2Vec via ONNX](https://github.com/shubham0204/Sentence-Embeddings-Android)
- [Best Open-Source Embedding Models 2026 (BentoML)](https://www.bentoml.com/blog/a-guide-to-open-source-embedding-models)
- [ONNX Model in React Native — Setup Guide](https://simplico.net/2026/01/21/how-to-use-an-onnx-model-in-react-native-and-other-mobile-app-frameworks/)
- [RPE & Autoregulation in Strength Training](https://www.stephgaudreau.com/rpe-autoregulation/)
- [Auto-Regulation vs Fixed-Loading (Systematic Review, NCBI)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7994759/)
- [Understanding Progressive Overload (rpe.training)](https://rpe.training/guides/understanding-progressive-overload/)

---

# Part 11 — Re-analysis after filling ARCHITECTURE.md

> Done after sections 0–8 of ARCHITECTURE.md were filled. Goal: stress-test the amendments and catch new contradictions.

## ✅ What holds up

- **Event sourcing model** — the 32-event catalog reads as exhaustive without being silly. The 8 domain groups map cleanly to the lifecycle.
- **Tool count of 10** — over the "5-8" guideline but each tool is distinct, has a deterministic fallback, and has a clear "when it fires" rule. Acceptable.
- **`recallEpisode` as a non-LLM tool** — clean. The LLM can invoke it; the implementation is pure local retrieval (FTS5 + sqlite-vec + RRF). No tension.
- **Deterministic fallbacks** — every tool has one. The app works fully offline. This is the strongest single design decision in the system.
- **GoalAnchor ~250 tokens** — fits comfortably in any model's first-1K-tokens region. Will be the cacheable prefix when we go paid.
- **15 invariants, all enforceable in code.** No vibes-based rules.
- **RPE autoregulation displaces `suggestProgression`** — one fewer LLM tool, more reliability. Cleanest single win from the red-team round.

## 🔧 What needs refinement (action items)

### Refinement 1: Gemini context caching unavailable on free tier (already fixed above)
**Status:** BLUEPRINT updated. The prompt structure is still designed cache-friendly, but caching is a paid-tier flip-switch, not a v1 saving. Math still pencils — Gemini free tier has 20× headroom on RPD without caching.

### Refinement 2: LLM meta events can consolidate
**Issue:** `LLMSuggestionAccepted` + `LLMSuggestionRejected` overlap with `LLMCallObserved`. Three events when one with a `status` field would do.
**Proposal:** keep `LLMCallObserved` only; add `outcome: 'accepted' | 'rejected_user' | 'rejected_validator' | 'rejected_safety' | 'fallback_used'` to its payload. Drops the catalog from 32 → 30.
**Impact:** small but it's the "don't add events when fields will do" principle. **Do this before any code.**

### Refinement 3: Stacked digest generation at week/month boundaries
**Issue:** On Day 28, completing the 4th week of the block could trigger both `WeeklyDigestGenerated` AND `MonthlyThemeGenerated` inline. Two LLM calls during the completion-screen render = bad UX (3–5s spinner).
**Proposal:** session-completion path emits the day summary inline. Larger digests (weekly, monthly, block, arc) are queued as `pendingCompaction` flags on the projections table. Next app open, before showing Home, run any pending compactions in sequence with a brief progress indicator ("syncing your week...").
**Impact:** keeps SessionCompleted latency low. Adds a tiny background-task abstraction.

### Refinement 4: `recallEpisode` naming
**Issue:** Listing it next to LLM tools is slightly confusing. It's an *agent action* the LLM can call but it never calls an LLM itself.
**Proposal:** add a footnote / tag in ARCHITECTURE.md §3 making clear which tools are "LLM-backed" vs "deterministic". Currently 9 LLM-backed + 1 deterministic (`recallEpisode`).
**Impact:** documentation clarity only. No code change.

### Refinement 5: Streaming responses
**Issue:** Generating today's session takes 1–3 seconds against the cloud. We currently show a spinner. Streaming the opening note token-by-token would feel snappier.
**Proposal:** **defer to v1.1.** Both Groq and Gemini support streaming, and Vercel AI SDK could help here. Not a blocker for v1.

### Refinement 6: Day-0 mode has implicit dependency
**Issue:** Day 0 template mode means the LLM is only used for rationale. But `craftPlan`'s schema requires the LLM to fill exercise names from templates too. On Day 0 we're saying "only generate rationale" but the schema implies more.
**Proposal:** `craftPlan` gains a `mode: 'rationale_only' | 'full'`. Day 0 calls with `rationale_only` and the schema enforces only the `rationale` field is filled. Day 14+ calls with `full`.
**Impact:** small schema adjustment. Worth doing before code.

## 🚨 New risks surfaced

1. **Latency stacking** at week/month/block boundaries. Refinement 3 addresses it.
2. **Validator quality is the moat.** With LLM constrained to filling skeleton, the deterministic validator becomes the quality gate. If validators are weak, garbage flows. **Validator design = hidden critical path.**
3. **Day-0–14 may feel "templatey" to users.** No personalization for 2 weeks could erode trust. Counter-narrative for marketing/onboarding: "first 2 weeks we're learning your patterns; week 3 onward your coach personalizes."

## ✅ Decision: locked & ready

After re-analysis, the architecture is implementation-ready with these adjustments folded in:
- LLM events consolidated to 1 type with status field (32 → 30 events)
- Compaction queue for stacked digests
- `craftPlan.mode` flag for Day 0–14 vs full
- Caching deferred to paid tier; prompt structure designed cache-friendly
- Document `recallEpisode` as deterministic tool

**Nothing else blocks implementation.** Next step: build the first vertical slice (TypeScript migration + Drizzle setup + first event types).

---

# Additional source (Part 11)
- [Gemini API Pricing: Free Tier + Caching (May 2026)](https://findskill.ai/blog/gemini-api-pricing-guide/) — confirms caching not on free tier
