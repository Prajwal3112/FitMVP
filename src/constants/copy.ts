import type { DroppedSlot } from '../events/session';

/**
 * User-facing strings shared by more than one screen.
 *
 * Kept in one place because the alternative is what happened five times in
 * this codebase: the same concept worded differently on two screens, drifting
 * until one of them is wrong. `Record<DroppedSlot['reason'], string>` also
 * makes the compiler demand a string for every new reason.
 */
export const DROP_REASON: Record<DroppedSlot['reason'], string> = {
  injury: "loads something you've flagged as injured",
  soreness: 'you said that area was sore',
  // Not "nothing_available", which is not English, and not "injury" — that
  // reads as alarming when the real cause is an empty kit.
  nothing_available: 'nothing in your kit trains this — a bar or bands would',
};
