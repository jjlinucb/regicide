import type { Card, CapturedPile, EnemyState, LegacyEnemySpec, Suit, SuitedCard } from './types.js';
import { cardValue } from './rules.js';

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
    secondSuit: spec.secondSuit,
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

/**
 * Endless Mode (classic Regicide only): after the first WON, the Castle deck is rebuilt one tier stronger by
 * `loop` (1-indexed) and stays in J/Q/K order each pass. Every rank's stats climb by a flat +10 health / +5
 * attack per loop — the same step that separates J from Q and Q from K in the base game — so at loop 1, Jacks
 * fight at the base game's Queen stats (30/15), Queens at King stats (40/20), and Kings step past their own
 * ceiling to 50/25. Loop 2 pushes every rank one more step, and so on indefinitely.
 */
export function buildEndlessCastleDeck(loop: number, rng: () => number): EnemyState[] {
  const scaled = (rank: 'J' | 'Q' | 'K', suit: Suit): EnemyState => {
    const enemy = makeEnemy(suit, rank);
    const stats = ENEMY_STATS[rank];
    enemy.maxHealth = stats.health + 10 * loop;
    enemy.baseAttack = stats.attack + 5 * loop;
    return enemy;
  };
  const jacks = shuffle(SUITS.map((s) => scaled('J', s)), rng);
  const queens = shuffle(SUITS.map((s) => scaled('Q', s)), rng);
  const kings = shuffle(SUITS.map((s) => scaled('K', s)), rng);
  return [...jacks, ...queens, ...kings];
}

/**
 * Endless Mode's Tavern deck: the standard 40 cards plus the 4 Jacks and 4 Kings (now playable, worth 10/20 per
 * rules.cardValue, and further boosted by GameState.playerCourtTier — see engine.ts) and jesters per player count.
 */
export function buildEndlessTavernDeck(playerCount: number, rng: () => number): Card[] {
  const jesterCount = JESTERS_BY_PLAYER_COUNT[playerCount] ?? 0;
  const jacks: SuitedCard[] = SUITS.map((s) => ({ id: nextId(), kind: 'suited', suit: s, rank: 'J' }));
  const kings: SuitedCard[] = SUITS.map((s) => ({ id: nextId(), kind: 'suited', suit: s, rank: 'K' }));
  const cards = [...buildStandardPartyCards(), ...jacks, ...kings, ...makeJesters(jesterCount)];
  return shuffle(cards, rng);
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

/**
 * Legacy-only (Mission 9): shuffles the party and splits the first 30 cards into 3 face-down piles of 10, each
 * with its top card immediately flipped face-up. Returns the piles plus whatever's left of the party (not
 * captured) — the caller shuffles that remainder (plus jesters, plus any mission-only extras) into the actual
 * reserve deck via buildLegacyReserveDeck.
 */
export function buildCapturedPiles(party: Card[], rng: () => number): { piles: CapturedPile[]; leftoverParty: Card[] } {
  const shuffled = shuffle(party, rng);
  const captured = shuffled.slice(0, 30);
  const leftoverParty = shuffled.slice(30);
  const piles: CapturedPile[] = [0, 1, 2].map((i) => {
    const pileCards = captured.slice(i * 10, i * 10 + 10);
    const faceUp = pileCards.shift() ?? null;
    return { faceDown: pileCards, faceUp };
  });
  return { piles, leftoverParty };
}

/** Legacy-only (Mission 10, "Pride to Fall"): how many party members are twisted into the enemy line. */
export const CORRUPTED_PARTY_ENEMY_COUNT = 8;

/**
 * Legacy-only (Mission 10): pulls CORRUPTED_PARTY_ENEMY_COUNT cards out of the campaign party and turns each into
 * a fixed-order enemy, sorted weakest-to-strongest by card value.
 *
 * Sourced correction (regicidelegacy.com's compendium, corroborated by BoardGameGeek threads and an independent
 * fan digital reimplementation — see the legacy-missions-transcript-mismatches memory doc's Mission 10 section):
 * the fight is supposed to be built from party members ALREADY marked corrupted earlier in the campaign
 * (SuitedCard.corrupted), not sampled fresh at random the way this shipped originally. In the actual current
 * campaign, though, no earlier mission's reward path sets that flag on a party card yet — the "corrupt another
 * card" reward step several earlier missions (2, 5, 8) are separately documented as missing isn't implemented,
 * and fixing that is out of scope here — so in practice `corrupted` below the fold-line is checked honestly and
 * usually comes up empty. This prioritizes any already-corrupted members first (so the sourced rule takes over
 * the instant an earlier mission starts corrupting cards for real) and only falls back to the old
 * random-sample-from-the-whole-party behavior to fill out whatever slots corrupted members don't cover — which,
 * against today's actual party state, is effectively all 8. Which corrupted members (or, on the fallback path,
 * which random ones) get pulled beyond "prefer corrupted" isn't specified by the transcript beyond "eight," so
 * the random tie-break remains a judgment call, not a transcript detail, exactly as before.
 *
 * Each enemy's health is fixed at 5x its (base) strength per the transcript — a flat multiple set here at
 * spec-build time, never recalculated later even though the enemy's *dealt* attack climbs with the mission zone
 * (see engine.ts's resolvedEnemyAttack). `secondSuit` carries over too, so a Dual-class Stickers party member
 * comes back immune to both classes, same as the class-immunity rule the transcript says otherwise applies "as
 * normal." Returns the enemies plus whatever's left of the party (not pulled) for the caller to build the
 * mission's reserve deck from — same shape as buildCapturedPiles above, the closest existing precedent for
 * carving mission-specific state out of the party at setup.
 */
export function buildCorruptedPartyEnemies(
  party: Card[],
  rng: () => number,
): { enemies: EnemyState[]; leftoverParty: Card[] } {
  const suited = party.filter((c): c is SuitedCard => c.kind === 'suited');
  const corrupted = shuffle(
    suited.filter((c) => c.corrupted),
    rng,
  );
  const uncorrupted = shuffle(
    suited.filter((c) => !c.corrupted),
    rng,
  );
  const chosen = [...corrupted, ...uncorrupted].slice(0, CORRUPTED_PARTY_ENEMY_COUNT);
  const chosenIds = new Set(chosen.map((c) => c.id));
  const leftoverParty = party.filter((c) => !chosenIds.has(c.id));

  const sorted = chosen.slice().sort((a, b) => cardValue(a) - cardValue(b));
  const enemies: EnemyState[] = sorted.map((card) => {
    const strength = cardValue(card);
    return {
      suit: card.suit,
      secondSuit: card.secondSuit,
      rank: 'J', // unused for display in Legacy (name takes over) — kept only to satisfy EnemyState's shape.
      name: card.name ?? `${card.rank} of ${card.suit}`,
      maxHealth: strength * 5,
      baseAttack: strength,
      damageTaken: 0,
      spadesShield: 0,
      blockedSpadesShield: 0,
      immunityBroken: false,
      tableCards: [],
      sourceCard: card,
    };
  });
  return { enemies, leftoverParty };
}

/**
 * Legacy-only (Mission 11, "Descent into Darkness"): pulls every Beast Companion card (Mission 4's reward pool,
 * see SuitedCard.beast) out of the campaign party and shuffles them into a face-down deck that sits in the
 * mission zone for this fight only — none of them are available to draw or play this mission (see
 * GameState.beastDeck). Returns the deck plus whatever's left of the party for the caller to build the mission's
 * reserve deck from — same "pull cards out, return the leftover" shape as buildCorruptedPartyEnemies above.
 */
export function buildBeastDeck(party: Card[], rng: () => number): { beastDeck: Card[]; leftoverParty: Card[] } {
  const beastCards = party.filter((c) => c.kind === 'suited' && c.beast);
  const beastIds = new Set(beastCards.map((c) => c.id));
  const leftoverParty = party.filter((c) => !beastIds.has(c.id));
  return { beastDeck: shuffle(beastCards, rng), leftoverParty };
}
