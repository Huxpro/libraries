// The harness page.
//
// Three live Lynx runtimes, all booting the same bundles the CI harness
// screenshots:
//
//   parity    one orb frozen at an instant you pick, beside the web
//             library's canvas painter, and stacked with it under a
//             difference blend
//   showcase  the example app, unmodified, animating
//   stress    N animating orbs, with this page's own frame cadence measured
//
// Two things in here are load-bearing rather than decorative:
//
// 1. The difference tile puts each layer on its own OPAQUE substrate.
//    `mix-blend-mode` composites against whatever is behind it, so stacking
//    two TRANSPARENT layers would leave every semi-transparent dot only
//    partly cancelled — a ghost that is an artifact of the blend, not a real
//    difference. Opaque substrates make the top layer fully opaque and the
//    blend exactly |a - b|.
//
// 2. Cards are mounted only while their section is on screen. Every mounted
//    orb writes one style per dot per frame on this single main thread, so
//    leaving all of them running would make the cadence meter measure the
//    page instead of the thing it is pointed at.

import { MODE_FRAMES, paintFrame, resolvePreset } from '/engine.js';

const STATES = [
  'working',
  'searching',
  'solving',
  'listening',
  'connecting',
  'weaving',
  'composing',
  'breathing',
  'shaping'
];

/** Both tuned designs are drawn into this box, via the port's displaySize. */
const DISPLAY = 200;
const PARITY_BUNDLE = '/parity.web.bundle';
const STRESS_SIZE = 64;

const ui = {
  state: 'searching',
  size: 64,
  dark: true,
  t: 0.6,
  amp: 20,
  stressState: 'composing',
  count: 1
};

const $ = (id) => document.getElementById(id);

function chips(host, values, get, set, label = String) {
  host.innerHTML = '';
  for (const value of values) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = label(value);
    b.setAttribute('aria-pressed', String(get() === value));
    b.addEventListener('click', () => {
      set(value);
      for (const other of host.children) other.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', 'true');
    });
    host.append(b);
  }
}

function lynxView(url, props, px) {
  const v = document.createElement('lynx-view');
  v.setAttribute('url', url);
  v.setAttribute('global-props', JSON.stringify(props));
  v.setAttribute('height', 'fixed');
  v.setAttribute('width', 'fixed');
  v.style.width = `${px.w}px`;
  v.style.height = `${px.h}px`;
  return v;
}

/**
 * Mount a card while its section is on screen, unmount it when it leaves.
 * `mount` may return null to mean "nothing to show".
 */
function whenVisible(container, mount, onChange = () => {}, rootMargin = '0px') {
  let view = null;
  const attach = () => {
    view = mount();
    if (view) container.append(view);
    onChange(view);
  };
  const detach = () => {
    if (view) view.remove();
    view = null;
    onChange(view);
  };
  let visible = false;
  new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !view) attach();
      else if (!visible) detach();
    },
    { rootMargin }
  ).observe(container);
  return {
    get view() {
      return view;
    },
    remount() {
      detach();
      if (visible) attach();
    }
  };
}

function renderReference(canvas, { state, size, dark, t }) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const zoom = DISPLAY / size;
  canvas.width = Math.round(DISPLAY * dpr);
  canvas.height = Math.round(DISPLAY * dpr);
  canvas.style.width = `${DISPLAY}px`;
  canvas.style.height = `${DISPLAY}px`;
  const ctx = canvas.getContext('2d');
  // displaySize scales the DRAWING, not a rasterised bitmap: the port scales
  // each dot's transform, this scales the context. Same picture.
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const { mode, opts } = resolvePreset(state, size);
  paintFrame(ctx, MODE_FRAMES[mode](size, t, opts), dark);
}

function markCount(state, size, t) {
  const { mode, opts } = resolvePreset(state, size);
  const frame = MODE_FRAMES[mode](size, t, opts);
  return frame.dots.length + frame.lines.length;
}

// ── 1 · parity ───────────────────────────────────────────────────────────

const stageLynx = $('stage-lynx');
const stageDiff = $('stage-diff');
const refCanvas = $('ref');

const amp = document.createElement('div');
amp.className = 'amp';
const layerRef = document.createElement('div');
layerRef.className = 'layer';
const diffCanvas = document.createElement('canvas');
layerRef.append(diffCanvas);
const layerLynx = document.createElement('div');
layerLynx.className = 'layer top';
amp.append(layerRef, layerLynx);
stageDiff.append(amp);

const parityProps = () => ({
  state: ui.state,
  size: ui.size,
  dark: ui.dark,
  t: ui.t,
  display: DISPLAY
});

const makeParityView = () => lynxView(PARITY_BUNDLE, parityProps(), { w: DISPLAY, h: DISPLAY });
const sideBySide = whenVisible(stageLynx, makeParityView);
const overlay = whenVisible(layerLynx, makeParityView);

function paintParity() {
  const props = parityProps();
  // `lynx-view` republishes globalProps to a running card, which is the same
  // path a host app uses to publish a theme change — so the slider drives a
  // real mechanism rather than a harness-only one.
  if (sideBySide.view) sideBySide.view.globalProps = props;
  if (overlay.view) overlay.view.globalProps = props;
  renderReference(refCanvas, ui);
  renderReference(diffCanvas, ui);

  const substrate = ui.dark ? '#000' : '#fff';
  layerRef.style.background = substrate;
  layerLynx.style.background = substrate;
  stageLynx.classList.toggle('light', !ui.dark);
  refCanvas.parentElement.classList.toggle('light', !ui.dark);
  amp.style.filter = `brightness(${ui.amp})`;

  $('t-value').textContent = ui.t.toFixed(2);
  $('amp-value').textContent = `${ui.amp}×`;
  $('diff-label').textContent = `amplified ${ui.amp}×`;
}

chips($('states'), STATES, () => ui.state, (v) => {
  ui.state = v;
  paintParity();
});
chips($('sizes'), [64, 20], () => ui.size, (v) => {
  ui.size = v;
  paintParity();
}, (v) => `${v}px`);
chips($('themes'), [true, false], () => ui.dark, (v) => {
  ui.dark = v;
  paintParity();
}, (v) => (v ? 'dark' : 'light'));

$('t').addEventListener('input', (e) => {
  ui.t = Number(e.target.value);
  paintParity();
});
$('amp').addEventListener('input', (e) => {
  ui.amp = Number(e.target.value);
  paintParity();
});

paintParity();

// ── 2 · the example app ──────────────────────────────────────────────────

const showcase = $('stage-showcase');
// A shade EARLY on the way out: this card animates all eighteen orbs at
// once, and leaving it running while you read the cadence meter below would
// quietly become the number you are reading.
whenVisible(
  showcase,
  () =>
    lynxView('/main.web.bundle', {}, {
      w: showcase.clientWidth || 420,
      h: showcase.clientHeight || 620
    }),
  () => {},
  '-80px'
);

// ── 3 · stress + frame cadence ───────────────────────────────────────────

const stageStress = $('stage-stress');
const stress = whenVisible(
  stageStress,
  () =>
    ui.count === 0
      ? null
      : lynxView(
          PARITY_BUNDLE,
          { state: ui.stressState, size: STRESS_SIZE, dark: true, live: ui.count },
          { w: STRESS_SIZE * ui.count, h: STRESS_SIZE }
        ),
  () => refreshCost()
);

let mounted = false;
function refreshCost() {
  mounted = stress.view !== null;
  const marks = mounted ? markCount(ui.stressState, STRESS_SIZE, performance.now() / 1000) * ui.count : 0;
  $('dots').textContent = marks.toLocaleString();
  return marks;
}

chips($('stress-states'), STATES, () => ui.stressState, (v) => {
  ui.stressState = v;
  stress.remount();
});
chips($('counts'), [0, 1, 2, 4, 8], () => ui.count, (v) => {
  ui.count = v;
  stress.remount();
}, (v) => (v === 0 ? 'none' : `${v}×`));

// This page's own frame cadence. With the orbs animating on the same main
// thread, it IS their cost — no instrumentation inside the card needed, and
// "none" gives you this machine's baseline to read the rest against.
let frames = 0;
let windowStart = performance.now();
const tick = (now) => {
  frames++;
  if (now - windowStart >= 1000) {
    const fps = (frames * 1000) / (now - windowStart);
    $('fps').textContent = fps.toFixed(0);
    $('writes').textContent = Math.round(refreshCost() * fps).toLocaleString();
    frames = 0;
    windowStart = now;
  }
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
