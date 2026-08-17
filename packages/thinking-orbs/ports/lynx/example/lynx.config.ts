import { defineConfig } from '@lynx-js/rspeedy'

import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin'
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin'
import { pluginTypeCheck } from '@rsbuild/plugin-type-check'

export default defineConfig({
  plugins: [
    pluginQRCode({
      schema(url) {
        // `?fullscreen=true` opens the page in LynxExplorer full screen
        return `${url}?fullscreen=true`
      },
    }),
    pluginReactLynx(),
    pluginTypeCheck(),
  ],
  source: {
    entry: {
      // the showcase
      main: './src/index.tsx',
      // one frozen orb, driven by global-props — see scripts/parity.mjs
      parity: './src/parity.tsx',
    },
  },
  environments: {
    // `lynx` is the native bundle; `web` is Lynx for Web, which is what the
    // parity harness loads in a headless browser
    lynx: {},
    web: {},
  },
})
