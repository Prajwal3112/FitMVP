// ─── Types ─────────────────────────────────────────────────────

export type Equipment = 'home' | 'gym';

export type Exercise = {
  name: string;
  sets: number;
  reps?: number;
  duration?: string;
};

export type Workout = {
  id: string;
  name: string;
  exercises: Exercise[];
};

// ─── Workout Templates (A · B · C) ──────────────────────────────

const HOME_WORKOUTS: Workout[] = [
  {
    id: 'home-a',
    name: 'Push Focus',
    exercises: [
      { name: 'Push-Ups',         sets: 3, reps: 12 },
      { name: 'Pike Push-Ups',    sets: 3, reps: 10 },
      { name: 'Diamond Push-Ups', sets: 3, reps: 8 },
      { name: 'Plank Hold',       sets: 3, duration: '30 sec' },
    ],
  },
  {
    id: 'home-b',
    name: 'Legs & Core',
    exercises: [
      { name: 'Bodyweight Squats', sets: 3, reps: 15 },
      { name: 'Reverse Lunges',    sets: 3, reps: 12 },
      { name: 'Glute Bridges',     sets: 3, reps: 15 },
      { name: 'Mountain Climbers', sets: 3, reps: 20 },
    ],
  },
  {
    id: 'home-c',
    name: 'Full Body',
    exercises: [
      { name: 'Burpees',        sets: 3, reps: 10 },
      { name: 'Squat to Press', sets: 3, reps: 12 },
      { name: 'Jumping Jacks',  sets: 3, reps: 25 },
      { name: 'Dead Bug',       sets: 3, reps: 10 },
    ],
  },
];

const GYM_WORKOUTS: Workout[] = [
  {
    id: 'gym-a',
    name: 'Push Day',
    exercises: [
      { name: 'Bench Press',            sets: 4, reps: 8 },
      { name: 'Overhead Press',         sets: 3, reps: 10 },
      { name: 'Incline Dumbbell Press', sets: 3, reps: 10 },
      { name: 'Tricep Pushdown',        sets: 3, reps: 12 },
    ],
  },
  {
    id: 'gym-b',
    name: 'Pull Day',
    exercises: [
      { name: 'Deadlift',     sets: 3, reps: 6 },
      { name: 'Lat Pulldown', sets: 3, reps: 12 },
      { name: 'Cable Row',    sets: 3, reps: 12 },
      { name: 'Bicep Curl',   sets: 3, reps: 12 },
    ],
  },
  {
    id: 'gym-c',
    name: 'Leg Day',
    exercises: [
      { name: 'Barbell Squat',     sets: 4, reps: 8 },
      { name: 'Leg Press',         sets: 3, reps: 12 },
      { name: 'Romanian Deadlift', sets: 3, reps: 10 },
      { name: 'Leg Curl',          sets: 3, reps: 12 },
    ],
  },
];

// ─── Equipment filter ──────────────────────────────────────────

export const workouts: Record<Equipment, Workout[]> = {
  home: HOME_WORKOUTS,
  gym: GYM_WORKOUTS,
};

// ─── Rotation selector ─────────────────────────────────────────
// Day 1 → A · Day 2 → B · Day 3 → C · Day 4 → A · …

export const getTodaysWorkout = (equipment: Equipment, currentDay: number): Workout => {
  const list = workouts[equipment] ?? workouts.home;
  const workout = list[(currentDay - 1) % list.length];
  if (!workout) throw new Error('workout rotation produced undefined — empty list?');
  return workout;
};

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
