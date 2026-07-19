export type Suit = 'H' | 'D' | 'C' | 'S';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'A' | 'J' | 'Q' | 'K';

export interface SuitedCard {
  id: string;
  kind: 'suited';
  suit: Suit;
  rank: Rank;
  /** Legacy-only: a party member's name (e.g. "Herbod"), shown instead of rank-of-suit. */
  name?: string;
}

export interface JesterCard {
  id: string;
  kind: 'jester';
}

export type Card = SuitedCard | JesterCard;

export interface PlayerState {
  id: string;
  name: string;
  hand: Card[];
  connected: boolean;
}

export interface EnemyState {
  suit: Suit;
  rank: 'J' | 'Q' | 'K';
  /** Legacy-only: a named mission enemy (e.g. "Letholdus the Justicar") shown instead of rank-of-suit. */
  name?: string;
  maxHealth: number;
  baseAttack: number;
  damageTaken: number;
  /** Active cumulative spade-shield reduction to this enemy's attack. */
  spadesShield: number;
  /** Spade values played while this enemy was immune to spades; folded into spadesShield if immunity is later broken. */
  blockedSpadesShield: number;
  /** True once a Jester has cancelled this enemy's suit immunity. */
  immunityBroken: boolean;
  /** All cards played against this enemy so far this fight (go to discard together on defeat). */
  tableCards: Card[];
}

/** A mission-specific enemy spec used to build a Legacy mission's enemy deck (see legacy/missions.ts). */
export interface LegacyEnemySpec {
  name: string;
  /** The class the enemy is immune to, modeled internally as a suit (see legacy/classes.ts). */
  suit: Suit;
  health: number;
  attack: number;
}

export type GamePhase = 'LOBBY' | 'IN_PROGRESS' | 'WON' | 'LOST';

/** What the current player must do next. AWAIT_JESTER_CLAIM is Legacy-only (see jesterClaim). */
export type TurnPhase = 'AWAIT_PLAY' | 'AWAIT_DEFEND' | 'AWAIT_JESTER_CLAIM';

/** Which rules variant this game is running — gates every Legacy-only mechanic below. */
export type Ruleset = 'regicide' | 'legacy';

/** Official solo-variant scoring: winning having flipped 0/1/2 solo Jesters. Only set for 1-player games. */
export type VictoryMedal = 'gold' | 'silver' | 'bronze';

export interface GameState {
  phase: GamePhase;
  /** Defaults to 'regicide' everywhere existing code constructs a GameState — every Legacy-only field/branch below is inert unless this is 'legacy'. */
  ruleset: Ruleset;
  players: PlayerState[];
  currentPlayerIndex: number;
  turnPhase: TurnPhase;
  /** Damage the current player must discard cards to cover (only meaningful in AWAIT_DEFEND). */
  pendingDamage: number;
  castleDeck: EnemyState[];
  currentEnemy: EnemyState | null;
  tavernDeck: Card[];
  discardPile: Card[];
  maxHandSize: number;
  /** Tracks, per player index, whether their most recently completed turn was a yield (for the "can't all yield" rule, and Legacy's Feign Death). */
  lastActionWasYield: boolean[];
  log: GameEvent[];
  lossReason: string | null;
  /** Internal PRNG state (uint32) for in-game randomness like Hearts reshuffles. */
  rngState: number;
  /** Solo-variant only: how many of the 2 set-aside Jesters have been flipped (discard hand, refill to max) this game. */
  soloJestersUsed: number;
  /** Set once on WON, only for 1-player games, based on soloJestersUsed at that moment. */
  victoryMedal: VictoryMedal | null;
  /**
   * Legacy-only: the open Jester-claim window. Non-null from PLAY_JESTER until the claimant's
   * combined attack resolves. `claimedBy` is null while the window is open to any player.
   */
  jesterClaim: { card: Card; claimedBy: string | null } | null;
}

export interface GameEvent {
  message: string;
}

export type GameAction =
  | { type: 'START_GAME'; playerIds: string[]; playerNames: string[]; seed: string }
  | {
      type: 'START_LEGACY_MISSION';
      playerIds: string[];
      playerNames: string[];
      seed: string;
      /** The campaign's current party roster (not a fresh standard deck). */
      party: Card[];
      /** This mission's enemies, in the fixed order they'll be faced. */
      enemies: LegacyEnemySpec[];
      /** How many Jesters to shuffle into this mission's reserve deck (by player count, per the rulebook). */
      jesterCount: number;
    }
  | { type: 'PLAY_CARDS'; playerId: string; cardIds: string[] }
  | { type: 'YIELD'; playerId: string }
  | { type: 'ACTIVATE_JESTER'; playerId: string; cardId: string; nextPlayerId: string }
  /** Legacy-only equivalent of ACTIVATE_JESTER: plays the Jester into the open claim window instead of choosing who goes next. */
  | { type: 'PLAY_JESTER'; playerId: string; cardId: string }
  /** Legacy-only: claim an open Jester window. Validated against the window being open, not turn ownership — any player may claim. */
  | { type: 'CLAIM_JESTER'; playerId: string }
  | { type: 'DEFEND'; playerId: string; cardIds: string[] }
  | { type: 'USE_SOLO_JESTER'; playerId: string };

export type EngineResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: string };

/** Redacted view of GameState sent to a specific client: other players' hands are counts only. */
export interface ClientPlayerView {
  id: string;
  name: string;
  connected: boolean;
  handCount: number;
  hand?: Card[]; // present only for the viewing player
}

export interface ClientGameState {
  phase: GamePhase;
  ruleset: Ruleset;
  players: ClientPlayerView[];
  currentPlayerIndex: number;
  turnPhase: TurnPhase;
  pendingDamage: number;
  currentEnemy: EnemyState | null;
  castleDeckCount: number;
  tavernDeckCount: number;
  discardPile: Card[];
  maxHandSize: number;
  log: GameEvent[];
  lossReason: string | null;
  soloJestersUsed: number;
  victoryMedal: VictoryMedal | null;
  /** Legacy-only: the Jester sitting in the open claim window, if any (public information — it's on the table). */
  jesterClaim: { card: Card; claimedBy: string | null } | null;
  you: {
    playerId: string;
  };
}
