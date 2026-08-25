import type { Card, EnemyState, Suit } from './types.js';

/** Value of a card both as an attack value and as a discard-to-defend value (rules are identical for both uses). */
export function cardValue(card: Card): number {
  if (card.kind === 'jester') return 0;
  const base = (() => {
    switch (card.rank) {
      case 'A':
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

/** A card's class suit(s) — two for a Dual-class Stickers card (see SuitedCard.secondSuit), one otherwise. */
export function cardSuits(card: Extract<Card, { kind: 'suited' }>): Suit[] {
  return card.secondSuit ? [card.suit, card.secondSuit] : [card.suit];
}

export interface PlayShape {
  totalValue: number;
  suits: Suit[];
}

/** Validates a proposed set of played cards (excluding the single-jester case, handled separately) per the Combos/Animal-or-Beast-Companion rules. Returns an error string or the resolved shape. */
export function validatePlayShape(cards: Card[]): PlayShape | { error: string } {
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

  // Combo: 2-4 cards of the same rank, summing to 10 or less.
  const rank = suited[0].rank;
  if (!suited.every((c) => c.rank === rank)) {
    return { error: 'Combo cards must all be the same rank.' };
  }
  if (cards.length > 4) {
    return { error: 'Combos are limited to 4 cards.' };
  }
  const totalValue = suited.reduce((sum, c) => sum + cardValue(c), 0);
  if (totalValue > 10) {
    return { error: 'Combo total must be 10 or less.' };
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

export function currentEnemyAttack(enemy: EnemyState): number {
  return Math.max(0, enemy.baseAttack - enemy.spadesShield);
}

/** Legacy-only (Mission 4): the enemy's attack with the discard pile's top-card buff folded in before the floor of 0 is applied, so spade shielding and the buff can offset each other. */
export function currentEnemyAttackWithDiscardBuff(enemy: EnemyState, discardBuff: number): number {
  return Math.max(0, enemy.baseAttack - enemy.spadesShield + discardBuff);
}

/** Legacy-only (Mission 4): the value of the card currently on top of the discard pile (the most recently discarded card), or 0 if the pile is empty. */
export function discardPileTopValue(discardPile: Card[]): number {
  if (discardPile.length === 0) return 0;
  return cardValue(discardPile[discardPile.length - 1]);
}

export function currentEnemyHealthRemaining(enemy: EnemyState): number {
  return enemy.maxHealth - enemy.damageTaken;
}

/**
 * Legacy-only (Mission 8): the current attack buff from non-Pilgrim cards sitting in the ascending mission zone
 * (see GameState.ascendingZone). Cards flagged `pilgrim` — the chain's intended fillers — contribute nothing;
 * only ordinary cards pressed into service to bridge a gap do, at their own card value.
 */
export function ascendingZoneAttackBuff(missionZone: Card[]): number {
  return missionZone.reduce((sum, c) => (c.kind === 'suited' && !c.pilgrim ? sum + cardValue(c) : sum), 0);
}

/** Legacy-only (Mission 11): the value of the card currently on top of the banish pile (the most recently banished card), or 0 if the pile is empty. Mirrors discardPileTopValue. */
export function banishPileTopValue(banishPile: Card[]): number {
  if (banishPile.length === 0) return 0;
  return cardValue(banishPile[banishPile.length - 1]);
}

/**
 * Legacy-only (Mission 11): the class(es) the current enemy is immune to from whatever cards currently sit on top
 * of the discard pile AND the banish pile — recomputed live on every check (see GameState.pileTopEnemyBonus),
 * never stored/frozen the way missionZone's other suit-immunity modes are. A Jester on top of either pile
 * contributes nothing.
 */
export function pileTopImmuneSuits(discardPile: Card[], banishPile: Card[]): Suit[] {
  const suits = new Set<Suit>();
  const discardTop = discardPile[discardPile.length - 1];
  const banishTop = banishPile[banishPile.length - 1];
  if (discardTop?.kind === 'suited') for (const s of cardSuits(discardTop)) suits.add(s);
  if (banishTop?.kind === 'suited') for (const s of cardSuits(banishTop)) suits.add(s);
  return Array.from(suits);
}
