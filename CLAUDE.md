# CLAUDE.md

**FitMVP — event-sourced personalized fitness coach (React Native + Expo SDK 54, TypeScript strict).**

Read this file first. Then read the design docs listed below. Do **not** write code until you understand where the project is and confirm the next step with the user.

## Vision

Not templates. An adaptive coach that keeps the user's goal in context for months, adapts sessions to skipped days / low energy / injury, and eventually runs its LLM tools on-device. Currently cloud LLM (Groq + Gemini free tier). Single-user, local-first, no cloud sync in v1.

## Where the design lives (read these, don't ask the user to explain)

- `ARCHITECTURE.md` — the spec.
  - §1 principles, §2 events (31 types), §3 tools (10; LLM-backed vs deterministic marked), §4 projections, §5 GoalAnchor, §6 memory tiers, §7 state machine, §8 invariants (15), §10 hard questions, §12–15 failure modes / cost / privacy / migration
  - **§9 Scenario F (long-dormancy re-entry) is drafted** from the founder's own framing, marked draft pending review. **Scenarios A–E, G, H and §11 are still empty** — user input pending; don't invent them.
- `BLUEPRINT.md` — tech stack, lifecycle walkthrough, **Part 6 red-team**, **Part 7 revised context architecture (LightMem tiers + FTS5 + sqlite-vec + RRF)**, **Part 8 locked lightweight algorithms**, Part 10 size budget, **Part 11 re-analysis** after filling ARCHITECTURE.

Recommended first read: CLAUDE.md → ARCHITECTURE §1–§8 + §10 → BLUEPRINT Parts 6–11. Around 15K tokens total.

## Current build state (as of 2026-09-26)

Vertical-slice build in progress. **Steps 1–6 done and verified on Android.
Steps 7a + 7c code-complete. Revalidated and hardened 2026-09-26 — five
blockers found and fixed.**

⚠ **The app has never been run on a phone by anyone.** Every claim below is
typechecker-and-`checks/`-deep. `npm run check` → 27 suites, `tsc` exit 0,
36 files uncommitted.

| Step | Status | What landed |
|---|---|---|
| 1 | ✓ | TypeScript strict migration of every screen/component/context |
| 2 | ✓ | Persistence: expo-sqlite + Drizzle ORM + Zod; migrations gated on boot |
| 3 | ✓ | Event types (`UserContextCreated`, `UserContextUpdated`) with ulid + sha256 chain |
| 4 | ✓ | Event log (`appendEvent`, `readEvents`, `verifyChain`) with promise-chain write lock |
| 5 | ✓ | Onboarding migrated to events; `RootNavigator` gates initial route on `isOnboarded` |
| 6 | ✓ | Goal flow migrated to events; both survive restart |
| 7a | 🔵 | **Session as events** — all 10 session events in `src/events/session.ts`; `sessions` + `streak` projections; `src/session/{scheduler,commands,summary}.ts`; new `CheckinScreen` + set-logging `ExerciseLogCard`; legacy `useState` session state deleted. `tsc` clean, 43 replay/schema assertions pass. **Not yet run on device.** |
| 7c | 🔵 | **Survive a real gym** (from the lifter teardown, 2026-09-21). Per-set RPE in half-steps (6–10); warmup sets with their own index space; `ExerciseHistory` projection driving a `last: 102.5 × 8 @ 8` line + weight/reps prefill + one-tap confirm; rest timer w/ auto-start; `KeyboardAvoidingView`; 3-day streak bar replaced by trailing-4-week adherence ("17 of your last 20"). 62 assertions pass. **Not yet run on device.** |
| 7b | ⏳ | **Abandoned + resume** — AppState ≥4h detection, trainingDay-rollover auto-skip, emit `SessionResumed`. Plus `AdherenceStats`, `Last7DaysTimeline`, `ExerciseHistory` projections (Step 8's `summarizeSession` needs them). |
| 8+ | ⏳ | **LLM layer** — `LLMClient` interface, DIY agent loop, Groq + Gemini providers, first tool (`summarizeSession` recommended — smallest, no complex validator). Its deterministic fallback already exists in `src/session/summary.ts`; Step 8 puts the LLM call in front of it. |

The next step needs a user check-in. Ask before starting.

### Decisions taken 2026-09-24 (after a lifter teardown, a returner teardown, a strategy review and a design review)

- **Game:** personal tool for the founder first. Not a business, not yet an indie launch.
- **Audience:** deliberately uncapped — "anyone into any kind of fitness". Consequence accepted: the **coach layer must not assume sets/reps**, so other disciplines are additive later. v1 logging stays resistance-training only.
- **Coach posture:** *observational* — the user drives, the app notices and speaks rarely. Never directive, never gamified.
- **Success:** someone says "this gets me", and a user who loses their streak can still continue.
- **Cut from v1** (specs retained, see BLUEPRINT Part 5 → "Deferred out of v1"): hybrid retrieval stack, semantic-fact lifecycle, digest tiers 2–4, provider fallback chain, Step 7b abandoned-detection, on-device LLM.
- **UI direction:** full rebuild — dark-first, typographic, generous space, one accent used sparingly. **Kill the iOS-Settings idiom** (grouped cards, caps headers, hairlines). Never gamify: a game punishes you for missing, and the lapse is the one moment you cannot afford to punish.
- **Next build (after the founder trains on it):** `reentryPolicy()` + the return-after-a-lapse screen. Every input already exists in the event log.
- **Open, undecided:** whether to route LLM calls through OpenRouter. If yes, ARCHITECTURE §14 must be rewritten — it currently promises prompts go only to Groq/Google, and a gateway adds a hop.

## ⚠ The failure mode this project keeps hitting (2026-09-25)

**Modules were built, tested, reported as done — and never imported.** An audit found `src/program/` (selectSplit, getParameters, resolveSession), `buildWarmup`/`buildCooldown`, `findSubstitutesTiered` and `selectRotationIndex` all had **zero consumers**. The live session path was still `getTodaysWorkout(equipment, index % 3)`. Every claim about splits, goal-based volume and rotation-on-completion was true of the code and false of the app.

**Before reporting anything as landed, grep for its consumers.** A passing test proves a function works; it does not prove anything calls it.

Now wired (verified): `commands.ts` uses `selectRotationIndex` (completions only) and `buildSessionDraft` builds from the 743-exercise library by movement-pattern slot.

**Also: `\b` in a regex does not match before `s`.** Cost three separate bugs — `climber\b` vs "Climbers", `dip\b` vs "Dips", `glute bridge` vs "Butt Lift (Bridge)". Spot-check named examples, never just counts.

## Pre-test hardening (2026-09-26) — before handing the APK to testers

The engine was wired to its call site but **starved of its inputs**: `commandCtx()`
never passed `goal`, `experience`, `daysPerWeek` or `sessionMaxMinutes`, so
`selectSplit(4, null, null, …)` handed **every single user Upper/Lower 4-day**
regardless of what they answered. Five test personas produced one session; they
now produce five. *Grep for the consumer AND check its arguments.*

Fixed in the same pass (found by a code-reading audit agent, each verified):

- **Goal screen dead end** — onboarding `reset`s the stack to `[Goal]`, then Goal called `goBack()`, a no-op. 100% of testers tapped Save and nothing happened; tapping again appended a duplicate `GoalCreated`. Now resets to Home.
- **Home users with no pull-up bar were permanently bricked.** The scheduler tested `owned.includes('pullup bar')` — a value **not in `OwnedEquipmentEnum`**, so always false. PULL day yielded zero exercises, `checkInAndSchedule` threw, and since **rotation advances on completion only**, they could never get past it. Skipping did not help. Added the enum value + the onboarding option, and `buildSessionDraft` now **falls back to full-body slots when a day is unfillable** and renames the day honestly. Verified: 0 empty sessions across 3,600 home configs (was 4 bricked cohorts).
- **"0 of 16" on first launch** — empty log ⇒ `firstDay = null` ⇒ 28-day denominator. A new user was told they'd missed 16 sessions before installing.
- **Blank set logged as 0 kg × 0 reps** — tapping ✓ on an empty row counted as a working set and made `selectExerciseHistory` read `max(weight)=0`, which progression treats as bodyweight, so that lift never got a load suggestion again. A rep count is now required.
- **Phantom session after a failed check-in** — `PreCheckinRecorded` was appended *before* `buildSessionDraft` could throw, parking an unfinishable stub for the rest of the day. Build first, write after.
- **Overnight staleness** — `todaysSession` was derived from `new Date()` inside a `useMemo` keyed on the projection, so the 4am rollover never invalidated it. Android keeps RN apps alive for days; a tester saw "Done for today" with a dead button. `dayTick` state + `AppState` listener + 60s interval now drive every date-derived read.
- **`ReturnHome` promised "already set to 85% load" and it was false** — `scaleLoad` had zero callers; only sets were scaled. Suggestions are now re-entry aware.
- **Terminal error screens** — the integrity and migration-failure screens had no button at all, and `ErrorBoundary` showed a raw stack with no reset. All three now have human copy and a `Share` report (RN core — no new dependency). `ErrorBoundary` has "Try again".
- **Workout screen could spin forever** if the 4am rollover landed mid-session; now has copy and an escape.
- **Onboarding answers were frozen for life** — `Onboarding` is only reachable while `isOnboarded` is false, so equipment/injuries/days/experience could never change. New **`SetupScreen`** (reachable from Home) appends `UserContextUpdated`; the reducer gained `equipment` and `constraints.sessionMaxMinutes`.
- **Tester feedback layer**: `src/dev/digest.ts` → a compact shareable text dump of the whole log (not raw JSON: 4 weeks is ~100KB, Android's share sheet truncates it, and the raw log carries free-text the tester didn't agree to hand over). `src/constants/build.ts` `APP_BUILD` is stamped on Home and every error report — **bump it on every build you hand out**.
- **`eas.json` + `android.package` + `versionCode`** added. `versionCode` must increment per build or Android refuses the install.

**Reverted a "fix" that was actually the design:** a skip does NOT reset the streak
(BLUEPRINT Phase 6). `longest === totalCompleted` always, and that is correct — this
app refuses to punish the lapse. The *display* was wrong; Completion's third tile is
now "Sets today" instead of a duplicate number.

## Six-reviewer revalidation + Tier 0–2 fixes (2026-09-26)

Six independent reviewers (product, architecture, code/bugs, security,
UX, simplicity) read the tree with no priming and no shared conclusions.
Report: `https://claude.ai/artifact/B1Hg4Lgu6fYQm14rrt5SGx`

**Almost every serious finding was one bug written five ways: a body-part
string crossing a module boundary with no shared vocabulary.** `MuscleGroup`
was `string`, so the compiler could see none of it — and in four cases the app
*narrated* the thing it had not done.

### THE RULE THAT CAME OUT OF IT
**Grep for consumers of the exported symbol, then trace it to a pixel.**
`buildWarmup` has a consumer. It has no pixel. The previous rule ("grep for
its consumers") was applied at *file* granularity, where nothing is orphaned;
at *export* granularity 19 functions had zero consumers.

**Second rule, earned twice:** anything that decides whether a write or a
submit is accepted goes in a module with **no React and no DB import**.
`tsx` cannot transform `react-native`, so validation living inside
`FitnessContext.tsx` or `commands.ts` is untestable — which is exactly how the
onboarding dead end survived 14 green suites. Hence `src/onboarding/form.ts`
and `src/session/plausibility.ts`.

### Tier 0 — the five blockers
- [x] **`src/data/muscles.ts` — one closed-union vocabulary.** `MUSCLES` (17,
  verified exactly exhaustive over `exercises.json`), `BODY_AREAS` mapping area
  words → real muscles, and `SORENESS_AREAS` / `INJURY_AREAS` as the only lists
  a screen may offer. `MuscleGroup` is no longer `string`.
  Soreness chips that act: **2 of 6 → 6 of 6.** Injury chips that filter:
  **4 of 7 → 7 of 7** (knee 196, elbow 333, hip 220 exercises). Joints map
  narrowly on purpose — knee → quadriceps only, so a bad knee removes squats
  and leg extensions but leaves 547 exercises including 42 hinge movements.
- [x] **Onboarding was impassable.** No age field on screen, form seeded
  `age: ''`, `Number('') === 0` failed `> 0`, and `isValid` omitted age so
  Continue was *enabled*. Every tester hit red "Invalid age" under a form with
  no age field. `age` had exactly one consumer: the check rejecting it. Widened
  the schema to optional (no version bump) rather than fabricating a number,
  and the button now asks `validateOnboardingForm` so it cannot diverge again.
- [x] **The app no longer narrates what it did not do.** "Still sore in places,
  so those sets are trimmed" came out of `resolveSession` off raw input. Only
  the scheduler — the only thing that knows — speaks now, and it counts:
  *"2 exercises left out and 1 cut back where you said you were sore."* On an
  upper day with sore legs it changes nothing and **says nothing**. Also
  deleted resolve's "the weights are 10% lighter" promise, whose `loadScale`
  no caller reads.
- [~] **`allowBackup`** — see the corrected security audit above. Blocked on 6.1.
- [x] **Two bugs my own fixes surfaced,** both found by enumeration not reasoning:
  un-deadening `legs` meant `legs @ level 3` on leg day dropped all six
  exercises → empty session → throw → unskippable (rotation advances on
  completion only). **116 of 12,480 combinations.** Fixed twice: `resolveSession`
  now asks *"is most of TODAY's work sore?"* (a raw count is the wrong shape —
  sore arms on leg day is not a recovery day; a wrecked lower body is), plus a
  scheduler backstop refilling from what is not sore. **0 empty across 12,480.**
  And `RECOVERY: ['core','hip_isolation','core']` did not match its own copy
  ("light full-body movement").

### Tier 1 — the core loop
- [x] **Exercise churn — the one that killed week two.** `jitter(id, salt)` was
  salted with `rotationIndex`, so the tiebreak moved every session. Worse, the
  recency term did `score -= 40` for anything recently trained — the **opposite
  of its own comment** ("novelty is penalised on purpose") — and was never
  passed anyway. Jitter is now session-invariant, the term rewards continuity
  (`known.has(id) → +45`), and it is wired via a new `selectKnownExerciseIds`.
  **13 distinct exercises over 12 weeks → 6.**
- [x] **Progression freeze — and a fix of mine that was wrong.** I floored
  `loadStep` at 2.5 kg; four existing tests failed and **they were right**.
  Returning 0 below 50 kg is deliberate: 2.5 kg on a 20 kg press is 12.5%. The
  real bug was `add_reps` having no ceiling and no way back to load, so a light
  lift climbed to 26 reps under a 6–12 rep programme — **half of double
  progression with the other half missing**. Implemented the missing half:
  climb to target+3, then one loadable step, reset the reps.
  Separately `PLATE_STEP_KG = 1.25` was documented as "a pair of micro-plates"
  and applied as a **total**, producing unloadable 31.25 / 36.25 / 48.75 kg
  suggestions → now `MIN_LOADABLE_STEP_KG = 2.5`.
  12 weeks at RPE 7: **9 frozen lifts → 0; all 12 gained.**
- [x] **The lapse screen.** `speak` fired at an absolute 4 days and the screen
  *replaces* Home — so a Mon/Thu trainer met it every Monday, cut off from
  goal, setup and preview. Now relative to their own rhythm (`> 2× normal
  spacing` **and** `≥ 5 days`). The fake choice is real: "I feel fine — full
  session" passes `ignoreReentry` and `checkInAndSchedule` honours it.
  "Something's changed" → **Setup**, not Goal. Killed *"you trained 1 times"*
  and the *"You'd hit 0 of your last 12"* line (adherence is now measured to
  the last completed day, not through the gap).
- [x] **Logging.** Typing into a logged set showed no keystrokes (`value` pinned
  to the stored number while `onChangeText` fed an invisible draft). Re-tapping
  ✓ — the obvious undo gesture — silently overwrote a real set with the
  prefill. Both fixed via a dirty check. A 1000 kg typo is refused at the
  command layer (`plausibility.ts`); without it two such sets produce *"you've
  got more. Try 1002.5kg"* forever, since there is no correction path.

### Tier 2 — durability
- [x] **Silent amnesia closed.** `readEvents` skip-and-counts unreadable rows
  instead of throwing, enters read-only mode, and surfaces the count through
  `logHealth` to a red banner on Home and into the digest. The old path logged
  to console, left every projection at `INITIAL_*`, and the navigator sent the
  user to **Onboarding** — a brand-new app with the history intact on disk —
  where they re-onboarded on top of it. It never presented as an error.
- [x] **Upcaster registry** (`src/events/upcast.ts`). ARCHITECTURE §15 specified
  it; the directory never existed. Every schema pins `schemaVersion:
  z.literal(N)`, so bumping N broke every historical row of that type.
  `rowToEvent` now upcasts the payload **and** the version before parsing, so
  the literal still matches and no schema changed. `checks/upcast.ts` fails if
  any type can reach its current version without a complete chain from v1 — a
  bump without its upcaster is a red test, not a forgotten user.
- [x] **Per-tap replay** — see D.1.
- [x] **`checks/reachability.ts` — the check this project kept needing.**
  Builds the real import graph from the entry points a user can reach (App.tsx
  + every screen and component), so transitive reachability is computed rather
  than grepped one hop. Flags any exported symbol no reachable module names,
  against a dated `KNOWN_ORPHANS` list — keeping dead code is now a decision,
  not an accident. It also runs a **pixel test** for the "computed and thrown
  away" class a consumer-grep cannot see.
  Two of my own mistakes it caught: the first version's consumer scan ignored
  `checks/`, so 29 Zod schemas looked dead; and the first pixel test matched
  bare tokens, so `warmupCount` in ExerciseLogCard made `draft.warmup` read as
  *rendered*. Both false. Corrected: all six NO-PIXEL items confirmed.
  It found one genuine orphan I had not spotted — `rawSqlite`, whose comment
  claims it is "for migration runner + advanced ops" while `useMigrations`
  takes `db`.
- [x] **`checks/` is in the repo, behind `npm run check`** (`tsc --noEmit &&
  ./checks/run.sh`). **27 suites**, and until 2026-09-29 zero new
  dependencies — `tsx` was already transitive. These were throwaway scratchpad scripts twice and were lost
  twice. New suites this pass: `onboarding`, `exercise_stability`,
  `progression_advances`, `reentry_rhythm`, `logging_guards`, `backup`,
  `upcast`, `fold_cost`, `soreness_never_empties`.

### Still open before/during the test

Ranked by what a tester actually hits.

1. ~~Warm-up and cool-down computed and thrown away~~ — **RENDERED 2026-09-29.**
2. ~~`reasons[1..]`, `dropped` and `split.warning` never displayed~~ —
   **RENDERED 2026-09-29.** See "The prescription reaches the screen" below.
3. **No exercise instructions on screen.** `exerciseInstructions.json` is
   **607 KB bundled and unreachable** (`getInstructions` has zero consumers).
   A beginner is handed "Thigh Abductor" with no affordance but Google.
4. **No history screen.** Eight routes, none of them a log. A four-week
   tester's only way to see what they did is the share sheet or the backup file.
5. **No mid-session swap** (2.5). The rack is taken and there is no path —
   `findSubstitutesTiered` exists, is tested, has zero consumers. Skip is one
   irreversible tap that disappears after the first set.
6. **`targetRpe` and `params.restSec` are computed and never rendered** — the
   last two NO-PIXEL items (`checks/reachability.ts` tracks the set). The timer
   is hardcoded to 150 s for everyone; a fat-loss user whose whole programme is
   density gets 2:30 rests, and a "rough day" check-in lowers `maxRpe` to 7
   without telling anyone.
7. ~~**The unlock gate punishes the ideal client.**~~ **FIXED 2026-09-29** —
   see "The unlock gate + the card" below. (Original finding kept for the
   reasoning:) `recovery` (weight 12) needs
   soreness in 4 separate weeks, `friction` (9) needs a bad week *and* a skip,
   `trend` (13) needs 4 lifts whose weight changed. Measured: never sore +
   never misses = **54**; bodyweight at home = **50**; both = **41**. Gate is
   60. The metric rewards being sore, inconsistent, and owning a barbell.
   **Two reviewers independently said the four-week unlock should not ship**
   at all, since `unlocked` flipping true changes an eyebrow label and one
   sentence and nothing else exists behind it.
8. ~~**The hash chain is bypassable in O(1).**~~ **FIXED 2026-09-29** — see
   the hash-chain section below.
9. **Clock/timezone movement.** `trainingDayOf` uses local calendar fields, so
   flying west produces "Today's session is already complete" with no override.
   A forward jump fires the emotional re-entry screen at someone who trained
   yesterday. The 4am rollover landing mid-session still orphans an `active`
   session permanently — its logged sets become invisible to every consumer.
10. **~380 lines + 607 KB of dead code**, and three event types
    (`GoalRevised`, `SessionResumed`, `ExerciseSubstituted`) with full schemas,
    reducers and union membership that **no code path can emit**.
11. **36 files uncommitted.** Every line of the last two weeks is untagged.
12. **No kill switch.** `eas.json` declares a `preview` channel but
    `expo-updates` is not installed, so it does nothing. If a build bricks a
    tester you hand-send a new APK and hope they install it.
13. `getTodaysWorkout` in `src/constants/workouts.ts` is dead and still
    contains a `throw` inside render. `Equipment` and `motivationalMessages`
    are its only live exports; move them and delete the rest.

## The prescription reaches the screen (2026-09-29)

`buildSessionDraft` returned `warmup`, `cooldown`, `dropped` and `reasons` on
every check-in. `checkInAndSchedule` forwarded five fields and dropped those
four, and `SessionScheduledPayloadSchema` had nowhere to put them — so 137
warm-up movements, every dropped-slot explanation and every reason past the
first were computed ~25 times per workout and discarded **at the write
boundary**. No user had ever seen one. This is the class of bug a
consumer-grep cannot see, which is why `checks/reachability.ts` runs a pixel
test: `buildWarmup` always had a consumer; it had no pixel.

**Four additive-optional payload fields**, so no schemaVersion bump and every
pre-2026-09-29 event still parses: `warmup`, `cooldown`, `dropped`, `reasons`.
`commands.ts` forwards them, the projection carries them.

**Home** now renders every reason under "WHY TODAY LOOKS LIKE THIS" and a
"LEFT OUT TODAY" section. The estimate includes the warm-up minutes. A novice
who picks six days finally reads the thing the engine has been writing all
along: *"You said six days. Starting there almost never lasts — three sessions
you actually do beat six you abandon."*

**Workout** gets a PREP block at the top (dynamic only, with the reason stated
so nobody stretches first) and COOL DOWN at the bottom once there is something
to cool down from, each tickable. **Ticks are local state on purpose** — a
within-session convenience is not worth an event type, and putting UI state in
the log makes it un-replayable.

`DROP_REASON` lives in `src/constants/copy.ts`, not in both screens. I wrote it
twice first, with a comment claiming it was in one place — the exact failure
this codebase keeps producing. `Record<DroppedSlot['reason'], string>` makes
the compiler demand copy for any new reason.

Pixel test: **6 of 6 NO PIXEL → 2** (`targetRpe`, `restSec` remain).
`checks/prescription_survives.ts` asserts the whole path.

## Mandatory end-of-session review (2026-09-29)

**Why it exists.** The engine prescribes volume and load from rules and has
never once been told whether the result was any good. RPE says how hard a SET
felt; nothing said whether the SESSION was the right session. That judgement is
the only thing six testers can give that no amount of engineering can derive.

**How it is enforced.** `completeSession(ctx, sessionId, review)` throws
`review_required` without one. The session therefore stays `active` until the
review is submitted — so:

- Home offers "Resume Workout" if a tester quits at the review, rather than
  losing the workout.
- **The rotation does not advance**, because it advances on completion only.
  That is correct: the day is not done.
- Workout's "Done" navigates to `Review`; it no longer completes anything.
- `Review` has `headerLeft: () => null`, `gestureEnabled: false`, and traps the
  Android back button with an explanation rather than swallowing it.

**Schema shape.** `review` is OPTIONAL on `SessionCompletedPayload` and
REQUIRED by the command layer. Optional because a required field would narrow
the schema — a version bump plus an upcaster for all history. Required in
`commands.ts` because that is where invariants live, and because
`ctx.requireReview: false` can relax it after the test without touching a
single historical event. The dev seeder writes events directly and is
unaffected.

**What it asks** — one required tap, everything else optional, because a review
that takes effort in a gym with sweaty hands is a review that gets abandoned,
and abandoning it leaves the session unfinished:
1. **Too easy / About right / Too much** (required — the calibration signal)
2. Gripes, multi-select: wrong exercises · too long · too short · something
   hurt · didn't have the kit · confusing
3. Free text, ≤1000 chars

**Where it surfaces.** `src/dev/digest.ts` leads with a verdict tally and a
gripe histogram, then per session the verdict, gripes and the tester's own
words. A review nobody reads is not a review. `checks/review_gate.ts` asserts
the whole path.

## The unlock gate + the card, fixed 2026-09-29

Three facets required the user to supply BAD NEWS, so the app told its best
client that after a month it still did not know them well enough to talk:

| client | was | now |
|---|---|---|
| sore sometimes, misses sometimes, barbell | 63 | 70 ✓ |
| never sore, never misses, barbell | **54** ✗ | 67 ✓ |
| bodyweight at home, never sore | **50** ✗ | 67 ✓ |
| bodyweight, never sore, never misses | **41** ✗ | 67 ✓ |

- `recovery` (12) counted weeks **in which you were sore**; it now counts weeks
  **observed**. Four weeks of honest "nothing hurts" IS the information — the
  app learned how this person recovers.
- `friction` (9) required a rough day AND a skip, docking consistency 9 points.
  Either still completes it faster; their absence no longer blocks it.
- `trend` (13) compared `weight_kg`, which is 0 forever for a bodyweight user —
  unreachable by construction. Bodyweight progress is now read in **reps**.

The gate still means something: two weeks does not unlock however diligent, and
the 75 ceiling holds. `checks/unlock_fairness.ts`.

**The card no longer promises a conversation.** `unlocked` flipping true
changed an eyebrow to "YOUR COACH IS READY" and nothing else — there is no LLM,
no chat, nothing behind the flag. Promising it was the same overclaim
`completeness.ts` was written to avoid, moved one level up. The eyebrow is now
"WHAT I'VE WORKED OUT", the four-week countdown copy is gone, and the weekly
reveal pays out from week one. The invitation returns when Phase 8 can honour
it.

## The hash chain, fixed 2026-09-29

`hashEvent` was `sha256(id + JSON.stringify(payload))`. Two holes, both
verified by execution before and after:

1. **The envelope was unprotected.** `seq`, `type`, `occurredAt`,
   `trainingDay` and `schemaVersion` all sat outside the hash. `trainingDay`
   is the most load-bearing field in the system — adherence, gap detection,
   the weekday signal, the rotation and `sessionIdByDay` all read it — and
   rewriting it in the database passed `verifyChain()` clean. So did changing
   an event's `type`.
2. **It was not a chain.** Event N's hash excluded N's own `prevHash`, so
   forging event 5 required patching exactly ONE field on event 6 rather than
   recomputing 6..N. Tampering was O(1) to hide, not O(N).

Now: `sha256(prevHash ∥ id ∥ type ∥ occurredAt ∥ trainingDay ∥ schemaVersion ∥
canonicalJson(payload))`, NUL-separated. `canonicalJson` sorts keys
recursively, so the hash is a function of content rather than of insertion
order — `JSON.stringify` round-tripped only by accident of the storage path,
and an upcaster that rebuilds a payload would have broken it.

`checks/schema.ts` asserts all of it: each envelope field's tampering is
detected, the one-field forgery is detected, a full tail rewrite is what it
now takes, and key order does not move the hash.

**⚠ EVERY HASH CHANGED.** Any pre-existing database fails `verifyChain` and
lands in read-only mode with the recovery screen. That is acceptable exactly
once and this was the moment — the app has never run on a device, so no real
log exists anywhere. **Wipe any dev database** (dev panel → wipe, or delete
and reinstall). Doing this after a tester had four weeks of data would have
needed an upcaster for the chain itself.

**On the "no threat model" objection** — three reviewers agreed there is no
adversary here (single user, local DB, no sync) and split on fix-vs-delete.
Fixed rather than deleted because what it actually detects is **corruption**,
not attack: a half-written WAL after a crash, a restored-from-backup `.db`
with an inconsistent `-wal` triple, a bad row from a future migration. Those
are real on a phone. A chain that silently accepts a rewritten `trainingDay`
detects none of them, which is worse than having none at all — it reports
health it cannot see.

## How the app gets onto a tester's phone (current stage)

Persona/onboarding studies are **parked**. The delivery path below is what
matters at this stage: each tester runs the real build on their own Android
phone, unattended, for several weeks.

### Why not Expo Go
Expo Go needs Metro running on the developer's laptop, is SDK-locked (Play
Store Expo Go is SDK 57; this project is 54), and the app dies the moment the
laptop closes. It is fine for a 20-minute sit-down; it cannot carry a
multi-week unattended test. Use a standalone APK.

### One-time setup (done)
- `eas.json` — `preview` profile, `distribution: internal`, `buildType: apk`
- `app.json` — `android.package: com.prajwal3112.fitmvp`, `android.versionCode`
- `src/constants/build.ts` — `APP_BUILD`, shown on Home and stamped on every
  error report

### Per build
1. Bump **both** `app.json → expo.android.versionCode` (integer, +1) and
   `src/constants/build.ts → APP_BUILD`. Android refuses to install an APK
   whose `versionCode` is not higher than the installed one; and a bug report
   without a build string cannot be placed against a commit.
2. `npx tsc --noEmit` → expect exit 0.
3. `eas build -p android --profile preview` (needs `eas-cli` and an Expo
   account; the first run asks about a keystore — let EAS manage it, and do
   not change it later or updates stop installing over the old app).
4. EAS returns an install link. Send that link.

### What a tester does
- Open the link on the phone, allow install-from-unknown-source once, install.
- **Do not uninstall, and do not "Clear data".** The SQLite log lives in the
  app sandbox; either action is total, silent, unrecoverable loss. Installing
  a *newer* build over the top preserves everything.
- Updates are a fresh link each time, not an in-app prompt — there is no OTA
  channel configured.

### What comes back
- **"Send my training data"** on Home → `src/dev/digest.ts` builds a compact
  text digest (setup, per-session prescribed-vs-logged, energy/soreness, skip
  reasons, context %) and hands it to the OS share sheet. Deliberately not raw
  JSON: four weeks is ~100 KB which Android truncates, nobody reads JSON in a
  chat thread, and the raw log carries free text the tester did not agree to
  hand over.
- Crash → `ErrorBoundary` shows human copy, "Try again", and a one-tap report.
- Migration failure / broken hash chain → their own screens, each with a
  report button.
- `Share` is React Native core, so none of this adds a dependency.

### Known limits of this path
- **iOS is not covered.** TestFlight needs a paid Apple Developer account.
  Android only for now.
- **The digest is not a restorable backup.** It cannot rebuild the event log.
- **No crash telemetry.** If someone hits a crash and does not tap the report
  button, nobody ever knows.
- **No notifications** — `expo-notifications` is not a dependency, so the app
  cannot contact anyone who stops opening it. Out-of-app contact is
  structurally impossible at this stage, not merely unbuilt.

## Audit findings (verified 2026-09-24, measured not asserted)

- **`projections` table is dead schema.** Declared in `src/db/schema.ts`, never read or written. BLUEPRINT Part 3's read/write description documents a system that was never built.
- **The refresh cost is a quadratic fold, NOT Zod.** Measured at 10,800 events: Zod 10.5ms (linear), `buildSessionsProjection` 408ms (quadratic). Cause is the object spread per event in `patch()` at `src/projections/sessions.ts:76-91`, plus `order.includes()`. Invisible today (~3ms at 14 sessions), unusable at ~4 years. ~20-line fix.
- **Invariants: 3 enforced, 3 partial, 9 unenforceable/N-A.** Guards live only in `commands.ts` and are bypassed by direct `appendEvent` — which `src/dev/seed.ts` does 1,587 times per preset.
- **14 of 31 specced event types exist.**
- **§12 read-only debug mode on chain break does not exist** — `App.tsx` only `console.log`s the verify result.
- **8 of 9 onboarding profile fields are inert.** Only `constraints.daysPerWeek` affects behaviour (the adherence denominator) and it is hardcoded to 4 — never asked.
- **RPE is behaviourally write-only.** Traced every consumer: stored, carried, rendered, averaged. Nothing reads it to make a decision.
- **`GoalAnchor` appears nowhere in the code**, despite "goal is gravity" being core principle #3.
- **Scheduler uses 3 of its inputs**: equipment, sessionIndex, energy(≤3). Soreness affects only the opening-note text. Never receives injuries, history, goal, or daysPerWeek.
- **Display names are primary keys.** `exerciseIdOf(name)` slugifies; renaming an exercise silently orphans its history. No collisions today; needs a stable registry before the library grows.
- **Home sessions never produce a summary highlight** — `summary.ts` filters `weight_kg > 0`.
- **Notifications are structurally impossible, not merely unbuilt** — `expo-notifications` is not a dependency.
- **The critical path is EMPTY.** `suggestLoad()` (~25 lines) and `reentryPolicy()` are both computable from data already in the log. The exercise library blocks a *different* set of features; notifications a third.

## Proposed task checklist (DRAFT — agreed 2026-09-24, not yet executed)

> Ordering rule: each phase must unblock the next. Nothing is built that can't be used.
> Test against: *does this get me to fifteen logged sessions of my own training, faster?*

**Phase 0 — Evidence. No code. Blocks everything.**
- [ ] 0.1 SDK 54 Expo Go APK on the Android phone
- [ ] 0.2 20-minute walkthrough using the dev panel presets; write a friction list
- [ ] 0.3 **Founder writes his own last 3 sessions + what happened the last time he stopped.** Still missing. This is the input that resolves the audience question, sizes the library, and gives the re-entry engine its first real test case

**Phase 1 — The two unblocked wins (nothing else needed for these).**
- [x] 1.0 `suggestLoad()` — RPE autoregulation. First consumer of RPE in the codebase; it was write-only before. `src/session/progression.ts`, 25 assertions passing. Wired into the logging card's prefill + a reason line
- [x] 1.1 `reentryPolicy()` + `selectGap()` + `ReturnHome` screen (ARCHITECTURE §9 Scenario F). Graded bands, skip-reason modifiers, session pre-lowered via `scaleSets`. 33 assertions. **All user-facing copy is PLACEHOLDER** pending the founder's own words after a real gap

**Phase 2 — Exercise knowledge.**
- [x] 2.0 **Stable exercise IDs** — library ids are permanent and opaque; `canonicalExerciseId()` translates the 24 legacy name-slugs on *read* (events stay immutable). Renaming no longer orphans history — use the database's own ids as permanent keys, display name as a separate mutable field; migrate the existing 24. Must happen BEFORE the import, not after
- [x] 2.1 Bundled `yuhonas/free-exercise-db` — 743 exercises (140 KB core + 539 KB instructions loaded lazily), incl. 4 hand-tagged conditioning entries the source omits (876 exercises, Unlicense/public domain, ~1MB) filtered to resistance training → 678. Static JSON, **not a runtime API** — the app is local-first and must work offline
- [x] 2.2 **Availability is driven by equipment OWNED, not a tier guess.** Only bodyweight (91 exercises) is universal; dumbbells take it to 215, a full home setup to 461, a gym to 743. Classifying dumbbells as part of a default 'home' tier had been offering equipment to people who own none
- [x] 2.3 Derived substitutions from `primaryMuscles` + `mechanic` + available equipment. **No hand-built graph needed** — this supersedes BLUEPRINT Part 8's "hand-built directed graph"
- [x] 2.4 **§8.7 injury locks + §8.8 equipment filter are now ENFORCED** in `buildSessionDraft` — verified across 30 tier×injury×rotation combinations with zero unsafe prescriptions. Unsafe exercises are substituted, or dropped if nothing safe exists. §8.6 volume-per-muscle still outstanding
- [ ] 2.5 Add / swap an exercise mid-session (user-initiated; the deterministic swaps above are scheduler-side)
- [x] 2.7 **Warm-up and cool-down** (`src/data/warmups.ts`, 137 movements). The strength import had discarded the source's 123 stretches and 14 cardio — all 16 muscle groups, 86 needing no equipment. **Dynamic movement before lifting, held stretches after**: static stretching immediately pre-session transiently reduces force output, so `buildWarmup()` returns dynamic only and will widen the net rather than fall back to static. `buildCooldown()` returns one stretch per muscle worked, so it isn't four hamstring stretches.
- [x] 2.6 **Soreness handled correctly**: a sore PRIMARY mover cannot be substituted away (every alternative trains the same muscle) so volume is cut instead — 30% at level 2, 50% at level 3. A sore SECONDARY mover is swapped around. Mild soreness (level 1) is left alone

**Phase 3 — UI remake (founder priority).**
- [ ] 3.1 Design tokens first: dark ground, type scale, spacing, one accent. No new assets needed
- [ ] 3.2 Home — answers one question, pre-decided, empty middle
- [ ] 3.3 Session/logging screen — one exercise at a time, 56pt tap targets
- [ ] 3.4 Check-in — three buckets, not ten dots. **Measured 2026-09-26: the
  ten dots have exactly two outcomes.** `energy` collapses to `≤3 rough` /
  `≥8 good` / else `ok`, and `feel: 'good'` is a no-op in all 30 goal ×
  experience combinations because `min(params.maxRpe, resolved.maxRpe)` where
  params is 8 or 9 and resolved is 9 or 10 — params always wins. Sessions at
  energy 4 and energy 10 are byte-identical. Either make 'good' do something
  or ship three buttons; do not keep asking a 10-point question to make a
  binary decision.
- [ ] 3.5 Completion / block review (the screenshot screen)

**Phase 4 — Make it a program.**
- [x] 4.8 **Day-of-week completion signal** (`selectWeekdayStats`, `selectScheduleAdvice`). The highest-value signal already in the log and read by nothing — `trainingDay` is on all 31 event types; nothing had ever bucketed by weekday. Produces *"You've missed Friday 4 of the last 4. Shall we make this a 2-day week? Same muscles, one less thing to feel bad about."* Deliberately conservative: needs ≥3 attempts on a day and a <34% completion rate before it says anything, and never suggests below 2 days.
- [x] 4.9 **ARCHITECTURE §12 read-only mode implemented.** A broken hash chain was a `console.log`. Now `appendEvent` refuses to write and the app shows a recovery screen — appending onto a corrupt chain buries the break under valid-looking rows. `enterReadOnlyMode()` / `isReadOnly()` in `events/log.ts`.
- [x] 4.10 Deleted `components/ExerciseCard.tsx` (0 consumers, superseded by `ExerciseLogCard`).
- [x] 4.11 **HomeScreen previews the real engine.** `getTodaysWorkout()` is dead; `FitnessContext.preview` runs `buildSessionDraft` with a neutral check-in, so the preview and the session cannot disagree.

**Security audit (2026-09-25) — one claim in it was WRONG, corrected 2026-09-26.**
No secrets in the repo; the only raw SQL is two static PRAGMAs (Drizzle
parameterises everything else); `.gitignore` covers `.env*` and `*.db*`; dev
tooling gated behind `__DEV__`; `wipeAllEvents` is unreachable in production.

~~**no network calls anywhere — nothing leaves the device**~~ — **true of the
code, false of the artifact.** `app.json` sets no `android.allowBackup`, and
the Expo config plugin defaults it to `true`, so the generated manifest gets
`android:allowBackup="true"` with no extraction rules and `fitmvp.db` sits
inside the default backup set. On any phone with Google backup on (the
default) the whole event log — bodyweight, injuries, per-session energy and
soreness, and BOTH free-text fields — is copied to that user's Google Drive.
ARCHITECTURE §14 is contradicted by the build.

The lesson: an audit of first-party code cannot conclude anything about the
artifact. Check the generated manifest and the config-plugin defaults.

**RESOLVED 2026-09-29.** A real export landed first, then
`android.allowBackup: false`. Order mattered: that accidental backup was the
only restore path in existence, so switching it off first would have made data
loss strictly more likely. Now nothing leaves the device and the user holds a
file they can restore from.
- [x] 4.5 **Engine wired into the live path.** `buildSessionDraft` now: `selectSplit` → `resolveSession` → `getParameters` → fills movement-pattern slots from the library, filtered by equipment owned / injuries / difficulty, with soreness and feel scaling volume. Warm-up and cool-down included. Five test personas now get five genuinely different sessions; previously a 58-year-old novice and a 19-year-old on a 6-day split got byte-identical workouts, and a man with a garage barbell got push-ups.
- [x] 4.6 **`staple: true` on 79 canonical lifts.** Inferring "is this the lift a coach would name" from the data failed three times — it produced Alternating Floor Press, then Jerk Dip Squat, then JM Press and Spell Caster. Name-length as a proxy backfired (canonical lifts have long descriptive names here; obscure ones are short). Declared instead. Non-staples remain for substitutions.
- [x] 4.7 Fixture rule: pull-ups/chin-ups/dips are filtered out for home users who haven't said they own a bar.
- [x] 4.0 **Split-selection engine** (`src/program/`), specced by a strength coach 2026-09-25. `selectSplit()` days×experience×goal×equipment; `getParameters()` reps/rest/volume/RPE per goal; `resolveSession()` with strict precedence. 55 assertions.
  - **⚠ THE RULE: the rotation advances on COMPLETION, never the calendar.** `selectRotationIndex()` counts completed sessions only — skips must not advance it. Getting this wrong decays the whole system the first week someone misses a session. `selectSessionIndex()` (completed **or** skipped) stays, but is only for the "Day N" label.
  - **Soreness is a volume modifier, never a session-type switch.** Sore chest on push day cuts chest volume; it does not become leg day. Swapping the day silently desynchronises frequency across muscle groups.
  - **3 days → full body, not PPL**, for everyone but advanced. Verified in test: PPL at 3 days is 1×/week on every major mover; full body is 3×. PPL-3 is popular because it's memorable, not because it works.
  - **"Good" days don't add volume**, they raise the RPE ceiling. Adding on good days and cutting on bad ones is a random walk with no progressive overload.
  - **Fat loss progresses density, not load.** In a deficit you get weaker; an app reading that as failure demoralises someone doing everything right. See `successFraming()`.
  - Guards: 36h recovery gate, 14-day drift guard (a starved muscle group forces its way back), recovery sessions suppressed under 6 total sessions (novices are sore everywhere for weeks — that's adaptation, not fatigue).
  - [x] **`pat` (movement pattern) tagged on all 743 exercises** — 19 patterns, zero unclassified, 23/23 spot-check. Derived offline from name + muscles + force + mechanic; it is NOT recoverable from source tags alone ("push + chest" can't separate horizontal from vertical pressing). Two regex bugs caught by spot-checking rather than counts: `\bclimber\b` can't match "Climbers", and "Butt Lift (Bridge)" doesn't contain "glute bridge".
  - [x] **Tiered substitution** (`findSubstitutesTiered`). "Same primary muscle" alone was too loose — bench → cable fly trains the same muscle and discards your load history. T1 same pattern ("your weights carry over") → T2 same muscle+class → T3 same muscle any class ("start lighter"). **Pain inverts it**: `reason:'pain'` penalises the matching pattern, because a hurting shoulder shouldn't be handed another press.
  - Gap noted: horizontal_pull, bicep, knee_isolation, chest_isolation and shoulder_isolation have **no bodyweight option** — a home user owning nothing cannot fill those slots. Needs bands, or those slots skip.
- [x] 4.1 **Onboarding rebuilt.** Now asks experience, realistic days/week (kills the hardcoded 4), where you train, what equipment you own, bodyweight, and multiple injuries. Every question changes something in session 1 — each has an on-screen line saying what
- [x] 4.2 **Starting-load estimation** (`src/session/startingLoad.ts`). Conservative bodyweight×pattern×experience ratios, floored at the empty bar (20kg), per-hand for dumbbell compounds, null for bodyweight work. Feeds `suggestLoad`'s no-history path as `kind: 'estimate'` with copy that admits it's a guess
- [ ] 4.3 Plateau detection (the deterministic rules from BLUEPRINT Part 8)
- [ ] 4.4 Bodyweight ladder by `level` ladder, since `weight_kg` is always 0 at home

**Phase 5 — The coach.**
- [x] 5.0 **Context completeness / AI unlock** (`src/context/completeness.ts`). Four weeks to unlock, with a percentage that is **computed from real data coverage, not elapsed time** — a bar that fills on a timer is a lie the user eventually catches, and catching it retroactively discredits everything else the app claims to know.
  - Eight facets, each with an actual test against the log, weighted **toward later weeks** (w1 15 · w2 18 · w3 20 · w4 22 = 75). Front-loading them made the bar saturate in week one with nothing left to reveal.
  - Measured curve on realistic 3×/week data: **28% → 64% → 69% → 75%**.
  - **Caps at 75%.** The last quarter is not observable from behaviour at all — why it matters to you, what your week is really like, why your back actually goes. That is the honest reason the conversation exists, and the reason the LLM's first job is extraction.
  - **Both gates must pass** to unlock: ≥4 weeks elapsed AND ≥60% coverage. Time alone lets someone unlock by waiting; coverage alone lets a 6×/week user unlock in nine days, before the app has seen a single bad week.
  - Bugs found by measuring rather than reasoning: weights were front-loaded; `trend` required a 2-week span inside a 5-deep history window that spans ~1.7 weeks, so it was unreachable by construction.
- [ ] 5.1 Notifications — max one a week, only when there's something true to say
- [ ] 5.2 LLM decision: write the sentences by hand first. If templates cover it, don't add it

**Phase 6 — Sharing (only after the founder has used it).**
- [x] 6.1 **Export event log as JSON — done 2026-09-29.**
  `src/dev/backup.ts` serialises the log and `parseBackup()` validates it
  completely before trusting it: envelope, every event's schema, gapless seq,
  and a full hash-chain recompute against the head recorded at export. 15
  assertions in `checks/backup.ts` cover round-trip, truncation, tampering,
  reordering and a dropped middle event. **1,200 events ≈ 558 KB**, which is
  far past what Android's share sheet carries as text — Android silently
  truncates it, and a truncated backup is worse than none because it looks
  like it worked.
  `src/dev/exportFile.ts` writes the file to `Paths.cache` (transient by
  design — the real copy is wherever the user puts it) and offers it to
  `shareAsync`. Reachable from Home: *"Save a backup of my training log"*,
  with the uninstall warning under it.
  **Deps added** (approved 2026-09-29): `expo-file-system ~19.0.24`,
  `expo-sharing ~14.0.8`. Both have **zero transitive dependencies** — no
  network or telemetry surface added; re-verified after install.
  **Restore is deliberately NOT implemented.** It would mean either refusing
  unless the log is empty (safe, useless on the phone that still holds the
  data) or merging two event-sourced histories, which needs conflict rules
  this project has not specified — and getting that wrong destroys the thing
  it protects. `parseBackup()` validates a file completely, so the format is
  ready whenever the rules are decided. Honest position: **the export protects
  against losing the PHONE, not against a corrupted log on a phone you hold.**
- [x] 6.2 EAS build config → `eas.json` preview profile, APK, internal
  distribution. Not yet run.

**Engineering debt — interleave, don't batch.**
- [~] D.1 **The per-tap replay is fixed; the cold fold is still quadratic.**
  `recordSet` now folds the single returned event forward via `applyOneEvent`
  instead of re-reading and replaying the log. Measured (`checks/fold_cost.ts`,
  desktop V8 — Hermes is 3–10× slower):

  | sessions | events | full replay | fold one event |
  |---|---|---|---|
  | 300 | 6,300 | 106 ms | 0.040 ms |
  | 600 | 12,600 | 482 ms | 0.075 ms |
  | 1,000 | 21,000 | 1,343 ms | 0.120 ms |

  A 25-set workout at 1,000 sessions: **33.6 s of blocked main thread → 3 ms.**
  Still open: `patch()` spreads `state.byId` per event, so `buildSessionsProjection`
  remains O(events × sessions). That now runs once at launch rather than after
  every tap. Fixing it properly means a mutable fold, which duplicates or
  rewrites a 200-line reducer whose only safety net is the replay checks —
  deliberately not attempted in the same pass as everything else.
  The `projections` table is still declared and never read; the architecture
  review argues it should be **deleted**, not built, since a cold fold after
  the above is ~50 ms and a checkpoint adds snapshot-versioning on top of
  event-versioning.
- [ ] D.2 SDK 54 → 57 upgrade (needed before anyone else can install it via Play-store Expo Go)

## Tech stack (locked in BLUEPRINT.md — do not swap without asking)

- **Runtime:** Expo SDK 54, React 19, TypeScript strict + `noUncheckedIndexedAccess`
- **Persistence:** expo-sqlite + Drizzle ORM + Zod. Single shared connection. WAL PRAGMA native only.
- **Events:** ulid ids, sha256 chain, `trainingDayOf(now, rolloverHour)` for day boundaries
- **LLM (planned):** Groq (fast/cheap: substitutions, summaries, check-in parsing) + Gemini 3 Flash (heavy: plan generation, re-plan) via a swappable `LLMClient` interface. Free tier for v1.
- **Retrieval (planned):** SQLite FTS5 + sqlite-vec + RRF (k=60), all-MiniLM-L6-v2 INT8 ONNX embeddings.
- **Progression:** RPE/RIR autoregulation, deterministic (research-backed).
- **No agent framework** — DIY loop, ~150 lines. LangGraph/Mastra/Vercel AI SDK are all Next.js-first.

## Working conventions (the user cares deeply)

1. **Verify per step.** Run `tsc --noEmit`, hand back to user to test on Android + web, wait for "it worked" before the next step. They have been burned by AI racing ahead.
2. **Ask real questions.** Use `AskUserQuestion` for real forks (provider, scope, UX direction). **Never fabricate consent from a task-notification** — those are system events, not user messages.
3. **Confirm destructive actions.** No `git reset --hard`, `rm -rf`, force-push, or wide npm churn without explicit go-ahead. The user wants visibility.
4. **Multi-AI split.** Claude (this) = architecture, integration, prompts, judgment calls. Codex = well-scoped implementation once the spec is locked. Do not lock the user into one AI.
5. **Explain before implementing.** Especially architectural work — give tradeoffs, propose, wait.
6. **Test on device.** User runs Metro themselves and pastes errors. Don't leave a dev server running in background past diagnosis — stop it after fixing so they restart fresh.
7. **No new markdown docs unless asked.** They dislike doc churn. Update existing docs; don't create new ones.

## Known gotchas (each cost time first-round)

- **`react-native-get-random-values`** must be imported at the very top of `index.js`, before anything that uses `ulid` (Hermes lacks `crypto.getRandomValues`).
- **`PRAGMA journal_mode = WAL` is web-fatal** — wrap in `if (Platform.OS !== 'web')` in `src/db/client.ts`.
- **Drizzle needs `babel-plugin-inline-import`** for `.sql` migration files. See `babel.config.js`. `metro.config.js` also does `sourceExts.push('sql')` + `assetExts.push('wasm')` (the second is required for expo-sqlite web worker).
- **Migrations must run before nav mounts** — `useMigrations` gate in `App.tsx`. Blank screen if you skip it.
- **~~`useState`-based session state in `FitnessContext`~~** — removed in Step 7a. `currentDay`/`streak`/`lastWeights` are now derived from the session + streak projections. Nothing session-related is in-memory any more.
- **`CompletionScreen`** now leads with the session's own extractive summary + highlights (Step 7a). Further enrichment still v1.1 backlog.
- **`SafeAreaView` deprecation warning** on RN — swap to `react-native-safe-area-context` (backlog).
- **Node is keg-only.** This machine runs Homebrew `node@22` (22.23.2) — Expo SDK 54 wants Node 20/22, and brew's unversioned `node` is 26.x. `~/.zshrc` exports `/opt/homebrew/opt/node@22/bin` onto PATH. If `node: command not found`, that line is why.
- **`npm install` rewrites `package-lock.json`** — npm 10 strips `libc` metadata npm 11+ writes for Linux-only optional deps. Cosmetic, no version changes; ignore the 12-line diff or commit it once.
- **Reducers must stay total.** Session reducers never throw on unknown/orphan events — a reducer that threw would make a bad historical event unreplayable. All guards live in `src/session/commands.ts`, which validates *before* appending.
- **No test runner is installed.** Steps 7a/7c were verified with throwaway scripts run through `node_modules/.bin/tsx` (a drizzle-kit transitive dep). They live in the session scratchpad, not the repo — if you want them kept, a real runner needs adding deliberately.
- **Widening a Zod constraint doesn't need a schemaVersion bump.** RPE went int → 0.5 steps and `isWarmup` was added as optional; every previously valid payload still parses, so no upcaster is needed. ARCHITECTURE §15's bump rule is about payload *shape* changes. Narrowing a constraint would need one.
- **Warmup sets have their own `setIndex` space.** Set identity is `(exerciseId, isWarmup, setIndex)`. Warmups never count toward prescribed volume, avg RPE, "exercises completed", or the §8.3 "≥1 set to finish" guard.
- **Onboarding never asks `daysPerWeek`** — it's hardcoded to 4 in `FitnessContext`, and trailing adherence uses it as the denominator. Ask for it before the adherence number is shown to anyone real.
- **Dev panel: long-press "Day N" on Home** (dev builds only). Seeds backdated history through the real validators + hash chain, so prefill/rotation/adherence/the return case are all testable in one sitting. `src/dev/seed.ts` + `src/screen/DevScreen.tsx`. Presets wipe first, and seed onboarding + goal too so you land in a working app.
- **Expo Go is SDK-locked.** Play Store Expo Go is on SDK 57; this project is SDK 54. Android can install the older APK (`https://expo.dev/go?sdkVersion=54&platform=android&device=true`) — **uninstall the newer one first**, Android refuses same-package downgrades. Turn off Play auto-update for it. An SDK 54→57 upgrade is a deliberate future step.
- **`SafeAreaView` must come from `react-native-safe-area-context`**, not `react-native` — the RN one is a no-op on Android, and `app.json` sets `edgeToEdgeEnabled: true`, so content renders under the status bar. `SafeAreaProvider` is mounted in `App.tsx`.
- **`MuscleGroup` is a closed union now, and body-part words go through
  `src/data/muscles.ts`.** Never write a body-part string literal in a screen.
  Five bugs came from exactly that, and the compiler could not see any of them
  while the type was `string`.
- **`tsx` cannot transform `react-native`.** Any module that imports RN — or
  reaches the DB, which imports expo-sqlite — is unreachable from `checks/`.
  Validation that gates a write or a submit must live in a pure module.
- **`expo-file-system` is installed but NOT resolvable from app code.** It is
  nested under `expo/node_modules` as a dep of `expo` itself. `require.resolve`
  fails. Anything needing it must `npx expo install` it properly first.
- **`checks/` scripts import by relative path (`../src/...`) with no `.ts`
  extension.** With the extension, `tsc` fails under
  `allowImportingTsExtensions: false`.
- **A new event type must be added to `CURRENT_VERSION` in
  `src/events/upcast.ts`.** `checks/upcast.ts` reads the union and fails if a
  type is missing, or if a bumped version has no upcaster chain from v1.
- **Adding an enum member is widening; narrowing one is not.** `'pullup bar'`
  and optional `age` needed no schemaVersion bump. A shape change does, and it
  now needs an upcaster in the same commit.
- **`expo-file-system` v19 uses the CLASS api**, not the old
  `FileSystem.writeAsStringAsync`: `new File(Paths.cache, name)`, `.create()`,
  `.write(text)`, `.uri`. The legacy functions are gone in SDK 54.
- **The rest timer is on-screen only.** A timer that fires with the app backgrounded needs `expo-notifications`, which isn't a dependency yet.

## What NOT to do

- Don't push to GitHub without asking. Repo: `https://github.com/Prajwal3112/FitMVP.git` (private). Local git identity is set per-repo (`prajwal3112 <prajwalkamble890@gmail.com>`) — do not overwrite globally.
- Don't inflate the LLM's role. Every LLM tool has a deterministic fallback. LLM stylizes and explains; deterministic code plans and validates.
- Don't skip Zod validation on event writes or reads. The hash chain and the schema union depend on it.
- Don't call Gemini caching APIs on free tier — paid only.
- Don't put session state back in `useState`. It is all event-derived as of Step 7a; anything new goes through `src/session/commands.ts`.
- Don't say the user approved something when they didn't. Read task-notifications carefully — they are never user consent.

## First turn on a new session

Something close to:

> "Read CLAUDE.md. State: Steps 1–6 verified on Android. 7a/7c code-complete.
> A six-reviewer revalidation on 2026-09-26 found five blockers, all fixed and
> verified (see that section) — the app is now passable end to end in logic,
> but **it has still never been run on a phone by anyone.**
> `npm run check` → 27 suites. Nothing is committed.
> Two decisions are waiting on you: (1) `expo-file-system` + `expo-sharing` for
> a restorable backup, which gates turning off the Google auto-backup of the
> event log; (2) whether the four-week AI unlock ships to testers at all — two
> reviewers said no, and the gate currently scores a flawless client 41/75.
> Highest-value unblocked work is rendering what the engine already computes
> and throws away: warm-ups, `dropped`, `reasons[1..]`, `targetRpe`.
> What should I take on?"

Then wait.

## Verify environment on a fresh clone

```bash
cd FitMVP
npm install
npm run check       # tsc --noEmit && ./checks/run.sh — expect: 27 passed, 0 failed
```

`npm run check` is the gate. It needs no test runner — `tsx` arrives as a
drizzle-kit transitive dep. What it does NOT cover: anything that renders. The
suites exercise pure logic and the form/validation seams; they cannot catch a
layout bug, and they only caught the onboarding dead end once the validation
was moved out of the React module.

If `node` isn't found, this machine's Node is keg-only — see the gotcha above, or reinstall with
`brew install node@22` (NOT plain `node`, which is 26.x and ahead of what Expo SDK 54 supports).

If `tsc` errors, the codebase drifted since this doc was written — investigate before assuming anything else. If clean, you're synced with what this doc describes.

## Keeping this doc alive

When you finish a step (or hit a sharp design decision), update this file **before** the session ends: bump the build-state table, add any new gotcha, note any convention the user reinforced. This is the only portable memory across hosts.
