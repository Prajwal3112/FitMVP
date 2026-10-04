/**
 * Dark, gym-legible, deliberately quiet.
 *
 * The brief, from the founder's first real session: *"I want the UI to be very
 * soothing to eyes such that even in harsh light or dark light gym where the
 * lights are already soft and not right, the UI must be visible."* Those are
 * two opposite problems and the palette has to solve both:
 *
 *  · HARSH overhead light washes out low contrast, so body text sits near 10:1
 *    against its surface rather than the 4.5:1 minimum.
 *  · A DIM gym at 9pm makes a bright screen painful, so nothing is pure white
 *    (#FFF text on dark is the main cause of halation) and nothing is pure
 *    black (#000 makes every edge a hard line and smears on OLED when
 *    scrolling). The ground is a very dark neutral with a faint green cast,
 *    which reads as calm rather than as a switched-off TV.
 *
 * ONE accent, used sparingly: a desaturated sage. It reads as "go" without the
 * urgency of a saturated green, stays legible under both lighting conditions,
 * and leaves warm hues free to mean something — amber for caution, muted coral
 * for destructive. A saturated accent on a dark ground is the single fastest
 * way to make an interface tiring, and this one is on screen for an hour at a
 * time while someone is already tired.
 *
 * This replaces the iOS system palette (#F2F2F7 ground, #007AFF links) that
 * CLAUDE.md decided to kill on 2026-09-24 and that was still shipping.
 */
export const colors = {
  /** App ground. Not #000 — see the note above. */
  background: '#121512',
  /** Cards and grouped rows, lifted just enough to read as a surface. */
  card: '#1C201C',
  /** A second lift, for a surface on a card (inputs, the active set row). */
  raised: '#262B26',

  /** Body text. Not #FFF: pure white on dark haloes under gym lighting. */
  text: '#E8ECE6',
  /** Secondary text — still ~7:1 on `card`, so it survives harsh light. */
  textMuted: '#9DA79B',
  /**
   * Hints and placeholders. Lifted from #6D766B to clear 4.5:1 on `card`,
   * because it does carry meaning in places — the "long-press a tick to take
   * that set back" hint is the only thing that makes removal discoverable, and
   * 3.5:1 is not readable under gym lighting.
   */
  textTertiary: '#828C80',

  /** The one accent. Desaturated sage. */
  primary: '#9ED27E',
  /** Text and icons ON the accent — dark, because the accent is light. */
  onPrimary: '#121512',

  /**
   * Muted coral, not alarm red. Used for real loss, not for every warning.
   * Hue ~10°, deliberately far from `caution` — at the original #E58F79 the
   * two were 25° apart, which is not enough to tell coral from amber at a
   * glance, let alone with red-green colour blindness.
   */
  destructive: '#E8806B',
  /**
   * Caution that is not destructive — a dropped exercise, a lightened load.
   * Hue ~49°, so ~39° clear of `destructive`. Colour still never carries
   * meaning alone: every use is paired with words.
   */
  caution: '#D8C46B',

  /** Hairlines. Low-alpha white reads correctly over both card and raised. */
  separator: 'rgba(232, 236, 230, 0.10)',
  /** Disabled fills and empty progress tracks. */
  disabledFill: '#2A2F29',
} as const;

export type ColorName = keyof typeof colors;
