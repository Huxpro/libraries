// The moving half of the verification: the parity harness freezes time, so
// by construction it cannot tell an animation from a still. This one runs
// the orbs live in Lynx for Web and answers the two questions a frozen
// diff leaves open.
//
//   1. Does it actually animate? Two captures a few frames apart must
//      differ — and differ by more than noise.
//   2. What does it cost the main thread? Every dot is one element write
//      per frame, so the heaviest mode (`composing` at 64, 566 dots) is
//      the one worth measuring, alone and several at once.
//
// The cost number is the browser's frame cadence with the orbs mounted,
// against the same page's cadence with nothing mounted. It is a Lynx for
// Web measurement on desktop Chromium, NOT a phone measurement — treat it
// as a ceiling check on the approach (are we writing a sane number of
// properties per frame?), not as device performance.
//
// Run: npm run live-check   [-- --state composing --size 64 --counts 1,4]

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const STATE = flag('state', 'composing');
const SIZE = Number(flag('size', '64'));
const COUNTS = String(flag('counts', '1,4')).split(',').map(Number);
const SECONDS = Number(flag('seconds', '3'));

const bundle = resolve(process.cwd(), flag('bundle', resolve(pkgRoot, '../example/dist/parity.web.bundle')));
if (!existsSync(bundle)) {
  console.error(
    `missing ${bundle}\n\nBuild the example app first:\n  cd ${resolve(pkgRoot, '../example')} && npm install && npx rspeedy build`
  );
  process.exit(2);
}
const clientDir = resolve(
  dirname(require.resolve('@lynx-js/web-core/package.json')),
  'dist/client_prod'
);

const { chromium } = require('playwright');
const { PNG } = require('pngjs');

const HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="/static/css/client.css">
<script src="/static/js/client.js" type="module"></script>
<style>html,body{margin:0;padding:0;background:transparent}
lynx-view{display:block;position:absolute;left:0;top:0}</style>
</head><body></body></html>`;

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };

const server = await new Promise((ok) => {
  const s = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    try {
      if (path === '/favicon.ico') return res.writeHead(204).end();
      if (path === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end(HTML);
      }
      const file = path === '/parity.web.bundle' ? bundle : join(clientDir, path);
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
const page = await browser.newPage({
  viewport: { width: 600, height: 300 },
  deviceScaleFactor: 1
});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await page.goto(`http://localhost:${port}/`);

/** Frame cadence of the page itself, in ms between animation frames. */
const cadence = (seconds) =>
  page.evaluate(async (secs) => {
    const deltas = [];
    await new Promise((done) => {
      let last = performance.now();
      const stop = last + secs * 1000;
      const tick = (now) => {
        deltas.push(now - last);
        last = now;
        if (now < stop) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    deltas.sort((a, b) => a - b);
    return {
      frames: deltas.length,
      median: deltas[Math.floor(deltas.length / 2)],
      p95: deltas[Math.floor(deltas.length * 0.95)]
    };
  }, seconds);

const mount = (props, across = 1) =>
  page.evaluate(
    ({ props, width, height }) => {
      document.body.innerHTML = '';
      const v = document.createElement('lynx-view');
      v.setAttribute('url', '/parity.web.bundle');
      v.setAttribute('global-props', JSON.stringify(props));
      v.setAttribute('height', 'fixed');
      v.setAttribute('width', 'fixed');
      v.style.width = `${width}px`;
      v.style.height = `${height}px`;
      document.body.appendChild(v);
    },
    { props, width: (props.size ?? 64) * across, height: props.size ?? 64 }
  );

const shot = () =>
  page.screenshot({ clip: { x: 0, y: 0, width: SIZE, height: SIZE }, omitBackground: true });

/** Mean per-pixel change between two captures, composited on black. */
function change(aBuf, bBuf) {
  const a = PNG.sync.read(aBuf);
  const b = PNG.sync.read(bBuf);
  let sum = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const aa = a.data[o + 3] / 255;
    const ba = b.data[o + 3] / 255;
    sum += Math.abs(a.data[o] * aa - b.data[o] * ba);
  }
  return sum / n;
}

await page.evaluate(() => {
  document.body.innerHTML = '';
});
await page.waitForTimeout(300);
const base = await cadence(SECONDS);
console.log(
  `baseline (nothing mounted)     ${base.frames} frames · median ${base.median.toFixed(2)} ms · p95 ${base.p95.toFixed(2)} ms`
);

let failed = false;
for (const count of COUNTS) {
  await mount({ state: STATE, size: SIZE, dark: true, live: count }, count);
  await page.waitForTimeout(900);

  const a = await shot();
  await page.waitForTimeout(120);
  const b = await shot();
  const moved = change(a, b);

  const run = await cadence(SECONDS);
  console.log(
    `${String(count).padStart(2)} × ${STATE}@${SIZE} live       ${run.frames} frames · median ${run.median.toFixed(2)} ms · ` +
      `p95 ${run.p95.toFixed(2)} ms · moved ${moved.toFixed(3)}/255 between captures`
  );
  // A still image would sit at ~0. Real motion in these animations moves
  // far more ink than that even over two frames.
  if (moved < 0.05) {
    console.error(`  FAIL — ${count} × ${STATE}@${SIZE} did not change between captures`);
    failed = true;
  }
  if (run.median > base.median * 2 + 4) {
    console.error(`  FAIL — frame cadence collapsed (${run.median.toFixed(2)} ms vs ${base.median.toFixed(2)} ms)`);
    failed = true;
  }
}

// ── behaviour matrix ─────────────────────────────────────────────────────
// Everything a frozen pixel diff structurally cannot see: whether the props
// that are supposed to STOP the animation stop it, and whether `auto` reads
// the host's appearance.

const captureTwice = async (props, waitMs = 250) => {
  await mount(props);
  await page.waitForTimeout(900);
  const a = await shot();
  await page.waitForTimeout(waitMs);
  return [a, await shot()];
};

/** Mean ink (composited on black) — tells dark ink from light ink. */
function meanInk(buf) {
  const p = PNG.sync.read(buf);
  let sum = 0;
  const n = p.width * p.height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    sum += p.data[o] * (p.data[o + 3] / 255);
  }
  return sum / n;
}

const behaviours = [];
const expect = (name, ok, detail) => {
  behaviours.push({ name, ok, detail });
  if (!ok) failed = true;
};

{
  const [a, b] = await captureTwice({ state: STATE, size: SIZE, dark: true, live: 1, paused: true });
  const moved = change(a, b);
  expect('paused holds one frame', moved < 0.01, `moved ${moved.toFixed(4)}/255`);
}
{
  const [a, b] = await captureTwice({
    state: STATE,
    size: SIZE,
    dark: true,
    live: 1,
    reducedMotion: true
  });
  const moved = change(a, b);
  // ...and it must be the SAME instant the web and RN ports freeze on.
  await mount({ state: STATE, size: SIZE, dark: true, t: 0.6 });
  await page.waitForTimeout(900);
  const golden = await shot();
  const drift = change(a, golden);
  expect('reduced motion holds one frame', moved < 0.01, `moved ${moved.toFixed(4)}/255`);
  expect('reduced motion frame is t=0.6', drift < 0.05, `differs by ${drift.toFixed(4)}/255`);
}
{
  await mount({ state: STATE, size: SIZE, theme: 'auto', appTheme: 'dark', t: 0.6 });
  await page.waitForTimeout(900);
  const autoDark = await shot();
  await mount({ state: STATE, size: SIZE, theme: 'auto', appTheme: 'light', t: 0.6 });
  await page.waitForTimeout(900);
  const autoLight = await shot();
  await mount({ state: STATE, size: SIZE, theme: 'light', t: 0.6 });
  await page.waitForTimeout(900);
  const pinnedLight = await shot();

  const inkDark = meanInk(autoDark);
  const inkLight = meanInk(autoLight);
  const drift = change(autoLight, pinnedLight);
  expect(
    'theme auto follows appTheme',
    inkDark > inkLight * 2,
    `mean ink ${inkDark.toFixed(2)} dark vs ${inkLight.toFixed(2)} light`
  );
  expect('auto+light === theme="light"', drift < 0.05, `differs by ${drift.toFixed(4)}/255`);
}

console.log('');
for (const b of behaviours) {
  console.log(`${b.ok ? 'ok  ' : 'FAIL'} ${b.name.padEnd(32)} ${b.detail}`);
}

await browser.close();
server.close();

if (errors.length) {
  console.log(`\n${errors.length} runtime error(s):`);
  for (const e of [...new Set(errors)].slice(0, 10)) console.log('  ' + e);
  failed = true;
}
console.log(failed ? '\nFAIL' : '\nPASS');
process.exit(failed ? 1 : 0);
