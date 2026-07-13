import { SUIT_THEME, SuitEmblem } from './heraldry';

const SHIELD_PATH = 'M100,8 L182,32 L182,110 Q182,170 100,196 Q18,170 18,110 L18,32 Z';

/** A quartered coat-of-arms uniting all four suits — shown on the victory screen, echoing a house-crest look. */
export function VictoryCrest() {
  return (
    <svg viewBox="0 0 200 220" className="victory-crest-svg" role="img" aria-label="Crest of the united realm">
      <defs>
        <clipPath id="shieldClip">
          <path d={SHIELD_PATH} />
        </clipPath>
        <linearGradient id="crestGold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffe9a8" />
          <stop offset="100%" stopColor="#c9962f" />
        </linearGradient>
      </defs>
      <g clipPath="url(#shieldClip)">
        <rect x={18} y={8} width={82} height={94} fill={SUIT_THEME.H.bgLight} />
        <rect x={100} y={8} width={82} height={94} fill={SUIT_THEME.D.bgLight} />
        <rect x={18} y={102} width={82} height={94} fill={SUIT_THEME.C.bgLight} />
        <rect x={100} y={102} width={82} height={94} fill={SUIT_THEME.S.bgLight} />
        <g transform="translate(58,55)">
          <SuitEmblem suit="H" accent={SUIT_THEME.H.accent} size={30} />
        </g>
        <g transform="translate(142,55)">
          <SuitEmblem suit="D" accent={SUIT_THEME.D.accent} size={30} />
        </g>
        <g transform="translate(58,149)">
          <SuitEmblem suit="C" accent={SUIT_THEME.C.accent} size={30} />
        </g>
        <g transform="translate(142,149)">
          <SuitEmblem suit="S" accent={SUIT_THEME.S.accent} size={30} />
        </g>
      </g>
      <line x1={100} y1={8} x2={100} y2={196} stroke="url(#crestGold)" strokeWidth={3} />
      <line x1={18} y1={102} x2={182} y2={102} stroke="url(#crestGold)" strokeWidth={3} />
      <path d={SHIELD_PATH} fill="none" stroke="url(#crestGold)" strokeWidth={5} />
      <circle cx={100} cy={102} r={16} fill="#1c1420" stroke="url(#crestGold)" strokeWidth={3} />
      <path d="M91,107 L91,97 L96,101 L100,94 L104,101 L109,97 L109,107 Z" fill="url(#crestGold)" />
    </svg>
  );
}
