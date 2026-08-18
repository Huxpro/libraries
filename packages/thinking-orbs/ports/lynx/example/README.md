# thinking-orbs-lynx example

A [rspeedy](https://lynxjs.org) ReactLynx app with two entries:

- **`src/index.tsx` → the showcase.** All nine states at both tuned sizes,
  with a theme toggle.
- **`src/parity.tsx` → the harness card.** Orbs with no chrome on a
  transparent background, configured entirely through `global-props`. The
  verification scripts in `../thinking-orbs-lynx/scripts` drive this one.

```bash
npm install
npx rspeedy build     # dist/main.{web,lynx}.bundle + dist/parity.{web,lynx}.bundle
npx rspeedy dev       # QR code for Lynx Explorer, plus a web preview URL
```

`lynx.config.ts` declares both the `lynx` and `web` environments, so one
build produces the native bundle and the Lynx-for-Web bundle the harness
loads in a headless browser.

To run the verification from here:

```bash
cd ../thinking-orbs-lynx
npm run parity        # frozen frames vs the web canvas renderer
npm run live-check    # motion, pause, reduced motion, theme, frame cost
```
