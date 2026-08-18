// The cross-thread half of the port: geometry, the ink rule, the element
// writes, and the frame loop that drives them.
//
// ReactLynx runs UI work on two threads — React itself lives on the
// background thread, element mutations happen on the main thread. A module
// imported `with { runtime: 'shared' }` is compiled into BOTH bundles,
// which is what lets a main thread function call plain functions from it.
// Everything an orb needs per frame therefore lives in this one module, and
// `ThinkingOrb.tsx` keeps only the three thin `'main thread'` entry points
// that React itself has to own.
//
// The geometry is not re-implemented: `thinking-orbs/engine` is the same
// compiled code the web component runs, so parity is structural rather than
// maintained by hand. This module only turns a finished frame into
// transforms and colours.
//
// Note the state isolation rule for shared modules — each thread gets its
// own instance of a module-level variable. `T0` below is deliberately one
// of those: every orb on the main thread reads that one origin, so several
// mounted together stay in phase exactly as they do on the web (which reads
// the shared `performance.now`).

import type { MainThread } from '@lynx-js/types';
import { MODE_FRAMES } from 'thinking-orbs/engine';
import type { ModeKey, ModeOpts, OrbFrame } from 'thinking-orbs/engine';

/**
 * Every dot is one `<view>` this many px across, scaled per frame. Writing
 * `transform` leaves layout alone; writing `width`/`height` would re-run it
 * for up to 566 nodes a frame.
 */
export const DOT_BASE = 8;

/** Same idea for `connecting`'s edges: a 1px-tall bar, rotated and scaled. */
export const LINE_BASE = 64;

/** Slots past the frame's mark count are parked, not unmounted. */
const HIDDEN = 'scale(0)';

/** Clock origin, so `t` stays small and every orb shares a phase. */
const T0 = Date.now();

export function nowSeconds(): number {
  return (Date.now() - T0) / 1000;
}

/** What a frame is drawn from — all plain numbers, so it crosses threads. */
export interface OrbConfig {
  mode: ModeKey;
  size: number;
  opts: ModeOpts;
  dark: boolean;
  /** displaySize / size — the drawing is scaled, never the rasterised box. */
  zoom: number;
  /** Preset speed × the `speed` prop. */
  effSpeed: number;
  paused: boolean;
  /** How many dot views the tree currently holds — see `configureOrb`. */
  slots: number;
  /**
   * Render this exact engine instant and stop. The preset speed is NOT
   * applied — this is the raw `t` the golden vectors are indexed by, which
   * is the whole point of the hook: a parity harness has to be able to ask
   * both renderers for the same moment.
   */
  frozen: number | null;
}

/** Main-thread-only state for one orb. Lives in a `useMainThreadRef`. */
export interface OrbLoop {
  host: MainThread.Element | null;
  dots: MainThread.Element[];
  lines: MainThread.Element[];
  cfg: OrbConfig | null;
  raf: number;
  gen: number;
  live: number;
  liveLines: number;
  /** Set once we have asked React for a bigger pool, so we ask only once. */
  asked: boolean;
  grow: ((n: number) => unknown) | null;
}

/** The serializable seed for that state — it is created on the background. */
export function initialLoop(): OrbLoop {
  return {
    host: null,
    dots: [],
    lines: [],
    cfg: null,
    raf: 0,
    gen: 0,
    live: 0,
    liveLines: 0,
    asked: false,
    grow: null
  };
}

export function orbFrame(mode: ModeKey, size: number, t: number, opts: ModeOpts): OrbFrame {
  return MODE_FRAMES[mode]!(size, t, opts);
}

/**
 * Ink value → an 8-bit grey, mirrored on dark substrates. Quantised the way
 * the canvas painter quantises it, so the two platforms land on identical
 * greys rather than merely close ones.
 */
function ink(white: number, alpha: number, dark: boolean): string {
  const w = white < 0 ? 0 : white > 1 ? 1 : white;
  const g = Math.round((dark ? 1 - w : w) * 255);
  return 'rgba(' + g + ',' + g + ',' + g + ',' + alpha + ')';
}

/**
 * Write one finished frame onto the pooled views.
 *
 * Pool slot `i` always draws `frame.dots[i]`, and the engine hands the dots
 * over already z-sorted far→near — so sibling order in the element tree IS
 * draw order, and the depth stacking comes out identical to the canvas
 * painter's without this renderer sorting anything itself.
 *
 * Returns how many slots are now in use, so the next frame only parks the
 * ones that actually fell out of use.
 */
function paintDots(
  frame: OrbFrame,
  els: MainThread.Element[],
  dark: boolean,
  zoom: number,
  wasLive: number
): number {
  const dots = frame.dots;
  const n = dots.length < els.length ? dots.length : els.length;
  for (let i = 0; i < n; i++) {
    const d = dots[i]!;
    els[i]!.setStyleProperties({
      transform:
        'translate(' +
        (d.x * zoom - DOT_BASE / 2).toFixed(3) +
        'px, ' +
        (d.y * zoom - DOT_BASE / 2).toFixed(3) +
        'px) scale(' +
        ((2 * d.r * zoom) / DOT_BASE).toFixed(5) +
        ')',
      'background-color': ink(d.white, d.a ?? 1, dark)
    });
  }
  for (let i = n; i < wasLive && i < els.length; i++) {
    els[i]!.setStyleProperty('transform', HIDDEN);
  }
  return n;
}

/**
 * The stroked edges `connecting` draws. A line is a 1px-tall bar whose
 * transform origin sits on its left edge, mid-height: translate that origin
 * onto (x1, y1), rotate to the edge's angle, then scale to its length and
 * stroke width. Canvas strokes are centred on the path, and so is this bar.
 */
function paintLines(
  frame: OrbFrame,
  els: MainThread.Element[],
  dark: boolean,
  zoom: number,
  wasLive: number
): number {
  const lines = frame.lines;
  const n = lines.length < els.length ? lines.length : els.length;
  for (let i = 0; i < n; i++) {
    const l = lines[i]!;
    const dx = (l.x2 - l.x1) * zoom;
    const dy = (l.y2 - l.y1) * zoom;
    els[i]!.setStyleProperties({
      transform:
        'translate(' +
        (l.x1 * zoom).toFixed(3) +
        'px, ' +
        (l.y1 * zoom - 0.5).toFixed(3) +
        'px) rotate(' +
        ((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(3) +
        'deg) scale(' +
        (Math.sqrt(dx * dx + dy * dy) / LINE_BASE).toFixed(5) +
        ', ' +
        (l.w * zoom).toFixed(4) +
        ')',
      'background-color': ink(l.white, l.a ?? 1, dark)
    });
  }
  for (let i = n; i < wasLive && i < els.length; i++) {
    els[i]!.setStyleProperty('transform', HIDDEN);
  }
  return n;
}

/** Lines are drawn first, so nodes sit on top of their edges. */
function drawAt(s: OrbLoop, t: number): void {
  const cfg = s.cfg!;
  const frame = orbFrame(cfg.mode, cfg.size, t, cfg.opts);
  s.liveLines = paintLines(frame, s.lines, cfg.dark, cfg.zoom, s.liveLines);
  s.live = paintDots(frame, s.dots, cfg.dark, cfg.zoom, s.live);
  // The pool is sized from sampled frames, so it can in principle come up
  // short. Ask React for a bigger one rather than silently dropping the
  // nearest — and therefore largest — dots for the rest of the animation.
  if (frame.dots.length > s.dots.length && !s.asked && s.grow) {
    s.asked = true;
    s.grow(frame.dots.length);
  }
}

export function stopOrb(s: OrbLoop): void {
  s.gen++;
  if (s.raf) cancelAnimationFrame(s.raf);
  s.raf = 0;
}

/** (Re)start from whatever host element and config we currently have. */
function restart(s: OrbLoop): void {
  stopOrb(s);
  const host = s.host;
  const cfg = s.cfg;
  if (!host || !cfg) return;

  // Collect the pool once per restart rather than per frame. Element order
  // is document order, which is what makes slot index equal draw order.
  s.dots = host.querySelectorAll('.thinking-orb-dot');
  s.lines = host.querySelectorAll('.thinking-orb-line');
  s.live = 0;
  s.liveLines = 0;

  if (cfg.frozen !== null) {
    drawAt(s, cfg.frozen);
    return;
  }
  // draw at least one frame even when paused, so an orb is never blank
  drawAt(s, nowSeconds() * cfg.effSpeed);
  if (cfg.paused) return;

  const gen = s.gen;
  const tick = () => {
    if (s.gen !== gen) return;
    drawAt(s, nowSeconds() * cfg.effSpeed);
    s.raf = requestAnimationFrame(tick);
  };
  s.raf = requestAnimationFrame(tick);
}

export function attachOrb(s: OrbLoop, host: MainThread.Element | null): void {
  s.host = host;
  if (!host) {
    stopOrb(s);
    return;
  }
  restart(s);
}

export function configureOrb(s: OrbLoop, cfg: OrbConfig, grow: (n: number) => unknown): void {
  // A new preset, or a pool that has actually changed size, means the last
  // growth request has been answered — allow another one. (React commits
  // the new views asynchronously, so a re-query here can still come back
  // short; letting the next frame ask again is what closes that gap.)
  if (!s.cfg || s.cfg.mode !== cfg.mode || s.cfg.size !== cfg.size || s.cfg.slots !== cfg.slots) {
    s.asked = false;
  }
  s.cfg = cfg;
  s.grow = grow;
  restart(s);
}

/**
 * How many pooled views a (mode, size) pair needs.
 *
 * The engine culls marks that have faded below the visibility floor, so a
 * frame's dot count moves over time and there is no count to read off the
 * options — deriving one here would mean re-implementing the very thing the
 * port refuses to re-implement. So sample the mode across a window, take
 * the worst frame, and leave headroom; `drawAt` covers the rest by asking
 * for growth if a frame ever exceeds the pool.
 */
const SAMPLES = 24;
const WINDOW = 12;

export function poolFor(
  mode: ModeKey,
  size: number,
  opts: ModeOpts
): { dots: number; lines: number } {
  let dots = 0;
  let lines = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const frame = orbFrame(mode, size, (i * WINDOW) / SAMPLES, opts);
    if (frame.dots.length > dots) dots = frame.dots.length;
    if (frame.lines.length > lines) lines = frame.lines.length;
  }
  return {
    dots: Math.ceil(dots * 1.1) + 2,
    // a mode with no edges must not allocate a stray one
    lines: lines === 0 ? 0 : Math.ceil(lines * 1.1) + 2
  };
}
