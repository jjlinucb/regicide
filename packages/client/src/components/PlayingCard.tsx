import { cardValue, classForCard, CLASS_THEME, JESTER_ABILITY_TEXT, SUIT_ABILITY_TEXT, SUIT_TO_CLASS, type Card } from '@regicide/shared';

const SUIT_GLYPH: Record<string, string> = { H: '♥', D: '♦', C: '♣', S: '♠' };
const SUIT_NAME: Record<string, string> = { H: 'Hearts', D: 'Diamonds', C: 'Clubs', S: 'Spades' };
const RED_SUITS = new Set(['H', 'D']);

/**
 * A card carries a `name` only in Regicide Legacy (party members are named characters) — use its presence as the
 * display-mode signal. The 3 Mercenary card types (see SuitedCard.noSuitPower/wildSuit/flexibleComboRank) are
 * Legacy-only too but deliberately unnamed (see mercenaries.ts's doc), so they're included explicitly. Not a type
 * predicate — `name` is already optional on SuitedCard, so an `is` guard here wouldn't narrow anything and would
 * collapse the (still-needed) non-Legacy branch to `never`.
 */
function isLegacyCard(card: Extract<Card, { kind: 'suited' }>): boolean {
  return Boolean(card.name) || Boolean(card.noSuitPower) || Boolean(card.wildSuit) || Boolean(card.flexibleComboRank);
}

/** Classic Regicide Endless Mode only: a King pushed past its ceiling shows as "K+N" (see SuitedCard.tier). */
function tieredRankLabel(card: Extract<Card, { kind: 'suited' }>): string {
  const base = card.rank === 'A' ? 'A' : card.rank;
  // A Mercenary's flexibleComboRank (see SuitedCard.flexibleComboRank) is printed on the physical card as both
  // values together (e.g. "2/5") — shown lower-value-first to match. tier and flexibleComboRank never coexist
  // (tier is classic-Endless-only; flexibleComboRank is Legacy-only), so no conflict here.
  return card.flexibleComboRank ? `${card.flexibleComboRank}/${base}` : card.tier ? `${base}+${card.tier}` : base;
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
  const rankLabel = card.rank === 'A' ? 'Ace' : card.rank === 'B' ? 'Beast' : card.rank;
  if (isLegacyCard(card)) {
    const cls = classForCard(card);
    const specialSuffix = card.special ? ` ${cls.specialText}` : '';
    const dualSuffix = card.secondSuit ? ` Also a ${SUIT_TO_CLASS[card.secondSuit].name} (Dual-class Sticker).` : '';
    const flexSuffix = card.flexibleComboRank ? ` Combos as a ${card.flexibleComboRank} too.` : '';
    const wildSuffix = card.wildSuit ? ' Choose a suit for it when you play it.' : '';
    const corruptedSuffix = card.corrupted ? ' Cursed: ignores enemy immunity, but burns the top card of the reserve deck when played.' : '';
    const reaverSuffix = card.reaver
      ? ` Reveals cards off the reserve deck equal to its own rank (${card.rank}), then choose one to add its strength to the attack — every revealed card is banished. Always doubles the play's total damage.`
      : '';
    const displayName = card.name ?? (card.wildSuit ? 'Any-Suit Ace' : 'Mercenary');
    return `${displayName} — ${cls.name}, strength ${cardValue(card)}. ${cls.tag}.${specialSuffix}${dualSuffix}${flexSuffix}${wildSuffix}${corruptedSuffix}${reaverSuffix}`;
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
  // An unresolved Mercenary any-suit Ace (see SuitedCard.wildSuit) still carries its inert placeholder suit ('H')
  // in-hand — classForCard would otherwise render it as a plain Cleric card, misleadingly hiding that it needs a
  // suit chosen before it can be played (see GamePage's chosenSuits picker).
  const isWildUnresolved = card.kind === 'suited' && Boolean(card.wildSuit);
  const style = {
    ...(small ? { width: 44, height: 62 } : {}),
    ...(isWildUnresolved ? { color: CLASS_THEME.MERCENARY.color } : classInfo ? { color: classInfo.color } : {}),
  };
  const glyph = isWildUnresolved ? '★' : classInfo ? classInfo.glyph : SUIT_GLYPH[card.suit];
  const abilityText = cardAbilityText(card);
  return (
    <button
      type="button"
      className={`playing-card${red ? ' red' : ''}${selected ? ' selected' : ''}${blocked ? ' blocked' : ''}${card.special ? ' special' : ''}${card.corrupted ? ' corrupted' : ''}`}
      onClick={onClick}
      style={Object.keys(style).length > 0 ? style : undefined}
      aria-label={cardLabel(card)}
      title={blocked ? `${abilityText} — no effect on this boss` : abilityText}
    >
      {card.special && !small && <span className="special-badge" aria-hidden="true">✦</span>}
      {card.corrupted && !small && <span className="corrupted-badge" aria-hidden="true">🥀</span>}
      <span className="rank">{rankLabel}</span>
      <span className="glyph">{glyph}</span>
      {legacy && card.secondSuit && !small && (
        <span className="glyph second-class-glyph" style={{ color: SUIT_TO_CLASS[card.secondSuit].color }}>
          {SUIT_TO_CLASS[card.secondSuit].glyph}
        </span>
      )}
      {legacy && !small && (
        <span className="legacy-card-name">
          {blocked ? 'No effect' : isWildUnresolved ? 'Choose suit' : card.name ?? 'Mercenary'}
        </span>
      )}
      {blocked && !small && !legacy && <span className="no-effect-badge">No effect</span>}
    </button>
  );
}
