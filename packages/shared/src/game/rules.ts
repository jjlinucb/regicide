import type { Card, EnemyState, Suit } from './types.js';

/** Value of a card both as an attack value and as a discard-to-defend value (rules are identical for both uses). */
export function cardValue(card: Card): number {
  if (card.kind === 'jester') return 0;
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
}

export function isAnimalCompanion(card: Card): boolean {
  return card.kind === 'suited' && card.rank === 'A';
}

export interface PlayShape {
  totalValue: number;
  suits: Suit[];
}

/** Validates a proposed set of played cards (excluding the single-jester case, handled separately) per the Combos/Animal Companion rules. Returns an error string or the resolved shape. */
export function validatePlayShape(cards: Card[]): PlayShape | { error: string } {
  if (cards.length === 0) return { error: 'No cards selected.' };
  if (cards.some((c) => c.kind === 'jester')) {
    return { error: 'The Jester must be played alone.' };
  }

  const suited = cards as Extract<Card, { kind: 'suited' }>[];
  const animalCount = suited.filter((c) => c.rank === 'A').length;

  if (cards.length === 1) {
    return { totalValue: cardValue(cards[0]), suits: [suited[0].suit] };
  }

  if (cards.length === 2 && animalCount >= 1) {
    // Animal Companion paired with one other card (which may be another Animal Companion). No sum cap.
    const totalValue = suited.reduce((sum, c) => sum + cardValue(c), 0);
    const suits = Array.from(new Set(suited.map((c) => c.suit)));
    return { totalValue, suits };
  }

  if (animalCount > 0) {
    return { error: 'Animal Companions can only be played alone or paired with exactly one other card.' };
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
  const suits = Array.from(new Set(suited.map((c) => c.suit)));
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
  return suit === enemy.suit && !enemy.immunityBroken;
}

export function currentEnemyAttack(enemy: EnemyState): number {
  return Math.max(0, enemy.baseAttack - enemy.spadesShield);
}

export function currentEnemyHealthRemaining(enemy: EnemyState): number {
  return enemy.maxHealth - enemy.damageTaken;
}
