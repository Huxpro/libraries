// The harness card — a second Lynx entry that renders orbs with no chrome
// on a transparent background, configured entirely through `global-props`.
//
// `global-props` is the same channel a Lynx host publishes its theme on, so
// driving the harness through it exercises a real path rather than a
// test-only one. Two scripts consume this card:
//
//   scripts/parity.mjs      one orb, frozen at `t`, pixel-diffed vs the web
//   scripts/live-check.mjs  `live` orbs, animating, measured for motion and
//                           main-thread frame cost
//
// Keeping it out of the showcase entry means those scripts measure the
// component rather than a demo layout.

import { root, useGlobalProps } from '@lynx-js/react';
import { ThinkingOrb } from 'thinking-orbs-lynx';
import type { OrbSize, OrbState } from 'thinking-orbs-lynx';

interface HarnessProps {
  state?: OrbState;
  size?: OrbSize;
  dark?: boolean;
  /** Raw engine time — NOT multiplied by the preset speed. */
  t?: number;
  /** Animate instead of freezing, and mount this many orbs side by side. */
  live?: number;
  /** Draw the `size` design into this many px — the `displaySize` prop. */
  display?: number;
  /** Pass the prop through verbatim; `auto` exercises `appTheme` below. */
  theme?: 'auto' | 'dark' | 'light';
  paused?: boolean;
  reducedMotion?: boolean;
  /**
   * Not read here — the component reads it out of globalProps itself, the
   * way a Lynx host publishes appearance. Declared so the shape is obvious.
   */
  appTheme?: 'dark' | 'light';
}

function HarnessCard() {
  const p = useGlobalProps() as HarnessProps;
  const size = p.size ?? 64;
  const live = p.live ?? 0;
  const display = p.display;
  const count = live > 0 ? live : 1;

  return (
    <view
      id="harness-stage"
      style={{
        position: 'absolute',
        left: '0px',
        top: '0px',
        display: 'flex',
        flexDirection: 'row'
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <ThinkingOrb
          key={i}
          state={p.state ?? 'working'}
          size={size}
          displaySize={display}
          theme={p.theme ?? (p.dark === false ? 'light' : 'dark')}
          paused={p.paused ?? false}
          reducedMotion={p.reducedMotion ?? false}
          frozenTime={live > 0 ? undefined : (p.t ?? 0.6)}
        />
      ))}
    </view>
  );
}

root.render(<HarnessCard />);
