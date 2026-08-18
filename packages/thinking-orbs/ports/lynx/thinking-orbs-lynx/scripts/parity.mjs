// The pixel parity harness: renders this port through LYNX FOR WEB in a
// headless browser and diffs it against the web library's canvas painter,
// frame for frame, at frozen instants.
//
// Why this is worth doing rather than trusting the golden vectors: the
// vectors call the engine directly and never go through the component, so
// they cannot see a view that is mis-positioned, a transform origin that is
// off, an ink value that lost its alpha, or a freeze hook that froze the
// wrong moment. The iOS port shipped exactly that last bug and only a pixel
// diff caught it (worst mean 38/255 — an order of magnitude past anything
// antialiasing explains).
//
// Both sides run in the SAME browser, on the same rasteriser, from the same
// geometry, at the same device pixel ratio. That is deliberate: it removes
// the sub-pixel-circle disagreement that dominated the Skia and CoreGraphics
// comparisons, and leaves the port's own draw sequence as the only variable.
//
// Run (from this package):
//   npm run build -w ../example      # or: cd ../example && npx rspeedy build
//   npm run parity
//
// Options: --states a,b  --sizes 64,20  --themes dark,light  --times 0.6,3.3
//          --out <dir>  --keep (leave the PNGs on disk)
//          --bundle <path to a parity.web.bundle>  --threshold <mean/255>
//          --display <px> (exercise the displaySize scaling path)

import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
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
const list = (name, fallback) =>
  String(flag(name, fallback))
    .split(',')
    .filter(Boolean);

const STATES = list(
  'states',
  'working,searching,solving,listening,connecting,weaving,composing,breathing,shaping'
);
const SIZES = list('sizes', '64,20').map(Number);
const THEMES = list('themes', 'dark,light');
// Two of the four instants the golden vectors are indexed by: one inside a
// hold phase, one mid-transition (the lesson from border-beam's freeze
// window finding).
const TIMES = list('times', '0.6,3.3').map(Number);
// Optional: render the `size` design into a different px box, i.e. the
// `displaySize` prop, which is the only path where the drawing is scaled.
const DISPLAY = flag('display', '') ? Number(flag('display', '')) : null;
const OUT = resolve(process.cwd(), flag('out', 'parity-out'));
const KEEP = argv.includes('--keep');
const DPR = 2;

const bundle = resolve(process.cwd(), flag('bundle', resolve(pkgRoot, '../example/dist/parity.web.bundle')));
if (!existsSync(bundle)) {
  console.error(
    `missing ${bundle}\n\nBuild the example app first:\n  cd ${resolve(pkgRoot, '../example')} && npm install && npx rspeedy build`
  );
  process.exit(2);
}

const engine = resolve(orbsRoot, 'dist/engine.es.js');
if (!existsSync(engine)) {
  console.error(`missing ${engine}\n\nBuild the web library first:\n  npm run build -w thinking-orbs`);
  process.exit(2);
}

// Lynx for Web ships a prebuilt client; serve it as-is rather than bundling
// a harness-only copy.
const clientDir = resolve(
  dirname(require.resolve('@lynx-js/web-core/package.json')),
  'dist/client_prod'
);

const { chromium } = require('playwright');
const { PNG } = require('pngjs');

const LYNX_HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="/static/css/client.css">
<script src="/static/js/client.js" type="module"></script>
<style>html,body{margin:0;padding:0;background:transparent}
lynx-view{display:block;position:absolute;left:0;top:0}</style>
</head><body></body></html>`;

const WEB_HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}
canvas{display:block;position:absolute;left:0;top:0}</style>
</head><body><canvas id="c"></canvas>
<script type="module">
import { MODE_FRAMES, resolvePreset, paintFrame } from '/engine.js';
window.__render = (state, size, t, dark, display) => {
  const box = display || size;
  const zoom = box / size;
  const c = document.getElementById('c');
  c.width = box * ${DPR};
  c.height = box * ${DPR};
  c.style.width = box + 'px';
  c.style.height = box + 'px';
  const ctx = c.getContext('2d');
  // displaySize scales the DRAWING, not a rasterised canvas: the port
  // scales each dot transform, this scales the context. Same picture.
  ctx.setTransform(${DPR} * zoom, 0, 0, ${DPR} * zoom, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const { mode, opts } = resolvePreset(state, size);
  paintFrame(ctx, MODE_FRAMES[mode](size, t, opts), dark);
};
window.__ready = true;
</script></body></html>`;

const TYPES = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.bundle': 'text/javascript'
};

function serve(port) {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    try {
      if (path === '/favicon.ico') return res.writeHead(204).end();
      if (path === '/lynx.html') return send(res, 'text/html', Buffer.from(LYNX_HTML));
      if (path === '/web.html') return send(res, 'text/html', Buffer.from(WEB_HTML));
      const file =
        path === '/parity.web.bundle'
          ? bundle
          : path === '/engine.js'
            ? engine
            : join(clientDir, path);
      send(res, TYPES[extname(file)] ?? 'application/octet-stream', await readFile(file));
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(port, () => ok(server)));
}

function send(res, type, body) {
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

/**
 * Composited-on-black RGB difference. These are transparent PNGs and raw
 * RGBA diffing punishes fully-transparent pixels whose colour channels are
 * undefined; what matters is what a viewer sees.
 */
function diff(aBuf, bBuf) {
  const a = PNG.sync.read(aBuf);
  const b = PNG.sync.read(bBuf);
  if (a.width !== b.width || a.height !== b.height) {
    return { note: `size ${a.width}x${a.height} vs ${b.width}x${b.height}` };
  }
  const n = a.width * a.height;
  const diffs = new Float64Array(n);
  let sum = 0;
  let max = 0;
  let hot = 0;
  let inkA = 0;
  let inkB = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const aa = a.data[o + 3] / 255;
    const ba = b.data[o + 3] / 255;
    let d = 0;
    for (let c = 0; c < 3; c++) {
      d = Math.max(d, Math.abs(a.data[o + c] * aa - b.data[o + c] * ba));
    }
    inkA += ((a.data[o] + a.data[o + 1] + a.data[o + 2]) / 3) * aa;
    inkB += ((b.data[o] + b.data[o + 1] + b.data[o + 2]) / 3) * ba;
    diffs[i] = d;
    sum += d;
    if (d > max) max = d;
    if (d > 16) hot++;
  }
  const sorted = Array.from(diffs).sort((x, y) => x - y);
  return {
    mean: sum / n,
    p99: sorted[Math.floor(n * 0.99)],
    max,
    hotPct: (hot / n) * 100,
    inkRatio: inkB === 0 ? 1 : inkA / inkB
  };
}

const server = await serve(0);
const port = server.address().port;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined
});
const context = await browser.newContext({
  viewport: { width: 200, height: 200 },
  deviceScaleFactor: DPR
});

const lynxPage = await context.newPage();
const errors = [];
lynxPage.on('pageerror', (e) => errors.push(String(e.message)));
lynxPage.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await lynxPage.goto(`http://localhost:${port}/lynx.html`);

const webPage = await context.newPage();
await webPage.goto(`http://localhost:${port}/web.html`);
await webPage.waitForFunction('window.__ready === true');

await rm(OUT, { recursive: true, force: true });
await mkdir(join(OUT, 'lynx'), { recursive: true });
await mkdir(join(OUT, 'web'), { recursive: true });

const rows = [];
for (const state of STATES) {
  for (const size of SIZES) {
    for (const themeName of THEMES) {
      const dark = themeName === 'dark';
      for (const t of TIMES) {
        const box = DISPLAY ?? size;
        const key = `${state}-${size}${DISPLAY ? `@${DISPLAY}` : ''}-${themeName}-${t}`;

        // A fresh lynx-view per case: `global-props` is read when the card
        // boots, which makes each capture an independent, honest mount
        // rather than a live update the harness would have to trust.
        await lynxPage.evaluate(
          ({ props, size }) => {
            document.body.innerHTML = '';
            const v = document.createElement('lynx-view');
            v.setAttribute('url', '/parity.web.bundle');
            v.setAttribute('global-props', JSON.stringify(props));
            v.setAttribute('height', 'fixed');
            v.setAttribute('width', 'fixed');
            v.style.width = `${size}px`;
            v.style.height = `${size}px`;
            document.body.appendChild(v);
          },
          { props: { state, size, dark, t, display: DISPLAY ?? undefined }, size: box }
        );
        // wait for the card to boot and paint its one frozen frame
        await lynxPage.waitForTimeout(700);
        const lynxPng = await lynxPage.screenshot({
          clip: { x: 0, y: 0, width: box, height: box },
          omitBackground: true
        });

        await webPage.evaluate(
          ({ state, size, t, dark, display }) => window.__render(state, size, t, dark, display),
          { state, size, t, dark, display: DISPLAY }
        );
        const webPng = await webPage.screenshot({
          clip: { x: 0, y: 0, width: box, height: box },
          omitBackground: true
        });

        await writeFile(join(OUT, 'lynx', `${key}.png`), lynxPng);
        await writeFile(join(OUT, 'web', `${key}.png`), webPng);
        rows.push({ key, ...diff(lynxPng, webPng) });
      }
    }
  }
}

await browser.close();
server.close();

console.log('case                                mean/255   p99   max   hot%   ink');
for (const r of rows) {
  if (r.note) {
    console.log(`${r.key.padEnd(34)} ${r.note}`);
    continue;
  }
  console.log(
    `${r.key.padEnd(34)} ${r.mean.toFixed(3).padStart(8)} ${r.p99.toFixed(2).padStart(5)} ` +
      `${r.max.toFixed(1).padStart(5)} ${r.hotPct.toFixed(2).padStart(6)} ${r.inkRatio.toFixed(3).padStart(6)}`
  );
}

const scored = rows.filter((r) => !r.note);
const worstMean = Math.max(...scored.map((r) => r.mean));
console.log(
  `\nworst mean ${worstMean.toFixed(3)}/255 · worst p99 ${Math.max(...scored.map((r) => r.p99)).toFixed(1)} · ` +
    `worst hot-pixel share ${Math.max(...scored.map((r) => r.hotPct)).toFixed(2)}% · ` +
    `ink ratio ${Math.min(...scored.map((r) => r.inkRatio)).toFixed(3)}–${Math.max(...scored.map((r) => r.inkRatio)).toFixed(3)} ` +
    `(${scored.length} frames)`
);
if (errors.length) {
  console.log(`\n${errors.length} runtime error(s) from the Lynx card:`);
  for (const e of [...new Set(errors)].slice(0, 10)) console.log('  ' + e);
}
if (!KEEP) await rm(OUT, { recursive: true, force: true });
else console.log(`\nPNGs in ${OUT}`);

// Both sides share a rasteriser here, so anything above a fraction of a
// grey level is a real difference in the draw sequence, not antialiasing.
const THRESHOLD = Number(flag('threshold', '1.5'));
if (worstMean > THRESHOLD) {
  console.error(`\nFAIL — worst mean ${worstMean.toFixed(3)} exceeds ${THRESHOLD}/255`);
  process.exit(1);
}
console.log('\nPASS');
