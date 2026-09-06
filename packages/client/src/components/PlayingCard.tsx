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
  // John's own call: Goran shows as "G" on his card face, same idea as Aces showing "A" and Beast Companions
  // showing "B" — purely cosmetic, so he's still an ordinary 8 (value, combos, starting-roster identity) under
  // the hood; only the rendered label changes. Matched by name, same as Goran's other name-targeted mechanics
  // (see party.ts's applySecondSuitByName/applyEvergreenUpgradeByName) — he has no distinct suit/rank of his own.
  if (card.name === 'Goran') return 'G';
  const base = card.rank === 'A' ? 'A' : card.rank;
  // A Mercenary's flexibleComboRank (see SuitedCard.flexibleComboRank) is printed on the physical card as both
  // values together (e.g. "2/5") — shown lower-value-first to match. tier and flexibleComboRank never coexist
  // (tier is classic-Endless-only; flexibleComboRank is Legacy-only), so no conflict here.
  return card.flexibleComboRank ? `${card.flexibleComboRank}/${base}` : card.tier ? `${base}+${card.tier}` : base;
}

/**
 * Every class a Legacy card actually carries, base first — what the card face needs to show.
 *
 * John, live play 2026-09-06: "for cards with multiple abilities, like Druid or [Guardian] that gets added on,
 * it's hard to know their abilities... I think they can just be side by side because they're equivalent."
 *
 * Two things were missing before. The five STICKER classes (SuitedCard.secondClassArcane/Reaver/Guardian/Druid/
 * Chanter) drew no glyph at all — a card granted Regrowth by Mission 7's reward looked identical to one without
 * it. And the suit-based bonus icons that did draw were shrunk into a corner stack, which read as "main class
 * plus footnotes" when a stickered card's two classes both resolve in full whenever it is played. They are
 * equivalent, so they are now laid out side by side at one size.
 */
export function cardClasses(card: Extract<Card, { kind: 'suited' }>) {
  const themes: (typeof CLASS_THEME)[keyof typeof CLASS_THEME][] = [];
  const push = (theme: (typeof CLASS_THEME)[keyof typeof CLASS_THEME]) => {
    if (!themes.some((t) => t.id === theme.id)) themes.push(theme);
  };
  // An Evergreen card shows its own single 🌳 and nothing else (John, 2026-09-06: "at the end of Mission 9 he
  // becomes Evergreen, so for Mission 10 it should show a tree"). Gøran collects one base suit per mission and
  // carries all four separate icons right through Mission 9 — then the upgrade REPLACES them, because Evergreen
  // already means all four powers at once. The suit-derived pushes are skipped rather than deduped: he keeps
  // `secondSuit` and `extraSuits` on the card after the upgrade, so without this he rendered as the tree plus
  // three orphaned suit icons.
  push(classForCard(card));
  if (!card.evergreen) {
    if (card.secondSuit) push(SUIT_TO_CLASS[card.secondSuit]);
    for (const s of card.extraSuits ?? []) push(SUIT_TO_CLASS[s]);
  }
  if (card.secondClassArcane) push(CLASS_THEME.MAGE);
  if (card.secondClassReaver) push(CLASS_THEME.REAVER);
  if (card.secondClassGuardian) push(CLASS_THEME.GUARDIAN);
  if (card.secondClassDruid) push(CLASS_THEME.DRUID);
  if (card.secondClassChanter) push(CLASS_THEME.CHANTER);
  return themes;
}

export function cardLabel(card: Card): string {
  if (card.kind === 'jester') return 'Jester';
  const rankLabel = tieredRankLabel(card);
  if (isLegacyCard(card)) {
    return `${rankLabel} ${cardClasses(card).map((t) => t.glyph).join('')}`;
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
    // Icons picked up one mission at a time (Gøran) rather than from a sticker — named separately so the text
    // doesn't credit them to a Dual-class Sticker.
    const extraSuffix = card.extraSuits?.length
      ? ` Also ${card.extraSuits.map((s) => SUIT_TO_CLASS[s].name).join(' and ')}.`
      : '';
    // The five sticker classes (Mission 5-9's rewards). These used to be invisible here AND on the card face —
    // a card granted the Druid's Regrowth read exactly like one without it. Each names what it adds, since the
    // whole point of a sticker is that the card keeps its own class power and gains this one on top.
    // A sticker class is exactly a bonus class with no suit of its own — the four base classes all have one.
    const stickerClasses = cardClasses(card)
      .slice(1)
      .filter((t) => t.suit === undefined);
    const stickerSuffix = stickerClasses.length
      ? ` ${stickerClasses.map((t) => `Also a ${t.name} (sticker) — ${t.tag}.`).join(' ')}`
      : '';
    const flexSuffix = card.flexibleComboRank ? ` Combos as a ${card.flexibleComboRank} too.` : '';
    const wildSuffix = card.wildSuit ? ' Choose a suit for it when you play it.' : '';
    const corruptedSuffix = card.corrupted ? ' Cursed: ignores enemy immunity, but burns the top card of the reserve deck when played.' : '';
    // Corruption's mirror (Mission 12). A restored card had NO tooltip clause and no badge, so it read as an
    // ordinary card despite carrying the mission's whole mechanic.
    const restoredSuffix = card.restored
      ? ' Restored: ignores enemy immunity, and heals the banish pile\'s top card back under the reserve deck when played. Can never be banished — it returns to the bottom of the reserve deck instead.'
      : '';
    const reaverSuffix = card.reaver
      ? " Reveals cards off the reserve deck equal to this attack's total value (including anything combo'd with it), then choose one to add its strength to the attack — every revealed card is banished. Always doubles the play's total damage."
      : '';
    const displayName = card.name ?? (card.wildSuit ? 'Any-Suit Ace' : 'Mercenary');
    return `${displayName} — ${cls.name}, strength ${cardValue(card)}. ${cls.tag}.${specialSuffix}${dualSuffix}${extraSuffix}${stickerSuffix}${flexSuffix}${wildSuffix}${corruptedSuffix}${restoredSuffix}${reaverSuffix}`;
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
  rankLabelOverride,
}: {
  card: Card;
  selected?: boolean;
  onClick?: () => void;
  small?: boolean;
  /** True when this card's suit power currently has no effect on the boss (immune, unbroken). */
  blocked?: boolean;
  /**
   * Replaces the computed rank label on the card face. Used for Legacy mission enemies, whose real `rank` is an
   * inert 'J' placeholder and whose printed letter comes from the mission data instead (see
   * EnemyState.rankLabel) — e.g. J/Q/K for Mission 7's tiers, H for Mission 2's hydra brood, T and D for
   * Mission 8's trolls and wyverns.
   */
  rankLabelOverride?: string;
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
  const rankLabel = rankLabelOverride ?? tieredRankLabel(card);
  const classInfo = legacy ? classForCard(card) : null;
  const classThemes = legacy ? cardClasses(card) : [];
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
      className={`playing-card${red ? ' red' : ''}${selected ? ' selected' : ''}${blocked ? ' blocked' : ''}${card.special ? ' special' : ''}${card.corrupted ? ' corrupted' : ''}${card.restored ? ' restored' : ''}`}
      onClick={onClick}
      style={Object.keys(style).length > 0 ? style : undefined}
      aria-label={cardLabel(card)}
      title={blocked ? `${abilityText} — no effect on this boss` : abilityText}
    >
      {card.special && !small && <span className="special-badge" aria-hidden="true">✦</span>}
      {card.corrupted && !small && <span className="corrupted-badge" aria-hidden="true">🥀</span>}
      {card.restored && !small && <span className="restored-badge" aria-hidden="true">🌱</span>}
      <span className="rank">{rankLabel}</span>
      {/* Every class the card carries, side by side at one size (John, 2026-09-06) — they resolve together when
          the card is played, so none of them is a footnote to the others. A single-class card is the common
          case and looks exactly as it always did; only a multi-class card spreads. See cardClasses. */}
      {classThemes.length > 1 && !small && !isWildUnresolved ? (
        <span className={`glyph class-glyph-row count-${Math.min(classThemes.length, 4)}`}>
          {classThemes.map((t) => (
            <span key={t.id} className="class-glyph" style={{ color: t.color }}>
              {t.glyph}
            </span>
          ))}
        </span>
      ) : (
        <span className="glyph">{glyph}</span>
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
