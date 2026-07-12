import type { Card, EnemyState, Suit } from './types.js';

const SUITS: Suit[] = ['H', 'D', 'C', 'S'];
const NUMBER_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10'] as const;

/** Small deterministic PRNG (mulberry32) seeded from a string, so games/tests are reproducible. */
export function makeRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], rng: () => number): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

let cardIdCounter = 0;
function nextId(): string {
  cardIdCounter += 1;
  return `c${cardIdCounter}`;
}

export function resetCardIdsForTests(): void {
  cardIdCounter = 0;
}

const ENEMY_STATS: Record<'J' | 'Q' | 'K', { attack: number; health: number }> = {
  J: { attack: 10, health: 20 },
  Q: { attack: 15, health: 30 },
  K: { attack: 20, health: 40 },
};

export function makeEnemy(suit: Suit, rank: 'J' | 'Q' | 'K'): EnemyState {
  const stats = ENEMY_STATS[rank];
  return {
    suit,
    rank,
    maxHealth: stats.health,
    baseAttack: stats.attack,
    damageTaken: 0,
    spadesShield: 0,
    blockedSpadesShield: 0,
    immunityBroken: false,
    tableCards: [],
  };
}

/** Builds the 12-enemy Castle deck: 4 Jacks (shuffled) on top, then Queens, then Kings on the bottom. */
export function buildCastleDeck(rng: () => number): EnemyState[] {
  const jacks = shuffle(SUITS.map((s) => makeEnemy(s, 'J')), rng);
  const queens = shuffle(SUITS.map((s) => makeEnemy(s, 'Q')), rng);
  const kings = shuffle(SUITS.map((s) => makeEnemy(s, 'K')), rng);
  // Index 0 = next to reveal (top of face-down pile) = Jacks first.
  return [...jacks, ...queens, ...kings];
}

const JESTERS_BY_PLAYER_COUNT: Record<number, number> = { 1: 0, 2: 0, 3: 1, 4: 2 };
export const MAX_HAND_SIZE_BY_PLAYER_COUNT: Record<number, number> = { 1: 8, 2: 7, 3: 6, 4: 5 };

/** Builds the Tavern deck: 2-10 of every suit, the 4 Animal Companions (Aces), and jesters per player count. */
export function buildTavernDeck(playerCount: number, rng: () => number): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of NUMBER_RANKS) {
      cards.push({ id: nextId(), kind: 'suited', suit, rank });
    }
    cards.push({ id: nextId(), kind: 'suited', suit, rank: 'A' });
  }
  const jesterCount = JESTERS_BY_PLAYER_COUNT[playerCount] ?? 0;
  for (let i = 0; i < jesterCount; i++) {
    cards.push({ id: nextId(), kind: 'jester' });
  }
  return shuffle(cards, rng);
}
