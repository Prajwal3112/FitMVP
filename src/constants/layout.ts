import { useWindowDimensions } from 'react-native';

/**
 * One place that knows how wide the screen is.
 *
 * Before this, every screen was a fixed-padding single column, so the same
 * code had to serve roughly a 4x width range:
 *
 *   ~280dp  a folded Galaxy Z Fold outer screen
 *   ~360dp  small Android phones, still shipping in 2026
 *   ~440dp  iPhone Pro Max / Galaxy Ultra
 *   ~600dp  small tablets, unfolded foldables, a phone in landscape
 *  ~1100dp  a 13" tablet
 *
 * The failure at the top of that range is not clipping — it is that a line of
 * text stretches to 1000px and becomes unreadable. Typographic research puts
 * comfortable line length around 65-75 characters, which at our body size is
 * roughly 600dp. So wide screens get a CENTRED COLUMN, not wider text.
 *
 * The failure at the bottom is padding eating the content: 20dp each side of a
 * 280dp screen leaves 240dp for a row of pills.
 *
 * Nothing here sets `allowFontScaling={false}`. If someone has large text
 * turned on in their OS they need it, and layouts must flex instead.
 */

export type Breakpoint = 'compact' | 'regular' | 'wide';

export type Layout = {
  breakpoint: Breakpoint;
  /** Raw width, if a screen needs to do something unusual. */
  width: number;
  /** Side padding for the outermost scroll container. */
  gutter: number;
  /**
   * Max width of the readable column. `undefined` below `wide` — a phone
   * should use every pixel it has.
   */
  maxContentWidth: number | undefined;
  /** Multiplier for type and spacing. Tablets are held further away. */
  scale: number;
  /** True when there is room to put things side by side. */
  isWide: boolean;
  /** Short viewport (phone in landscape): trim vertical space. */
  isShort: boolean;
};

/** Below this, assume a folded phone and conserve every horizontal pixel. */
const COMPACT_MAX = 359;
/** At and above this, stop widening text and centre a column instead. */
const WIDE_MIN = 600;
/** ~65-75 characters at our body size. */
const READABLE_COLUMN = 640;

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();

  const breakpoint: Breakpoint =
    width <= COMPACT_MAX ? 'compact' : width >= WIDE_MIN ? 'wide' : 'regular';

  return {
    breakpoint,
    width,
    gutter: breakpoint === 'compact' ? 12 : breakpoint === 'wide' ? 32 : 20,
    maxContentWidth: breakpoint === 'wide' ? READABLE_COLUMN : undefined,
    // Deliberately small. A 1.3x jump makes a tablet look like a kiosk; the
    // real fix for a big screen is whitespace, not big type.
    scale: breakpoint === 'wide' ? 1.06 : 1,
    isWide: breakpoint === 'wide',
    isShort: height < 600,
  };
}

/** Round to whole pixels — fractional padding renders inconsistently. */
export function scaled(value: number, layout: Layout): number {
  return Math.round(value * layout.scale);
}
