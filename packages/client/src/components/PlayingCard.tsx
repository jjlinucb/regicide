import { cardValue, classForCard, JESTER_ABILITY_TEXT, SUIT_ABILITY_TEXT, SUIT_TO_CLASS, type Card } from '@regicide/shared';

const SUIT_GLYPH: Record<string, string> = { H: '♥', D: '♦', C: '♣', S: '♠' };
const SUIT_NAME: Record<string, string> = { H: 'Hearts', D: 'Diamonds', C: 'Clubs', S: 'Spades' };
const RED_SUITS = new Set(['H', 'D']);

/** A card carries a `name` only in Regicide Legacy (party members are named characters) — use its presence as the display-mode signal. */
function isLegacyCard(card: Card): card is Extract<Card, { kind: 'suited' }> & { name: string } {
  return card.kind === 'suited' && Boolean(card.name);
}

/** Classic Regicide Endless Mode only: a King pushed past its ceiling shows as "K+N" (see SuitedCard.tier). */
function tieredRankLabel(card: Extract<Card, { kind: 'suited' }>): string {
  const base = card.rank === 'A' ? 'A' : card.rank;
  return card.tier ? `${base}+${card.tier}` : base;
}

export function cardLabel(card: Card): string {
  if (card.kind === 'jester') return 'Jester';
  const rankLabel = tieredRankLabel(card);
  if (isLegacyCard(card)) {
    const secondGlyph = card.secondSuit ? SUIT_TO_CLASS[card.secondSuit].glyph : '';
    return `${rankLabel} ${classForCard(card).glyph}${secondGlyph}`;
  }
  return `${rankLabel}${SUIT_GLYPH[card.suit]}`;
}

/** Hover/long-press reminder of what a card does — handy for a solo player deciding what to play. */
export function cardAbilityText(card: Card): string {
  if (card.kind === 'jester') return JESTER_ABILITY_TEXT;
  const rankLabel = card.rank === 'A' ? 'Ace' : card.rank;
  if (isLegacyCard(card)) {
    const cls = classForCard(card);
    const specialSuffix = card.special ? ` ${cls.specialText}` : '';
    const dualSuffix = card.secondSuit ? ` Also a ${SUIT_TO_CLASS[card.secondSuit].name} (Dual-class Sticker).` : '';
    return `${card.name} — ${cls.name}, strength ${cardValue(card)}. ${cls.tag}.${specialSuffix}${dualSuffix}`;
  }
  const tierSuffix = card.tier ? ` (upgraded ${card.tier} tier${card.tier > 1 ? 's' : ''} past King, from an Endless Mode win)` : '';
  return `${rankLabel} of ${SUIT_NAME[card.suit]} — value ${cardValue(card)}${tierSuffix}. ${SUIT_ABILITY_TEXT[card.suit]}`;
}

export function PlayingCard({
  card,
  selected,
  onClick,
  small,
  blocked,
}: {
  card: Card;
  selected?: boolean;
  onClick?: () => void;
  small?: boolean;
  /** True when this card's suit power currently has no effect on the boss (immune, unbroken). */
  blocked?: boolean;
}) {
  if (card.kind === 'jester') {
    return (
      <button
        type="button"
        className={`playing-card jester${selected ? ' selected' : ''}`}
        onClick={onClick}
        style={small ? { width: 44, height: 62 } : undefined}
        aria-label="Jester"
        title={cardAbilityText(card)}
      >
        <span className="glyph">🃏</span>
        {!small && <span className="jester-label">JESTER</span>}
      </button>
    );
  }
  const legacy = isLegacyCard(card);
  const red = !legacy && RED_SUITS.has(card.suit);
  const rankLabel = tieredRankLabel(card);
  const classInfo = legacy ? classForCard(card) : null;
  const style = { ...(small ? { width: 44, height: 62 } : {}), ...(classInfo ? { color: classInfo.color } : {}) };
  const glyph = classInfo ? classInfo.glyph : SUIT_GLYPH[card.suit];
  const abilityText = cardAbilityText(card);
  return (
    <button
      type="button"
      className={`playing-card${red ? ' red' : ''}${selected ? ' selected' : ''}${blocked ? ' blocked' : ''}${card.special ? ' special' : ''}`}
      onClick={onClick}
      style={Object.keys(style).length > 0 ? style : undefined}
      aria-label={cardLabel(card)}
      title={blocked ? `${abilityText} — no effect on this boss` : abilityText}
    >
      {card.special && !small && <span className="special-badge" aria-hidden="true">✦</span>}
      <span className="rank">{rankLabel}</span>
      <span className="glyph">{glyph}</span>
      {legacy && card.secondSuit && !small && (
        <span className="glyph second-class-glyph" style={{ color: SUIT_TO_CLASS[card.secondSuit].color }}>
          {SUIT_TO_CLASS[card.secondSuit].glyph}
        </span>
      )}
      {legacy && !small && <span className="legacy-card-name">{blocked ? 'No effect' : card.name}</span>}
      {blocked && !small && !legacy && <span className="no-effect-badge">No effect</span>}
    </button>
  );
}
