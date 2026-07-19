import { cardValue, JESTER_ABILITY_TEXT, SUIT_ABILITY_TEXT, SUIT_TO_CLASS, type Card } from '@regicide/shared';

const SUIT_GLYPH: Record<string, string> = { H: '♥', D: '♦', C: '♣', S: '♠' };
const SUIT_NAME: Record<string, string> = { H: 'Hearts', D: 'Diamonds', C: 'Clubs', S: 'Spades' };
const RED_SUITS = new Set(['H', 'D']);

/** A card carries a `name` only in Regicide Legacy (party members are named characters) — use its presence as the display-mode signal. */
function isLegacyCard(card: Card): card is Extract<Card, { kind: 'suited' }> & { name: string } {
  return card.kind === 'suited' && Boolean(card.name);
}

export function cardLabel(card: Card): string {
  if (card.kind === 'jester') return 'Jester';
  const rankLabel = card.rank === 'A' ? 'A' : card.rank;
  if (isLegacyCard(card)) return `${rankLabel} ${SUIT_TO_CLASS[card.suit].glyph}`;
  return `${rankLabel}${SUIT_GLYPH[card.suit]}`;
}

/** Hover/long-press reminder of what a card does — handy for a solo player deciding what to play. */
export function cardAbilityText(card: Card): string {
  if (card.kind === 'jester') return JESTER_ABILITY_TEXT;
  const rankLabel = card.rank === 'A' ? 'Ace' : card.rank;
  if (isLegacyCard(card)) {
    const cls = SUIT_TO_CLASS[card.suit];
    return `${card.name} — ${cls.name}, strength ${cardValue(card)}. ${cls.tag}.`;
  }
  return `${rankLabel} of ${SUIT_NAME[card.suit]} — value ${cardValue(card)}. ${SUIT_ABILITY_TEXT[card.suit]}`;
}

export function PlayingCard({
  card,
  selected,
  onClick,
  small,
}: {
  card: Card;
  selected?: boolean;
  onClick?: () => void;
  small?: boolean;
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
  const rankLabel = card.rank === 'A' ? 'A' : card.rank;
  const classInfo = legacy ? SUIT_TO_CLASS[card.suit] : null;
  const style = { ...(small ? { width: 44, height: 62 } : {}), ...(classInfo ? { color: classInfo.color } : {}) };
  const glyph = classInfo ? classInfo.glyph : SUIT_GLYPH[card.suit];
  return (
    <button
      type="button"
      className={`playing-card${red ? ' red' : ''}${selected ? ' selected' : ''}`}
      onClick={onClick}
      style={Object.keys(style).length > 0 ? style : undefined}
      aria-label={cardLabel(card)}
      title={cardAbilityText(card)}
    >
      <span className="rank">{rankLabel}</span>
      <span className="glyph">{glyph}</span>
      {legacy && !small && <span className="legacy-card-name">{card.name}</span>}
    </button>
  );
}
