// The ReactLynx ThinkingOrb.
//
// Lynx has no canvas to paint into — `x-canvas` is deprecated in the web
// platform with the note that the proposal "cannot be implemented on other
// platforms", and the `<svg>` element takes a source string, which is a
// parse per frame rather than a draw call. So an orb here is a POOL OF
// VIEWS: one `<view>` per dot, each a circle of `DOT_BASE` px that every
// frame re-positions and re-tints with a single `setStyleProperties` write.
// Nothing is mounted or unmounted while it animates, and no write touches
// layout — only `transform` and `background-color` move.
//
// The whole loop runs on the MAIN THREAD. Frame geometry, the ink rule and
// the element writes all live in `./shared.js`, imported with
// `runtime: 'shared'` so both threads have the code; React stays on the
// background thread and does nothing per frame. That is the opposite of the
// React Native port, where geometry runs on the JS thread and Skia
// rasterises on the UI thread — but the reason is the same: whatever must
// not jank belongs off the thread React renders on.
//
// Geometry itself is shared with the web, not re-implemented: the frames
// come from `thinking-orbs/engine`, the same compiled code the web
// component runs.

import {
  runOnBackground,
  runOnMainThread,
  useEffect,
  useMainThreadRef,
  useMemo,
  useState
} from '@lynx-js/react';
import type { MainThread } from '@lynx-js/types';
import { resolvePreset } from 'thinking-orbs/engine';
import {
  DOT_BASE,
  LINE_BASE,
  attachOrb,
  configureOrb,
  initialLoop,
  poolFor,
  stopOrb
} from './shared.js' with { runtime: 'shared' };
import type { OrbConfig, OrbLoop } from './shared.js';
import { useResolvedDark } from './theme.js';
import type { ThinkingOrbProps } from './types.js';

const LABELS: Record<string, string> = {
  working: 'Working…',
  searching: 'Searching…',
  solving: 'Solving…',
  listening: 'Listening…',
  connecting: 'Connecting…',
  weaving: 'Weaving…',
  composing: 'Composing…',
  breathing: 'Thinking…',
  shaping: 'Shaping…'
};

/** The static frame reduced-motion users see — same instant as the web. */
const REDUCED_MOTION_T = 0.6;

const DOT_STYLE = {
  position: 'absolute',
  left: '0px',
  top: '0px',
  width: `${DOT_BASE}px`,
  height: `${DOT_BASE}px`,
  borderRadius: `${DOT_BASE / 2}px`,
  transformOrigin: '50% 50%',
  transform: 'scale(0)'
} as const;

const LINE_STYLE = {
  position: 'absolute',
  left: '0px',
  top: '0px',
  width: `${LINE_BASE}px`,
  height: '1px',
  transformOrigin: '0 50%',
  transform: 'scale(0)'
} as const;

export function ThinkingOrb({
  state = 'working',
  size = 64,
  theme = 'auto',
  speed = 1,
  paused = false,
  displaySize,
  reducedMotion = false,
  frozenTime,
  accessibilityLabel,
  className,
  style
}: ThinkingOrbProps) {
  const dark = useResolvedDark(theme);
  const { mode, speed: baseSpeed, opts } = useMemo(() => resolvePreset(state, size), [state, size]);

  const box = displaySize ?? size;
  const zoom = box / size;

  // How many views the pool needs. `poolFor` samples the mode; `grown` is
  // the escape hatch for the frame that samples missed, requested by the
  // main thread the first time one overflows.
  const base = useMemo(() => poolFor(mode, size, opts), [mode, size, opts]);
  const poolKey = `${mode}:${size}`;
  const [grown, setGrown] = useState({ key: '', n: 0 });
  const dotSlots = grown.key === poolKey ? Math.max(base.dots, grown.n) : base.dots;

  const mt = useMainThreadRef<OrbLoop>(initialLoop());

  // Plain background closure. `runOnBackground` turns it into a callable
  // handle, and it has to be CALLED from the main thread — calling it here
  // throws "runOnBackground can only be used on the main thread", so the
  // wrapping happens inside `applyConfig` below.
  const grow = (n: number) => {
    setGrown({ key: poolKey, n });
  };

  const onHost = (el: MainThread.Element | null) => {
    'main thread';
    const s = mt.current;
    attachOrb(s, el);
    return () => {
      stopOrb(s);
    };
  };

  const applyConfig = (cfg: OrbConfig) => {
    'main thread';
    configureOrb(mt.current, cfg, runOnBackground(grow));
  };

  const cfg: OrbConfig = useMemo(
    () => ({
      mode,
      size,
      opts,
      dark,
      zoom,
      effSpeed: baseSpeed * speed,
      paused,
      slots: dotSlots,
      frozen: frozenTime ?? (reducedMotion ? REDUCED_MOTION_T : null)
    }),
    [mode, size, opts, dark, zoom, baseSpeed, speed, paused, frozenTime, reducedMotion, dotSlots]
  );

  useEffect(() => {
    runOnMainThread(applyConfig)(cfg);
  }, [cfg]);

  return (
    <view
      main-thread:ref={onHost}
      className={className}
      accessibility-element={true}
      accessibility-traits="image"
      accessibility-label={accessibilityLabel ?? LABELS[state]}
      style={{
        position: 'relative',
        // a canvas clips at its bounds; make the pool do the same
        overflow: 'hidden',
        width: `${box}px`,
        height: `${box}px`,
        ...style
      }}
    >
      {Array.from({ length: base.lines }, (_, i) => (
        <view key={`l${i}`} className="thinking-orb-line" style={LINE_STYLE} />
      ))}
      {Array.from({ length: dotSlots }, (_, i) => (
        <view key={`d${i}`} className="thinking-orb-dot" style={DOT_STYLE} />
      ))}
    </view>
  );
}
