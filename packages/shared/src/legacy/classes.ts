import type { SpecialAbilityId, Suit } from '../game/types.js';

export type ClassId = 'WARRIOR' | 'BARD' | 'CLERIC' | 'PALADIN' | 'MAGE' | 'REAVER' | 'GUARDIAN';

/**
 * Regicide Legacy's four base classes map 1:1 onto classic Regicide's four suits — Warrior=Clubs (double damage),
 * Bard=Diamonds (draw), Cleric=Hearts (heal), Paladin=Spades (reduce enemy strength). Internally a Legacy party
 * card IS a suited card (see legacy/party.ts); this table is purely the display layer so suit letters never
 * leak into Legacy UI text.
 *
 * Mage (introduced Mission 3) and Reaver (introduced Mission 5) are the odd ones out: neither has a suit of its
 * own (there's no 5th or 6th suit in a standard deck). Both kinds of card keep whatever suit they're printed
 * with, purely for immunity bookkeeping, but their class power never joins the combined suit-power resolution —
 * see SuitedCard.arcane/reaver and engine.ts's resolveArcaneBolts/resolveCommittedPlay.
 */
export interface ClassTheme {
  id: ClassId;
  /** Absent only for MAGE — see class doc above. */
  suit?: Suit;
  name: string;
  tag: string;
  glyph: string;
  color: string;
  /** This class's signature ability, grantable to a stand-out recruit on top of its base suit power (see party.ts's RecruitSpec.special). */
  specialAbility: SpecialAbilityId;
  specialName: string;
  specialText: string;
}

export const CLASS_THEME: Record<ClassId, ClassTheme> = {
  WARRIOR: {
    id: 'WARRIOR',
    suit: 'C',
    name: 'Warrior',
    tag: 'Double Damage',
    glyph: '⚔',
    color: '#8a3b3b',
    specialAbility: 'CLEAVE',
    specialName: 'Cleave',
    specialText: 'Cleave: triples this play\'s damage instead of doubling it.',
  },
  BARD: {
    id: 'BARD',
    suit: 'D',
    name: 'Bard',
    tag: 'Draw Cards',
    glyph: '🎵',
    color: '#c99a3a',
    specialAbility: 'INSPIRE',
    specialName: 'Inspire',
    specialText: 'Inspire: draws 2 additional cards on top of the play\'s normal draw.',
  },
  CLERIC: {
    id: 'CLERIC',
    suit: 'H',
    name: 'Cleric',
    tag: 'Heal',
    glyph: '✚',
    color: '#b8434a',
    specialAbility: 'REVIVE',
    specialName: 'Revive',
    specialText: 'Revive: shuffles 2 additional cards back from the discard pile.',
  },
  PALADIN: {
    id: 'PALADIN',
    suit: 'S',
    name: 'Paladin',
    tag: 'Reduce Strength',
    glyph: '🛡',
    color: '#3f4f6b',
    specialAbility: 'BULWARK',
    specialName: 'Bulwark',
    specialText: 'Bulwark: reduces the enemy\'s attack to 0 for the rest of the fight.',
  },
  MAGE: {
    id: 'MAGE',
    name: 'Mage',
    tag: 'Arcane Bolt',
    glyph: '✦',
    color: '#5b3f8c',
    specialAbility: 'ARCANE_SURGE',
    specialName: 'Arcane Surge',
    specialText: 'Arcane Surge: this Mage\'s arcane bolt hits for double its own card value.',
  },
  REAVER: {
    id: 'REAVER',
    name: 'Reaver',
    tag: 'Reserve Tear',
    glyph: '🍄',
    color: '#5c6b2f',
    specialAbility: 'PLUNDER',
    specialName: 'Plunder',
    specialText: 'Plunder: tears 2 reserve cards instead of 1 (both banished) and keeps the higher value.',
  },
  GUARDIAN: {
    id: 'GUARDIAN',
    name: 'Guardian',
    tag: 'Absolute Shield',
    glyph: '⛨',
    color: '#4a6b5c',
    specialAbility: 'AEGIS',
    specialName: 'Aegis',
    specialText: 'Aegis: the shield holds permanently, reducing the enemy\'s attack to 0 for the rest of the fight.',
  },
};

export const SUIT_TO_CLASS: Record<Suit, ClassTheme> = {
  C: CLASS_THEME.WARRIOR,
  D: CLASS_THEME.BARD,
  H: CLASS_THEME.CLERIC,
  S: CLASS_THEME.PALADIN,
};

export function classForSuit(suit: Suit): ClassTheme {
  return SUIT_TO_CLASS[suit];
}

/**
 * A Legacy party card's real class theme. Almost always its suit's class — except a Mage or Reaver card, whose
 * suit is only along for immunity bookkeeping (see SuitedCard.arcane/reaver), so those must be checked first.
 */
export function classForCard(card: { suit: Suit; arcane?: boolean; reaver?: boolean; guardian?: boolean }): ClassTheme {
  if (card.arcane) return CLASS_THEME.MAGE;
  if (card.reaver) return CLASS_THEME.REAVER;
  if (card.guardian) return CLASS_THEME.GUARDIAN;
  return SUIT_TO_CLASS[card.suit];
}
