// Assembles the deployable harness into `dist/`.
//
// Everything the page needs is a static file, because Lynx for Web is a
// static file: a prebuilt client runtime, a `.web.bundle` compiled from the
// ReactLynx source, and the web library's own engine for the reference
// canvas. There is no server side and nothing is mocked — the page boots the
// same bundle `scripts/parity.mjs` screenshots in CI.
//
//   npm run build -w @sites/orbs-lynx
//
// Steps: build the web library (for dist/engine.js), install + build the
// Lynx example (for the two .web.bundle files), then copy those plus the
// Lynx-for-Web client runtime next to the page.

import { cpSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const orbs = join(repo, 'packages/thinking-orbs');
const port = join(orbs, 'ports/lynx/thinking-orbs-lynx');
const example = join(orbs, 'ports/lynx/example');
const dist = join(here, 'dist');

const run = (cmd, args, cwd) => {
  process.stdout.write(`\n$ ${cmd} ${args.join(' ')}   (${cwd.replace(repo, '.')})\n`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error(`\nfailed: ${cmd} ${args.join(' ')}`);
    process.exit(r.status ?? 1);
  }
};

// 1. the web library — the reference renderer the page diffs against
if (!existsSync(join(orbs, 'dist/engine.es.js'))) {
  run('npm', ['run', 'build'], orbs);
}

// 2. the Lynx bundles. Neither the port nor the example is an npm workspace
//    (each carries its own lockfile, like the React Native pair), so each
//    installs itself.
//
//    The port's own install is not optional here even though the example is
//    what gets built: the example links the port by path rather than through
//    its node_modules, so when the type checker follows an import into
//    `thinking-orbs-lynx/src`, TypeScript resolves `@lynx-js/react` from
//    THAT directory upwards and finds nothing. (A real consumer install is
//    unaffected — the package sits inside the app's node_modules, so the
//    lookup lands on the app's copy.) Skipping this is a clean-clone-only
//    failure, which is exactly the kind CI and a deploy hit and a working
//    tree never does.
//    `--ignore-scripts` on the port: all a deploy build needs from it is the
//    presence of its type dependencies, and its devDependencies include
//    Playwright, whose install script would otherwise pull a browser down
//    into a build that never opens one.
if (!existsSync(join(port, 'node_modules'))) {
  run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts'], port);
}
if (!existsSync(join(example, 'node_modules'))) {
  run('npm', ['install', '--no-audit', '--no-fund'], example);
}
run('npx', ['rspeedy', 'build'], example);

// 3. assemble
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

cpSync(join(here, 'public'), dist, { recursive: true });
cpSync(join(orbs, 'dist/engine.es.js'), join(dist, 'engine.js'));
for (const file of ['main.web.bundle', 'parity.web.bundle']) {
  cpSync(join(example, 'dist', file), join(dist, file));
}

// Lynx for Web ships a prebuilt client (JS + CSS + the wasm it lazy-loads).
// Serve it as-is rather than re-bundling a copy the harness would then have
// to keep in step.
const client = join(
  dirname(require.resolve('@lynx-js/web-core/package.json')),
  'dist/client_prod/static'
);
cpSync(client, join(dist, 'static'), { recursive: true });

const bytes = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce(
    (n, e) =>
      n + (e.isDirectory() ? bytes(join(dir, e.name)) : statSync(join(dir, e.name)).size),
    0
  );
console.log(`\nbuilt ${dist.replace(repo, '.')} — ${(bytes(dist) / 1024 / 1024).toFixed(2)} MB`);
