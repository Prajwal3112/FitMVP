import type { ImageSourcePropType } from 'react-native';

/**
 * Bundled demonstration photos, keyed by exerciseId.
 *
 * GENERATED — see the regeneration note at the bottom. Do not hand-edit.
 *
 * WHY A STATIC MAP. Metro resolves `require` at build time, so
 * `require(`./img/${id}.jpg`)` cannot work; every path has to appear
 * literally. That is also what keeps the bundle honest: only these files ship.
 *
 * WHY ONLY THESE 88. The scheduler can prescribe 90 of the 743
 * exercises across every persona and five training blocks; two of those are
 * hand-added conditioning entries the source dataset does not cover. Shipping
 * photos for all 743 would be ~6.6 MB for ~650 exercises nobody can be given.
 *
 * Downscaled to 320px wide at JPEG q55: ~15 KB each, 1.3 MB total.
 * Measured alternatives were 400px/q55 at 2 MB and 500px/q70 at 3 MB — on a
 * card that renders ~140pt wide, 320px is already past what the screen shows.
 *
 * Source: yuhonas/free-exercise-db, Unlicense (public domain).
 */
/** Module-private: `exerciseImage()` is the only way in. */
const EXERCISE_IMAGES: Record<string, ImageSourcePropType> = {
  'Air_Bike': require('./img/Air_Bike.jpg'),
  'Arnold_Dumbbell_Press': require('./img/Arnold_Dumbbell_Press.jpg'),
  'Barbell_Bench_Press_-_Medium_Grip': require('./img/Barbell_Bench_Press_-_Medium_Grip.jpg'),
  'Barbell_Curl': require('./img/Barbell_Curl.jpg'),
  'Barbell_Deadlift': require('./img/Barbell_Deadlift.jpg'),
  'Barbell_Glute_Bridge': require('./img/Barbell_Glute_Bridge.jpg'),
  'Barbell_Incline_Bench_Press_-_Medium_Grip': require('./img/Barbell_Incline_Bench_Press_-_Medium_Grip.jpg'),
  'Barbell_Lunge': require('./img/Barbell_Lunge.jpg'),
  'Barbell_Seated_Calf_Raise': require('./img/Barbell_Seated_Calf_Raise.jpg'),
  'Barbell_Shoulder_Press': require('./img/Barbell_Shoulder_Press.jpg'),
  'Barbell_Shrug': require('./img/Barbell_Shrug.jpg'),
  'Barbell_Squat': require('./img/Barbell_Squat.jpg'),
  'Bent_Over_Barbell_Row': require('./img/Bent_Over_Barbell_Row.jpg'),
  'Bent_Over_Two-Dumbbell_Row': require('./img/Bent_Over_Two-Dumbbell_Row.jpg'),
  'Body-Up': require('./img/Body-Up.jpg'),
  'Body_Tricep_Press': require('./img/Body_Tricep_Press.jpg'),
  'Bodyweight_Squat': require('./img/Bodyweight_Squat.jpg'),
  'Bodyweight_Walking_Lunge': require('./img/Bodyweight_Walking_Lunge.jpg'),
  'Butt_Lift_Bridge': require('./img/Butt_Lift_Bridge.jpg'),
  'Cable_Crunch': require('./img/Cable_Crunch.jpg'),
  'Calf_Raise_On_A_Dumbbell': require('./img/Calf_Raise_On_A_Dumbbell.jpg'),
  'Chin-Up': require('./img/Chin-Up.jpg'),
  'Close-Grip_Barbell_Bench_Press': require('./img/Close-Grip_Barbell_Bench_Press.jpg'),
  'Close-Grip_Dumbbell_Press': require('./img/Close-Grip_Dumbbell_Press.jpg'),
  'Close-Grip_EZ-Bar_Press': require('./img/Close-Grip_EZ-Bar_Press.jpg'),
  'Close-Grip_Front_Lat_Pulldown': require('./img/Close-Grip_Front_Lat_Pulldown.jpg'),
  'Crunches': require('./img/Crunches.jpg'),
  'Dead_Bug': require('./img/Dead_Bug.jpg'),
  'Decline_Dumbbell_Bench_Press': require('./img/Decline_Dumbbell_Bench_Press.jpg'),
  'Dips_-_Triceps_Version': require('./img/Dips_-_Triceps_Version.jpg'),
  'Dumbbell_Bench_Press': require('./img/Dumbbell_Bench_Press.jpg'),
  'Dumbbell_Bench_Press_with_Neutral_Grip': require('./img/Dumbbell_Bench_Press_with_Neutral_Grip.jpg'),
  'Dumbbell_Bicep_Curl': require('./img/Dumbbell_Bicep_Curl.jpg'),
  'Dumbbell_Flyes': require('./img/Dumbbell_Flyes.jpg'),
  'Dumbbell_Incline_Row': require('./img/Dumbbell_Incline_Row.jpg'),
  'Dumbbell_Lunges': require('./img/Dumbbell_Lunges.jpg'),
  'Dumbbell_Lying_Pronation': require('./img/Dumbbell_Lying_Pronation.jpg'),
  'Dumbbell_Lying_Supination': require('./img/Dumbbell_Lying_Supination.jpg'),
  'Dumbbell_Rear_Lunge': require('./img/Dumbbell_Rear_Lunge.jpg'),
  'Dumbbell_Seated_One-Leg_Calf_Raise': require('./img/Dumbbell_Seated_One-Leg_Calf_Raise.jpg'),
  'Dumbbell_Shoulder_Press': require('./img/Dumbbell_Shoulder_Press.jpg'),
  'Dumbbell_Shrug': require('./img/Dumbbell_Shrug.jpg'),
  'Dumbbell_Squat': require('./img/Dumbbell_Squat.jpg'),
  'Dumbbell_Step_Ups': require('./img/Dumbbell_Step_Ups.jpg'),
  'Face_Pull': require('./img/Face_Pull.jpg'),
  'Front_Barbell_Squat': require('./img/Front_Barbell_Squat.jpg'),
  'Front_Dumbbell_Raise': require('./img/Front_Dumbbell_Raise.jpg'),
  'Glute_Kickback': require('./img/Glute_Kickback.jpg'),
  'Hammer_Curls': require('./img/Hammer_Curls.jpg'),
  'Handstand_Push-Ups': require('./img/Handstand_Push-Ups.jpg'),
  'Incline_Dumbbell_Flyes': require('./img/Incline_Dumbbell_Flyes.jpg'),
  'Incline_Dumbbell_Press': require('./img/Incline_Dumbbell_Press.jpg'),
  'Incline_Push-Up_Close-Grip': require('./img/Incline_Push-Up_Close-Grip.jpg'),
  'Incline_Push-Up_Reverse_Grip': require('./img/Incline_Push-Up_Reverse_Grip.jpg'),
  'Leg_Extensions': require('./img/Leg_Extensions.jpg'),
  'Leg_Press': require('./img/Leg_Press.jpg'),
  'Lying_Leg_Curls': require('./img/Lying_Leg_Curls.jpg'),
  'Machine_Shoulder_Military_Press': require('./img/Machine_Shoulder_Military_Press.jpg'),
  'Mountain_Climbers': require('./img/Mountain_Climbers.jpg'),
  'One-Arm_Dumbbell_Row': require('./img/One-Arm_Dumbbell_Row.jpg'),
  'Plank': require('./img/Plank.jpg'),
  'Preacher_Curl': require('./img/Preacher_Curl.jpg'),
  'Pullups': require('./img/Pullups.jpg'),
  'Push_Press': require('./img/Push_Press.jpg'),
  'Pushups': require('./img/Pushups.jpg'),
  'Pushups_Close_and_Wide_Hand_Positions': require('./img/Pushups_Close_and_Wide_Hand_Positions.jpg'),
  'Reverse_Flyes': require('./img/Reverse_Flyes.jpg'),
  'Reverse_Grip_Bent-Over_Rows': require('./img/Reverse_Grip_Bent-Over_Rows.jpg'),
  'Romanian_Deadlift': require('./img/Romanian_Deadlift.jpg'),
  'Russian_Twist': require('./img/Russian_Twist.jpg'),
  'Seated_Cable_Rows': require('./img/Seated_Cable_Rows.jpg'),
  'Seated_Calf_Raise': require('./img/Seated_Calf_Raise.jpg'),
  'Seated_Dumbbell_Press': require('./img/Seated_Dumbbell_Press.jpg'),
  'Side_Lateral_Raise': require('./img/Side_Lateral_Raise.jpg'),
  'Standing_Barbell_Calf_Raise': require('./img/Standing_Barbell_Calf_Raise.jpg'),
  'Standing_Calf_Raises': require('./img/Standing_Calf_Raises.jpg'),
  'Standing_Dumbbell_Calf_Raise': require('./img/Standing_Dumbbell_Calf_Raise.jpg'),
  'Standing_Dumbbell_Triceps_Extension': require('./img/Standing_Dumbbell_Triceps_Extension.jpg'),
  'Standing_Dumbbell_Upright_Row': require('./img/Standing_Dumbbell_Upright_Row.jpg'),
  'Standing_Military_Press': require('./img/Standing_Military_Press.jpg'),
  'Standing_Towel_Triceps_Extension': require('./img/Standing_Towel_Triceps_Extension.jpg'),
  'Step-up_with_Knee_Raise': require('./img/Step-up_with_Knee_Raise.jpg'),
  'Stiff-Legged_Dumbbell_Deadlift': require('./img/Stiff-Legged_Dumbbell_Deadlift.jpg'),
  'Thigh_Abductor': require('./img/Thigh_Abductor.jpg'),
  'Thigh_Adductor': require('./img/Thigh_Adductor.jpg'),
  'Triceps_Pushdown': require('./img/Triceps_Pushdown.jpg'),
  'Triceps_Pushdown_-_Rope_Attachment': require('./img/Triceps_Pushdown_-_Rope_Attachment.jpg'),
  'Wide-Grip_Lat_Pulldown': require('./img/Wide-Grip_Lat_Pulldown.jpg'),
  'Wrist_Rotations_with_Straight_Bar': require('./img/Wrist_Rotations_with_Straight_Bar.jpg'),
};

/** Photo for an exercise, or undefined when we have none. */
export function exerciseImage(id: string): ImageSourcePropType | undefined {
  return EXERCISE_IMAGES[id];
}

// REGENERATE: re-run the reachability sweep in checks/, download `<id>/0.jpg`
// for each reachable id from free-exercise-db, resize with
// `sips -Z 320 --setProperty formatOptions 55`, then rebuild this file from
// the contents of ./img — keeping EXERCISE_IMAGES module-private, since
// `exerciseImage()` is the only consumer. If the scheduler's selection changes, the reachable
// set changes with it — checks/images.ts fails when they drift apart.
