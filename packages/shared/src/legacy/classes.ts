import type { Suit } from '../game/types.js';

export type ClassId = 'WARRIOR' | 'BARD' | 'CLERIC' | 'PALADIN';

/**
 * Regicide Legacy's four classes map 1:1 onto classic Regicide's four suits — Warrior=Clubs (double damage),
 * Bard=Diamonds (draw), Cleric=Hearts (heal), Paladin=Spades (reduce enemy strength). Internally a Legacy party
 * card IS a suited card (see legacy/party.ts); this table is purely the display layer so suit letters never
 * leak into Legacy UI text.
 */
export interface ClassTheme {
  id: ClassId;
  suit: Suit;
  name: string;
  tag: string;
  glyph: string;
  color: string;
}

export const CLASS_THEME: Record<ClassId, ClassTheme> = {
  WARRIOR: { id: 'WARRIOR', suit: 'C', name: 'Warrior', tag: 'Double Damage', glyph: '⚔', color: '#8a3b3b' },
  BARD: { id: 'BARD', suit: 'D', name: 'Bard', tag: 'Draw Cards', glyph: '🎵', color: '#c99a3a' },
  CLERIC: { id: 'CLERIC', suit: 'H', name: 'Cleric', tag: 'Heal', glyph: '✚', color: '#b8434a' },
  PALADIN: { id: 'PALADIN', suit: 'S', name: 'Paladin', tag: 'Reduce Strength', glyph: '🛡', color: '#3f4f6b' },
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
