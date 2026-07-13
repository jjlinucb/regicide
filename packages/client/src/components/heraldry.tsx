import type { Suit } from '@regicide/shared';

/** Shared dark-fantasy palette + flavor name per suit, reused by BossPortrait and VictoryCrest. */
export interface SuitTheme {
  name: string;
  bgDark: string;
  bgLight: string;
  body: string;
  bodyDark: string;
  accent: string;
  glow: string;
}

export const SUIT_THEME: Record<Suit, SuitTheme> = {
  H: { name: 'Crimson Tyrant', bgDark: '#1c0709', bgLight: '#3d1015', body: '#5c2530', bodyDark: '#341018', accent: '#d9a544', glow: '#ff4d4d' },
  D: { name: 'Gilded Despot', bgDark: '#1c1403', bgLight: '#3d2b08', body: '#7a5a1f', bodyDark: '#3f2d0d', accent: '#e8c15a', glow: '#ffcc33' },
  C: { name: 'Feral Warlord', bgDark: '#0a1005', bgLight: '#182408', body: '#33481f', bodyDark: '#1a2610', accent: '#9fc46a', glow: '#7dff5e' },
  S: { name: 'Shadow Wraith-King', bgDark: '#0a0714', bgLight: '#180f2e', body: '#2e2050', bodyDark: '#160f2b', accent: '#b494e0', glow: '#b666ff' },
};

/** A small suit sigil, drawn from scratch (no emoji/system glyphs) — reused on boss chests and the victory crest. */
export function SuitEmblem({ suit, accent, size = 22 }: { suit: Suit; accent: string; size?: number }) {
  const half = size / 2;
  switch (suit) {
    case 'H':
      // A stylized flame-heart.
      return (
        <path
          d={`M0,${half * 0.6} C${-half},${-half * 0.6} ${-half * 0.5},${-half} 0,${-half * 0.15}
              C${half * 0.5},${-half} ${half},${-half * 0.6} 0,${half * 0.6} Z`}
          fill={accent}
        />
      );
    case 'D':
      // A faceted gem.
      return <path d={`M0,${-half} L${half},0 L0,${half} L${-half},0 Z`} fill={accent} />;
    case 'C':
      // Three claw-mark slashes.
      return (
        <g stroke={accent} strokeWidth={size * 0.16} strokeLinecap="round" fill="none">
          <path d={`M${-half * 0.7},${-half} L${-half * 0.2},${half}`} />
          <path d={`M0,${-half} L0,${half}`} />
          <path d={`M${half * 0.7},${-half} L${half * 0.2},${half}`} />
        </g>
      );
    case 'S':
      // A crescent moon.
      return (
        <path
          d={`M${half * 0.3},${-half} A${half},${half} 0 1 0 ${half * 0.3},${half}
              A${half * 0.65},${half * 0.65} 0 1 1 ${half * 0.3},${-half} Z`}
          fill={accent}
        />
      );
  }
}
