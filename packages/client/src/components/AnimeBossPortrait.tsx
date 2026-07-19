import type { Suit } from '@regicide/shared';
import { SUIT_THEME, SuitEmblem } from './heraldry';

type Rank = 'J' | 'Q' | 'K';
const TIER: Record<Rank, 1 | 2 | 3> = { J: 1, Q: 2, K: 3 };
const INK = '#160a1e';
const ink = (w = 3) => ({ stroke: INK, strokeWidth: w, strokeLinejoin: 'round' as const });

/** Big anime speed-lines radiating from behind the head — the shonen "power panel" cue. */
function ActionBurst({ color }: { color: string }) {
  const lines: JSX.Element[] = [];
  for (let i = 0; i < 20; i++) {
    const angle = (Math.PI / 10) * i;
    const len = 100 + (i % 4) * 10;
    const x2 = 100 + Math.cos(angle) * len;
    const y2 = 100 + Math.sin(angle) * len;
    lines.push(<line key={i} x1={100} y1={100} x2={x2} y2={y2} stroke={color} strokeWidth={1.6} opacity={0.16} />);
  }
  return <g>{lines}</g>;
}

/** Oversized, glossy anime eyes — the single most defining feature of the style. */
function AnimeEyes({ color, glow }: { color: string; glow: string }) {
  return (
    <g>
      {[-1, 1].map((side) => (
        <g key={side} transform={`translate(${100 + side * 14},96)`}>
          <ellipse rx={9} ry={11} fill="#160a1e" />
          <ellipse rx={7} ry={9} fill={color} />
          <ellipse cx={-2} cy={-3} rx={2.6} ry={3.4} fill="#fff" opacity={0.9} />
          <ellipse cx={1.5} cy={2} rx={1.2} ry={1.6} fill="#fff" opacity={0.6} />
          <ellipse rx={7} ry={9} fill="none" stroke={glow} strokeWidth={0.8} opacity={0.7} filter="url(#animeGlow)" />
        </g>
      ))}
    </g>
  );
}

/** Jagged, wind-blown spiky hair — height/spike-count scales with rank for a "power-up" read. */
function SpikyHair({ tier, color, dark }: { tier: 1 | 2 | 3; color: string; dark: string }) {
  const spikes = tier === 1 ? 5 : tier === 2 ? 7 : 9;
  const height = tier === 1 ? 34 : tier === 2 ? 50 : 68;
  const pts: string[] = [];
  for (let i = 0; i <= spikes; i++) {
    const x = 60 + (80 * i) / spikes;
    const h = i % 2 === 0 ? height : height * 0.45;
    pts.push(`${x},${68 - h}`);
  }
  const path = `M55,72 ${pts.map((p) => `L${p}`).join(' ')} L145,72 Q100,${86} 55,72 Z`;
  return (
    <g>
      <path d={path} fill={color} {...ink(2.5)} />
      <path d={`M55,72 ${pts.slice(0, Math.ceil(pts.length / 2)).map((p) => `L${p}`).join(' ')}`} stroke={dark} strokeWidth={2} fill="none" opacity={0.5} />
    </g>
  );
}

function Face({ theme }: { theme: (typeof SUIT_THEME)['H'] }) {
  return (
    <g>
      <ellipse cx={100} cy={100} rx={30} ry={34} fill="#f2d9c2" {...ink(2.5)} />
      <AnimeEyes color={theme.glow} glow={theme.accent} />
      <path d="M92,116 Q100,120 108,116" stroke={INK} strokeWidth={2} fill="none" strokeLinecap="round" />
    </g>
  );
}

/** Hearts — a fiery blade-wielding hero archetype, cape whipping in the wind. */
function CrimsonHero({ tier, theme }: { tier: 1 | 2 | 3; theme: (typeof SUIT_THEME)['H'] }) {
  return (
    <g>
      <path d={`M40,150 Q20,${120 - tier * 10} 45,${95 - tier * 4} L60,150 Q100,168 140,150 L155,${95 - tier * 4} Q180,${120 - tier * 10} 160,150 Q100,180 40,150 Z`} fill={theme.bodyDark} opacity={0.85} {...ink(2)} />
      <path d="M62,150 L70,100 L130,100 L138,150 Q100,170 62,150 Z" fill={theme.body} {...ink(3)} />
      <SpikyHair tier={tier} color={theme.bodyDark} dark={INK} />
      <Face theme={theme} />
      <g transform="translate(100,132)">
        <SuitEmblem suit="H" accent={theme.glow} size={16} />
      </g>
      <g transform={`translate(155,${150 - tier * 10}) rotate(${18 + tier * 4})`}>
        <path d={`M-7,${-70 - tier * 10} L7,${-70 - tier * 10} L4,0 L-4,0 Z`} fill={theme.glow} {...ink(2)} filter="url(#animeGlow)" />
        <rect x={-12} y={0} width={24} height={8} rx={2} fill={theme.bodyDark} {...ink(2)} />
      </g>
    </g>
  );
}

/** Diamonds — a sharp-dressed rival-rogue with a glinting rapier and a smirk. */
function GildedRogue({ tier, theme }: { tier: 1 | 2 | 3; theme: (typeof SUIT_THEME)['D'] }) {
  return (
    <g>
      <path d="M64,150 L72,102 L128,102 L136,150 Q100,168 64,150 Z" fill={theme.body} {...ink(3)} />
      <path d="M72,110 L100,150 L128,110" stroke={theme.bodyDark} strokeWidth={3} fill="none" opacity={0.6} />
      <SpikyHair tier={tier} color={theme.bodyDark} dark={INK} />
      <Face theme={theme} />
      <g transform="translate(100,134)">
        <SuitEmblem suit="D" accent={theme.glow} size={15} />
      </g>
      <g transform={`translate(150,${145 - tier * 8}) rotate(${15 + tier * 3})`}>
        <line x1={0} y1={0} x2={0} y2={-(58 + tier * 10)} stroke={theme.glow} strokeWidth={1.6} filter="url(#animeGlow)" />
        <rect x={-8} y={0} width={16} height={6} rx={2} fill={theme.bodyDark} {...ink(1.5)} />
      </g>
    </g>
  );
}

/** Clubs — a hulking battle-brawler archetype, bandaged fists and a wide grin. */
function FeralBrawler({ tier, theme }: { tier: 1 | 2 | 3; theme: (typeof SUIT_THEME)['C'] }) {
  const bulk = tier === 1 ? 0 : tier === 2 ? 10 : 22;
  return (
    <g>
      <path d={`M${45 - bulk},155 L58,96 L142,96 L${155 + bulk},155 Q100,182 ${45 - bulk},155 Z`} fill={theme.body} {...ink(3)} />
      <SpikyHair tier={tier} color={theme.bodyDark} dark={INK} />
      <Face theme={theme} />
      <path d="M96,120 Q100,124 104,120" stroke={INK} strokeWidth={2} fill="none" strokeLinecap="round" />
      <g transform="translate(100,138)">
        <SuitEmblem suit="C" accent={theme.glow} size={18} />
      </g>
      <g transform={`translate(${152 + bulk * 0.4},${170 - tier * 6})`}>
        <circle r={10 + tier * 2} fill={theme.bodyDark} {...ink(2.5)} />
        <path d={`M${-8 - tier},0 L${8 + tier},0`} stroke="#f2f0e6" strokeWidth={2} opacity={0.6} />
      </g>
    </g>
  );
}

/** Spades — a cool, cloaked ninja/assassin archetype with a wind-sharp blade. */
function ShadowAssassin({ tier, theme }: { tier: 1 | 2 | 3; theme: (typeof SUIT_THEME)['S'] }) {
  return (
    <g>
      <path d="M66,150 L74,98 L126,98 L134,150 Q100,172 66,150 Z" fill={theme.body} {...ink(3)} />
      {tier >= 2 && <path d="M58,110 Q40,140 55,175 Q75,150 74,120 Z" fill={theme.bodyDark} opacity={0.7} {...ink(1.5)} />}
      {tier >= 2 && <path d="M142,110 Q160,140 145,175 Q125,150 126,120 Z" fill={theme.bodyDark} opacity={0.7} {...ink(1.5)} />}
      <SpikyHair tier={tier} color={theme.bodyDark} dark={INK} />
      <path d="M78,98 Q100,106 122,98 L122,106 Q100,114 78,106 Z" fill={theme.bodyDark} opacity={0.85} />
      <Face theme={theme} />
      <g transform="translate(100,130)">
        <SuitEmblem suit="S" accent={theme.glow} size={15} />
      </g>
      <g transform={`translate(150,${150 - tier * 8}) rotate(${-20 - tier * 5})`}>
        <path d={`M0,0 L${50 + tier * 12},-6 L${50 + tier * 12},4 Z`} fill={theme.glow} {...ink(1.5)} filter="url(#animeGlow)" />
      </g>
    </g>
  );
}

export function AnimeBossPortrait({ suit, rank, label }: { suit: Suit; rank: Rank; label?: string }) {
  const tier = TIER[rank];
  const theme = SUIT_THEME[suit];
  return (
    <svg viewBox="0 0 200 220" className="boss-svg" role="img" aria-label={label ?? `${theme.name} (anime style) boss portrait`}>
      <defs>
        <radialGradient id={`animeBg-${suit}`} cx="50%" cy="30%" r="85%">
          <stop offset="0%" stopColor={theme.bgLight} />
          <stop offset="100%" stopColor={theme.bgDark} />
        </radialGradient>
        <filter id="animeGlow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect x={0} y={0} width={200} height={220} fill={`url(#animeBg-${suit})`} />
      <ActionBurst color={theme.accent} />
      <ellipse cx={100} cy={206} rx={58} ry={9} fill="#000" opacity={0.35} />
      {suit === 'H' && <CrimsonHero tier={tier} theme={theme} />}
      {suit === 'D' && <GildedRogue tier={tier} theme={theme} />}
      {suit === 'C' && <FeralBrawler tier={tier} theme={theme} />}
      {suit === 'S' && <ShadowAssassin tier={tier} theme={theme} />}
      <rect x={3} y={3} width={194} height={214} fill="none" stroke={theme.accent} strokeWidth={3} opacity={0.85} />
    </svg>
  );
}
