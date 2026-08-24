import type { Card, EngineResult, GameAction, GameState, PlayerState, SpecialAbilityId, Suit } from './types.js';
import {
  buildCastleDeck,
  buildEndlessCastleDeck,
  buildEndlessTavernDeck,
  buildLegacyReserveDeck,
  buildTavernDeck,
  makeLegacyEnemy,
  makeRng,
  MAX_HAND_SIZE_BY_PLAYER_COUNT,
} from './deck.js';
import {
  ascendingZoneAttackBuff,
  cardSuits,
  cardValue,
  currentEnemyAttack,
  currentEnemyAttackWithDiscardBuff,
  discardPileTopValue,
  isSuitBlockedByImmunity,
  MAX_SOLO_JESTERS,
  validatePlayShape,
} from './rules.js';
import { classForSuit } from '../legacy/classes.js';

const SUIT_NAME: Record<Suit, string> = { H: 'Hearts', D: 'Diamonds', C: 'Clubs', S: 'Spades' };

/** Ruleset-aware label for a suit's power in log messages — "Hearts" in classic Regicide, "Cleric" in Legacy. */
function powerLabel(state: GameState, suit: Suit): string {
  return state.ruleset === 'legacy' ? classForSuit(suit).name : SUIT_NAME[suit];
}

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
  flipMissionZoneCard(state);
  checkForStuckLoss(state);
}

/**
 * Mission 3 ("Lessons in Flames") only: end of every turn, the top of the reserve deck flips face-up into a
 * shared mission zone, and the enemy becomes immune to that card's class(es) too — stacking with each further
 * flip. Only called from advanceToNextPlayer, so defeating an enemy (which skips straight back to AWAIT_PLAY
 * without advancing) naturally skips this turn's flip, per the mission's rule.
 */
function flipMissionZoneCard(state: GameState): void {
  if (!state.endOfTurnZoneFlip || !state.currentEnemy) return;
  const card = state.tavernDeck.shift();
  if (!card) return;
  state.missionZone.push(card);
  if (card.kind === 'suited') {
    for (const s of cardSuits(card)) {
      if (!state.zoneImmuneSuits.includes(s)) state.zoneImmuneSuits.push(s);
    }
    log(state, `The mission zone flips ${card.name ?? `a ${card.rank}`} — the enemy is now also immune to ${cardSuits(card).map((s) => classForSuit(s).name).join(' & ')}.`);
  } else {
    log(state, 'The mission zone flips a Jester.');
  }
}

function drawOneCard(state: GameState, player: PlayerState): boolean {
  if (state.tavernDeck.length === 0) return false;
  if (player.hand.length >= state.maxHandSize) return false;
  const card = state.tavernDeck.shift()!;
  player.hand.push(card);
  return true;
}

/** Mission 8's chant only: draws up to `count` cards for `player`, ignoring the hand limit (see beginChant). */
function forceDrawCards(state: GameState, player: PlayerState, count: number): number {
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    const card = state.tavernDeck.shift();
    if (!card) break;
    player.hand.push(card);
    drawn += 1;
  }
  return drawn;
}

function resolveDiamonds(state: GameState, attackValue: number, bonus = 0): void {
  let drawn = 0;
  let idx = state.currentPlayerIndex;
  let consecutiveSkips = 0;
  const n = state.players.length;
  const target = attackValue + bonus;
  while (drawn < target) {
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
  if (drawn > 0) log(state, `${powerLabel(state, 'D')}: ${drawn} card(s) drawn${bonus > 0 ? ' (Inspire)' : ''}.`);
}

function resolveHearts(state: GameState, attackValue: number, bonus = 0): void {
  const shuffled = shuffleWithState(state.discardPile, state);
  const healCount = Math.min(attackValue + bonus, shuffled.length);
  const healed = shuffled.slice(0, healCount);
  const remaining = shuffled.slice(healCount);
  state.tavernDeck.push(...healed); // "under the tavern deck" = bottom
  state.discardPile = remaining;
  if (healCount > 0) log(state, `${powerLabel(state, 'H')}: ${healCount} card(s) shuffled back under the Tavern deck${bonus > 0 ? ' (Revive)' : ''}.`);
}

/** True if any played card carries the given signature ability (Legacy-only; see types.SpecialAbilityId). */
function hasSpecial(cards: Card[], ability: SpecialAbilityId): boolean {
  return cards.some((c) => c.kind === 'suited' && c.special === ability);
}

/**
 * Legacy-only, Mission 3+: resolves each played Mage card's arcane bolt — at that card's own value, one after
 * another, and always before the rest of the play's class powers resolve (see resolveSuitPowers). Returns the
 * total bonus damage to add on top of the play's normal totalValue * multiplier.
 */
function resolveArcaneBolts(state: GameState, cards: Card[]): number {
  let bonus = 0;
  for (const c of cards) {
    if (c.kind !== 'suited' || !c.arcane) continue;
    const base = cardValue(c);
    const surged = c.special === 'ARCANE_SURGE';
    const bolt = surged ? base * 2 : base;
    bonus += bolt;
    log(state, `${c.name ?? 'A Mage'}'s arcane bolt strikes for ${bolt}${surged ? ' (Arcane Surge)' : ''}.`);
  }
  return bonus;
}

/**
 * Resolves suit/class powers for a play of the given total value against the current enemy. Returns the damage
 * multiplier to apply (1 normally, 2 for Clubs, 3 for Clubs + a Cleave card). `ignoreImmunity` is Legacy-only:
 * true for an attack combined with a claimed Jester, which ignores immunity for that attack only (unlike classic
 * Regicide's Jester, this does NOT permanently set enemy.immunityBroken).
 */
function resolveSuitPowers(
  state: GameState,
  cards: Card[],
  suits: ('H' | 'D' | 'C' | 'S')[],
  totalValue: number,
  ignoreImmunity = false,
  corruptedSuits: Suit[] = [],
): number {
  const enemy = state.currentEnemy!;
  const blocked = (s: 'H' | 'D' | 'C' | 'S') =>
    !ignoreImmunity &&
    !enemy.immunityBroken &&
    !corruptedSuits.includes(s) &&
    (isSuitBlockedByImmunity(s, enemy) || state.zoneImmuneSuits.includes(s));
  const immuneNoun = state.ruleset === 'legacy' ? 'class' : 'suit';

  if (suits.includes('H')) {
    if (blocked('H')) log(state, `${powerLabel(state, 'H')} blocked — the enemy is immune to its own ${immuneNoun}.`);
    else resolveHearts(state, totalValue, hasSpecial(cards, 'REVIVE') ? 2 : 0);
  }
  if (suits.includes('D')) {
    if (blocked('D')) log(state, `${powerLabel(state, 'D')} blocked — the enemy is immune to its own ${immuneNoun}.`);
    else resolveDiamonds(state, totalValue, hasSpecial(cards, 'INSPIRE') ? 2 : 0);
  }
  let clubsMultiplier = 1;
  if (suits.includes('C')) {
    if (blocked('C')) log(state, `${powerLabel(state, 'C')} blocked — the enemy is immune to its own ${immuneNoun}.`);
    else {
      clubsMultiplier = hasSpecial(cards, 'CLEAVE') ? 3 : 2;
      if (clubsMultiplier === 3) log(state, `${powerLabel(state, 'C')}: damage tripled (Cleave).`);
    }
  }
  if (suits.includes('S')) {
    if (blocked('S')) {
      enemy.blockedSpadesShield += totalValue;
      log(state, `${powerLabel(state, 'S')} blocked — the enemy is immune to its own ${immuneNoun} (shield banked for later).`);
    } else if (hasSpecial(cards, 'BULWARK')) {
      enemy.spadesShield = enemy.baseAttack;
      log(state, `${powerLabel(state, 'S')}: the enemy's attack is reduced to 0 (Bulwark).`);
    } else {
      enemy.spadesShield += totalValue;
    }
  }
  return clubsMultiplier;
}

function enemyLabel(enemy: { name?: string; rank: 'J' | 'Q' | 'K'; suit: string }): string {
  return enemy.name ?? `${enemy.rank} of ${enemy.suit}`;
}

const RANK_ORDER: ('J' | 'Q' | 'K')[] = ['J', 'Q', 'K'];
const RANK_NAME: Record<'J' | 'Q' | 'K', string> = { J: 'Jack', Q: 'Queen', K: 'King' };

/**
 * Classic Regicide Endless Mode only: a defeated enemy's card carries its escalation into the player's own deck.
 * Fought during endless loop N, its rank is promoted N steps up the J→Q→K chain (defeat a Jack in loop 1, it comes
 * back a Queen; loop 2, a King). Once a promotion would go past King — there's no rank above it — the excess
 * instead becomes `tier`, so a King defeated in loop 2 comes back a King worth two tiers more than a fresh one,
 * stepping past both the printed ceiling and any King already sitting in the deck from an earlier, lower-tier win.
 */
function upgradeDefeatedRank(rank: 'J' | 'Q' | 'K', loop: number): { rank: 'J' | 'Q' | 'K'; tier: number } {
  if (loop <= 0) return { rank, tier: 0 };
  const idx = RANK_ORDER.indexOf(rank) + loop;
  if (idx < RANK_ORDER.length) return { rank: RANK_ORDER[idx], tier: 0 };
  return { rank: 'K', tier: idx - (RANK_ORDER.length - 1) };
}

/**
 * The current enemy's attack, live — folds in Mission 4's discard-pile buff (see GameState.discardTopBuffsAttack)
 * and/or Mission 8's ascending-zone buff (see GameState.ascendingZone) when active.
 */
function resolvedEnemyAttack(state: GameState): number {
  const enemy = state.currentEnemy!;
  if (state.ruleset !== 'legacy') return currentEnemyAttack(enemy);
  let buff = 0;
  if (state.discardTopBuffsAttack) buff += discardPileTopValue(state.discardPile);
  if (state.ascendingZone) buff += ascendingZoneAttackBuff(state.missionZone);
  return buff !== 0 ? currentEnemyAttackWithDiscardBuff(enemy, buff) : currentEnemyAttack(enemy);
}

/**
 * Shared tail for any non-attacking Legacy action that still lets the enemy strike back (Mission 8's
 * PLACE_IN_ZONE and RESOLVE_ZONE_PURGE) — mirrors resolveCommittedPlay's own tail, but these two actions can
 * never carry a Guardian shield block (that's scoped to the attack it was played alongside).
 */
function finishNonAttackTurn(state: GameState): EngineResult {
  const enemyAttack = resolvedEnemyAttack(state);
  if (enemyAttack <= 0) {
    log(state, `The enemy's attack has been reduced to 0 — no damage suffered.`);
    advanceToNextPlayer(state);
    return ok(state);
  }
  state.pendingDamage = enemyAttack;
  state.turnPhase = 'AWAIT_DEFEND';
  return ok(state);
}

/**
 * Like finishNonAttackTurn, but for the tail of a deferred attack (RESOLVE_CHANT / RESOLVE_AZURE_EMBLEM) that
 * may still be carrying a Guardian shield block from the attack it was played alongside.
 */
function finishDeferredAttackTurn(state: GameState, blockNextAttack: boolean): EngineResult {
  if (blockNextAttack) {
    log(state, 'The shield holds — no damage suffered.');
    advanceToNextPlayer(state);
    return ok(state);
  }
  return finishNonAttackTurn(state);
}

/** Returns true if the enemy was defeated by this hit (win or new enemy revealed either way). */
function dealDamageAndCheckDefeat(state: GameState, damage: number): boolean {
  const enemy = state.currentEnemy!;
  enemy.damageTaken += damage;
  const remaining = enemy.maxHealth - enemy.damageTaken;
  if (remaining > 0) return false;

  if (state.ruleset === 'legacy' && state.exactKillOnly && remaining < 0) {
    // Overkill on an exact-kill-only enemy doesn't defeat it — it recycles to the back of the enemy line,
    // wounds healed, to be fought again later (see GameState.exactKillOnly).
    log(state, `${enemyLabel(enemy)} shrugs off the overkill and slinks to the back of the line, wounds healed!`);
    state.discardPile.push(...enemy.tableCards);
    enemy.damageTaken = 0;
    enemy.spadesShield = 0;
    enemy.blockedSpadesShield = 0;
    enemy.immunityBroken = false;
    enemy.tableCards = [];
    state.castleDeck.push(enemy);
    state.currentEnemy = state.castleDeck.shift()!;
    log(state, `A new enemy is revealed: ${enemyLabel(state.currentEnemy)}.`);
    state.turnPhase = 'AWAIT_PLAY';
    state.pendingDamage = 0;
    checkForStuckLoss(state);
    return true;
  }

  if (state.ruleset === 'legacy') {
    // Legacy enemies always go to the discard pile — no exact-damage/return-to-deck effect (that's mission-specific
    // in the physical game, and doesn't apply cleanly since Legacy enemies don't carry a J/Q/K-style card value).
    log(state, state.exactKillOnly ? `${enemyLabel(enemy)} felled by an exact hit — banished for good!` : `${enemyLabel(enemy)} defeated!`);
    if (state.exactKillToReserveDeck && remaining === 0) {
      // Mission 4: an exact hit seals a card representing the specimen onto the top of the reserve deck instead
      // of letting it fall into the discard pile — its value mirrors the enemy's attack tier (10/15/20).
      const specimenRank = enemy.baseAttack <= 10 ? 'J' : enemy.baseAttack <= 15 ? 'Q' : 'K';
      const specimenCard: Card = {
        id: `specimen-${enemy.suit}-${Date.now()}-${Math.floor(nextRandom(state) * 1e6)}`,
        kind: 'suited',
        suit: enemy.suit,
        rank: specimenRank,
        name: enemy.name ? `${enemy.name}'s Remains` : undefined,
      };
      state.tavernDeck.unshift(specimenCard);
      log(state, `An exact hit seals a specimen card atop the reserve deck.`);
    }
    if (state.endOfTurnZoneFlip && state.missionZone.length > 0) {
      const exact = remaining === 0;
      if (exact) {
        // Exact kill: save the most recently flipped zone card to the discard pile, banish the rest.
        const saved = state.missionZone.pop()!;
        state.discardPile.push(saved);
        state.banishPile.push(...state.missionZone);
        log(state, `An exact hit saves ${saved.kind === 'suited' ? saved.name ?? `the ${saved.rank}` : 'the Jester'} from the mission zone — the rest is banished.`);
      } else {
        state.banishPile.push(...state.missionZone);
        log(state, 'The mission zone is banished.');
      }
      state.missionZone = [];
      state.zoneImmuneSuits = [];
    }
    if (state.zoneVengeanceOnKill) {
      // Mission 6: whatever's left on the enemy's table after this kill doesn't just fall to the discard pile —
      // its lowest-value card is sacrificed permanently into the (never-cleared) mission zone alongside Myla.
      if (enemy.tableCards.length > 0) {
        let lowestIdx = 0;
        for (let i = 1; i < enemy.tableCards.length; i++) {
          if (cardValue(enemy.tableCards[i]) < cardValue(enemy.tableCards[lowestIdx])) lowestIdx = i;
        }
        const [sacrificed] = enemy.tableCards.splice(lowestIdx, 1);
        state.missionZone.push(sacrificed);
        state.zoneImmuneSuits = Array.from(
          new Set(state.missionZone.flatMap((c) => (c.kind === 'suited' ? cardSuits(c) : []))),
        );
        log(state, `${sacrificed.kind === 'suited' ? sacrificed.name ?? `the ${sacrificed.rank}` : 'the Jester'} is drawn permanently into the mission zone.`);
      }
    }
  } else {
    const exact = remaining === 0;
    const upgrade = upgradeDefeatedRank(enemy.rank, state.endlessLoop);
    const upgraded = upgrade.rank !== enemy.rank || upgrade.tier > 0;
    const defeatedCard: Card = {
      id: `enemy-${enemy.suit}${enemy.rank}-${Date.now()}-${Math.floor(nextRandom(state) * 1e6)}`,
      kind: 'suited',
      suit: enemy.suit,
      rank: upgrade.rank,
      ...(upgrade.tier > 0 ? { tier: upgrade.tier } : {}),
    };
    const upgradeNote = upgraded
      ? ` — upgraded to a ${RANK_NAME[upgrade.rank]}${upgrade.tier > 0 ? ` (tier ${upgrade.tier} past King)` : ''} in your deck!`
      : '';
    if (exact) {
      state.tavernDeck.unshift(defeatedCard); // top of tavern deck
      log(state, `${enemyLabel(enemy)} defeated with an exact hit — returns to the top of the Tavern deck${upgradeNote || '!'}`);
    } else {
      state.discardPile.push(defeatedCard);
      log(state, `${enemyLabel(enemy)} defeated${upgradeNote || '!'}`);
    }
  }
  state.discardPile.push(...enemy.tableCards);

  if (state.castleDeck.length === 0) {
    state.phase = 'WON';
    state.currentEnemy = null;
    if (state.ruleset === 'regicide' && state.players.length === 1) {
      state.victoryMedal = state.soloJestersUsed === 0 ? 'gold' : state.soloJestersUsed === 1 ? 'silver' : 'bronze';
    }
    log(state, state.ruleset === 'legacy' ? 'All enemies defeated — the mission is complete!' : 'The last King has fallen — the realm is saved!');
    return true;
  }
  state.currentEnemy = state.castleDeck.shift()!;
  log(state, `A new enemy is revealed: ${enemyLabel(state.currentEnemy)}.`);

  if (state.ruleset === 'legacy' && state.exactKillSplashDamage && remaining === 0) {
    // Mission 5: an exact hit bursts outward, dealing the defeated enemy's own base attack as splash damage
    // straight into whatever's now revealed — reusing this same function lets the splash chain into a further
    // kill (and its own effects) if it's strong enough.
    const splash = enemy.baseAttack;
    log(state, `${enemyLabel(enemy)}'s death throes burst outward — ${splash} splash damage crashes into ${enemyLabel(state.currentEnemy)}!`);
    dealDamageAndCheckDefeat(state, splash);
    return true;
  }

  if (state.ruleset === 'legacy' && state.zoneVengeanceOnKill && state.missionZone.length > 0) {
    // Mission 6: Myla, permanently seated in the mission zone, strikes right after it grows — team damage equal
    // to the live sum of every card resting there (her own base value of 7 included). An exact-damage kill
    // excludes the single highest-value zone card from this one strike's total. Routed through the existing
    // AWAIT_DEFEND/defend() flow, so an uncovered hit ends the mission exactly like any other undefended attack.
    const exact = remaining === 0;
    const values = state.missionZone.map(cardValue);
    let total = values.reduce((a, b) => a + b, 0);
    if (exact) {
      total -= Math.max(...values);
      log(state, `An exact hit spares the mission zone's strongest card from Myla's wrath this time.`);
    }
    if (total > 0) {
      log(state, `Myla lashes out for ${total} damage from the ${state.missionZone.length} card(s) haunting the mission zone!`);
      state.pendingDamage = total;
      state.turnPhase = 'AWAIT_DEFEND';
      return true;
    }
  }

  // Defeating player continues their turn against the new enemy (no defend, no turn advance).
  state.turnPhase = 'AWAIT_PLAY';
  state.pendingDamage = 0;
  // The winning play may have emptied their hand; if yielding is also blocked right now,
  // they have no legal move and the game is lost (mirrors the check after a normal turn ends).
  checkForStuckLoss(state);
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
  state.ruleset = 'regicide';
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
  state.soloJestersUsed = 0;
  state.victoryMedal = null;
  state.jesterClaim = null;
  state.endlessLoop = 0;
  state.exactKillOnly = false;
  state.relics = [];
  state.comboAssist = null;
  state.azureEmblemWindow = null;
  state.endOfTurnZoneFlip = false;
  state.missionZone = [];
  state.zoneImmuneSuits = [];
  state.banishPile = [];
  state.jesterClaimNextPlayerOnly = false;
  state.discardTopBuffsAttack = false;
  state.exactKillToReserveDeck = false;
  state.exactKillSplashDamage = false;
  state.zoneVengeanceOnKill = false;
  state.ascendingZone = false;
  state.zoneClosed = false;
  state.zonePurge = null;
  state.chanterWindow = null;

  log(state, `Game started with ${n} player(s). First enemy: ${state.currentEnemy.rank} of ${state.currentEnemy.suit}.`);
  return ok(state);
}

function startLegacyMission(state: GameState, action: Extract<GameAction, { type: 'START_LEGACY_MISSION' }>): EngineResult {
  if (state.phase !== 'LOBBY') return fail('The game has already started.');
  const n = action.playerIds.length;
  if (n < 1 || n > 4) return fail('Regicide Legacy supports 1-4 players.');
  if (action.playerIds.length !== action.playerNames.length) return fail('Player id/name mismatch.');
  if (!action.standardCastle && action.enemies.length === 0) return fail('A mission needs at least one enemy.');

  const buildRng = makeRng(action.seed);
  const enemyDeck = action.standardCastle ? buildCastleDeck(buildRng) : action.enemies.map(makeLegacyEnemy);
  const reserveDeck = buildLegacyReserveDeck([...action.party, ...(action.extraReserveCards ?? [])], action.jesterCount, buildRng);
  const maxHandSize = MAX_HAND_SIZE_BY_PLAYER_COUNT[n] ?? 5;

  const players: PlayerState[] = action.playerIds.map((id, i) => ({
    id,
    name: action.playerNames[i],
    hand: [],
    connected: true,
  }));

  for (const player of players) {
    for (let i = 0; i < maxHandSize; i++) {
      const card = reserveDeck.shift();
      if (card) player.hand.push(card);
    }
  }

  state.phase = 'IN_PROGRESS';
  state.ruleset = 'legacy';
  state.players = players;
  state.currentPlayerIndex = 0;
  state.turnPhase = 'AWAIT_PLAY';
  state.pendingDamage = 0;
  state.castleDeck = enemyDeck.slice(1);
  state.currentEnemy = enemyDeck[0];
  state.tavernDeck = reserveDeck;
  state.discardPile = [];
  state.maxHandSize = maxHandSize;
  state.lastActionWasYield = players.map(() => false);
  state.log = [];
  state.lossReason = null;
  state.rngState = hashSeed(`${action.seed}:play`);
  state.soloJestersUsed = 0;
  state.victoryMedal = null;
  state.jesterClaim = null;
  state.endlessLoop = 0;
  state.exactKillOnly = action.exactKillOnly ?? false;
  state.relics = action.relics ?? [];
  state.comboAssist = null;
  state.azureEmblemWindow = null;
  state.endOfTurnZoneFlip = action.endOfTurnZoneFlip ?? false;
  state.missionZone = action.presetMissionZone ?? [];
  // Mission 8's ascending zone never grants suit immunity — its cards only buff the enemy's attack while a
  // gap-bridging card sits there (see rules.ts's ascendingZoneAttackBuff) — unlike Missions 3/5/6's zone modes.
  state.zoneImmuneSuits = action.ascendingZone
    ? []
    : Array.from(new Set(state.missionZone.flatMap((c) => (c.kind === 'suited' ? cardSuits(c) : []))));
  state.banishPile = [];
  state.jesterClaimNextPlayerOnly = action.jesterClaimNextPlayerOnly ?? false;
  state.discardTopBuffsAttack = action.discardTopBuffsAttack ?? false;
  state.exactKillToReserveDeck = action.exactKillToReserveDeck ?? false;
  state.exactKillSplashDamage = action.exactKillSplashDamage ?? false;
  state.zoneVengeanceOnKill = action.zoneVengeanceOnKill ?? false;
  state.ascendingZone = action.ascendingZone ?? false;
  state.zoneClosed = false;
  state.zonePurge = null;
  state.chanterWindow = null;

  log(state, `Mission started with ${n} player(s). First enemy: ${enemyLabel(state.currentEnemy)}.`);
  return ok(state);
}

/**
 * Classic Regicide only: continues a WON game into another round instead of ending it. Kings join the Tavern
 * deck as playable cards (worth 20 per rules.cardValue) and the Castle deck is rebuilt scaled up by the loop
 * count, so the fight escalates indefinitely.
 */
function startEndlessRound(state: GameState): EngineResult {
  if (state.phase !== 'WON') return fail('Endless Mode can only be started after winning.');
  if (state.ruleset !== 'regicide') return fail('Endless Mode is only available in classic Regicide.');

  const n = state.players.length;
  const loop = state.endlessLoop + 1;
  const rng = () => nextRandom(state);
  const castleDeck = buildEndlessCastleDeck(loop, rng);
  const tavernDeck = buildEndlessTavernDeck(n, rng);

  for (const player of state.players) {
    player.hand = [];
  }
  for (const player of state.players) {
    for (let i = 0; i < state.maxHandSize; i++) {
      const card = tavernDeck.shift();
      if (card) player.hand.push(card);
    }
  }

  state.phase = 'IN_PROGRESS';
  state.currentPlayerIndex = 0;
  state.turnPhase = 'AWAIT_PLAY';
  state.pendingDamage = 0;
  state.castleDeck = castleDeck.slice(1);
  state.currentEnemy = castleDeck[0];
  state.tavernDeck = tavernDeck;
  state.discardPile = [];
  state.lastActionWasYield = state.players.map(() => false);
  state.lossReason = null;
  state.soloJestersUsed = 0;
  state.victoryMedal = null;
  state.jesterClaim = null;
  state.endlessLoop = loop;

  log(state, `Endless Round ${loop} begins! Kings now walk among the Tavern deck. First enemy: ${enemyLabel(state.currentEnemy)}.`);
  return ok(state);
}

/**
 * Resolves a play already committed to the enemy's table (cards moved out of hand, already in tableCards):
 * class powers, damage, and the resulting AWAIT_DEFEND/turn-advance. Shared by the immediate PLAY_CARDS path
 * and by RESOLVE_COMBO, once an open Kinfolk Flute assist window is locked in.
 */
function resolveCommittedPlay(state: GameState, player: PlayerState, cards: Card[], claimedJester: Card | null): EngineResult {
  const shape = validatePlayShape(cards);
  if ('error' in shape) return fail(shape.error);

  log(
    state,
    `${player.name} plays ${cards.length > 1 ? 'a combo' : 'a card'} for ${shape.totalValue}${claimedJester ? ', combined with the claimed Jester — ignoring immunity' : ''}.`,
  );
  const arcaneBonus = state.ruleset === 'legacy' ? resolveArcaneBolts(state, cards) : 0;
  // Mage, Reaver, and Guardian cards' printed suits don't join the combined suit-power resolution below — a
  // Mage's class power is the arcane bolt above instead (which already resolved), a Reaver's is the
  // reserve-deck tear resolved just below, and a Guardian's is the permanent shield resolved just after that
  // (Mage always goes first, per legacy/classes.ts).
  const nonArcaneCards = cards.filter(
    (c): c is Extract<Card, { kind: 'suited' }> =>
      c.kind === 'suited' && !c.arcane && !c.reaver && !c.guardian && !c.chanter,
  );
  const nonArcaneSuits = Array.from(new Set(nonArcaneCards.flatMap(cardSuits)));

  // Corrupted cards: their class power always ignores immunity, at the cost of banishing the top of the
  // reserve deck the instant they're played (see SuitedCard.corrupted).
  const corruptedCards = nonArcaneCards.filter((c) => c.corrupted);
  const corruptedSuits = Array.from(new Set(corruptedCards.flatMap(cardSuits)));
  for (const c of corruptedCards) {
    const banished = state.tavernDeck.shift();
    if (banished) {
      state.banishPile.push(banished);
      log(state, `${c.name ?? 'A corrupted card'} ignores immunity — the reserve deck's top card is banished as the cost.`);
    }
  }

  // Reavers (Mission 5): playing one tears the top card off the reserve deck, adds its raw value straight onto
  // the attack as flat bonus damage, and permanently banishes it. A Reaver never doubles damage on its own —
  // that bonus still gets folded into a Warrior (Clubs) card's own doubling if one's played alongside it, for
  // a much bigger hit, but Reaver alone doesn't multiply anything.
  const reaverCards = cards.filter((c): c is Extract<Card, { kind: 'suited' }> => c.kind === 'suited' && Boolean(c.reaver));
  let reaverBonus = 0;
  if (state.ruleset === 'legacy' && reaverCards.length > 0) {
    const tearCount = hasSpecial(reaverCards, 'PLUNDER') ? 2 : 1;
    const revealed: Card[] = [];
    for (let i = 0; i < tearCount; i++) {
      const card = state.tavernDeck.shift();
      if (card) revealed.push(card);
    }
    if (revealed.length > 0) {
      reaverBonus = Math.max(...revealed.map(cardValue));
      state.banishPile.push(...revealed);
      const revealedLabel = revealed
        .map((c) => (c.kind === 'suited' ? c.name ?? `a ${c.rank}` : 'a Jester'))
        .join(' and ');
      log(state, `${reaverCards[0].name ?? 'A Reaver'} tears ${revealedLabel} from the reserve deck — banished, +${reaverBonus} damage.`);
    } else {
      log(state, 'The reserve deck is empty — no card to tear for the Reaver bonus.');
    }
  }

  // Guardians (Mission 6): playing one raises an absolute shield that blocks the enemy's very next attack
  // entirely, regardless of the card's own value — spent the instant it's used, not a stacking reduction.
  // Aegis instead holds the shield permanently, zeroing the enemy's attack for the rest of the fight (same
  // final effect as Bulwark, but from a Guardian's suit-less card).
  const guardianCards = cards.filter((c): c is Extract<Card, { kind: 'suited' }> => c.kind === 'suited' && Boolean(c.guardian));
  let guardianBlocksNextAttack = false;
  if (state.ruleset === 'legacy' && guardianCards.length > 0) {
    const enemy = state.currentEnemy!;
    if (hasSpecial(guardianCards, 'AEGIS')) {
      enemy.spadesShield = enemy.baseAttack;
      log(state, `${guardianCards[0].name ?? 'A Guardian'} raises Aegis — the shield holds permanently, the enemy's attack reduced to 0.`);
    } else {
      guardianBlocksNextAttack = true;
      log(state, `${guardianCards[0].name ?? 'A Guardian'} raises an absolute shield, blocking the enemy's next attack entirely.`);
    }
  }

  // Chanters (Mission 8): playing one opens a chant worth its own card value — every player at the table draws
  // that many cards at once, even past their hand limit, then whoever ended up over the limit trims back down
  // one at a time (see beginChant). Encore doubles that card's contribution.
  const chanterCards = cards.filter((c): c is Extract<Card, { kind: 'suited' }> => c.kind === 'suited' && Boolean(c.chanter));
  let chantCount = 0;
  if (state.ruleset === 'legacy' && chanterCards.length > 0) {
    for (const c of chanterCards) {
      const base = cardValue(c);
      const doubled = c.special === 'ENCORE';
      const amount = doubled ? base * 2 : base;
      chantCount += amount;
      log(state, `${c.name ?? 'A Chanter'} leads the chant — every player draws ${amount} card(s) at once${doubled ? ' (Encore)' : ''}.`);
    }
  }

  const clubsMultiplier = resolveSuitPowers(state, cards, nonArcaneSuits, shape.totalValue, Boolean(claimedJester), corruptedSuits);
  const damage = (shape.totalValue + reaverBonus) * clubsMultiplier + arcaneBonus;
  state.lastActionWasYield[state.currentPlayerIndex] = false;

  const defeated = dealDamageAndCheckDefeat(state, damage);

  if (state.phase !== 'IN_PROGRESS') return ok(state);
  if (defeated) return ok(state); // enemy was defeated, same player continues against the next one

  if (chantCount > 0) {
    return beginChant(state, chantCount, guardianBlocksNextAttack);
  }

  // Azure Emblem (Mission 6 relic): whenever a Mage joins the attack, every other player gets one chance to
  // silently stock the reserve deck. Skipped if a Chanter also fired in the same play (see chantCount above) —
  // the two mission-specific windows never need to stack in practice, since each faction's cards are unique.
  if (state.ruleset === 'legacy' && state.relics.includes('AZURE_EMBLEM') && cards.some((c) => c.kind === 'suited' && c.arcane)) {
    return beginAzureEmblem(state, player.id, guardianBlocksNextAttack);
  }

  const enemyAttack = guardianBlocksNextAttack ? 0 : resolvedEnemyAttack(state);
  if (enemyAttack <= 0) {
    log(state, guardianBlocksNextAttack ? 'The shield holds — no damage suffered.' : `The enemy's attack has been reduced to 0 — no damage suffered.`);
    advanceToNextPlayer(state);
    return ok(state);
  }
  state.pendingDamage = enemyAttack;
  state.turnPhase = 'AWAIT_DEFEND';
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

  const claimedJester =
    state.ruleset === 'legacy' && state.jesterClaim?.claimedBy === player.id ? state.jesterClaim.card : null;

  // Remove played cards from hand, move to the enemy's table pile for this fight.
  const idSet = new Set(action.cardIds);
  player.hand = player.hand.filter((c) => !idSet.has(c.id));
  state.currentEnemy!.tableCards.push(...cards);
  if (claimedJester) {
    state.currentEnemy!.tableCards.push(claimedJester);
    state.jesterClaim = null;
  }

  // Kinfolk Flute: with room left in the combo (fewer than 4 cards, total under 10) and no claimed Jester
  // complicating things, open an assist window instead of resolving immediately — any other player may
  // silently add one matching card before the attacker calls RESOLVE_COMBO.
  const canOpenComboAssist =
    state.ruleset === 'legacy' &&
    state.relics.includes('KINFOLK_FLUTE') &&
    !claimedJester &&
    cards.every((c) => c.kind === 'suited') &&
    cards.length < 4 &&
    shape.totalValue < 10;

  if (canOpenComboAssist) {
    state.comboAssist = { attackerId: player.id, cardIds: cards.map((c) => c.id) };
    state.turnPhase = 'AWAIT_COMBO_ASSIST';
    log(state, `${player.name} commits ${cards.length > 1 ? 'a combo' : 'a card'} to the attack — the Kinfolk Flute lets others silently add a matching card before it resolves.`);
    return ok(state);
  }

  return resolveCommittedPlay(state, player, cards, claimedJester);
}

function assistCombo(state: GameState, action: Extract<GameAction, { type: 'ASSIST_COMBO' }>): EngineResult {
  if (state.turnPhase !== 'AWAIT_COMBO_ASSIST' || !state.comboAssist) return fail('No open attack to assist.');
  if (action.playerId === state.comboAssist.attackerId) {
    return fail("You can't assist your own attack — resolve it instead.");
  }
  const assister = state.players.find((p) => p.id === action.playerId);
  if (!assister) return fail('Unknown player.');
  const card = assister.hand.find((c) => c.id === action.cardId);
  if (!card) return fail('Card is not in your hand.');
  if (card.kind !== 'suited') return fail('Only a suited card can be added to a combo.');

  const existing = state.currentEnemy!.tableCards.filter((c) => state.comboAssist!.cardIds.includes(c.id));
  const combined = validatePlayShape([...existing, card]);
  if ('error' in combined) return fail(`That card doesn't fit the combo: ${combined.error}`);

  assister.hand = assister.hand.filter((c) => c.id !== card.id);
  state.currentEnemy!.tableCards.push(card);
  state.comboAssist.cardIds.push(card.id);
  log(state, `${assister.name} silently slips a card into the open attack (Kinfolk Flute).`);
  return ok(state);
}

function resolveComboAssist(state: GameState, action: Extract<GameAction, { type: 'RESOLVE_COMBO' }>): EngineResult {
  if (state.turnPhase !== 'AWAIT_COMBO_ASSIST' || !state.comboAssist) return fail('No open attack to resolve.');
  if (action.playerId !== state.comboAssist.attackerId) return fail('Only the attacking player can resolve this combo.');

  const player = currentPlayer(state);
  const cards = state.currentEnemy!.tableCards.filter((c) => state.comboAssist!.cardIds.includes(c.id));
  state.comboAssist = null;
  state.turnPhase = 'AWAIT_PLAY';
  return resolveCommittedPlay(state, player, cards, null);
}

function yieldTurn(state: GameState, action: Extract<GameAction, { type: 'YIELD' }>): EngineResult {
  const err = requireCurrentPlayerTurn(state, action.playerId, 'AWAIT_PLAY');
  if (err) return fail(err);
  if (allOtherPlayersYieldedLastTurn(state)) {
    return fail('Everyone else just yielded — you must play a card.');
  }

  const player = currentPlayer(state);
  if (state.ruleset === 'legacy' && state.jesterClaim?.claimedBy === player.id) {
    state.discardPile.push(state.jesterClaim.card);
    log(state, `${player.name} yields — the claimed Jester goes to the discard pile, unused.`);
    state.jesterClaim = null;
  }
  log(state, `${player.name} yields.`);
  state.lastActionWasYield[state.currentPlayerIndex] = true;

  const enemyAttack = resolvedEnemyAttack(state);
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

/** Legacy-only: plays the Jester into an open claim window instead of choosing who goes next (see claimJester). */
function playJester(state: GameState, action: Extract<GameAction, { type: 'PLAY_JESTER' }>): EngineResult {
  if (state.ruleset !== 'legacy') return fail('PLAY_JESTER is only available in Regicide Legacy.');
  const err = requireCurrentPlayerTurn(state, action.playerId, 'AWAIT_PLAY');
  if (err) return fail(err);

  const player = currentPlayer(state);
  const card = player.hand.find((c) => c.id === action.cardId);
  if (!card || card.kind !== 'jester') return fail('That is not a Jester in your hand.');

  player.hand = player.hand.filter((c) => c.id !== card.id);
  state.jesterClaim = { card, claimedBy: null };
  state.turnPhase = 'AWAIT_JESTER_CLAIM';
  state.lastActionWasYield[state.currentPlayerIndex] = false;
  log(state, `${player.name} plays the Jester into the open — any player may claim it.`);
  return ok(state);
}

/** Legacy-only: claims an open Jester window. Validated against the window being open, not turn ownership — any player may claim. */
function claimJester(state: GameState, action: Extract<GameAction, { type: 'CLAIM_JESTER' }>): EngineResult {
  if (state.ruleset !== 'legacy') return fail('CLAIM_JESTER is only available in Regicide Legacy.');
  if (state.phase !== 'IN_PROGRESS') return fail('The game is not in progress.');
  if (state.turnPhase !== 'AWAIT_JESTER_CLAIM' || !state.jesterClaim || state.jesterClaim.claimedBy !== null) {
    return fail('There is no open Jester to claim right now.');
  }
  const player = findPlayer(state, action.playerId);
  if (!player) return fail('Unknown player.');

  // Modified Jester rule (Mission 2's hydras only): the oppressive dual immunities restrict the claim to
  // whoever's turn comes next, instead of being open to the whole table.
  if (state.jesterClaimNextPlayerOnly) {
    const nextPlayer = state.players[(state.currentPlayerIndex + 1) % state.players.length];
    if (player.id !== nextPlayer.id) {
      return fail('Only the next player in turn order may claim this Jester.');
    }
  }

  state.jesterClaim.claimedBy = player.id;
  state.currentPlayerIndex = state.players.findIndex((p) => p.id === player.id);
  state.turnPhase = 'AWAIT_PLAY';
  log(state, `${player.name} claims the Jester and takes over the turn.`);
  return ok(state);
}

function useSoloJester(state: GameState, action: Extract<GameAction, { type: 'USE_SOLO_JESTER' }>): EngineResult {
  if (state.ruleset !== 'regicide') {
    return fail('Regicide Legacy solo play uses the Jester claim mechanic instead — see PLAY_JESTER/CLAIM_JESTER.');
  }
  if (state.phase !== 'IN_PROGRESS') return fail('The game is not in progress.');
  const cp = currentPlayer(state);
  if (!cp || cp.id !== action.playerId) return fail('It is not your turn.');
  if (state.players.length !== 1) return fail('The solo Jester is only available in 1-player games.');
  if (state.turnPhase !== 'AWAIT_PLAY' && state.turnPhase !== 'AWAIT_DEFEND') {
    return fail('The solo Jester can only be used before playing a card or before defending.');
  }
  if (state.soloJestersUsed >= MAX_SOLO_JESTERS) return fail('No solo Jesters remaining.');

  const player = cp;
  state.discardPile.push(...player.hand);
  player.hand = [];
  while (player.hand.length < state.maxHandSize && drawOneCard(state, player)) {
    // keep drawing until the hand limit or the Tavern deck runs dry
  }
  state.soloJestersUsed += 1;
  log(state, `${player.name} flips a Jester — hand discarded and refilled to ${player.hand.length}. (${MAX_SOLO_JESTERS - state.soloJestersUsed} left)`);
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
  // Legacy "Feign Death": discarding a full hand always succeeds, but only if you didn't play a card this turn
  // (so your hand wasn't reduced below your limit) — i.e. you yielded straight into this defend.
  const feignDeath =
    state.ruleset === 'legacy' &&
    isEntireHand &&
    cards.length > 0 &&
    player.hand.length === state.maxHandSize &&
    state.lastActionWasYield[state.currentPlayerIndex];

  if (discardTotal < state.pendingDamage && !isEntireHand) {
    return fail(`That only covers ${discardTotal} of ${state.pendingDamage} damage — select more cards or your whole hand.`);
  }

  const idSet = new Set(action.cardIds);
  player.hand = player.hand.filter((c) => !idSet.has(c.id));
  state.discardPile.push(...cards);

  if (discardTotal < state.pendingDamage && !feignDeath) {
    state.phase = 'LOST';
    state.lossReason = `${player.name} could only cover ${discardTotal} of ${state.pendingDamage} damage — the party has fallen.`;
    log(state, state.lossReason);
    return ok(state);
  }

  if (feignDeath && discardTotal < state.pendingDamage) {
    log(state, `${player.name} feigns death — discards their whole hand (${discardTotal}) despite ${state.pendingDamage} damage owed!`);
  } else {
    log(state, `${player.name} discards ${cards.length} card(s) to cover ${state.pendingDamage} damage.`);
  }
  advanceToNextPlayer(state);
  return ok(state);
}

/**
 * Mission 8 only: the ascending mission zone's 10-card purge. The zone's cards already spilled into the
 * discard pile by the caller; this just closes the zone for good and opens the Ultimate Banishment window for
 * `player` to resolve via RESOLVE_ZONE_PURGE.
 */
function beginZonePurge(state: GameState, player: PlayerState): EngineResult {
  state.zoneClosed = true;
  state.zonePurge = { playerId: player.id };
  state.turnPhase = 'AWAIT_ZONE_PURGE';
  log(state, `The chain reaches 10 — the mission zone purges and closes for good! ${player.name} may banish any of the ${state.discardPile.length} spilled card(s) forever.`);
  return ok(state);
}

/** Legacy-only (Mission 8): places a card from hand into the ascending mission zone (see GameState.ascendingZone). */
function placeInZone(state: GameState, action: Extract<GameAction, { type: 'PLACE_IN_ZONE' }>): EngineResult {
  if (!state.ascendingZone) return fail('There is no ascending mission zone in this mission.');
  if (state.zoneClosed) return fail('The mission zone has closed — no more cards can be placed there.');
  const err = requireCurrentPlayerTurn(state, action.playerId, 'AWAIT_PLAY');
  if (err) return fail(err);

  const player = currentPlayer(state);
  const card = player.hand.find((c) => c.id === action.cardId);
  if (!card) return fail('That card is not in your hand.');
  if (card.kind !== 'suited') return fail('Only a suited card can be placed in the mission zone.');

  const top = state.missionZone[state.missionZone.length - 1];
  const required = top ? cardValue(top) + 1 : 1;
  const value = cardValue(card);
  if (value !== required) {
    return fail(`The mission zone needs a card worth exactly ${required} next — that card is worth ${value}.`);
  }

  player.hand = player.hand.filter((c) => c.id !== card.id);
  state.missionZone.push(card);
  state.lastActionWasYield[state.currentPlayerIndex] = false;

  if (card.pilgrim) {
    log(state, `${player.name} guides ${card.name ?? 'a survivor'} into place — the chain now stands at ${required}.`);
  } else {
    log(state, `${player.name} presses ${card.name ?? `a ${card.rank}`} into the gap at ${required} — the enemy grows bolder while it sits there.`);
  }

  if (required === 10) {
    state.discardPile.push(...state.missionZone);
    state.missionZone = [];
    state.zoneImmuneSuits = [];
    return beginZonePurge(state, player);
  }

  return finishNonAttackTurn(state);
}

/** Legacy-only (Mission 8): resolves the open Ultimate Banishment window after the zone's 10-card purge (see GameState.zonePurge). */
function resolveZonePurge(state: GameState, action: Extract<GameAction, { type: 'RESOLVE_ZONE_PURGE' }>): EngineResult {
  if (state.turnPhase !== 'AWAIT_ZONE_PURGE' || !state.zonePurge) return fail('There is no open purge to resolve.');
  if (action.playerId !== state.zonePurge.playerId) return fail('Only the player who triggered the purge may resolve it.');

  const banishIds = new Set(action.banishCardIds);
  const toBanish = state.discardPile.filter((c) => banishIds.has(c.id));
  const remaining = state.discardPile.filter((c) => !banishIds.has(c.id));
  state.banishPile.push(...toBanish);
  const shuffled = shuffleWithState(remaining, state);
  state.tavernDeck.push(...shuffled); // bottom of the reserve deck
  state.discardPile = [];
  state.zonePurge = null;
  state.turnPhase = 'AWAIT_PLAY';
  log(
    state,
    toBanish.length > 0
      ? `${toBanish.length} card(s) banished forever; the remaining ${shuffled.length} shuffle into the bottom of the reserve deck.`
      : `The spilled ${shuffled.length} card(s) shuffle into the bottom of the reserve deck.`,
  );
  return finishNonAttackTurn(state);
}

/**
 * Legacy-only (Mission 8): opens (or immediately clears) a chant — every player at the table draws `count`
 * cards at once, even past their hand limit, then whoever's now over their limit trims back down one player at
 * a time via RESOLVE_CHANT. `blockNextAttack` mirrors a Guardian shield raised in the same play; it's carried
 * through to whenever the chant's tail (the deferred enemy-attack resolution) finally runs.
 */
function beginChant(state: GameState, count: number, blockNextAttack: boolean): EngineResult {
  const totalDrawn = state.players.reduce((sum, p) => sum + forceDrawCards(state, p, count), 0);
  if (totalDrawn > 0) log(state, `The chant draws ${totalDrawn} card(s) across the table.`);

  const pendingPlayerIds = state.players.filter((p) => p.hand.length > state.maxHandSize).map((p) => p.id);
  if (pendingPlayerIds.length === 0) {
    return finishDeferredAttackTurn(state, blockNextAttack);
  }

  state.chanterWindow = { pendingPlayerIds, blockNextAttack };
  state.turnPhase = 'AWAIT_CHANT_TRIM';
  log(state, `${pendingPlayerIds.length} player(s) are over their hand limit and must trim back down.`);
  return ok(state);
}

/** Legacy-only (Mission 8): the front-of-queue player in an open chant window trims their hand back to the limit (see GameState.chanterWindow). */
function resolveChant(state: GameState, action: Extract<GameAction, { type: 'RESOLVE_CHANT' }>): EngineResult {
  if (state.turnPhase !== 'AWAIT_CHANT_TRIM' || !state.chanterWindow) return fail('There is no open chant to resolve.');
  const [trimmerId, ...rest] = state.chanterWindow.pendingPlayerIds;
  if (action.playerId !== trimmerId) return fail("It's not your turn to trim your hand for the chant.");

  const player = findPlayer(state, trimmerId);
  if (!player) return fail('Unknown player.');
  const overflow = player.hand.length - state.maxHandSize;
  const ids = Array.from(new Set(action.discardCardIds));
  if (ids.length !== overflow) {
    return fail(`You need to discard exactly ${overflow} card(s) to reach your hand limit — selected ${ids.length}.`);
  }

  const cards: Card[] = [];
  for (const id of ids) {
    const card = player.hand.find((c) => c.id === id);
    if (!card) return fail(`Card ${id} is not in your hand.`);
    cards.push(card);
  }
  player.hand = player.hand.filter((c) => !ids.includes(c.id));
  state.discardPile.push(...cards);
  log(state, `${player.name} trims ${cards.length} card(s) back down to their hand limit.`);

  const { blockNextAttack } = state.chanterWindow;
  if (rest.length === 0) {
    state.chanterWindow = null;
    state.turnPhase = 'AWAIT_PLAY';
    return finishDeferredAttackTurn(state, blockNextAttack);
  }

  state.chanterWindow = { pendingPlayerIds: rest, blockNextAttack };
  return ok(state);
}

/**
 * Legacy-only (Mission 6), gated by the 'AZURE_EMBLEM' relic: opens (or immediately clears) the Azure Emblem
 * window after a play that included a Mage card — every other player, one at a time, may silently place a
 * single card from hand atop the reserve deck via RESOLVE_AZURE_EMBLEM. `blockNextAttack` mirrors a Guardian
 * shield raised in the same play.
 */
function beginAzureEmblem(state: GameState, attackerId: string, blockNextAttack: boolean): EngineResult {
  const pendingPlayerIds = state.players.filter((p) => p.id !== attackerId).map((p) => p.id);
  if (pendingPlayerIds.length === 0) {
    return finishDeferredAttackTurn(state, blockNextAttack);
  }

  state.azureEmblemWindow = { pendingPlayerIds, blockNextAttack };
  state.turnPhase = 'AWAIT_AZURE_EMBLEM';
  log(state, 'Azure Emblem: any other player may silently place a card atop the reserve deck.');
  return ok(state);
}

/** Legacy-only (Mission 6): the front-of-queue player in an open Azure Emblem window responds (see GameState.azureEmblemWindow). */
function resolveAzureEmblem(state: GameState, action: Extract<GameAction, { type: 'RESOLVE_AZURE_EMBLEM' }>): EngineResult {
  if (state.turnPhase !== 'AWAIT_AZURE_EMBLEM' || !state.azureEmblemWindow) return fail('There is no open Azure Emblem window to resolve.');
  const [nextId, ...rest] = state.azureEmblemWindow.pendingPlayerIds;
  if (action.playerId !== nextId) return fail("It's not your turn to respond to the Azure Emblem.");

  const player = findPlayer(state, nextId);
  if (!player) return fail('Unknown player.');

  if (action.cardId) {
    const card = player.hand.find((c) => c.id === action.cardId);
    if (!card) return fail('That card is not in your hand.');
    player.hand = player.hand.filter((c) => c.id !== card.id);
    state.tavernDeck.unshift(card);
    log(state, `${player.name} silently places a card atop the reserve deck (Azure Emblem).`);
  }

  const { blockNextAttack } = state.azureEmblemWindow;
  if (rest.length === 0) {
    state.azureEmblemWindow = null;
    state.turnPhase = 'AWAIT_PLAY';
    return finishDeferredAttackTurn(state, blockNextAttack);
  }

  state.azureEmblemWindow = { pendingPlayerIds: rest, blockNextAttack };
  return ok(state);
}

export function createLobbyState(): GameState {
  return {
    phase: 'LOBBY',
    ruleset: 'regicide',
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
    soloJestersUsed: 0,
    victoryMedal: null,
    jesterClaim: null,
    endlessLoop: 0,
    exactKillOnly: false,
    relics: [],
    comboAssist: null,
    azureEmblemWindow: null,
    endOfTurnZoneFlip: false,
    missionZone: [],
    zoneImmuneSuits: [],
    banishPile: [],
    jesterClaimNextPlayerOnly: false,
    discardTopBuffsAttack: false,
    exactKillToReserveDeck: false,
    exactKillSplashDamage: false,
    zoneVengeanceOnKill: false,
    ascendingZone: false,
    zoneClosed: false,
    zonePurge: null,
    chanterWindow: null,
  };
}

export function applyAction(state: GameState, action: GameAction): EngineResult {
  const draft = cloneState(state);
  switch (action.type) {
    case 'START_GAME':
      return startGame(draft, action);
    case 'START_LEGACY_MISSION':
      return startLegacyMission(draft, action);
    case 'PLAY_CARDS':
      return playCards(draft, action);
    case 'YIELD':
      return yieldTurn(draft, action);
    case 'ACTIVATE_JESTER':
      return activateJester(draft, action);
    case 'PLAY_JESTER':
      return playJester(draft, action);
    case 'CLAIM_JESTER':
      return claimJester(draft, action);
    case 'ASSIST_COMBO':
      return assistCombo(draft, action);
    case 'RESOLVE_COMBO':
      return resolveComboAssist(draft, action);
    case 'RESOLVE_AZURE_EMBLEM':
      return resolveAzureEmblem(draft, action);
    case 'DEFEND':
      return defend(draft, action);
    case 'PLACE_IN_ZONE':
      return placeInZone(draft, action);
    case 'RESOLVE_ZONE_PURGE':
      return resolveZonePurge(draft, action);
    case 'RESOLVE_CHANT':
      return resolveChant(draft, action);
    case 'USE_SOLO_JESTER':
      return useSoloJester(draft, action);
    case 'START_ENDLESS_ROUND':
      return startEndlessRound(draft);
    default:
      return fail('Unknown action.');
  }
}
