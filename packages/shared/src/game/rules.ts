import type { Card, EnemyState, Rank, Suit } from './types.js';

/** Value of a card both as an attack value and as a discard-to-defend value (rules are identical for both uses). */
export function cardValue(card: Card): number {
  if (card.kind === 'jester') return 0;
  const base = (() => {
    switch (card.rank) {
      case 'A':
      case 'B':
        return 1;
      case 'J':
        return 10;
      case 'Q':
        return 15;
      case 'K':
        return 20;
      default:
        return Number(card.rank);
    }
  })();
  // Classic Regicide Endless Mode only: a King pushed past its ceiling carries a tier (see types.SuitedCard.tier).
  return base + (card.tier ?? 0) * 5;
}

export function isAnimalCompanion(card: Card): boolean {
  return card.kind === 'suited' && card.rank === 'A';
}

/** Legacy-only (Mission 4): a Beast Companion counts as a "companion" card for pairing purposes too (see isCompanionCard) — see SuitedCard.beast. */
export function isBeastCompanion(card: Card): boolean {
  return card.kind === 'suited' && Boolean(card.beast);
}

/** True for any card that plays by the Animal/Beast Companion pairing rule instead of the combo rule. */
export function isCompanionCard(card: Card): boolean {
  return isAnimalCompanion(card) || isBeastCompanion(card);
}

/**
 * Legacy-only, Mission 3+: a "Mage" for reveal purposes — a pure Mage card, or a card carrying a bonus Mage
 * sticker (Mission 9's secondClassArcane). Shared with the client (see GamePage's azureEmblemEligibleCards),
 * which needs it to tell which of an open Azure Emblem window's cards are actually eligible to bank.
 */
export function isMageCard(card: Card): card is Extract<Card, { kind: 'suited' }> {
  return card.kind === 'suited' && Boolean(card.arcane || card.secondClassArcane);
}

/**
 * A card's class suit(s) — one normally, two for a Dual-class Stickers card (see SuitedCard.secondSuit), and
 * more for a card accumulating icons mission by mission (see SuitedCard.extraSuits — Gøran is the only one).
 * De-duplicated, so re-granting a suit the card already carries can never double-resolve its power.
 */
export function cardSuits(card: Extract<Card, { kind: 'suited' }>): Suit[] {
  if (!card.secondSuit && !card.extraSuits?.length) return [card.suit];
  return [...new Set([card.suit, ...(card.secondSuit ? [card.secondSuit] : []), ...(card.extraSuits ?? [])])];
}

/** Ranks a card can satisfy for combo-matching: its own printed rank, plus a Mercenary "2/5"'s flagged alternate (see SuitedCard.flexibleComboRank). */
function comboMatchRanks(card: Extract<Card, { kind: 'suited' }>): Rank[] {
  return card.flexibleComboRank ? [card.rank, card.flexibleComboRank] : [card.rank];
}

export interface PlayShape {
  totalValue: number;
  suits: Suit[];
}

/**
 * Validates a proposed set of played cards (excluding the single-jester case, handled separately) per the
 * Combos/Animal-or-Beast-Companion rules. Returns an error string or the resolved shape.
 *
 * `loop` is Endless Mode's `state.endlessLoop` (0 outside Endless Mode, or before its first extra round) — it
 * raises the combo total-value cap by 1 per loop (10 + loop), reaching 20 at Endless Mode's final round (see
 * engine.ts's ENDLESS_MODE_MAX_LOOP), so a full round of endless play tops out exactly enough to legally combo two
 * 10s or four 5s together. The 4-card-per-combo count cap is unaffected regardless of loop.
 */
export function validatePlayShape(cards: Card[], loop = 0): PlayShape | { error: string } {
  if (cards.length === 0) return { error: 'No cards selected.' };
  if (cards.some((c) => c.kind === 'jester')) {
    return { error: 'The Jester must be played alone.' };
  }

  const suited = cards as Extract<Card, { kind: 'suited' }>[];
  const companionCount = suited.filter(isCompanionCard).length;

  if (cards.length === 1) {
    return { totalValue: cardValue(cards[0]), suits: cardSuits(suited[0]) };
  }

  if (cards.length === 2 && companionCount >= 1) {
    // Animal/Beast Companion paired with one other card (which may itself be a companion). No sum cap. A plain
    // Animal Companion contributes its own printed value (an Ace's flat 1) same as always; a Beast Companion
    // instead copies whatever value its partner card contributes (see SuitedCard.beast) — computed per-card so
    // two companions paired together (Ace+Ace, Ace+Beast, Beast+Beast) still fall back to a normal value sum.
    const [a, b] = suited;
    const contribution = (card: Extract<Card, { kind: 'suited' }>, partner: Extract<Card, { kind: 'suited' }>) =>
      isBeastCompanion(card) ? cardValue(partner) : cardValue(card);
    const totalValue = contribution(a, b) + contribution(b, a);
    const suits = Array.from(new Set(suited.flatMap(cardSuits)));
    return { totalValue, suits };
  }

  if (companionCount > 0) {
    return { error: 'Animal/Beast Companions can only be played alone or paired with exactly one other card.' };
  }

  // Combo: 2-4 cards of the same rank, summing to 10 or less. A Mercenary "2/5" (see SuitedCard.flexibleComboRank)
  // can satisfy either its own printed rank or its flagged alternate — resolved to whichever single rank every
  // card in the play can agree on, preferring each card's own printed rank first (so an all-flexible combo
  // defaults to its cards' shared printed identity rather than the alternate) over order-dependent comparison.
  const resolvedRank = comboMatchRanks(suited[0]).find((candidate) =>
    suited.every((c) => comboMatchRanks(c).includes(candidate)),
  );
  if (!resolvedRank) {
    return { error: 'Combo cards must all be the same rank.' };
  }
  if (cards.length > 4) {
    return { error: 'Combos are limited to 4 cards.' };
  }
  const totalValue = suited.reduce((sum, c) => sum + (c.rank === resolvedRank ? cardValue(c) : Number(c.flexibleComboRank)), 0);
  const comboCap = 10 + Math.max(0, loop);
  if (totalValue > comboCap) {
    return { error: `Combo total must be ${comboCap} or less.` };
  }
  const suits = Array.from(new Set(suited.flatMap(cardSuits)));
  return { totalValue, suits };
}

/** Reminder text for each suit's power, shown as a tooltip on cards so a solo player can decide how to use them. */
export const SUIT_ABILITY_TEXT: Record<Suit, string> = {
  H: 'Hearts: shuffles that many cards from the discard pile back under the Tavern deck (a "heal").',
  D: 'Diamonds: draws that many cards from the Tavern deck, filling players up to their hand limit.',
  C: 'Clubs: doubles the damage dealt to the enemy this play.',
  S: 'Spades: reduces the enemy\'s attack by that much for the rest of the fight.',
};

export const JESTER_ABILITY_TEXT =
  'Jester: play alone (does not use your turn) to cancel the current enemy\'s suit immunity, then choose who goes next.';

/** Official 1-player variant: 2 Jesters are set aside (not in the deck) and may each be flipped once. */
export const MAX_SOLO_JESTERS = 2;

export const SOLO_JESTER_ABILITY_TEXT =
  'Solo Jester: discard your whole hand and refill to your hand limit. Usable before playing a card or before defending. ' +
  'Winning with 0 used = Gold, 1 used = Silver, 2 used = Bronze.';

export function isSuitBlockedByImmunity(suit: Suit, enemy: EnemyState): boolean {
  return (suit === enemy.suit || suit === enemy.secondSuit) && !enemy.immunityBroken;
}

/**
 * Legacy-only, JOHN 2026-09-04: true for an enemy whose immunity can never be pierced by anything. Today that is
 * exactly one enemy — Myla, Mission 9's boss, immune to Bard and Paladin (Diamonds + Spades) for the whole fight
 * with, as that mission's own comment already put it, "no Jester-breakable weak point to lean on". Every route
 * this engine has for ignoring immunity is switched off against her (see engine.ts's
 * continueResolveCommittedPlay): a claimed Jester, Gøran's Evergreen, a played corrupted/restored card, and a
 * corrupted Mage's revealed suit.
 *
 * A Jester is otherwise unaffected — it still lands its flat 8 damage and still spares the claimant the enemy's
 * counter-attack — and it still cancels immunity against every other enemy in the campaign.
 *
 * Matched by enemy NAME rather than by mission number so the rule travels with the enemy, the same way
 * engine.ts's Mission 6 zone-relief step already excludes the Myla CARD by name. She is a live enemy in Mission 9
 * only: Missions 5 and 6 seed a `zoneCompanion('Myla', ...)` card into the banish pile / mission zone, which is a
 * different thing entirely and is not touched by this.
 */
export function hasUnpierceableImmunity(enemy: EnemyState): boolean {
  return enemy.name === 'Myla';
}

export function currentEnemyAttack(enemy: EnemyState): number {
  return Math.max(0, enemy.baseAttack - enemy.spadesShield);
}

/** Legacy-only (Mission 4): the enemy's attack with the discard pile's top-card buff folded in before the floor of 0 is applied, so spade shielding and the buff can offset each other. */
export function currentEnemyAttackWithDiscardBuff(enemy: EnemyState, discardBuff: number): number {
  return Math.max(0, enemy.baseAttack - enemy.spadesShield + discardBuff);
}

/**
 * Legacy-only (Mission 4): the value of the card currently on top of the discard pile (the most recently
 * discarded card), or 0 if the pile is empty. A flexible-rank Mercenary (see SuitedCard.flexibleComboRank, e.g. a
 * "2/5" card) always reads as its LOWER value here — house rule, John's call: this value only ever feeds a boss
 * attack buff (this mission's discardTopBuffsAttack, Mission 11's pileTopEnemyBonus), so the lower reading is
 * strictly better for the party and there's no reason a player would ever want the higher one to apply instead.
 */
export function discardPileTopValue(discardPile: Card[]): number {
  if (discardPile.length === 0) return 0;
  return pileTopValue(discardPile[discardPile.length - 1]);
}

/** Shared by discardPileTopValue/banishPileTopValue — see discardPileTopValue's doc comment for the flexible-rank rule. */
function pileTopValue(top: Card): number {
  if (top.kind === 'suited' && top.flexibleComboRank != null) return Math.min(cardValue(top), Number(top.flexibleComboRank));
  return cardValue(top);
}

export function currentEnemyHealthRemaining(enemy: EnemyState): number {
  return enemy.maxHealth - enemy.damageTaken;
}

/**
 * Legacy-only (Mission 8): the current attack buff from non-Pilgrim cards sitting in the ascending mission zone
 * (see GameState.ascendingZone). Cards flagged `pilgrim` — the chain's intended fillers — contribute nothing;
 * an ordinary card pressed into service to bridge a gap contributes its own card value; the mission's one "2/5"
 * wildcard (see SuitedCard.flexibleComboRank, matchesAscendingZoneSlot below) always contributes its LOWER
 * flagged alternate instead of its printed value, no matter which required slot (2 or 5) it filled — sourced
 * fan-reimplementation rules doc: "Once placed, they count as 2 for enemy attack calculation."
 */
export function ascendingZoneAttackBuff(missionZone: Card[]): number {
  return missionZone.reduce((sum, c) => {
    if (c.kind !== 'suited' || c.pilgrim) return sum;
    if (c.flexibleComboRank) return sum + Number(c.flexibleComboRank);
    return sum + cardValue(c);
  }, 0);
}

/**
 * Legacy-only (Mission 8): true if `card` can fill the ascending zone's `required` next slot — either directly
 * (its own printed value, the ordinary case) or, for the mission's one "2/5" wildcard, via its flagged alternate
 * (see SuitedCard.flexibleComboRank — the same card shape legacy/mercenaries.ts's TWO_FIVE_* shop cards already
 * use for combo-matching, reused here for the sourced fan-reimplementation rule: "2/5 cards can be placed as a 2
 * during 2-selection or as a 5 during 5-selection"). See engine.ts's placeInZone.
 */
export function matchesAscendingZoneSlot(card: Card, required: number): boolean {
  if (card.kind !== 'suited') return false;
  if (cardValue(card) === required) return true;
  return card.flexibleComboRank !== undefined && Number(card.flexibleComboRank) === required;
}

/** Legacy-only (Mission 11): the value of the card currently on top of the banish pile (the most recently banished card), or 0 if the pile is empty. Mirrors discardPileTopValue, including its flexible-rank-reads-low rule. */
export function banishPileTopValue(banishPile: Card[]): number {
  if (banishPile.length === 0) return 0;
  return pileTopValue(banishPile[banishPile.length - 1]);
}

/**
 * Legacy-only (Mission 11): the class(es) the current enemy is immune to from whatever cards currently sit on top
 * of the discard pile AND the banish pile — recomputed live on every check (see GameState.pileTopEnemyBonus),
 * never stored/frozen the way missionZone's other suit-immunity modes are. A Jester on top of either pile
 * contributes nothing.
 *
 * BALANCE FIX (2026-08-28, unsourced — the same failure class Mission 3's endOfTurnZoneFlip needed to fix, see
 * engine.ts's flipMissionZoneCard for the full writeup and the simulated before/after numbers that justified it
 * there, and grep `inherentImmunityCount` for the pattern this mirrors): uncapped, a single Dual-class Stickers
 * card (see SuitedCard.secondSuit) sitting on top of just ONE pile could by itself grant 2 classes of immunity at
 * once, and — paired with whatever the OTHER pile's top contributes — could between them cover all 4 classes,
 * regardless of the enemy's own suit. Since Mission 11's enemies are all deliberately single-class (see
 * missions.ts's Mission 11 entry), that's a full lockout of every class at once, including BOTH hand-refill suits
 * (Hearts/Diamonds) simultaneously — the exact shape that made Mission 3 nearly unwinnable.
 *
 * Unlike Mission 3's cumulative zoneImmuneSuits (which only ever grows, and never clears except on a kill — so
 * ANY addition compounds turn after turn into the same eventual lockout, hence that mission's final +0 cap), this
 * mechanic recomputes fresh every check from whatever happens to sit on top of two piles that churn constantly
 * (every DEFEND, every kill, every beast-deck flip changes one or both tops) — and this file's own existing,
 * sourced test coverage (legacy.test.ts's "mission 11 pile-top bonus strength & immunity" tests) already exercises
 * EACH pile independently granting its own single class as intended behavior ("immune to whatever class sits on
 * top of the discard pile, even if unrelated to its own suit" / same for the banish pile). A flat total cap would
 * silently break that sourced two-independent-sources design (whichever pile's suit happened to get processed
 * second would lose its slot to the first). So the bound is scoped to the actual defect instead: each pile's top
 * card grants AT MOST ONE new class of immunity — its first suit not already accounted for — never both of a
 * dual-suited card's suits from a single pile at once. That leaves each pile free to keep contributing its own
 * class independently (up to 3 total: the enemy's own class plus one from each pile), while making a full 4-class
 * lockout structurally impossible, since reaching it would require a single pile-top card to grant 2 classes by
 * itself.
 *
 * Deliberately NOT extended to Mission 12's flipBanishPileZoneCard/zoneImmuneSuits — that's a different,
 * already-tested mechanic (see that function's own doc comment for why a prior attempt to reuse Mission 3's cap
 * there had to be reverted).
 */
export function pileTopImmuneSuits(discardPile: Card[], banishPile: Card[], enemy: EnemyState): Suit[] {
  const totalImmuneSuits = new Set<Suit>([enemy.suit, ...(enemy.secondSuit ? [enemy.secondSuit] : [])]);
  const suits = new Set<Suit>();
  for (const pile of [discardPile, banishPile]) {
    const top = pile[pile.length - 1];
    // A Mercenary "19" (see SuitedCard.noSuitPower) carries an inert placeholder suit and must never contribute
    // immunity here, same as it's excluded from the combined suit-power resolution when actually played.
    if (top?.kind !== 'suited' || top.noSuitPower) continue;
    for (const s of cardSuits(top)) {
      if (!totalImmuneSuits.has(s)) {
        totalImmuneSuits.add(s);
        suits.add(s);
        break; // this pile's top card has granted its one new class — its other suit (if dual-suited) grants no more
      }
    }
  }
  return Array.from(suits);
}

/**
 * Legacy-only (Mission 12, "Decay to Growth"): the combined value of every card currently sitting in the mission
 * zone — buffs the current enemy's attack for as long as they sit there (see GameState.restoredCardMechanic /
 * engine.ts's resolvedEnemyAttack), climbing every turn a fresh card flips in off the top of the banish pile (see
 * engine.ts's flipBanishPileZoneCard). Unlike Mission 8's ascendingZoneAttackBuff, every card counts equally —
 * there's no Pilgrim-style exclusion here.
 */
export function missionZoneValueSum(missionZone: Card[]): number {
  return missionZone.reduce((sum, c) => sum + cardValue(c), 0);
}
