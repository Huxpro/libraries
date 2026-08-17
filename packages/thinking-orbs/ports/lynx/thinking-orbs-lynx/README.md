# thinking-orbs-lynx

Dotted thought-orb loading indicators for [Lynx](https://lynxjs.org),
rendered with ReactLynx. Port of
[thinking-orbs](https://orbs.jakubantalik.com) — nine hand-tuned animated
states, two purpose-tuned sizes, automatic dark/light.

> **Status: verified on Lynx for Web.** All nine states at both sizes, in
> dark and light, render and animate in `@lynx-js/web-core` 0.24.1 under
> headless Chromium, and pixel-diff against the web canvas renderer at worst
> mean **0.072/255**. The native bundle (`dist/main.lynx.bundle`) builds, but
> has **not** been run on a device, a simulator, or Lynx Explorer — see
> "What is not verified".
>
> Built against ReactLynx 0.124, rspeedy 0.16, `@lynx-js/types` 4.1.

## Install

```bash
npm install thinking-orbs-lynx
```

The package ships **TypeScript source**, not a compiled bundle, because its
main-thread functions and its `with { runtime: 'shared' }` import have to be
processed by your app's ReactLynx compiler — a pre-compiled copy would ship
`'main thread'` as an inert string literal. Rspeedy compiles it out of
`node_modules` with no extra configuration (verified from a clean
`npm pack` install).

## Usage

```tsx
import { ThinkingOrb } from 'thinking-orbs-lynx';

<ThinkingOrb state="searching" size={64} />;
```

Props mirror the web package — `state`, `size` (`64 | 20`), `theme`
(`'auto' | 'dark' | 'light'`), `speed`, `paused`, `accessibilityLabel`,
`style` — plus three additions:

| prop | why it exists |
|---|---|
| `displaySize` | render the tuned `size` design at some other px box. The geometry still comes from the `size` preset (64 and 20 are two designs, not one at two scales); the drawing is scaled into the larger box. Dots are views with a border radius, so this stays sharp. |
| `reducedMotion` | Lynx exposes no `prefers-reduced-motion` equivalent, so the host app has to supply the signal. When true the orb shows the same static frame (`t = 0.6`) the web and React Native ports show. |
| `frozenTime` | renders one fixed engine instant. It is the hook the parity harness drives, and it takes the **raw** `t` the golden vectors are indexed by — the preset speed is deliberately not applied to it. |

## How it renders, and why

Lynx has no canvas to paint into. `x-canvas` is marked deprecated in the web
platform with the note that the proposal "cannot be implemented on other
platforms", and `<svg>` takes a source string, which would mean re-parsing an
SVG document every frame.

So an orb is a **pool of views**: one `<view>` per dot, each an 8px circle
that every frame gets re-positioned and re-tinted by a single
`setStyleProperties` write. Nothing mounts or unmounts while it animates, and
no write touches layout — only `transform` and `background-color` move.

Three details make that faithful rather than merely close:

- **Draw order is sibling order.** The engine returns dots already z-sorted
  far→near, and pool slot *i* always draws `frame.dots[i]`, so the depth
  stacking falls out of the element tree without the renderer sorting
  anything.
- **Scale, don't resize.** A dot view is a fixed 8px circle scaled by
  `2r/8`. Writing `width`/`height` instead would re-run layout for up to 566
  nodes a frame.
- **Ink is quantised the way the canvas painter quantises it** — to an 8-bit
  grey, mirrored on dark substrates — so the two platforms land on identical
  greys rather than merely close ones.

`connecting`'s edges are the same trick rotated: a 1px-tall bar whose
transform origin sits on its left edge, translated onto `(x1, y1)`, rotated
to the edge angle, then scaled to length and stroke width.

## Threading

The whole frame loop runs on the **main thread**. Geometry, the ink rule and
the element writes live in `src/shared.ts`, imported with
`runtime: 'shared'` so both threads have the code; `ThinkingOrb.tsx` keeps
only three thin `'main thread'` entry points. React, on the background
thread, does nothing per frame.

That is the mirror image of the React Native port — geometry on the JS
thread, rasterisation on the UI thread — and the reason is the same: what
must not jank belongs off the thread React renders on. The difference is
that Lynx made it cheap. React Native would have needed `'worklet'`
directives throughout the shared engine (measured: without them Reanimated's
Babel plugin produces zero worklets), which is why that port left geometry on
the JS thread. Lynx's `runtime: 'shared'` is an import attribute at the call
site, so **the web library needed no changes at all** to become
main-thread-callable.

## How parity is achieved

The geometry is not re-implemented. This package depends on
`thinking-orbs/engine` — the same compiled, React-free frame functions the
web component runs — and only translates the resulting dot list into element
writes. A frame arrives already z-sorted, radius-clamped and culled, so the
renderer draws the array in order and derives nothing.

```bash
npm run verify:golden
```

asserts the resolved engine reproduces `spec/orbs-golden.json` exactly (72
cases, 70,115 values, tolerance 1e-4). It is not checking arithmetic — it is
checking that the dependency resolved to the engine those vectors came from,
since a stale or duplicated copy of `thinking-orbs` in the tree would
otherwise surface as an animation subtly out of step with the web.

## How the rendering is verified

```bash
cd ../example && npm install && npx rspeedy build   # builds parity.web.bundle
cd ../thinking-orbs-lynx
npm run parity        # frozen frames, pixel-diffed against the web canvas
npm run live-check    # motion, pause, reduced motion, theme, frame cost
```

`parity.mjs` boots this port's real component through **Lynx for Web** in
headless Chromium, one fresh `lynx-view` per case configured through
`global-props`, and diffs the screenshot against the web library's own
`paintFrame` running on a canvas in the same browser at the same device pixel
ratio. Golden vectors cannot catch a mis-positioned view, a wrong transform
origin, a dropped alpha, or a freeze hook that froze the wrong moment — the
iOS port shipped exactly that last bug and only a pixel diff found it.

Current result over all 72 combinations (9 states × 2 sizes × 2 themes ×
2 timestamps):

| metric | worst |
|---|---|
| mean difference | **0.072/255** (0.028%) |
| p99 difference | 1.0/255 |
| pixels differing by >16 | 0.19% of one frame, 0.00% typical |
| total ink vs the web | 0.995–1.001× |

`--display 133` re-runs the same comparison through `displaySize`, the only
path where the drawing is scaled — the port scales each dot's transform, the
reference scales the canvas context. Worst mean there is **0.006/255**.

Both sides share a rasteriser here, which is the point: it removes the
sub-pixel-circle disagreement that dominated the Skia and CoreGraphics
comparisons (see the port plan's findings) and leaves this port's own draw
sequence as the only variable. A residual this small means the pooled views
land where the canvas arcs land.

`live-check.mjs` covers what a frozen diff structurally cannot see:

```
ok   paused holds one frame           moved 0.0000/255
ok   reduced motion holds one frame   moved 0.0000/255
ok   reduced motion frame is t=0.6    differs by 0.0000/255
ok   theme auto follows appTheme      mean ink 14.35 dark vs 6.24 light
ok   auto+light === theme="light"     differs by 0.0000/255
```

## Cost

One element write per dot per frame is the whole cost model, so it scales
with dot count. Measured in headless Chromium (Lynx for Web, one page,
against the same page's idle frame cadence):

| load | dots/frame | frame cadence |
|---|---|---|
| 1 × `searching` @64 | 204 | 60 fps |
| 4 × `searching` @64 | 816 | 60 fps |
| 1 × `composing` @64 | 566 | 60 fps |
| 2–3 × `composing` @64 | 1132–1698 | 60 fps median, occasional dropped frame |
| 4 × `composing` @64 | 2264 | 30 fps |

The geometry is not what costs: the heaviest mode is 0.12 ms/frame of maths.
Replacing the per-dot colour string with a constant moved the 4-instance
number by ~10%, so the cost is the element writes and their compositing, not
string building. Practical guidance: several orbs on screen at once is fine;
several of the *densest* modes at 64px at once is not. `size={20}` costs a
fifth as much, and is what an inline spinner should use anyway.

This is a Lynx-for-Web number on desktop Chromium — a ceiling check on the
approach, not device performance. Native writes go straight to the engine
rather than through the DOM.

## Behaviours, and where the platform differs

| behaviour | web | this port |
|---|---|---|
| theme | `data-theme` ancestor → `prefers-color-scheme` | `lynx.__globalProps.appTheme` via `useGlobalProps()`, so a host that updates globalProps re-renders the orb. Unknown resolves to dark, as on the web. |
| reduced motion | `prefers-reduced-motion` | no platform signal — pass `reducedMotion` |
| off-screen pause | `IntersectionObserver` + `visibilitychange` | not automatic. `lynx.createIntersectionObserver` and the `exposure` events exist, but both need wiring the component cannot do generically; drive `paused` from your own viewport tracking if you render many orbs in a list. |
| accessibility | `role="img"` + per-state label | `accessibility-element` + `accessibility-traits="image"` + the same labels |

The pool is sized by sampling the mode across a 12-second window and taking
the worst frame, because the engine culls faded marks and there is no dot
count to read off the options — deriving one here would mean re-implementing
the thing this port refuses to re-implement. Measured against a 600-second
dense sweep, every shipped preset's true maximum equals its sampled maximum,
so the 10% margin is never needed; if a frame ever did overflow the pool, the
main thread asks React for a bigger one rather than dropping the nearest and
largest dots.

## What is not verified

- **Native.** The Lynx bundle builds, but nothing here has run on Android,
  iOS, Harmony, or in Lynx Explorer. `setStyleProperties` on a few hundred
  views per frame is the number that needs a device: the web measurement
  above says the approach is sane, not that a phone can hold 60 fps.
- **`querySelectorAll` on the main thread** (used once per (re)start to
  collect the pool) is documented since Lynx 2.14 and works in Lynx for Web;
  its behaviour on each native platform is untested here.
- **Multiple orbs staying in phase** relies on one shared clock origin per
  main-thread module instance, which holds in Lynx for Web; a host that runs
  cards in separate Lynx views may not share it.

## License

MIT
