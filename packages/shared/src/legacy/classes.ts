import type { SpecialAbilityId, Suit } from '../game/types.js';

export type ClassId =
  | 'WARRIOR'
  | 'BARD'
  | 'CLERIC'
  | 'PALADIN'
  | 'MAGE'
  | 'REAVER'
  | 'GUARDIAN'
  | 'DRUID'
  | 'CHANTER'
  | 'EVERGREEN'
  | 'MERCENARY';

/**
 * Regicide Legacy's four base classes map 1:1 onto classic Regicide's four suits — Warrior=Clubs (double damage),
 * Bard=Diamonds (draw), Cleric=Hearts (heal), Paladin=Spades (reduce enemy strength). Internally a Legacy party
 * card IS a suited card (see legacy/party.ts); this table is purely the display layer so suit letters never
 * leak into Legacy UI text.
 *
 * Mage (Mission 3), Reaver (Mission 5), Guardian (Mission 6), Druid (Mission 7), Chanter (Mission 8), and
 * Evergreen (Mission 9) are the odd ones out: none has a suit of its own (there's no 5th+ suit in a standard
 * deck). Each kind of card keeps whatever suit it's printed with, purely for immunity bookkeeping, but its
 * class power never joins the combined suit-power resolution — see
 * SuitedCard.arcane/reaver/guardian/druid/chanter/evergreen and engine.ts's revealForMage/resolveCommittedPlay.
 */
export interface ClassTheme {
  id: ClassId;
  /** Absent for MAGE, REAVER, GUARDIAN, DRUID, CHANTER, and EVERGREEN — see class doc above. */
  suit?: Suit;
  name: string;
  tag: string;
  glyph: string;
  color: string;
  /**
   * This class's signature ability, grantable to a stand-out recruit on top of its base suit power (see party.ts's
   * RecruitSpec.special). Absent only for MERCENARY, which no recruit/sticker reward ever targets — it exists
   * purely as classForCard's display theme for the Mercenary "19" card (see SuitedCard.noSuitPower).
   */
  specialAbility?: SpecialAbilityId;
  specialName?: string;
  specialText?: string;
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
  DRUID: {
    id: 'DRUID',
    name: 'Druid',
    tag: 'Regrowth',
    glyph: '🌱',
    color: '#4a7c3f',
    specialAbility: 'WELLSPRING',
    specialName: 'Wellspring',
    specialText: 'Wellspring: Regrowth salvages 2 cards from the banish pile instead of 1.',
  },
  CHANTER: {
    id: 'CHANTER',
    name: 'Chanter',
    tag: 'Team Draw',
    glyph: '🎼',
    color: '#3a8c8c',
    specialAbility: 'ENCORE',
    specialName: 'Encore',
    specialText: 'Encore: doubles how many cards everyone draws in the chant.',
  },
  EVERGREEN: {
    id: 'EVERGREEN',
    name: 'Evergreen',
    tag: 'All Four Powers',
    glyph: '🌳',
    color: '#2f6b3f',
    specialAbility: 'EVERGREEN',
    specialName: 'Evergreen',
    specialText:
      'Evergreen: resolves all four base class powers at once — heal, draw, double damage, reduce enemy ' +
      "strength — and always ignores enemy immunity, no matter which classes the enemy is immune to.",
  },
  MERCENARY: {
    id: 'MERCENARY',
    name: 'Mercenary',
    tag: 'No Power',
    glyph: '⛒',
    color: '#6b6255',
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
export function classForCard(card: {
  suit: Suit;
  arcane?: boolean;
  reaver?: boolean;
  guardian?: boolean;
  druid?: boolean;
  chanter?: boolean;
  evergreen?: boolean;
  noSuitPower?: boolean;
}): ClassTheme {
  if (card.arcane) return CLASS_THEME.MAGE;
  if (card.reaver) return CLASS_THEME.REAVER;
  if (card.guardian) return CLASS_THEME.GUARDIAN;
  if (card.druid) return CLASS_THEME.DRUID;
  if (card.chanter) return CLASS_THEME.CHANTER;
  if (card.evergreen) return CLASS_THEME.EVERGREEN;
  if (card.noSuitPower) return CLASS_THEME.MERCENARY;
  return SUIT_TO_CLASS[card.suit];
}
