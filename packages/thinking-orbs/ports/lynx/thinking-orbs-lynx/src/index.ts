export { ThinkingOrb } from './ThinkingOrb.js';
export type { ThinkingOrbProps, OrbState, OrbSize, OrbTheme } from './types.js';

// Same power-user surface as the web package, re-exported so consumers do
// not need a second dependency to drive their own pool of views.
export { MODE_FRAMES, resolvePreset, STATE_TO_MODE } from 'thinking-orbs/engine';
export type { Dot, Line, OrbFrame, ModeFrame, ModeKey } from 'thinking-orbs/engine';
