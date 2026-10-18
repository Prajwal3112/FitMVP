// ─── What's left of the template era ───────────────────────────
//
// This file used to hold three hand-written workouts per equipment tier and
// `getTodaysWorkout(equipment, day % 3)`, which was the app's entire idea of
// a programme. Everything a session is made of now comes from the engine —
// selectSplit → resolveSession → getParameters → 743 exercises filled into
// movement-pattern slots — and HomeScreen was the templates' last consumer.
//
// Deleted 2026-10-18: HOME_WORKOUTS, GYM_WORKOUTS, `workouts`, `Workout`,
// `Exercise` and `getTodaysWorkout`. The last of those shipped in the
// production bundle with a `throw` on its unreachable branch, inside a
// function called during render.
//
// `Equipment` stays because fourteen modules import it, and the copy below
// stays because two screens show it.

export type Equipment = 'home' | 'gym';

// ─── Motivational copy ─────────────────────────────────────────

export const motivationalMessages = {
  day3: [
    "Day 3 is where most people quit. You're not most people.",
    "The first two days were easy. Today is where it actually starts.",
    "Every elite athlete has had a Day 3. They pushed through. So will you.",
  ],
  completion: [
    'Consistency beats perfection. Every single time.',
    'One more day in the books. Your future self is watching.',
    "You showed up. That's the whole game.",
  ],
} as const;
