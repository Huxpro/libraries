// What the pooled-view approach costs, against the thing it replaced.
//
// The port draws a dot as an element because Lynx has no canvas. The
// obvious question is what that costs versus a canvas, and the only honest
// way to answer it is to run both on one machine, in one browser, over the
// same frames. This does that, in three arms:
//
//   canvas  the web library's own painter, one <canvas> per orb
//   views   the port's draw routine transcribed onto plain DOM elements —
//           same engine call, same per-dot writes, no Lynx in the way
//   lynx    the shipped port through Lynx for Web, runtime and all
//
// `views` is the interesting middle term: canvas→views is the cost of the
// approach, views→lynx is the cost of the framework on top of it.
//
// Each configuration gets a FRESH PAGE and is repeated, because the lynx
// arm turned out to be sensitive both to what ran before it in the same
// page and to run-to-run variance — a single reading of it is not evidence.
// The median is what gets reported.
//
// Run (after building the example, as for scripts/parity.mjs):
//   npm run bench
//   npm run bench -- --states composing --counts 1,2,4,8 --reps 5
//
// The numbers are Lynx-for-Web on a desktop browser: a ceiling check on the
// approach, not device performance. Native Lynx writes reach the engine
// directly instead of going through the DOM.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const orbsRoot = resolve(pkgRoot, '../../..');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const list = (name, fallback) => String(flag(name, fallback)).split(',').filter(Boolean);

const STATES = list('states', 'composing,searching');
const COUNTS = list('counts', '1,2,4').map(Number);
const ARMS = list('arms', 'canvas,views,lynx');
const REPS = Number(flag('reps', '3'));
const SECONDS = Number(flag('seconds', '3'));
const SIZE = Number(flag('size', '64'));

const bundle = resolve(process.cwd(), flag('bundle', resolve(pkgRoot, '../example/dist/parity.web.bundle')));
const engine = resolve(orbsRoot, 'dist/engine.es.js');
for (const [what, path] of [['the example app', bundle], ['the web library', engine]]) {
  if (!existsSync(path)) {
    console.error(`missing ${path}\n\nBuild ${what} first — see scripts/parity.mjs`);
    process.exit(2);
  }
}
const clientDir = resolve(dirname(require.resolve('@lynx-js/web-core/package.json')), 'dist/client_prod');
const { chromium } = require('playwright');

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="/static/css/client.css">
<script src="/static/js/client.js" type="module"></script>
<style>
  html,body{margin:0;background:#000}
  #stage{position:relative;display:flex;flex-wrap:wrap;gap:8px;padding:8px}
  .pool{position:relative;width:${SIZE}px;height:${SIZE}px;overflow:hidden}
  .dot{position:absolute;left:0;top:0;width:8px;height:8px;border-radius:4px;
       transform-origin:50% 50%;transform:scale(0)}
</style></head><body><div id="stage"></div>
<script type="module">
import { MODE_FRAMES, paintFrame, resolvePreset } from '/engine.js';
const DOT_BASE = 8;
const stage = document.getElementById('stage');
let loops = [];
const clear = () => { for (const id of loops) cancelAnimationFrame(id); loops = []; stage.innerHTML = ''; };
const ink = (white, alpha, dark) => {
  const w = white < 0 ? 0 : white > 1 ? 1 : white;
  const g = Math.round((dark ? 1 - w : w) * 255);
  return 'rgba(' + g + ',' + g + ',' + g + ',' + alpha + ')';
};

function mountCanvas(k, state, size) {
  const { mode, speed, opts } = resolvePreset(state, size);
  const dpr = Math.min(2, devicePixelRatio || 1);
  for (let i = 0; i < k; i++) {
    const c = document.createElement('canvas');
    c.width = size * dpr; c.height = size * dpr;
    c.style.width = c.style.height = size + 'px';
    stage.append(c);
    const ctx = c.getContext('2d');
    const tick = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      paintFrame(ctx, MODE_FRAMES[mode](size, (performance.now() / 1000) * speed, opts), true);
      loops[i] = requestAnimationFrame(tick);
    };
    loops[i] = requestAnimationFrame(tick);
  }
}

function mountViews(k, state, size) {
  const { mode, speed, opts } = resolvePreset(state, size);
  let cap = 0;
  for (let i = 0; i < 24; i++) cap = Math.max(cap, MODE_FRAMES[mode](size, i * 0.5, opts).dots.length);
  cap = Math.ceil(cap * 1.1) + 2;
  for (let i = 0; i < k; i++) {
    const pool = document.createElement('div');
    pool.className = 'pool';
    const els = [];
    for (let n = 0; n < cap; n++) {
      const d = document.createElement('div');
      d.className = 'dot';
      pool.append(d);
      els.push(d);
    }
    stage.append(pool);
    let live = 0;
    const tick = () => {
      const dots = MODE_FRAMES[mode](size, (performance.now() / 1000) * speed, opts).dots;
      const n = Math.min(dots.length, els.length);
      for (let j = 0; j < n; j++) {
        const d = dots[j];
        const s = els[j].style;
        s.transform = 'translate(' + (d.x - DOT_BASE / 2).toFixed(3) + 'px, ' +
          (d.y - DOT_BASE / 2).toFixed(3) + 'px) scale(' + ((2 * d.r) / DOT_BASE).toFixed(5) + ')';
        s.backgroundColor = ink(d.white, d.a ?? 1, true);
      }
      for (let j = n; j < live; j++) els[j].style.transform = 'scale(0)';
      live = n;
      loops[i] = requestAnimationFrame(tick);
    };
    loops[i] = requestAnimationFrame(tick);
  }
}

function mountLynx(k, state, size) {
  const v = document.createElement('lynx-view');
  v.setAttribute('url', '/parity.web.bundle');
  v.setAttribute('global-props', JSON.stringify({ state, size, dark: true, live: k }));
  v.setAttribute('height', 'fixed');
  v.setAttribute('width', 'fixed');
  v.style.width = size * k + 'px';
  v.style.height = size + 'px';
  stage.append(v);
}

window.__mount = (arm, k, state, size) => {
  clear();
  if (!k) return;
  ({ canvas: mountCanvas, views: mountViews, lynx: mountLynx })[arm](k, state, size);
};

/** Cadence of the page's own frames — with the orbs on this thread, it IS their cost. */
window.__cadence = (secs) => new Promise((done) => {
  const deltas = [];
  let last = performance.now();
  const stop = last + secs * 1000;
  const tick = (now) => {
    deltas.push(now - last);
    last = now;
    if (now < stop) requestAnimationFrame(tick);
    else {
      deltas.sort((a, b) => a - b);
      done({ fps: deltas.length / secs, p95: deltas[Math.floor(deltas.length * 0.95)] });
    }
  };
  requestAnimationFrame(tick);
});

window.__marks = (state, size) => {
  const { mode, opts } = resolvePreset(state, size);
  const f = MODE_FRAMES[mode](size, 1.7, opts);
  return f.dots.length + f.lines.length;
};
window.__ready = true;
</script></body></html>`;

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
const server = await new Promise((ok) => {
  const s = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    try {
      if (path === '/favicon.ico') return res.writeHead(204).end();
      if (path === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end(PAGE);
      }
      const file =
        path === '/parity.web.bundle' ? bundle : path === '/engine.js' ? engine : join(clientDir, path);
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store'
      });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  s.listen(0, () => ok(s));
});
const port = server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

const once = async (arm, k, state) => {
  const page = await browser.newPage({ viewport: { width: 900, height: 400 }, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction('window.__ready === true');
  await page.evaluate(([a, n, s, z]) => window.__mount(a, n, s, z), [arm, k, state, SIZE]);
  // the Lynx arm has a runtime to boot before it is drawing steadily
  await page.waitForTimeout(arm === 'lynx' ? 2500 : 800);
  const r = await page.evaluate((s) => window.__cadence(s), SECONDS);
  const marks = await page.evaluate(([s, z]) => window.__marks(s, z), [state, SIZE]);
  await page.close();
  return { ...r, marks: marks * k };
};

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

console.log(`Lynx for Web · ${SIZE}px · ${REPS} runs of ${SECONDS}s per configuration, fresh page each\n`);
console.log('state       arm       ×   marks/frame   fps runs                median   p95');
const table = [];
for (const state of STATES) {
  for (const arm of ARMS) {
    for (const k of COUNTS) {
      const runs = [];
      for (let i = 0; i < REPS; i++) runs.push(await once(arm, k, state));
      const fps = runs.map((r) => r.fps);
      const row = { state, arm, k, marks: runs[0].marks, fps: median(fps), p95: median(runs.map((r) => r.p95)) };
      table.push(row);
      console.log(
        state.padEnd(11),
        arm.padEnd(9),
        String(k).padStart(2),
        String(row.marks).padStart(12),
        '  ' + fps.map((f) => f.toFixed(1).padStart(5)).join(' ').padEnd(22),
        row.fps.toFixed(1).padStart(6),
        (row.p95.toFixed(1) + 'ms').padStart(8)
      );
    }
  }
}

await browser.close();
server.close();

// The comparison the whole exercise is for: how much more does a canvas
// absorb than a pool of elements, at the same frame rate?
console.log('');
for (const state of STATES) {
  const at60 = (arm) => {
    const rows = table.filter((r) => r.state === state && r.arm === arm && r.fps >= 55);
    return rows.length ? Math.max(...rows.map((r) => r.marks)) : 0;
  };
  console.log(
    `${state}: marks/frame still at ~60fps — canvas ${at60('canvas')}, ` +
      `views ${at60('views')}, lynx ${at60('lynx')}`
  );
}
