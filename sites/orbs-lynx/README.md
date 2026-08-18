# @sites/orbs-lynx

The live harness for the [Lynx port](../../packages/thinking-orbs/ports/lynx/thinking-orbs-lynx):
a static page that boots the port in **Lynx for Web** and diffs it against
the web library's canvas painter in the browser, in front of you.

It is the same evidence `scripts/parity.mjs` collects headlessly, except you
drive it: pick a state, size, theme and engine instant, and the third tile
stacks the two renderers under `mix-blend-mode: difference` with an
amplifier, so "identical" is something you can see rather than a number you
have to take on faith.

```bash
npm install                      # from the repo root
npm run build:site-orbs-lynx     # → sites/orbs-lynx/dist
npm run dev -w @sites/orbs-lynx  # build + serve on :4173
```

## What the build does

There is no framework and no bundler here — Lynx for Web is a static file,
so the page is too. `build.mjs`:

1. builds `thinking-orbs` (for `dist/engine.js`, the reference renderer),
2. installs and builds the Lynx example (for `main.web.bundle` and
   `parity.web.bundle` — the example carries its own lockfile, like the
   React Native one, so it installs itself),
3. copies those plus the prebuilt `@lynx-js/web-core` client runtime next to
   `public/`.

## Deploying

`vercel.json` at the repo root points a Vercel project at this site:

| setting | value |
|---|---|
| Root Directory | the repository root |
| Build Command | `npm run build:site-orbs-lynx` |
| Output Directory | `sites/orbs-lynx/dist` |
| Framework Preset | Other |

Those three come from `vercel.json`, so a project pointed at the repo root
needs no manual configuration. `.node-version` pins Node 20, which is what
rspeedy requires.

The other three sites in this repo deploy elsewhere (GitHub Pages,
Cloudflare Pages) and are untouched by that file.
