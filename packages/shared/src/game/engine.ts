import type { Card, EngineResult, GameAction, GameState, PlayerState } from './types.js';
import { buildCastleDeck, buildTavernDeck, makeRng, MAX_HAND_SIZE_BY_PLAYER_COUNT } from './deck.js';
import { cardValue, currentEnemyAttack, isSuitBlockedByImmunity, validatePlayShape } from './rules.js';

const MAX_LOG_LENGTH = 200;

function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

function log(state: GameState, message: string): void {
  state.log.push({ message });
  if (state.log.length > MAX_LOG_LENGTH) {
    state.log.splice(0, state.log.length - MAX_LOG_LENGTH);
  }
}

function nextRandom(state: GameState): number {
  let a = state.rngState | 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  state.rngState = a;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffleWithState<T>(arr: T[], state: GameState): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(state) * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function ok(state: GameState): EngineResult {
  return { ok: true, state, events: state.log.slice(-1) };
}

function fail(error: string): EngineResult {
  return { ok: false, error };
}

function findPlayer(state: GameState, playerId: string): PlayerState | undefined {
  return state.players.find((p) => p.id === playerId);
}

function currentPlayer(state: GameState): PlayerState {
  return state.players[state.currentPlayerIndex];
}

function requireCurrentPlayerTurn(state: GameState, playerId: string, expectedPhase: GameState['turnPhase']): string | null {
  if (state.phase !== 'IN_PROGRESS') return 'The game is not in progress.';
  const cp = currentPlayer(state);
  if (!cp || cp.id !== playerId) return "It is not your turn.";
  if (state.turnPhase !== expectedPhase) return `You cannot do that right now (expected ${expectedPhase}).`;
  return null;
}

function allOtherPlayersYieldedLastTurn(state: GameState): boolean {
  const n = state.players.length;
  if (n <= 1) return false;
  for (let i = 0; i < n; i++) {
    if (i === state.currentPlayerIndex) continue;
    if (!state.lastActionWasYield[i]) return false;
  }
  return true;
}

function checkForStuckLoss(state: GameState): void {
  if (state.phase !== 'IN_PROGRESS') return;
  const p = currentPlayer(state);
  if (p.hand.length === 0 && allOtherPlayersYieldedLastTurn(state)) {
    state.phase = 'LOST';
    state.lossReason = `${p.name} has no cards left and cannot yield — the party has fallen.`;
    log(state, state.lossReason);
  }
}

function advanceToNextPlayer(state: GameState): void {
  state.pendingDamage = 0;
  state.turnPhase = 'AWAIT_PLAY';
  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
  checkForStuckLoss(state);
}

function drawOneCard(state: GameState, player: PlayerState): boolean {
  if (state.tavernDeck.length === 0) return false;
  if (player.hand.length >= state.maxHandSize) return false;
  const card = state.tavernDeck.shift()!;
  player.hand.push(card);
  return true;
}

function resolveDiamonds(state: GameState, attackValue: number): void {
  let drawn = 0;
  let idx = state.currentPlayerIndex;
  let consecutiveSkips = 0;
  const n = state.players.length;
  while (drawn < attackValue) {
    if (state.tavernDeck.length === 0) break;
    const candidate = state.players[idx % n];
    if (candidate.hand.length < state.maxHandSize) {
      drawOneCard(state, candidate);
      drawn += 1;
      consecutiveSkips = 0;
    } else {
      consecutiveSkips += 1;
      if (consecutiveSkips >= n) break; // everyone is at max hand size
    }
    idx += 1;
  }
  if (drawn > 0) log(state, `Diamonds: ${drawn} card(s) drawn.`);
}

function resolveHearts(state: GameState, attackValue: number): void {
  const shuffled = shuffleWithState(state.discardPile, state);
  const healCount = Math.min(attackValue, shuffled.length);
  const healed = shuffled.slice(0, healCount);
  const remaining = shuffled.slice(healCount);
  state.tavernDeck.push(...healed); // "under the tavern deck" = bottom
  state.discardPile = remaining;
  if (healCount > 0) log(state, `Hearts: ${healCount} card(s) shuffled back under the Tavern deck.`);
}

/** Resolves suit powers for a play of the given total value against the current enemy. Returns whether damage should be doubled. */
function resolveSuitPowers(state: GameState, suits: ('H' | 'D' | 'C' | 'S')[], totalValue: number): boolean {
  const enemy = state.currentEnemy!;
  const blocked = (s: 'H' | 'D' | 'C' | 'S') => isSuitBlockedByImmunity(s, enemy);

  if (suits.includes('H')) {
    if (blocked('H')) log(state, `Hearts blocked — the enemy is immune to its own suit.`);
    else resolveHearts(state, totalValue);
  }
  if (suits.includes('D')) {
    if (blocked('D')) log(state, `Diamonds blocked — the enemy is immune to its own suit.`);
    else resolveDiamonds(state, totalValue);
  }
  let clubsDoubled = false;
  if (suits.includes('C')) {
    if (blocked('C')) log(state, `Clubs blocked — the enemy is immune to its own suit.`);
    else clubsDoubled = true;
  }
  if (suits.includes('S')) {
    if (blocked('S')) {
      enemy.blockedSpadesShield += totalValue;
      log(state, `Spades blocked — the enemy is immune to its own suit (shield banked for later).`);
    } else {
      enemy.spadesShield += totalValue;
    }
  }
  return clubsDoubled;
}

/** Returns true if the enemy was defeated by this hit (win or new enemy revealed either way). */
function dealDamageAndCheckDefeat(state: GameState, damage: number): boolean {
  const enemy = state.currentEnemy!;
  enemy.damageTaken += damage;
  const remaining = enemy.maxHealth - enemy.damageTaken;
  if (remaining > 0) return false;

  const exact = remaining === 0;
  const defeatedCard: Card = { id: `enemy-${enemy.suit}${enemy.rank}-${Date.now()}-${Math.floor(nextRandom(state) * 1e6)}`, kind: 'suited', suit: enemy.suit, rank: enemy.rank };
  if (exact) {
    state.tavernDeck.unshift(defeatedCard); // top of tavern deck
    log(state, `${enemy.rank} of ${enemy.suit} defeated with an exact hit — returns to the top of the Tavern deck!`);
  } else {
    state.discardPile.push(defeatedCard);
    log(state, `${enemy.rank} of ${enemy.suit} defeated!`);
  }
  state.discardPile.push(...enemy.tableCards);

  if (state.castleDeck.length === 0) {
    state.phase = 'WON';
    state.currentEnemy = null;
    log(state, `The last King has fallen — the realm is saved!`);
    return true;
  }
  state.currentEnemy = state.castleDeck.shift()!;
  log(state, `A new enemy is revealed: ${state.currentEnemy.rank} of ${state.currentEnemy.suit}.`);
  // Defeating player continues their turn against the new enemy (no defend, no turn advance).
  state.turnPhase = 'AWAIT_PLAY';
  state.pendingDamage = 0;
  return true;
}

function startGame(state: GameState, action: Extract<GameAction, { type: 'START_GAME' }>): EngineResult {
  if (state.phase !== 'LOBBY') return fail('The game has already started.');
  const n = action.playerIds.length;
  if (n < 1 || n > 4) return fail('Regicide supports 1-4 players.');
  if (action.playerIds.length !== action.playerNames.length) return fail('Player id/name mismatch.');

  const buildRng = makeRng(action.seed);
  const castleDeck = buildCastleDeck(buildRng);
  const tavernDeck = buildTavernDeck(n, buildRng);
  const maxHandSize = MAX_HAND_SIZE_BY_PLAYER_COUNT[n] ?? 5;

  const players: PlayerState[] = action.playerIds.map((id, i) => ({
    id,
    name: action.playerNames[i],
    hand: [],
    connected: true,
  }));

  for (const player of players) {
    for (let i = 0; i < maxHandSize; i++) {
      const card = tavernDeck.shift();
      if (card) player.hand.push(card);
    }
  }

  state.phase = 'IN_PROGRESS';
  state.players = players;
  state.currentPlayerIndex = 0;
  state.turnPhase = 'AWAIT_PLAY';
  state.pendingDamage = 0;
  state.castleDeck = castleDeck.slice(1);
  state.currentEnemy = castleDeck[0];
  state.tavernDeck = tavernDeck;
  state.discardPile = [];
  state.maxHandSize = maxHandSize;
  state.lastActionWasYield = players.map(() => false);
  state.log = [];
  state.lossReason = null;
  state.rngState = hashSeed(`${action.seed}:play`);

  log(state, `Game started with ${n} player(s). First enemy: ${state.currentEnemy.rank} of ${state.currentEnemy.suit}.`);
  return ok(state);
}

function playCards(state: GameState, action: Extract<GameAction, { type: 'PLAY_CARDS' }>): EngineResult {
  const err = requireCurrentPlayerTurn(state, action.playerId, 'AWAIT_PLAY');
  if (err) return fail(err);

  const player = currentPlayer(state);
  const cards: Card[] = [];
  for (const id of action.cardIds) {
    const card = player.hand.find((c) => c.id === id);
    if (!card) return fail(`Card ${id} is not in your hand.`);
    cards.push(card);
  }
  if (cards.some((c) => c.kind === 'jester')) {
    return fail('Use the Jester action to play the Jester.');
  }

  const shape = validatePlayShape(cards);
  if ('error' in shape) return fail(shape.error);

  // Remove played cards from hand, move to the enemy's table pile for this fight.
  const idSet = new Set(action.cardIds);
  player.hand = player.hand.filter((c) => !idSet.has(c.id));
  state.currentEnemy!.tableCards.push(...cards);

  log(state, `${player.name} plays ${cards.length > 1 ? 'a combo' : 'a card'} for ${shape.totalValue}.`);
  const clubsDoubled = resolveSuitPowers(state, shape.suits, shape.totalValue);
  const damage = shape.totalValue * (clubsDoubled ? 2 : 1);
  state.lastActionWasYield[state.currentPlayerIndex] = false;

  const defeated = dealDamageAndCheckDefeat(state, damage);

  if (state.phase !== 'IN_PROGRESS') return ok(state);
  if (defeated) return ok(state); // enemy was defeated, same player continues against the next one

  const enemyAttack = currentEnemyAttack(state.currentEnemy!);
  if (enemyAttack <= 0) {
    log(state, `The enemy's attack has been reduced to 0 — no damage suffered.`);
    advanceToNextPlayer(state);
    return ok(state);
  }
  state.pendingDamage = enemyAttack;
  state.turnPhase = 'AWAIT_DEFEND';
  return ok(state);
}

function yieldTurn(state: GameState, action: Extract<GameAction, { type: 'YIELD' }>): EngineResult {
  const err = requireCurrentPlayerTurn(state, action.playerId, 'AWAIT_PLAY');
  if (err) return fail(err);
  if (allOtherPlayersYieldedLastTurn(state)) {
    return fail('Everyone else just yielded — you must play a card.');
  }

  const player = currentPlayer(state);
  log(state, `${player.name} yields.`);
  state.lastActionWasYield[state.currentPlayerIndex] = true;

  const enemyAttack = currentEnemyAttack(state.currentEnemy!);
  if (enemyAttack <= 0) {
    advanceToNextPlayer(state);
    return ok(state);
  }
  state.pendingDamage = enemyAttack;
  state.turnPhase = 'AWAIT_DEFEND';
  return ok(state);
}

function activateJester(state: GameState, action: Extract<GameAction, { type: 'ACTIVATE_JESTER' }>): EngineResult {
  const err = requireCurrentPlayerTurn(state, action.playerId, 'AWAIT_PLAY');
  if (err) return fail(err);

  const player = currentPlayer(state);
  const card = player.hand.find((c) => c.id === action.cardId);
  if (!card || card.kind !== 'jester') return fail('That is not a Jester in your hand.');
  const nextPlayer = findPlayer(state, action.nextPlayerId);
  if (!nextPlayer) return fail('Unknown next player.');

  player.hand = player.hand.filter((c) => c.id !== card.id);
  const enemy = state.currentEnemy!;
  enemy.tableCards.push(card);
  const wasImmune = !enemy.immunityBroken;
  enemy.immunityBroken = true;
  if (enemy.blockedSpadesShield > 0) {
    enemy.spadesShield += enemy.blockedSpadesShield;
    enemy.blockedSpadesShield = 0;
  }

  log(state, `${player.name} plays the Jester${wasImmune ? ` — the ${enemy.rank} of ${enemy.suit}'s immunity is broken!` : '.'}`);
  state.lastActionWasYield[state.currentPlayerIndex] = false;

  state.currentPlayerIndex = state.players.findIndex((p) => p.id === nextPlayer.id);
  state.turnPhase = 'AWAIT_PLAY';
  state.pendingDamage = 0;
  log(state, `${nextPlayer.name} goes next.`);
  checkForStuckLoss(state);
  return ok(state);
}

function defend(state: GameState, action: Extract<GameAction, { type: 'DEFEND' }>): EngineResult {
  const err = requireCurrentPlayerTurn(state, action.playerId, 'AWAIT_DEFEND');
  if (err) return fail(err);

  const player = currentPlayer(state);
  const cards: Card[] = [];
  for (const id of action.cardIds) {
    const card = player.hand.find((c) => c.id === id);
    if (!card) return fail(`Card ${id} is not in your hand.`);
    cards.push(card);
  }
  const discardTotal = cards.reduce((sum, c) => sum + cardValue(c), 0);
  const isEntireHand = cards.length === player.hand.length;

  if (discardTotal < state.pendingDamage && !isEntireHand) {
    return fail(`That only covers ${discardTotal} of ${state.pendingDamage} damage — select more cards or your whole hand.`);
  }

  const idSet = new Set(action.cardIds);
  player.hand = player.hand.filter((c) => !idSet.has(c.id));
  state.discardPile.push(...cards);

  if (discardTotal < state.pendingDamage) {
    state.phase = 'LOST';
    state.lossReason = `${player.name} could only cover ${discardTotal} of ${state.pendingDamage} damage — the party has fallen.`;
    log(state, state.lossReason);
    return ok(state);
  }

  log(state, `${player.name} discards ${cards.length} card(s) to cover ${state.pendingDamage} damage.`);
  advanceToNextPlayer(state);
  return ok(state);
}

export function createLobbyState(): GameState {
  return {
    phase: 'LOBBY',
    players: [],
    currentPlayerIndex: 0,
    turnPhase: 'AWAIT_PLAY',
    pendingDamage: 0,
    castleDeck: [],
    currentEnemy: null,
    tavernDeck: [],
    discardPile: [],
    maxHandSize: 5,
    lastActionWasYield: [],
    log: [],
    lossReason: null,
    rngState: 0,
  };
}

export function applyAction(state: GameState, action: GameAction): EngineResult {
  const draft = cloneState(state);
  switch (action.type) {
    case 'START_GAME':
      return startGame(draft, action);
    case 'PLAY_CARDS':
      return playCards(draft, action);
    case 'YIELD':
      return yieldTurn(draft, action);
    case 'ACTIVATE_JESTER':
      return activateJester(draft, action);
    case 'DEFEND':
      return defend(draft, action);
    default:
      return fail('Unknown action.');
  }
}
