# CLAUDE.md

**FitMVP — event-sourced personalized fitness coach (React Native + Expo SDK 54, TypeScript strict).**

Read this file first. Then read the design docs listed below. Do **not** write code until you understand where the project is and confirm the next step with the user.

## Vision

Not templates. An adaptive coach that keeps the user's goal in context for months, adapts sessions to skipped days / low energy / injury, and eventually runs its LLM tools on-device. Currently cloud LLM (Groq + Gemini free tier). Single-user, local-first, no cloud sync in v1.

## Where the design lives (read these, don't ask the user to explain)

- `ARCHITECTURE.md` — the spec.
  - §1 principles, §2 events (30 types), §3 tools (10; LLM-backed vs deterministic marked), §4 projections, §5 GoalAnchor, §6 memory tiers, §7 state machine, §8 invariants (15), §10 hard questions, §12–15 failure modes / cost / privacy / migration
  - **§9 (test scenarios) and §11 (cold-start narrative) are still empty** — user input pending; don't invent them.
- `BLUEPRINT.md` — tech stack, lifecycle walkthrough, **Part 6 red-team**, **Part 7 revised context architecture (LightMem tiers + FTS5 + sqlite-vec + RRF)**, **Part 8 locked lightweight algorithms**, Part 10 size budget, **Part 11 re-analysis** after filling ARCHITECTURE.

Recommended first read: CLAUDE.md → ARCHITECTURE §1–§8 + §10 → BLUEPRINT Parts 6–11. Around 15K tokens total.

## Current build state (as of 2026-09-16)

Vertical-slice build in progress. **Steps 1–6 done and verified on Android.**

| Step | Status | What landed |
|---|---|---|
| 1 | ✓ | TypeScript strict migration of every screen/component/context |
| 2 | ✓ | Persistence: expo-sqlite + Drizzle ORM + Zod; migrations gated on boot |
| 3 | ✓ | Event types (`UserContextCreated`, `UserContextUpdated`) with ulid + sha256 chain |
| 4 | ✓ | Event log (`appendEvent`, `readEvents`, `verifyChain`) with promise-chain write lock |
| 5 | ✓ | Onboarding migrated to events; `RootNavigator` gates initial route on `isOnboarded` |
| 6 | ✓ | Goal flow migrated to events; both survive restart |
| 7 | ⏳ | **Session as events** — `SessionScheduled`, `SessionStarted`, `PreCheckinRecorded`, `SetCompleted`, `ExerciseSubstituted`, `SessionCompleted`, `SessionSkipped`, `SessionSummaryGenerated`. Biggest event family. |
| 8+ | ⏳ | **LLM layer** — `LLMClient` interface, DIY agent loop, Groq + Gemini providers, first tool (`summarizeSession` recommended — smallest, no complex validator). |

The next step needs a user check-in. Ask before starting.

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
- **`useState`-based session state (`currentDay`, `streak`, `history`) in `FitnessContext` is legacy** — do not build on it. It gets replaced by session events in Step 7.
- **`CompletionScreen` needs enrichment** (user flagged 2026-06-07) — v1.1 backlog.
- **`SafeAreaView` deprecation warning** on RN — swap to `react-native-safe-area-context` (backlog).

## What NOT to do

- Don't push to GitHub without asking. Repo: `https://github.com/Prajwal3112/FitMVP.git` (private). Local git identity is set per-repo (`prajwal3112 <prajwalkamble890@gmail.com>`) — do not overwrite globally.
- Don't inflate the LLM's role. Every LLM tool has a deterministic fallback. LLM stylizes and explains; deterministic code plans and validates.
- Don't skip Zod validation on event writes or reads. The hash chain and the schema union depend on it.
- Don't call Gemini caching APIs on free tier — paid only.
- Don't extend `useState` session state — migrate the whole surface in Step 7.
- Don't say the user approved something when they didn't. Read task-notifications carefully — they are never user consent.

## First turn on a new session

Something close to:

> "Read CLAUDE.md. Current state: Steps 1–6 of the event-sourced build are done (Onboarding + Goal survive restart, verified on Android). Next candidates: Step 7 (session as events — the biggest event family) or the LLM scaffold (LLMClient + first tool). Which should I take on? Anything to redirect first?"

Then wait for the user before touching code.

## Verify environment on a fresh clone

```bash
cd FitMVP
npm install
npx tsc --noEmit    # expect: exit 0
```

If `tsc` errors, the codebase drifted since this doc was written — investigate before assuming anything else. If clean, you're synced with what this doc describes.

## Keeping this doc alive

When you finish a step (or hit a sharp design decision), update this file **before** the session ends: bump the build-state table, add any new gotcha, note any convention the user reinforced. This is the only portable memory across hosts.
