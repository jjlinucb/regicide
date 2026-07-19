import type { Card, EnemyState, LegacyEnemySpec, Suit, SuitedCard } from './types.js';

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

/** Legacy-only: builds a named mission enemy with custom stats (bypasses the fixed J/Q/K stat table). */
export function makeLegacyEnemy(spec: LegacyEnemySpec): EnemyState {
  return {
    suit: spec.suit,
    rank: 'J', // unused for display in Legacy (name takes over) — kept only to satisfy EnemyState's shape.
    name: spec.name,
    maxHealth: spec.health,
    baseAttack: spec.attack,
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

export const JESTERS_BY_PLAYER_COUNT: Record<number, number> = { 1: 0, 2: 0, 3: 1, 4: 2 };
export const MAX_HAND_SIZE_BY_PLAYER_COUNT: Record<number, number> = { 1: 8, 2: 7, 3: 6, 4: 5 };

/**
 * Builds the 40 standard cards — 2-10 of every suit plus the 4 Animal Companions (Aces) — with no jesters.
 * Shared by classic Regicide's Tavern deck and Legacy's starting 40-member party (same card set, different display).
 */
export function buildStandardPartyCards(): SuitedCard[] {
  const cards: SuitedCard[] = [];
  for (const suit of SUITS) {
    for (const rank of NUMBER_RANKS) {
      cards.push({ id: nextId(), kind: 'suited', suit, rank });
    }
    cards.push({ id: nextId(), kind: 'suited', suit, rank: 'A' });
  }
  return cards;
}

function makeJesters(count: number): Card[] {
  const cards: Card[] = [];
  for (let i = 0; i < count; i++) {
    cards.push({ id: nextId(), kind: 'jester' });
  }
  return cards;
}

/** Builds the Tavern deck: 2-10 of every suit, the 4 Animal Companions (Aces), and jesters per player count. */
export function buildTavernDeck(playerCount: number, rng: () => number): Card[] {
  const jesterCount = JESTERS_BY_PLAYER_COUNT[playerCount] ?? 0;
  const cards = [...buildStandardPartyCards(), ...makeJesters(jesterCount)];
  return shuffle(cards, rng);
}

/** Legacy-only: shuffles a campaign's party together with a given number of jesters into a mission's reserve deck. */
export function buildLegacyReserveDeck(party: Card[], jesterCount: number, rng: () => number): Card[] {
  return shuffle([...party, ...makeJesters(jesterCount)], rng);
}
