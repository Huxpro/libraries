// Platform behaviours the web library gets from the DOM.
//
//   theme      web:  data-theme ancestor / prefers-color-scheme
//              Lynx: lynx.__globalProps.appTheme, which is how a Lynx host
//                    publishes its appearance to the front end. Reading it
//                    through `useGlobalProps()` means a host that updates
//                    globalProps re-renders the orb, so live theme switches
//                    work the same way they do on the web.
//
//   reduced    web:  prefers-reduced-motion
//              Lynx: no equivalent exists — see the `reducedMotion` prop.
//
//   pause      web:  IntersectionObserver + visibilitychange
//              Lynx: no cheap ambient signal; callers drive `paused`.

import { useGlobalProps } from '@lynx-js/react';
import type { OrbTheme } from './types.js';

interface ThemedGlobalProps {
  appTheme?: string;
}

/**
 * Resolve the effective dark/light substrate. Unknown resolves to dark,
 * matching the web build's pre-mount fallback and the React Native port.
 */
export function useResolvedDark(theme: OrbTheme): boolean {
  const globalProps = useGlobalProps() as ThemedGlobalProps | undefined;
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return globalProps?.appTheme !== 'light';
}
