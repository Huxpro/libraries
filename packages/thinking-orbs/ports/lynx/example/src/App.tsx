// The showcase card: every shipped state at both tuned sizes, with a
// theme toggle. Mirrors the web demo's chip grid.

import { useState } from '@lynx-js/react';
import { ThinkingOrb } from 'thinking-orbs-lynx';
import type { OrbState } from 'thinking-orbs-lynx';

const STATES: OrbState[] = [
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

export function App() {
  const [dark, setDark] = useState(true);
  const ink = dark ? '#f5f5f5' : '#141414';
  const muted = dark ? '#8a8a8a' : '#6b6b6b';

  return (
    <scroll-view
      scroll-orientation="vertical"
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: dark ? '#0b0b0c' : '#fbfbfb'
      }}
    >
      <view style={{ padding: '24px' }}>
        <text style={{ color: ink, fontSize: '22px', fontWeight: 'bold' }}>thinking-orbs</text>
        <text style={{ color: muted, fontSize: '13px', marginTop: '4px' }}>
          ReactLynx port — nine states, two tuned sizes
        </text>

        <view
          bindtap={() => setDark((d) => !d)}
          style={{
            marginTop: '16px',
            marginBottom: '8px',
            paddingTop: '8px',
            paddingBottom: '8px',
            paddingLeft: '14px',
            paddingRight: '14px',
            alignSelf: 'flex-start',
            borderRadius: '999px',
            backgroundColor: dark ? '#1c1c1f' : '#ececef'
          }}
        >
          <text style={{ color: ink, fontSize: '13px' }}>{dark ? 'dark' : 'light'} — tap to flip</text>
        </view>

        {STATES.map((state) => (
          <view
            key={state}
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              paddingTop: '10px',
              paddingBottom: '10px'
            }}
          >
            <ThinkingOrb state={state} size={64} theme={dark ? 'dark' : 'light'} />
            <view style={{ width: '20px' }} />
            <ThinkingOrb state={state} size={20} theme={dark ? 'dark' : 'light'} />
            <view style={{ width: '20px' }} />
            <text style={{ color: ink, fontSize: '15px' }}>{state}</text>
          </view>
        ))}
      </view>
    </scroll-view>
  );
}
