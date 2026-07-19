import type { Suit } from '@regicide/shared';
import { SUIT_THEME, SuitEmblem } from './heraldry';

type Rank = 'J' | 'Q' | 'K';
const TIER: Record<Rank, 1 | 2 | 3> = { J: 1, Q: 2, K: 3 };

/** Bold dark-metal ink outline used on every plate — keeps the silhouette sharp instead of soft/flat. */
const INK = '#0a0810';
const ink = (w = 3) => ({ stroke: INK, strokeWidth: w, strokeLinejoin: 'round' as const });

/** Jagged lightning bolts crackling in the background, echoing a stormy dark-armor mood. */
function LightningBolts({ glow }: { glow: string }) {
  return (
    <g stroke={glow} strokeWidth={2} fill="none" opacity={0.55} filter="url(#bossGlow)" strokeLinejoin="round">
      <path d="M28,20 L40,45 L26,50 L44,90" />
      <path d="M175,15 L162,40 L178,48 L158,85" />
    </g>
  );
}

/** Radiating speed-lines behind the figure for dramatic impact-panel energy. */
function FocusLines({ color }: { color: string }) {
  const lines: JSX.Element[] = [];
  for (let i = 0; i < 16; i++) {
    const angle = (Math.PI / 8) * i;
    const len = 105 + (i % 3) * 8;
    const x2 = 100 + Math.cos(angle) * len;
    const y2 = 100 + Math.sin(angle) * len;
    lines.push(<line key={i} x1={100} y1={100} x2={x2} y2={y2} stroke={color} strokeWidth={2} opacity={0.12} />);
  }
  return <g>{lines}</g>;
}

/** A thin glowing eye-slit peering out of a fully-enclosed helm — no face, just menace. */
function EyeSlit({ x, y, side, glow }: { x: number; y: number; side: 1 | -1; glow: string }) {
  return (
    <g filter="url(#bossGlow)">
      <path d={`M${x - 6},${y} L${x + 6 * side},${y - 2} L${x + 6 * side},${y + 2.5} L${x - 6},${y + 3.5} Z`} fill={glow} />
    </g>
  );
}

/** A jagged crack of glowing energy running through the armor plate. */
function GlowCrack({ d, glow }: { d: string; glow: string }) {
  return <path d={d} stroke={glow} strokeWidth={2.4} fill="none" strokeLinecap="round" filter="url(#bossGlow)" opacity={0.9} />;
}

/** The shattered-crown crest atop the helm — Regicide's rank symbol, reforged as jagged dark armor spikes. */
function HelmCrest({ tier, dark, accent }: { tier: 1 | 2 | 3; dark: string; accent: string }) {
  const spikeCount = tier === 1 ? 3 : tier === 2 ? 5 : 7;
  const baseH = tier === 1 ? 14 : tier === 2 ? 24 : 36;
  const width = tier === 1 ? 40 : tier === 2 ? 54 : 68;
  const pts: string[] = [`${100 - width / 2},58`];
  for (let i = 0; i <= spikeCount; i++) {
    const x = 100 - width / 2 + (width * i) / spikeCount;
    const jag = i % 2 === 0 ? baseH : baseH * 0.45;
    pts.push(`${x},${58 - jag}`);
    if (i < spikeCount) {
      const xm = 100 - width / 2 + (width * (i + 0.5)) / spikeCount;
      pts.push(`${xm},58`);
    }
  }
  pts.push(`${100 + width / 2},58`);
  return (
    <g>
      <polygon points={pts.join(' ')} fill={dark} {...ink(2.5)} />
      {tier === 3 && <GlowCrack d={`M${100 - width * 0.2},${58 - baseH * 0.5} L100,${58 - baseH} L${100 + width * 0.2},${58 - baseH * 0.5}`} glow={accent} />}
    </g>
  );
}

/** Jagged shoulder pauldrons — the "flamboyant tyrant" silhouette cue, escalating with rank. */
function Pauldrons({ tier, dark, accent }: { tier: 1 | 2 | 3; dark: string; accent: string }) {
  const size = tier === 1 ? 14 : tier === 2 ? 22 : 32;
  const spikes = tier === 1 ? 1 : tier === 2 ? 2 : 3;
  const side = (mirror: 1 | -1) => {
    const baseX = 100 + mirror * 62;
    const pts: string[] = [`${100 + mirror * 40},95`];
    for (let i = 0; i <= spikes; i++) {
      const x = 100 + mirror * (40 + ((baseX - 100 - mirror * 40) * i) / spikes);
      pts.push(`${x},${95 - (i % 2 === 0 ? size : size * 0.4)}`);
    }
    pts.push(`${baseX},115`);
    return <polygon key={mirror} points={pts.join(' ')} fill={dark} {...ink(2.5)} />;
  };
  return (
    <g>
      {side(-1)}
      {side(1)}
      {tier === 3 && <GlowCrack d={`M${100 - 55},100 L${100 - 40},108`} glow={accent} />}
      {tier === 3 && <GlowCrack d={`M${100 + 55},100 L${100 + 40},108`} glow={accent} />}
    </g>
  );
}

/** A tattered cape flaring behind the shoulders, torn hem sharpening with rank. */
function TatteredCape({ tier, dark }: { tier: 1 | 2 | 3; dark: string }) {
  if (tier === 1) return null;
  const flare = tier === 3 ? 55 : 32;
  const hem = tier === 3 ? 210 : 195;
  return (
    <path
      d={`M${58 - flare},${hem - 20} L${45 - flare},${hem} L${65 - flare},${hem - 8} L${80 - flare * 0.6},${hem}
          L${100},${hem - 24} L${120 + flare * 0.6},${hem} L${135 + flare},${hem - 8} L${155 + flare},${hem} L${142 + flare},${hem - 20}
          L120,105 L80,105 Z`}
      fill={dark}
      {...ink(3)}
      opacity={0.92}
    />
  );
}

/** Hearts — a crimson tyrant-knight wielding a massive glowing broadsword. */
function CrimsonTyrant({ tier, theme }: { tier: 1 | 2 | 3; theme: (typeof SUIT_THEME)['H'] }) {
  return (
    <g>
      <TatteredCape tier={tier} dark={theme.bodyDark} />
      <path d="M55,150 L68,95 L132,95 L145,150 Q100,172 55,150 Z" fill={theme.body} {...ink(3)} />
      <path d="M68,95 L100,95 L92,150 L55,150 Z" fill={theme.bodyDark} opacity={0.5} />
      <Pauldrons tier={tier} dark={theme.bodyDark} accent={theme.glow} />
      <GlowCrack d="M78,105 L88,125 L80,135 L92,155" glow={theme.glow} />
      <path d="M78,60 L122,60 L130,85 L120,106 L100,113 L80,106 L70,85 Z" fill={theme.bodyDark} {...ink(3)} />
      <EyeSlit x={90} y={82} side={-1} glow={theme.glow} />
      <EyeSlit x={110} y={82} side={1} glow={theme.glow} />
      <HelmCrest tier={tier} dark={theme.bodyDark} accent={theme.glow} />
      <g transform="translate(100,128)">
        <SuitEmblem suit="H" accent={theme.glow} size={18} />
      </g>
      <g transform={`translate(150,${160 - tier * 8}) rotate(${20 + tier * 3})`}>
        <path d={`M-9,${-60 - tier * 8} L9,${-60 - tier * 8} L6,${-4} L0,4 L-6,${-4} Z`} fill={theme.body} {...ink(2.5)} />
        <line x1={0} y1={-58 - tier * 8} x2={0} y2={-8} stroke={theme.glow} strokeWidth={2} opacity={0.8} filter="url(#bossGlow)" />
        <rect x={-14} y={-8} width={28} height={7} rx={1.5} fill={theme.bodyDark} {...ink(2)} />
        <rect x={-4} y={-1} width={8} height={18} fill={theme.bodyDark} {...ink(2)} />
        <circle cx={0} cy={19} r={6} fill={theme.body} {...ink(2)} />
      </g>
    </g>
  );
}

/** Diamonds — a gold-plated despot wielding a gem-tipped war-pick, hoard glittering at their feet. */
function GildedDespot({ tier, theme }: { tier: 1 | 2 | 3; theme: (typeof SUIT_THEME)['D'] }) {
  const hoardCount = tier === 1 ? 2 : tier === 2 ? 4 : 7;
  const hoard: JSX.Element[] = [];
  for (let i = 0; i < hoardCount; i++) {
    const x = 50 + i * (100 / Math.max(1, hoardCount - 1));
    const s = 6 + (i % 2) * 3;
    hoard.push(<polygon key={i} points={`${x},${190 - s} ${x + s},190 ${x},${190 + s} ${x - s},190`} fill={theme.glow} {...ink(2)} />);
  }
  return (
    <g>
      <TatteredCape tier={tier} dark={theme.bodyDark} />
      <path d="M58,150 L70,95 L130,95 L142,150 Q100,170 58,150 Z" fill={theme.body} {...ink(3)} />
      {Array.from({ length: 3 }).map((_, row) =>
        Array.from({ length: 4 }).map((__, col) => (
          <polygon
            key={`${row}-${col}`}
            points={`${76 + col * 16 + (row % 2) * 8},${107 + row * 13} ${82 + col * 16 + (row % 2) * 8},${112 + row * 13} ${76 + col * 16 + (row % 2) * 8},${117 + row * 13} ${70 + col * 16 + (row % 2) * 8},${112 + row * 13}`}
            fill={theme.bodyDark}
            opacity={0.55}
          />
        )),
      )}
      <Pauldrons tier={tier} dark={theme.bodyDark} accent={theme.glow} />
      <GlowCrack d="M122,105 L112,125 L120,135 L108,155" glow={theme.glow} />
      <path d="M78,60 L122,60 L130,85 L120,106 L100,113 L80,106 L70,85 Z" fill={theme.bodyDark} {...ink(3)} />
      <EyeSlit x={90} y={82} side={-1} glow={theme.glow} />
      <EyeSlit x={110} y={82} side={1} glow={theme.glow} />
      <HelmCrest tier={tier} dark={theme.bodyDark} accent={theme.glow} />
      <g transform="translate(100,132)">
        <SuitEmblem suit="D" accent={theme.glow} size={16} />
      </g>
      <g transform={`translate(150,${158 - tier * 6}) rotate(${18 + tier * 2})`}>
        <line x1={0} y1={-8} x2={0} y2={-52 - tier * 8} stroke={theme.bodyDark} strokeWidth={6} strokeLinecap="round" />
        <polygon points={`0,${-64 - tier * 8} 10,${-52 - tier * 8} 0,${-42 - tier * 8} -10,${-52 - tier * 8}`} fill={theme.glow} {...ink(2)} filter="url(#bossGlow)" />
      </g>
      <g>{hoard}</g>
    </g>
  );
}

/** Clubs — a hulking warlord swinging a massive spiked maul, tusked and bulking up with rank. */
function FeralWarlord({ tier, theme }: { tier: 1 | 2 | 3; theme: (typeof SUIT_THEME)['C'] }) {
  const tuskLen = tier === 1 ? 8 : tier === 2 ? 13 : 19;
  const clubHeadR = tier === 1 ? 11 : tier === 2 ? 15 : 20;
  const spikeCount = tier === 1 ? 3 : tier === 2 ? 4 : 6;
  const spikes: JSX.Element[] = [];
  for (let i = 0; i < spikeCount; i++) {
    const a = (Math.PI * 2 * i) / spikeCount;
    const x = Math.cos(a) * clubHeadR;
    const y = Math.sin(a) * clubHeadR;
    const x2 = Math.cos(a) * (clubHeadR + 10);
    const y2 = Math.sin(a) * (clubHeadR + 10);
    spikes.push(<polygon key={i} points={`${x - 2.5},${y} ${x2},${y2} ${x + 2.5},${y}`} fill={theme.bodyDark} {...ink(1.5)} />);
  }
  return (
    <g>
      <TatteredCape tier={tier} dark={theme.bodyDark} />
      <path d="M32,158 L54,90 L146,90 L168,158 Q100,185 32,158 Z" fill={theme.body} {...ink(3)} />
      <Pauldrons tier={tier} dark={theme.bodyDark} accent={theme.glow} />
      <GlowCrack d="M100,100 L96,125 L104,135 L98,158" glow={theme.glow} />
      <path d="M76,58 L124,58 L134,86 L122,110 L100,118 L78,110 L66,86 Z" fill={theme.bodyDark} {...ink(3)} />
      <path d={`M89,90 L${85},${90 + tuskLen} L94,93 Z`} fill="#f2f0e6" {...ink(1.5)} />
      <path d={`M111,90 L${115},${90 + tuskLen} L106,93 Z`} fill="#f2f0e6" {...ink(1.5)} />
      <EyeSlit x={90} y={82} side={-1} glow={theme.glow} />
      <EyeSlit x={110} y={82} side={1} glow={theme.glow} />
      <HelmCrest tier={tier} dark={theme.bodyDark} accent={theme.glow} />
      <g transform="translate(100,133)">
        <SuitEmblem suit="C" accent={theme.glow} size={20} />
      </g>
      <g transform={`translate(152,${168 - tier * 4}) rotate(${20 + tier * 3})`}>
        <rect x={-5} y={-8} width={10} height={46 + tier * 6} fill={theme.bodyDark} {...ink(2)} />
        <g transform={`translate(0,-8)`}>
          <circle cx={0} cy={0} r={clubHeadR} fill={theme.bodyDark} {...ink(2.5)} />
          {spikes}
        </g>
      </g>
    </g>
  );
}

/** Spades — a shadow-cloaked death-lord bearing a wicked crescent glaive, horns curling with rank. */
function ShadowWraithKing({ tier, theme }: { tier: 1 | 2 | 3; theme: (typeof SUIT_THEME)['S'] }) {
  const hornLen = tier === 2 ? 24 : tier === 3 ? 38 : 12;
  return (
    <g>
      <TatteredCape tier={tier} dark={theme.bodyDark} />
      <path d="M62,150 L75,90 L125,90 L138,150 Q100,175 62,150 Z" fill={theme.body} {...ink(3)} />
      <Pauldrons tier={tier} dark={theme.bodyDark} accent={theme.glow} />
      <GlowCrack d="M85,105 L92,125 L84,135 L90,155" glow={theme.glow} />
      <path d="M78,58 L122,58 L128,84 L118,105 L100,112 L82,105 L72,84 Z" fill={theme.bodyDark} {...ink(3)} />
      <path
        d={`M84,62 Q${68 - hornLen * 0.3},${62 - hornLen * 0.6} ${62},${46 - hornLen}`}
        stroke={theme.bodyDark}
        strokeWidth={6}
        fill="none"
        strokeLinecap="round"
      />
      <path
        d={`M116,62 Q${132 + hornLen * 0.3},${62 - hornLen * 0.6} ${138},${46 - hornLen}`}
        stroke={theme.bodyDark}
        strokeWidth={6}
        fill="none"
        strokeLinecap="round"
      />
      <EyeSlit x={88} y={80} side={-1} glow={theme.glow} />
      <EyeSlit x={112} y={80} side={1} glow={theme.glow} />
      {tier === 3 && <HelmCrest tier={tier} dark={theme.bodyDark} accent={theme.glow} />}
      <g transform="translate(100,124)">
        <SuitEmblem suit="S" accent={theme.glow} size={16} />
      </g>
      <g transform={`translate(150,${145 - tier * 6}) rotate(${-25 - tier * 5})`}>
        <line x1={0} y1={-6} x2={0} y2={40 + tier * 10} stroke={theme.bodyDark} strokeWidth={5} strokeLinecap="round" />
        {(() => {
          const l = 40 + tier * 12;
          return (
            <path
              d={`M0,0 Q${-l * 0.65},${-l * 0.45} ${-l * 0.22},${-l} Q${l * 0.12},${-l * 0.5} ${l * 0.16},0 Z`}
              fill={theme.glow}
              {...ink(2)}
              filter="url(#bossGlow)"
            />
          );
        })()}
      </g>
    </g>
  );
}

export function BossPortrait({ suit, rank, label }: { suit: Suit; rank: Rank; label?: string }) {
  const tier = TIER[rank];
  const theme = SUIT_THEME[suit];
  return (
    <svg viewBox="0 0 200 220" className="boss-svg" role="img" aria-label={label ?? `${theme.name} boss portrait`}>
      <defs>
        <radialGradient id={`bossBg-${suit}`} cx="50%" cy="35%" r="80%">
          <stop offset="0%" stopColor={theme.bgLight} />
          <stop offset="100%" stopColor={theme.bgDark} />
        </radialGradient>
        <radialGradient id="bossVignette" cx="50%" cy="45%" r="65%">
          <stop offset="55%" stopColor="#000" stopOpacity={0} />
          <stop offset="100%" stopColor="#000" stopOpacity={0.6} />
        </radialGradient>
        <filter id="bossGlow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect x={0} y={0} width={200} height={220} fill={`url(#bossBg-${suit})`} />
      <FocusLines color={theme.accent} />
      <LightningBolts glow={theme.glow} />
      <ellipse cx={100} cy={206} rx={58} ry={9} fill="#000" opacity={0.4} />
      {suit === 'H' && <CrimsonTyrant tier={tier} theme={theme} />}
      {suit === 'D' && <GildedDespot tier={tier} theme={theme} />}
      {suit === 'C' && <FeralWarlord tier={tier} theme={theme} />}
      {suit === 'S' && <ShadowWraithKing tier={tier} theme={theme} />}
      <rect x={0} y={0} width={200} height={220} fill="url(#bossVignette)" />
      <rect x={3} y={3} width={194} height={214} fill="none" stroke={theme.accent} strokeWidth={3} opacity={0.8} />
      <rect x={7} y={7} width={186} height={206} fill="none" stroke={theme.accent} strokeWidth={1} opacity={0.4} />
    </svg>
  );
}
