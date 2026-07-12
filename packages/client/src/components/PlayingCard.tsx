import type { Card } from '@regicide/shared';

const SUIT_GLYPH: Record<string, string> = { H: '♥', D: '♦', C: '♣', S: '♠' };
const RED_SUITS = new Set(['H', 'D']);

export function cardLabel(card: Card): string {
  if (card.kind === 'jester') return 'Jester';
  const rankLabel = card.rank === 'A' ? 'A' : card.rank;
  return `${rankLabel}${SUIT_GLYPH[card.suit]}`;
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
      >
        <span className="glyph">🃏</span>
      </button>
    );
  }
  const red = RED_SUITS.has(card.suit);
  const rankLabel = card.rank === 'A' ? 'A' : card.rank;
  return (
    <button
      type="button"
      className={`playing-card${red ? ' red' : ''}${selected ? ' selected' : ''}`}
      onClick={onClick}
      style={small ? { width: 44, height: 62 } : undefined}
      aria-label={cardLabel(card)}
    >
      <span className="rank">{rankLabel}</span>
      <span className="glyph">{SUIT_GLYPH[card.suit]}</span>
    </button>
  );
}
