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

const ENEMY_RANK_INDEX: Record<string, number> = { J: 0, Q: 1, K: 2 };
const ENEMY_SUIT_INDEX: Record<Suit, number> = { C: 0, D: 1, H: 2, S: 3 };

/** Finds the stable portrait for every starting, campaign, and court character card. */
export function cardArtFor(card: Card): CardArt | null {
  if (card.kind !== 'suited') return null;

  const namedArt = card.name ? MAGE_ART[card.name] ?? CAMPAIGN_ART[card.name] : undefined;
  if (namedArt) return namedArt;

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
