import type { CSSProperties } from 'react';
import type { Card, Suit } from '@regicide/shared';

/** A character portrait occupies one cell in a generated art sheet. */
export interface CardArt {
  sheet: string;
  index: number;
  columns?: number;
  rows?: number;
}

const BASE_RANK_INDEX: Record<string, number> = {
  '2': 0,
  '3': 1,
  '4': 2,
  '5': 3,
  '6': 4,
  '7': 5,
  '8': 6,
  '9': 7,
  '10': 8,
  A: 9,
};

const BASE_SHEET: Record<Suit, string> = {
  C: 'warrior-grid',
  D: 'bard-grid',
  H: 'cleric-grid',
  S: 'paladin-grid',
};

const MAGE_ART: Record<string, CardArt> = {
  'Ilyra Sparkwrit': { sheet: 'mage-grid', index: 0 },
  'Corvath the Kindled': { sheet: 'mage-grid', index: 1 },
  'Dassin Coalglow': { sheet: 'mage-grid', index: 2 },
  'Ophira Emberquill': { sheet: 'mage-grid', index: 3 },
  'Wystan Pyrewick': { sheet: 'mage-grid', index: 4 },
  'Marn Cindervoice': { sheet: 'mage-grid', index: 5 },
  'Talis Ashborn': { sheet: 'mage-grid', index: 6 },
  'Ruven Ashcaller': { sheet: 'mage-grid', index: 7 },
  'Sorrel Brandwake': { sheet: 'mage-grid', index: 8 },
  'Kael Emberdrake': { sheet: 'mage-grid', index: 9 },
};

const CAMPAIGN_ART: Record<string, CardArt> = {
  'High Arcana': { sheet: 'legacy-hero-grid', index: 0 },
  Haror: { sheet: 'legacy-hero-grid', index: 1 },
  Ferro: { sheet: 'legacy-hero-grid', index: 2 },
  Alanta: { sheet: 'legacy-hero-grid', index: 3 },
  'Bram the Refrainkeeper': { sheet: 'legacy-hero-grid', index: 4 },
  Goran: { sheet: 'legacy-hero-grid', index: 5 },
  Fennow: { sheet: 'legacy-hero-grid', index: 6 },
  Cressida: { sheet: 'legacy-hero-grid', index: 7 },
  Orwick: { sheet: 'legacy-hero-grid', index: 8 },
  Sabrielle: { sheet: 'legacy-hero-grid', index: 9 },
  Ash: { sheet: 'enemy-grid', index: 12, rows: 3 },
};

const MERCENARY_ART: Record<string, CardArt> = {
  Ghali: { sheet: 'mercenary-grid', index: 0, rows: 3 },
  'Pàviõ': { sheet: 'mercenary-grid', index: 1, rows: 3 },
  Argo: { sheet: 'mercenary-grid', index: 2, rows: 3 },
  Hella: { sheet: 'mercenary-grid', index: 3, rows: 3 },
};

const PILGRIM_NAME_ART: Record<string, CardArt> = {
  'Old Yarrow': { sheet: 'pilgrim-grid', index: 0 },
  'Little Mireille': { sheet: 'pilgrim-grid', index: 1 },
  'Bosk the Carter': { sheet: 'pilgrim-grid', index: 2 },
  'Sister Halvard': { sheet: 'pilgrim-grid', index: 3 },
  'Corin Drizzlecoat': { sheet: 'pilgrim-grid', index: 4 },
  'Fenna Longrope': { sheet: 'pilgrim-grid', index: 5 },
  Scrap: { sheet: 'pilgrim-grid', index: 6 },
};

const PILGRIM_RANK_ART: Record<string, CardArt> = {
  '2': { sheet: 'pilgrim-grid', index: 7 },
  '3': { sheet: 'pilgrim-grid', index: 1 },
  '4': { sheet: 'pilgrim-grid', index: 8 },
  '5': { sheet: 'pilgrim-grid', index: 2 },
  '6': { sheet: 'pilgrim-grid', index: 9 },
  '7': { sheet: 'pilgrim-grid', index: 5 },
};

const ENEMY_RANK_INDEX: Record<string, number> = { J: 0, Q: 1, K: 2 };
const ENEMY_SUIT_INDEX: Record<Suit, number> = { C: 0, D: 1, H: 2, S: 3 };

export const JESTER_ART: CardArt = { sheet: 'mercenary-grid', index: 10, rows: 3 };

/** Finds the stable portrait for every playable card family. */
export function cardArtFor(card: Card): CardArt | null {
  if (card.kind !== 'suited') return null;

  if (card.pilgrim) return (card.name ? PILGRIM_NAME_ART[card.name] : undefined) ?? PILGRIM_RANK_ART[card.rank] ?? null;

  const namedArt = card.name ? MAGE_ART[card.name] ?? CAMPAIGN_ART[card.name] ?? MERCENARY_ART[card.name] : undefined;
  if (namedArt) return namedArt;

  if (card.flexibleComboRank) return { sheet: 'mercenary-grid', index: 4 + ENEMY_SUIT_INDEX[card.suit], rows: 3 };
  if (card.noSuitPower && card.rank === '19') return { sheet: 'mercenary-grid', index: 8, rows: 3 };
  if (card.wildSuit) return { sheet: 'mercenary-grid', index: 9, rows: 3 };

  const enemyRank = ENEMY_RANK_INDEX[card.rank];
  if (enemyRank !== undefined) {
    return { sheet: 'enemy-grid', index: enemyRank * 4 + ENEMY_SUIT_INDEX[card.suit], rows: 3 };
  }

  // Pure campaign-class cards are expected to have one of the named portraits above. Cards upgraded in place
  // (such as Evergreen Esme) retain their original party portrait.
  if (card.arcane || card.reaver || card.guardian || card.druid || card.chanter) return null;

  const index = BASE_RANK_INDEX[card.rank];
  return index === undefined ? null : { sheet: BASE_SHEET[card.suit], index };
}

/** Turns a sheet location into a CSS background crop without creating per-card image requests. */
export function cardArtStyle(art: CardArt): CSSProperties {
  const columns = art.columns ?? 5;
  const rows = art.rows ?? 2;
  const col = art.index % columns;
  const row = Math.floor(art.index / columns);
  const x = columns > 1 ? (col * 100) / (columns - 1) : 0;
  const y = rows > 1 ? (row * 100) / (rows - 1) : 0;

  return {
    backgroundImage: `url(/card-art/sheets/${art.sheet}.png)`,
    backgroundSize: `${columns * 100}% ${rows * 100}%`,
    backgroundPosition: `${x}% ${y}%`,
  };
}
