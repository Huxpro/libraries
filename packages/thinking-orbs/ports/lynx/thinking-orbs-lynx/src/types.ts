import type { OrbSize, OrbState } from 'thinking-orbs/engine';

export type { OrbSize, OrbState };

/**
 * Theme mode. `auto` follows the host app's appearance via
 * `lynx.__globalProps.appTheme`, which is how a Lynx host publishes its
 * theme to the front end.
 *
 * The web build additionally walks up the DOM for a `data-theme` attribute
 * and subscribes to `prefers-color-scheme`; Lynx has neither, so a host
 * that themes independently of `__globalProps` should pass `theme`
 * explicitly from its own context.
 */
export type OrbTheme = 'auto' | 'dark' | 'light';

export interface ThinkingOrbProps {
  /** Which animation to show. @default 'working' */
  state?: OrbState;
  /** Tuned size preset — 64 or 20 px. @default 64 */
  size?: OrbSize;
  /** Theme mode; `auto` follows `lynx.__globalProps.appTheme`. @default 'auto' */
  theme?: OrbTheme;
  /** Speed multiplier on top of the preset's baked speed. @default 1 */
  speed?: number;
  /** Freeze on a static frame. @default false */
  paused?: boolean;
  /**
   * Render the orb at this many px instead of `size`.
   *
   * The GEOMETRY still comes from the `size` preset — 64 and 20 are two
   * tuned designs, not one design at two scales — but every dot is scaled
   * into a `displaySize` box. Dots are views with a border radius rather
   * than a rasterised bitmap, so this stays sharp at any factor.
   */
  displaySize?: number;
  /**
   * Show the static reduced-motion frame instead of animating.
   *
   * Lynx exposes no `prefers-reduced-motion` equivalent (the web build
   * reads the media query, React Native reads
   * `AccessibilityInfo.isReduceMotionEnabled`), so on this platform the
   * host app has to supply the signal.
   *
   * @default false
   */
  reducedMotion?: boolean;
  /**
   * Render one fixed engine instant and stop — the parity hook.
   *
   * The value is the RAW `t` the engine and `spec/orbs-golden.json` are
   * indexed by: the preset speed is deliberately not applied to it. That
   * detail is the whole point. The iOS port's first frozen-time hook
   * multiplied the instant by the preset speed while the web harness
   * evaluated at raw `t`, so the two sides froze different moments and the
   * pixel diff came back eight times worse than antialiasing could explain.
   *
   * Takes precedence over `reducedMotion` and `paused`.
   */
  frozenTime?: number;
  /** Overrides the per-state default. */
  accessibilityLabel?: string;
  /** Applied to the host view, on top of its `displaySize`/`size` box. */
  style?: Record<string, string | number>;
  className?: string;
}
