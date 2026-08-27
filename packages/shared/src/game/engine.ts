import type { Card, CapturedPile, EngineResult, GameAction, GameState, PlayerState, SpecialAbilityId, Suit } from './types.js';
import {
  buildBeastDeck,
  buildCapturedPiles,
  buildCastleDeck,
  buildCorruptedPartyEnemies,
  buildEndlessCastleDeck,
  CORRUPTED_PARTY_ENEMY_COUNT,
  buildEndlessTavernDeck,
  buildLegacyReserveDeck,
  buildTavernDeck,
  makeLegacyEnemy,
  makeRng,
  MAX_HAND_SIZE_BY_PLAYER_COUNT,
} from './deck.js';
import {
  ascendingZoneAttackBuff,
  banishPileTopValue,
  cardSuits,
  cardValue,
  currentEnemyAttack,
  currentEnemyAttackWithDiscardBuff,
  discardPileTopValue,
  isCompanionCard,
  isSuitBlockedByImmunity,
  MAX_SOLO_JESTERS,
  missionZoneValueSum,
  pileTopImmuneSuits,
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
  if (p.hand.length !== 0) return;
  // Solo play has no "other players" for allOtherPlayersYieldedLastTurn to ever be true about (it hard-returns
  // false below player count 2, which is also the correct answer for yieldTurn's own unrelated use of the same
  // helper — yielding alone is always legitimate). An empty hand alone isn't fatal there either: a play that
  // spends the last card to defeat an enemy, feign death, or place a card still deserves its shot at whatever
  // that action set up next. What's genuinely terminal is a *forced* yield — the only legal move once the hand
  // is empty — that changes nothing: with no one else at the table, that's the solo equivalent of every other
  // player having already yielded. Without this, a solo game can wedge forever: an empty hand plus a
  // fully-shielded (0-attack) enemy lets YIELD keep advancing the turn indefinitely with no way to ever draw
  // another card (every other action handler resets lastActionWasYield to false on completion — see defend()).
  const stuck = state.players.length <= 1 ? state.lastActionWasYield[state.currentPlayerIndex] : allOtherPlayersYieldedLastTurn(state);
  if (stuck) {
    state.phase = 'LOST';
    state.lossReason = `${p.name} has no cards left and cannot yield — the party has fallen.`;
    log(state, state.lossReason);
  }
}

function advanceToNextPlayer(state: GameState): void {
  // Mission 10: the current enemy's end-of-turn power fires for the turn that's ending, before the
  // current-player pointer moves on to whoever's turn is starting next (see resolveCorruptedEnemyEndOfTurnEffect).
  resolveCorruptedEnemyEndOfTurnEffect(state);
  state.pendingDamage = 0;
  state.turnPhase = 'AWAIT_PLAY';
  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
  flipMissionZoneCard(state);
  rollMissionZoneBonusCard(state);
  flipPilgrimCard(state);
  flipStartOfTurnZoneCard(state);
  flipBeastDeckCard(state);
  flipBanishPileZoneCard(state);
  // Mission 8's placement window only ever covers the turn a kill happened on (or the continued turn right
  // after it) — once play moves on to a fresh turn with no kill behind it, close the window back up.
  state.zoneOpenForPlacement = false;
  checkForStuckLoss(state);
}

/**
 * Mission 9 only: called everywhere a turn would normally end outright (defend succeeds, or the enemy's attack
 * was already 0) — opens the AWAIT_END_OF_TURN banish-to-rescue/decline choice instead of advancing immediately,
 * as long as at least one captured pile still has a face-up card to offer. Never called when a kill lets the
 * same player continue their turn (dealDamageAndCheckDefeat's "continue" path calls neither this nor
 * advanceToNextPlayer directly), which is exactly how the mission's "no end-of-turn effects after a kill" rule
 * falls out for free.
 */
function endTurnOrAwaitRescue(state: GameState): void {
  if (state.ruleset === 'legacy' && state.capturedPilesActive && state.capturedPiles.some((p) => p.faceUp)) {
    state.turnPhase = 'AWAIT_END_OF_TURN';
    return;
  }
  advanceToNextPlayer(state);
}

/**
 * Mission 3 ("Lessons in Flames") only: end of every turn, the top of the reserve deck flips face-up into a
 * shared mission zone, and the enemy becomes immune to that card's class(es) too. Only called from
 * advanceToNextPlayer, so defeating an enemy (which skips straight back to AWAIT_PLAY without advancing)
 * naturally skips this turn's flip, per the mission's rule.
 *
 * SECOND-PASS BALANCE FIX (2026-08-26, unsourced — no compendium/BGG text covers this specific interaction, see
 * legacy/missions.ts's Mission 3 comment for the citations that DO exist): a 12-agent playtest pass found this
 * mission still simulated a ~0% win rate even after the first pass removed the enemies' own baked-in dual
 * immunity — the zone alone was still adding a NEW class of immunity on nearly every non-kill turn, uncapped,
 * across a 6-enemy exactKillOnly gauntlet where landing a precise hit every turn is already hard. With only 4
 * classes to go around, that reliably walls off Hearts and/or Diamonds (the only two hand-refill tools — Diamonds
 * draws, Hearts just recycles the discard pile back into the reserve deck) within 3-4 non-kill turns, and once
 * refill is gone it's gone for the rest of that enemy's fight: nothing in this engine ever grows a hand except a
 * live Diamonds play, so a walled-off hand only ever shrinks from there while full unmitigated attack keeps
 * landing every turn.
 *
 * A second simulation pass (packages/shared/src/legacy/_verify_mission_3.test.ts, deleted after use) measured
 * this directly rather than guessing: capping the zone at letting through one MORE class beyond the enemy's own
 * inherent immunity (i.e. the enemy ever ends up immune to at most 2 classes at once) moved the needle
 * essentially not at all — the party still hits a full Hearts+Diamonds lockout almost as often, because with
 * only 4 classes total, "one more" has better than even odds of completing that exact pair. Only capping the
 * zone at contributing NOTHING beyond the enemy's own inherent immunity (i.e. this flip keeps happening, keeps
 * feeding the mission-zone flavor and the exact-kill-save/banish-on-defeat cleanup below, but stops actually
 * compounding the enemy's immunity further) produced a real, measured improvement: total enemies defeated across
 * 60 seeded 1p/2p/4p games went from 70/360 to 92/360 (+31%), and average turns survived per game went from 12.6
 * to 39.4 (+213%), versus the uncapped version, using the same heuristic (not optimal) bot both times. Every
 * intermediate cap tested (allowing 1 or 2 MORE classes beyond the enemy's own) performed close to the uncapped
 * baseline, not partway to this result — the failure mode is a binary "did this hit complete the Hearts+Diamonds
 * lockout," not a smooth gradient, so a partial cap barely helps. The literal win rate stayed at 0% in both
 * configurations across all 60 games — the same heuristic bot also can't beat plain Mission 1 (classic Regicide,
 * zero Legacy quirks) in 40/40 tries, so it's a real bot-skill ceiling, not evidence against this fix; the
 * turns/kills deltas above are the meaningful signal here, matching this repo's own established caveat for this
 * kind of verification (see the memory note that gave rise to this fix).
 */
function flipMissionZoneCard(state: GameState): void {
  if (!state.endOfTurnZoneFlip || !state.currentEnemy) return;
  const card = state.tavernDeck.shift();
  if (!card) return;
  state.missionZone.push(card);
  if (card.kind === 'suited') {
    const enemy = state.currentEnemy;
    const totalImmuneSuits = new Set([enemy.suit, ...(enemy.secondSuit ? [enemy.secondSuit] : []), ...state.zoneImmuneSuits]);
    const inherentImmunityCount = 1 + (enemy.secondSuit ? 1 : 0);
    const added: string[] = [];
    for (const s of cardSuits(card)) {
      if (totalImmuneSuits.size >= inherentImmunityCount) break;
      if (!state.zoneImmuneSuits.includes(s)) {
        state.zoneImmuneSuits.push(s);
        totalImmuneSuits.add(s);
        added.push(s);
      }
    }
    if (added.length > 0) {
      log(state, `The mission zone flips ${card.name ?? `a ${card.rank}`} — the enemy is now also immune to ${added.map((s) => classForSuit(s as Suit).name).join(' & ')}.`);
    } else {
      log(state, `The mission zone flips ${card.name ?? `a ${card.rank}`} — the fire catches, but the enemy's resistance is already spent.`);
    }
  } else {
    log(state, 'The mission zone flips a Jester.');
  }
}

/**
 * Mission 5 ("High and Mighty") only: a single "rolling" card cycles through its own zone slot every turn,
 * separate from `missionZone` (which here holds only Myla's static presetMissionZone seat — a fixed immunity
 * that never flips or banishes, preserving her narrative presence across Missions 5 and 6). Whatever card
 * currently occupies the rolling slot is banished for good, and a fresh one flips in off the reserve deck to
 * replace it — its value buffs the current enemy's attack for as long as it sits there (see resolvedEnemyAttack).
 * Only called from advanceToNextPlayer, so a kill that lets the same player continue their turn naturally skips
 * a cycle that turn, same as flipMissionZoneCard.
 */
function rollMissionZoneBonusCard(state: GameState): void {
  if (!state.rollingZoneBonus) return;
  if (state.rollingZoneCard) {
    banishCards(state, [state.rollingZoneCard]);
  }
  const card = state.tavernDeck.shift();
  state.rollingZoneCard = card ?? null;
  if (card) {
    const label = card.kind === 'suited' ? card.name ?? `the ${card.rank}` : 'a Jester';
    log(state, `The mission zone cycles ${label} in — last turn's card is banished for good, and the enemy grows bolder while this one sits there.`);
  }
}

/**
 * Mission 7 ("Tales of Rebirth") only: at the start of every turn, the top of the face-down Pilgrim deck flips
 * face-up into the shared Pilgrim zone — a rescue puzzle separate from missionZone's suit-immunity mechanic (see
 * GameState.pilgrimZone). Called both once at mission start (the first player's first turn) and from
 * advanceToNextPlayer; like flipMissionZoneCard, it's naturally skipped when a kill lets the same player
 * continue their turn against a new enemy, since that path doesn't call advanceToNextPlayer.
 */
function flipPilgrimCard(state: GameState): void {
  if (!state.pilgrimMechanic) return;
  const card = state.pilgrimDeck.shift();
  if (!card) return;
  state.pilgrimZone.push(card);
  log(state, `A Pilgrim surfaces in the mission zone: ${card.kind === 'suited' ? card.name ?? `the ${card.rank}` : 'a Jester'}.`);
}

/**
 * Mission 7 only: an attack whose total played value exactly matches a Pilgrim currently sitting in the zone
 * rescues them — permanently banished (out of the burn-penalty math for good), not sent to the discard pile.
 * Uses the play's raw totalValue (the cards' own printed sum), before any class-power multiplier or bonus.
 */
function checkPilgrimRescue(state: GameState, totalValue: number): void {
  if (!state.pilgrimMechanic) return;
  const idx = state.pilgrimZone.findIndex((c) => cardValue(c) === totalValue);
  if (idx === -1) return;
  const [rescued] = state.pilgrimZone.splice(idx, 1);
  banishCards(state, [rescued]);
  log(state, `${rescued.kind === 'suited' ? rescued.name ?? `the ${rescued.rank}` : 'A Jester'} is rescued from the mission zone — banished safely, for good.`);
}

/**
 * Mission 10 ("Pride to Fall") only: at the START of every turn — unlike Mission 3's flipMissionZoneCard, which
 * fires at the end — the top of the reserve deck flips face-up into the shared mission zone. Reuses
 * `missionZone` itself (Mission 10 doesn't use any of the other zone modes), but unlike Mission 3's flip these
 * cards never grant suit immunity — their combined value instead buffs the current enemy's own dealt attack for
 * as long as they sit there (see resolvedEnemyAttack). Called both once at mission start (the first player's
 * first turn) and from advanceToNextPlayer; like every other zone flip, a kill that lets the same player
 * continue their turn naturally skips a flip that turn, since that path never calls advanceToNextPlayer.
 */
function flipStartOfTurnZoneCard(state: GameState): void {
  if (!state.startOfTurnZoneFlip || !state.currentEnemy) return;
  const card = state.tavernDeck.shift();
  if (!card) return;
  state.missionZone.push(card);
  const label = card.kind === 'suited' ? card.name ?? `the ${card.rank}` : 'a Jester';
  log(state, `The mission zone flips ${label} — the corrupted line grows bolder.`);
}

/**
 * Mission 10 only: the current enemy's end-of-turn class power, for the turn that's ending — called from
 * advanceToNextPlayer BEFORE the current-player pointer advances, so "current player" here still means whoever's
 * turn just ended (per the transcript's "current player must move a card from hand"). A Cleric enemy drags the
 * discard pile's top card into the mission zone; a Bard enemy forces that player to move a card from hand into
 * the zone, skipped entirely if their hand is empty — this picks their lowest-value card, since the transcript
 * gives the player no choice in the matter ("must move a card"), a judgment call rather than a transcript detail.
 * Warrior and Paladin enemies have no end-of-turn effect of their own — see resolvedEnemyAttack and
 * applyEnemyPaladinDamageReduction for their always-on powers instead. Naturally skipped on a turn a kill
 * happened on, since dealDamageAndCheckDefeat's same-player-continues path never calls advanceToNextPlayer —
 * exactly the transcript's "defeating an enemy skips end-of-turn effects that turn."
 */
function resolveCorruptedEnemyEndOfTurnEffect(state: GameState): void {
  if (!state.corruptedPartyEnemies || !state.currentEnemy) return;
  const cls = classForSuit(state.currentEnemy.suit).id;
  if (cls === 'CLERIC') {
    const dragged = state.discardPile.pop();
    if (!dragged) return;
    state.missionZone.push(dragged);
    const label = dragged.kind === 'suited' ? dragged.name ?? `the ${dragged.rank}` : 'the Jester';
    log(state, `${enemyLabel(state.currentEnemy)} drags ${label} from the discard pile into the mission zone.`);
  } else if (cls === 'BARD') {
    const player = currentPlayer(state);
    if (player.hand.length === 0) return;
    let lowestIdx = 0;
    for (let i = 1; i < player.hand.length; i++) {
      if (cardValue(player.hand[i]) < cardValue(player.hand[lowestIdx])) lowestIdx = i;
    }
    const [moved] = player.hand.splice(lowestIdx, 1);
    state.missionZone.push(moved);
    const label = moved.kind === 'suited' ? moved.name ?? `the ${moved.rank}` : 'the Jester';
    log(state, `${enemyLabel(state.currentEnemy)} forces ${player.name} to surrender ${label} into the mission zone.`);
  }
}

/**
 * Mission 10 only: an enemy Paladin's extra power — reduces damage it takes by its own base strength (the
 * pre-zone-bonus figure), floored at 0. Distinct from a Paladin's own Spades power (enemy.spadesShield), which
 * instead reduces the ENEMY's own attack output — this is a defensive power on the incoming hit itself, with no
 * analogue anywhere else in the engine.
 */
function applyEnemyPaladinDamageReduction(state: GameState, damage: number): number {
  if (!state.corruptedPartyEnemies || !state.currentEnemy) return damage;
  if (classForSuit(state.currentEnemy.suit).id !== 'PALADIN') return damage;
  return Math.max(0, damage - state.currentEnemy.baseAttack);
}

/**
 * Mission 11 ("Descent into Darkness") only: at the start of every turn, flip the top card of the beast deck
 * (see GameState.beastDeck / deck.ts's buildBeastDeck) for a one-shot effect keyed to its class — Warrior
 * banishes the discard pile's top card, Paladin discards the reserve deck's top card, Cleric has the current
 * player discard from hand, Bard has the current player banish from hand (skipped entirely if their hand is
 * empty). Which card the current player gives up isn't specified by the transcript for Cleric/Bard — same
 * judgment call as Mission 10's enemy-Bard forced move (see resolveCorruptedEnemyEndOfTurnEffect) — so this
 * always picks their lowest-value card. Once the deck runs dry it reshuffles from its own used-card pile
 * (GameState.beastDeckDiscard) and the cycle continues; skipped entirely for the turn right after an exact kill
 * (see GameState.skipNextBeastDeckFlip, consumed here). Called both once at mission start (the first player's
 * first turn) and from advanceToNextPlayer, same as every other start-of-turn flip in this file.
 */
function flipBeastDeckCard(state: GameState): void {
  if (!state.beastDeckMechanic) return;
  if (state.skipNextBeastDeckFlip) {
    state.skipNextBeastDeckFlip = false;
    log(state, 'The beast deck holds still this turn — the exact kill spared it a flip.');
    return;
  }
  if (state.beastDeck.length === 0) {
    if (state.beastDeckDiscard.length === 0) return; // nothing left to flip or reshuffle from
    state.beastDeck = shuffleWithState(state.beastDeckDiscard, state);
    state.beastDeckDiscard = [];
    log(state, 'The beast deck runs dry and reshuffles.');
  }
  const card = state.beastDeck.shift()!;
  state.beastDeckDiscard.push(card);
  if (card.kind !== 'suited') return; // the beast pool is always suited cards — guarded defensively
  const label = card.name ?? `the ${card.rank}`;
  const cls = classForSuit(card.suit).id;

  if (cls === 'WARRIOR') {
    const banished = state.discardPile.pop();
    if (banished) {
      banishCards(state, [banished]);
      log(state, `${label} flips (Warrior) — the top of the discard pile is banished.`);
    } else {
      log(state, `${label} flips (Warrior) — the discard pile is empty, nothing to banish.`);
    }
    return;
  }
  if (cls === 'PALADIN') {
    const discarded = state.tavernDeck.shift();
    if (discarded) {
      state.discardPile.push(discarded);
      log(state, `${label} flips (Paladin) — the top of the reserve deck is discarded.`);
    } else {
      log(state, `${label} flips (Paladin) — the reserve deck is empty, nothing to discard.`);
    }
    return;
  }
  const player = currentPlayer(state);
  if (cls === 'CLERIC') {
    if (player.hand.length === 0) {
      log(state, `${label} flips (Cleric) — ${player.name} has no cards to discard.`);
      return;
    }
    let idx = 0;
    for (let i = 1; i < player.hand.length; i++) {
      if (cardValue(player.hand[i]) < cardValue(player.hand[idx])) idx = i;
    }
    const [discarded] = player.hand.splice(idx, 1);
    state.discardPile.push(discarded);
    log(state, `${label} flips (Cleric) — ${player.name} discards a card from hand.`);
  } else if (cls === 'BARD') {
    if (player.hand.length === 0) {
      log(state, `${label} flips (Bard) — ${player.name} has no cards to banish, skipped.`);
      return;
    }
    let idx = 0;
    for (let i = 1; i < player.hand.length; i++) {
      if (cardValue(player.hand[i]) < cardValue(player.hand[idx])) idx = i;
    }
    const [banished] = player.hand.splice(idx, 1);
    banishCards(state, [banished]);
    log(state, `${label} flips (Bard) — ${player.name} banishes a card from hand.`);
  }
}

/**
 * Mission 12 ("Decay to Growth") only: at the start of every turn, the top card of the BANISH pile (not the
 * reserve deck, unlike every earlier zone-flip mission) moves into the shared mission zone, where it accumulates
 * (never cleared except by the mission's own three-step cleanup on defeat — see dealDamageAndCheckDefeat) —
 * buffing the current enemy's attack by the zone's combined value (see rules.ts's missionZoneValueSum /
 * resolvedEnemyAttack) and granting it immunity to every class sitting there, by reusing the same
 * `zoneImmuneSuits` accumulation Mission 3's flipMissionZoneCard already populates (the immunity check in
 * resolveSuitPowers isn't gated per mission — it just reads whatever's in zoneImmuneSuits). This is a closer
 * cousin to Mission 11's flipBeastDeckCard (a start-of-turn flip with its own skip-on-exact-kill flag) than to
 * Mission 11's OWN pileTopEnemyBonus (which peeks the banish pile's top live, in place, without moving anything) —
 * the mission zone actually removing the card from the banish pile is exactly why this needs its own function
 * rather than reusing pileTopImmuneSuits/banishPileTopValue directly. Called both once at mission start (the first
 * player's first turn) and from advanceToNextPlayer, same as every other start-of-turn flip in this file.
 */
function flipBanishPileZoneCard(state: GameState): void {
  if (!state.restoredCardMechanic || !state.currentEnemy) return;
  if (state.skipNextBanishZoneFlip) {
    state.skipNextBanishZoneFlip = false;
    log(state, 'The mission zone holds still this turn — the exact kill spared it a flip.');
    return;
  }
  const card = state.banishPile.pop(); // top of the banish pile
  if (!card) return;
  state.missionZone.push(card);
  if (card.kind === 'suited') {
    for (const s of cardSuits(card)) {
      if (!state.zoneImmuneSuits.includes(s)) state.zoneImmuneSuits.push(s);
    }
  }
  const label = card.kind === 'suited' ? card.name ?? `the ${card.rank}` : 'a Jester';
  log(state, `The mission zone pulls ${label} from the top of the banish pile — the enemy grows bolder and gains its immunity.`);
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
  toReserveDeck(state, healed, 'bottom'); // "under the tavern deck" = bottom
  state.discardPile = remaining;
  if (healCount > 0) log(state, `${powerLabel(state, 'H')}: ${healCount} card(s) shuffled back under the Tavern deck${bonus > 0 ? ' (Revive)' : ''}.`);
}

/** True if any played card carries the given signature ability (Legacy-only; see types.SpecialAbilityId). */
function hasSpecial(cards: Card[], ability: SpecialAbilityId): boolean {
  return cards.some((c) => c.kind === 'suited' && c.special === ability);
}

/**
 * Legacy-only (Mission 12, "Decay to Growth"): sends `cards` to the banish pile, honoring the restored-card
 * redirect (see SuitedCard.restored) first — a restored card can never land in the banish pile itself; it's sent
 * to the bottom of the reserve deck instead. A no-op wrapper (behaves exactly like `state.banishPile.push(...)`)
 * whenever this mission's mechanic isn't active, so it's safe to use at every banish-pile call site across the
 * whole engine, no matter which mission-specific mechanic (Reaver's tear, a corrupted card's own cost, mission-zone
 * cleanup, etc.) is doing the banishing.
 */
function banishCards(state: GameState, cards: Card[]): void {
  if (cards.length === 0) return;
  if (!state.restoredCardMechanic) {
    state.banishPile.push(...cards);
    return;
  }
  for (const c of cards) {
    if (c.kind === 'suited' && c.restored) state.tavernDeck.push(c); // bottom of the reserve deck
    else state.banishPile.push(c);
  }
}

/**
 * Legacy-only (Mission 12): sends `cards` into the reserve deck at `position`, honoring the corrupted-card
 * redirect (see SuitedCard.corrupted) first — a corrupted card sent to the reserve deck, top OR bottom, instead
 * goes to the bottom of the banish pile. Mirrors banishCards' redirect in the opposite direction, and is likewise
 * a no-op wrapper (behaves exactly like a plain push/unshift onto `state.tavernDeck`) whenever this mission's
 * mechanic isn't active.
 */
function toReserveDeck(state: GameState, cards: Card[], position: 'top' | 'bottom'): void {
  if (cards.length === 0) return;
  if (!state.restoredCardMechanic) {
    if (position === 'top') state.tavernDeck.unshift(...cards);
    else state.tavernDeck.push(...cards);
    return;
  }
  for (const c of cards) {
    if (c.kind === 'suited' && c.corrupted) state.banishPile.unshift(c); // bottom of the banish pile
    else if (position === 'top') state.tavernDeck.unshift(c);
    else state.tavernDeck.push(c);
  }
}

/**
 * Pays a corrupted card's (or, via corruptedReturnQueue, a corrupted enemy's) cost: normally banishes the top of
 * the reserve deck (see SuitedCard.corrupted / EnemyState.corrupted). With Mission 9's 'EVERGREEN_MOTHER' relic
 * in play, the cost changes to another player banishing a card from their own hand instead — in solo play (no
 * "other player" to ask), the same player banishes from their own remaining hand instead (the relic's "solo
 * side"). If there's no eligible hand to banish from (every other hand is empty, or the solo player's own hand
 * is), nothing happens.
 */
function applyCorruptedCost(state: GameState, player: PlayerState, label: string): void {
  if (state.relics.includes('EVERGREEN_MOTHER')) {
    const candidates = state.players.length === 1 ? [player] : state.players.filter((p) => p.id !== player.id);
    const eligible = candidates.filter((p) => p.hand.length > 0);
    if (eligible.length === 0) {
      log(state, `${label} ignores immunity — no hand for the Evergreen Mother to banish from.`);
      return;
    }
    const victim = eligible[Math.floor(nextRandom(state) * eligible.length)];
    const idx = Math.floor(nextRandom(state) * victim.hand.length);
    const [lost] = victim.hand.splice(idx, 1);
    banishCards(state, [lost]);
    log(state, `${label} ignores immunity — the Evergreen Mother banishes a card from ${victim.name}'s hand as the cost.`);
    return;
  }
  const banished = state.tavernDeck.shift();
  if (banished) {
    banishCards(state, [banished]);
    log(state, `${label} ignores immunity — the reserve deck's top card is banished as the cost.`);
  }
}

/**
 * Legacy-only (Mission 12): a restored card's own cost, mirroring applyCorruptedCost in the opposite direction —
 * instead of banishing the reserve deck's top card, it HEALS the banish pile's top card back into the game,
 * returned to the bottom of the reserve deck (routed through toReserveDeck so a healed card that itself happens to
 * be corrupted redirects right back to the bottom of the banish pile instead — see SuitedCard.corrupted). No
 * Evergreen Mother-style relic variant exists for this — the transcript names no alternate cost.
 */
function applyRestoredHeal(state: GameState, label: string): void {
  const healed = state.banishPile.pop(); // top of the banish pile
  if (healed) {
    toReserveDeck(state, [healed], 'bottom');
    const healedLabel = healed.kind === 'suited' ? healed.name ?? `the ${healed.rank}` : 'the Jester';
    log(state, `${label} ignores immunity — heals ${healedLabel} from the banish pile back under the reserve deck.`);
  } else {
    log(state, `${label} ignores immunity — the banish pile is empty, nothing to heal.`);
  }
}

/**
 * Legacy-only, Mission 3+: resolves each played Mage card's arcane bolt — at that card's own value, one after
 * another, and always before the rest of the play's class powers resolve (see resolveSuitPowers). Also fires for
 * a card carrying a bonus Mage sticker (Mission 9's secondClassArcane) — unlike a pure Mage card, that card's own
 * suit power ALSO resolves normally (see resolveCommittedPlay's nonArcaneCards filter). Returns the total bonus
 * damage to add on top of the play's normal totalValue * multiplier.
 */
function resolveArcaneBolts(state: GameState, cards: Card[]): number {
  let bonus = 0;
  for (const c of cards) {
    if (c.kind !== 'suited' || !(c.arcane || c.secondClassArcane)) continue;
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
  // Mission 11: the current enemy is also immune to whatever class(es) sit on top of the discard pile and the
  // banish pile right now — recomputed live rather than stored, since both piles keep changing across the fight
  // (see GameState.pileTopEnemyBonus / rules.ts's pileTopImmuneSuits).
  const pileImmuneSuits = state.pileTopEnemyBonus ? pileTopImmuneSuits(state.discardPile, state.banishPile) : [];
  const blocked = (s: 'H' | 'D' | 'C' | 'S') =>
    !ignoreImmunity &&
    !enemy.immunityBroken &&
    !corruptedSuits.includes(s) &&
    (isSuitBlockedByImmunity(s, enemy) || state.zoneImmuneSuits.includes(s) || pileImmuneSuits.includes(s));
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

const PLAYER_COURT_TIER_FOR_RANK: Record<'J' | 'Q' | 'K', number> = { J: 1, Q: 2, K: 3 };

/**
 * Endless Mode only: a distinct, player-side court tier (see GameState.playerCourtTier) — separate from
 * upgradeDefeatedRank's own defeated-enemy-card promotion. Every J/Q/K enemy defeat ratchets this up
 * (monotonically, never resets on a new round), and it boosts the player's own Jack/Queen cards' value by
 * stamping the same `.tier` field cardValue() already reads. Kings and number/Ace cards are untouched — Kings
 * are already the top rank and use the separate enemy-tier mechanic if any. Sweeps every zone a Jack/Queen card
 * could currently sit in (tavern deck, every hand, discard pile) using Math.max so it only ever upgrades, never
 * clobbers a higher tier a card might already carry (e.g. from upgradeDefeatedRank's chain, though in practice
 * that chain only ever produces K-rank cards past King, so there's no real collision — see engine.ts:634-649).
 */
function applyPlayerCourtTier(state: GameState, tier: number): void {
  if (tier <= state.playerCourtTier) return;
  state.playerCourtTier = tier;
  const bump = (card: Card) => {
    if (card.kind === 'suited' && (card.rank === 'J' || card.rank === 'Q')) {
      card.tier = Math.max(card.tier ?? 0, state.playerCourtTier);
    }
  };
  state.tavernDeck.forEach(bump);
  state.discardPile.forEach(bump);
  for (const player of state.players) player.hand.forEach(bump);
}

/**
 * The current enemy's attack, live — folds in Mission 4's discard-pile buff (see GameState.discardTopBuffsAttack)
 * and/or Mission 8's ascending-zone buff (see GameState.ascendingZone) when active.
 */
/** Exported for the client: the single source of truth for the current enemy's live attack, so the UI never re-derives per-mission buff math and drifts out of sync with it (see redact.ts's liveEnemyAttack). */
export function resolvedEnemyAttack(state: GameState): number {
  const enemy = state.currentEnemy!;
  if (state.ruleset !== 'legacy') return currentEnemyAttack(enemy);
  if (state.corruptedPartyEnemies) {
    // Mission 10: "double total strength (base + mission-zone bonus) BEFORE any Paladin [Spades] reduction is
    // subtracted" — a different formula shape from every other mission's buff (which all fold their buff into
    // baseAttack before spadesShield is subtracted, with no multiplier step in between), so this doesn't reuse
    // currentEnemyAttackWithDiscardBuff.
    const zoneBonus = state.startOfTurnZoneFlip ? state.missionZone.reduce((sum, c) => sum + cardValue(c), 0) : 0;
    const totalStrength = enemy.baseAttack + zoneBonus;
    const isWarrior = classForSuit(enemy.suit).id === 'WARRIOR';
    const multiplied = isWarrior ? totalStrength * 2 : totalStrength;
    return Math.max(0, multiplied - enemy.spadesShield);
  }
  let buff = 0;
  if (state.discardTopBuffsAttack) buff += discardPileTopValue(state.discardPile);
  if (state.ascendingZone) buff += ascendingZoneAttackBuff(state.missionZone);
  if (state.rollingZoneBonus && state.rollingZoneCard) buff += cardValue(state.rollingZoneCard);
  // Mission 11: bonus strength from the discard pile's AND banish pile's top cards combined (see
  // GameState.pileTopEnemyBonus / rules.ts's banishPileTopValue).
  if (state.pileTopEnemyBonus) buff += discardPileTopValue(state.discardPile) + banishPileTopValue(state.banishPile);
  // Mission 12: bonus strength from the mission zone's combined value — cards that flipped in off the top of the
  // banish pile (see GameState.restoredCardMechanic / flipBanishPileZoneCard / rules.ts's missionZoneValueSum),
  // accumulating every turn instead of being recomputed live off an untouched pile.
  if (state.restoredCardMechanic) buff += missionZoneValueSum(state.missionZone);
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
    if (state.endOfTurnZoneFlip && state.missionZone.length > 0) {
      // Mission 3: without this, a run of overkills lets the escalating immunity zone snowball indefinitely across
      // the whole gauntlet (the zone otherwise only ever clears on an exact kill, at the bottom of this function) —
      // stacking with each recycled enemy until immunity walls off most of the party's usable classes before a
      // single kill lands. Clearing it here bounds the worst case to "however many turns spent on the current
      // enemy," same as an exact kill would. No source describes this specific edge case; it's a defensive fix for
      // an interaction the physical single-enemy mission likely never has to handle.
      banishCards(state, state.missionZone);
      state.missionZone = [];
      state.zoneImmuneSuits = [];
      log(state, 'The mission zone is banished as the fight resets.');
    }
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
        banishCards(state, state.missionZone);
        log(state, `An exact hit saves ${saved.kind === 'suited' ? saved.name ?? `the ${saved.rank}` : 'the Jester'} from the mission zone — the rest is banished.`);
      } else {
        banishCards(state, state.missionZone);
        log(state, 'The mission zone is banished.');
      }
      state.missionZone = [];
      state.zoneImmuneSuits = [];
    }
    if (state.corruptedPartyEnemies) {
      // Mission 10: "Mission-zone cards go to the banish pile normally, or to the discard pile instead on an
      // exact kill" — unlike Mission 3's endOfTurnZoneFlip (which saves only the single most-recently-flipped
      // card on an exact kill), the transcript here reads as the WHOLE zone moving to discard together.
      const exact = remaining === 0;
      if (state.missionZone.length > 0) {
        if (exact) {
          state.discardPile.push(...state.missionZone);
          log(state, 'An exact hit saves the whole mission zone — sent to the discard pile instead of banished.');
        } else {
          banishCards(state, state.missionZone);
          log(state, 'The mission zone is banished.');
        }
        state.missionZone = [];
      }
      // Community research's "deck rehabilitation" reward (uncertain — the transcript documents no reward for
      // this mission at all; see legacy/missions.ts's Mission 10 entry): an exact-damage kill cleanses this
      // corrupted hero — its original, untouched party card is tracked here and restored to the campaign roster
      // at mission end (see GameState.restoredPartyCards / party.ts's applyRestoredPartyCards). An overkill
      // leaves the hero lost for good — no restoration, same as any other Legacy enemy's defeat.
      if (exact && enemy.sourceCard) {
        state.restoredPartyCards.push(enemy.sourceCard);
        const heroLabel = enemy.sourceCard.kind === 'suited' ? enemy.sourceCard.name ?? enemyLabel(enemy) : enemyLabel(enemy);
        log(state, `${heroLabel}'s corruption breaks under the exact hit — cleansed, they may return to the party.`);
      }
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
    if (state.pilgrimMechanic) {
      // Mission 7: every kill burns cards off the top of the reserve deck straight into the discard pile, equal
      // to the combined value of every Pilgrim still waiting (unrescued) in the mission zone.
      const burnTotal = state.pilgrimZone.reduce((sum, c) => sum + cardValue(c), 0);
      if (burnTotal > 0) {
        const burned = state.tavernDeck.splice(0, burnTotal);
        if (burned.length > 0) {
          state.discardPile.push(...burned);
          log(state, `The ${state.pilgrimZone.length} Pilgrim(s) still waiting (combined strength ${burnTotal}) burn ${burned.length} card(s) off the reserve deck into the discard pile.`);
        }
      }
    }
    if (state.beastDeckMechanic && remaining === 0) {
      // Mission 11: an exact hit rattles the machine — the beast deck skips its very next flip (see
      // GameState.skipNextBeastDeckFlip / flipBeastDeckCard).
      state.skipNextBeastDeckFlip = true;
      log(state, 'The exact hit rattles the machine — the beast deck skips its next flip.');
    }
    if (state.corruptedReturnQueue && !enemy.corrupted) {
      // Mission 4: this defeat wasn't the last of it — the enemy rejoins the back of the fight queue, wounds
      // healed and immunity intact, but corrupted (see EnemyState.corrupted / resolveCommittedPlay's
      // enemyCorrupted handling). Guarded on `!enemy.corrupted` so a corrupted return, once defeated again,
      // stays gone for good instead of looping forever.
      const requeued = {
        ...enemy,
        damageTaken: 0,
        spadesShield: 0,
        blockedSpadesShield: 0,
        immunityBroken: false,
        tableCards: [],
        corrupted: true,
      };
      state.castleDeck.push(requeued);
      log(state, `${enemyLabel(enemy)} rejoins the fight queue, corrupted!`);
    }
    if (state.restoredCardMechanic) {
      // Mission 12 ("Decay to Growth"): a much bigger cleanup than any earlier mission's zone-only sweep — banish
      // the WHOLE mission zone (no exact-kill exception, unlike Mission 3/10's zone flips saving one card — the
      // transcript names no such carve-out here), THEN the enemy's own table cards (handled just below, by
      // folding this flag into the pileTopEnemyBonus branch's condition), THEN the entire discard pile (handled
      // right after that) — order preserved throughout, feeding fresh material to next turn's banish-pile-top
      // flip (see flipBanishPileZoneCard).
      if (state.missionZone.length > 0) {
        banishCards(state, state.missionZone);
        state.missionZone = [];
        state.zoneImmuneSuits = [];
        log(state, 'The mission zone is banished.');
      }
      if (remaining === 0) {
        // An exact hit rattles the machine — the mission zone skips its very next flip (mirrors Mission 11's
        // skipNextBeastDeckFlip).
        state.skipNextBanishZoneFlip = true;
        log(state, 'The exact hit rattles the machine — the mission zone skips its next flip.');
      }
    }
  } else {
    if (state.endlessLoop > 0) {
      applyPlayerCourtTier(state, PLAYER_COURT_TIER_FOR_RANK[enemy.rank]);
    }
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
  if (state.ruleset === 'legacy' && (state.pileTopEnemyBonus || state.restoredCardMechanic)) {
    // Mission 11: "defeating the enemy always banishes it" — its played cards go to the banish pile instead of
    // the discard pile, directly feeding the very pile-top bonus/immunity mechanic this flag names (see
    // resolvedEnemyAttack / resolveSuitPowers's blocked check). Mission 12 reuses the same rule as step two of its
    // own three-step cleanup (see the restoredCardMechanic block above for step one, and just below for step three).
    banishCards(state, enemy.tableCards);
  } else {
    state.discardPile.push(...enemy.tableCards);
  }
  if (state.ruleset === 'legacy' && state.restoredCardMechanic) {
    // Mission 12's cleanup, step three: banish the ENTIRE discard pile too — order preserved, right after the
    // mission zone and the enemy's own table cards above.
    banishCards(state, state.discardPile);
    state.discardPile = [];
  }

  if (state.castleDeck.length === 0) {
    if (state.ruleset === 'legacy' && state.beastDeckMechanic) {
      const beastRewardPool = [...state.beastDeck, ...state.beastDeckDiscard];
      if (beastRewardPool.length > 0) {
        // Mission 11's reward: the party picks ONE of the beast-deck cards to carry into Mission 12 — modeled as
        // a genuine pending choice (see CHOOSE_BEAST_REWARD / chooseBeastReward) instead of resolving
        // automatically, the closest existing precedent being Mission 9's AWAIT_RESCUE_CHOICE window. The
        // mission doesn't actually complete (phase -> WON) until the party resolves it.
        state.currentEnemy = null;
        state.turnPhase = 'AWAIT_BEAST_REWARD_CHOICE';
        log(state, `All enemies defeated! The party may choose one of the ${beastRewardPool.length} beast card(s) to carry forward.`);
        return true;
      }
    }
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

  if (state.ruleset === 'legacy' && state.capturedPilesActive && remaining === 0 && state.capturedPiles.some((p) => p.faceUp)) {
    // Mission 9: an exact-damage kill's bonus — choose a captured pile's face-up card to send straight to the
    // top of the reserve deck (see chooseExactKillRescue). Blocks further play until resolved.
    state.turnPhase = 'AWAIT_RESCUE_CHOICE';
    log(state, 'An exact hit! Choose a captured pile to rescue straight to the top of the reserve deck.');
    return true;
  }

  // Defeating player continues their turn against the new enemy (no defend, no turn advance).
  state.turnPhase = 'AWAIT_PLAY';
  state.pendingDamage = 0;
  // Mission 8: the kill that just happened opens this turn's ascending-zone placement window (see
  // GameState.zoneOpenForPlacement / placeInZone) — closed again at the next advanceToNextPlayer.
  state.zoneOpenForPlacement = true;
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
  state.playerCourtTier = 0;
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
  state.corruptedReturnQueue = false;
  state.exactKillSplashDamage = false;
  state.rollingZoneBonus = false;
  state.rollingZoneCard = null;
  state.zoneVengeanceOnKill = false;
  state.pilgrimMechanic = false;
  state.pilgrimDeck = [];
  state.pilgrimZone = [];
  state.ascendingZone = false;
  state.zoneOpenForPlacement = false;
  state.zoneClosed = false;
  state.zonePurge = null;
  state.chanterWindow = null;
  state.capturedPilesActive = false;
  state.capturedPiles = [];
  state.corruptedPartyEnemies = false;
  state.startOfTurnZoneFlip = false;
  state.restoredPartyCards = [];
  state.beastDeckMechanic = false;
  state.beastDeck = [];
  state.beastDeckDiscard = [];
  state.skipNextBeastDeckFlip = false;
  state.pileTopEnemyBonus = false;
  state.restoredCardMechanic = false;
  state.skipNextBanishZoneFlip = false;

  log(state, `Game started with ${n} player(s). First enemy: ${state.currentEnemy.rank} of ${state.currentEnemy.suit}.`);
  return ok(state);
}

function startLegacyMission(state: GameState, action: Extract<GameAction, { type: 'START_LEGACY_MISSION' }>): EngineResult {
  if (state.phase !== 'LOBBY') return fail('The game has already started.');
  const n = action.playerIds.length;
  if (n < 1 || n > 4) return fail('Regicide Legacy supports 1-4 players.');
  if (action.playerIds.length !== action.playerNames.length) return fail('Player id/name mismatch.');
  const corruptedPartyEnemies = action.corruptedPartyEnemies ?? false;
  if (!action.standardCastle && !corruptedPartyEnemies && action.enemies.length === 0) {
    return fail('A mission needs at least one enemy.');
  }
  if (corruptedPartyEnemies && action.party.filter((c) => c.kind === 'suited').length < CORRUPTED_PARTY_ENEMY_COUNT) {
    return fail(`Mission 10 needs at least ${CORRUPTED_PARTY_ENEMY_COUNT} eligible party members to corrupt.`);
  }

  const buildRng = makeRng(action.seed);
  // Mission 10: the 8-enemy fight queue isn't a static list — it's built from the party itself (see
  // buildCorruptedPartyEnemies), so this needs to run before the reserve deck does, and its leftover party feeds
  // the reserve deck below instead of the raw action.party (the 8 chosen cards aren't available to draw/play —
  // they're standing on the other side of the table).
  const corruptedEnemyBuild = corruptedPartyEnemies ? buildCorruptedPartyEnemies(action.party, buildRng) : null;
  const enemyDeck = action.standardCastle
    ? buildCastleDeck(buildRng)
    : corruptedEnemyBuild
      ? corruptedEnemyBuild.enemies
      : action.enemies.map(makeLegacyEnemy);
  let partyForReserve = corruptedEnemyBuild ? corruptedEnemyBuild.leftoverParty : action.party;
  // Mission 11: every Beast Companion card (Mission 4's reward pool) is pulled out of the party and shuffled
  // into its own face-down deck sitting in the mission zone for this fight only — none of them are available to
  // draw or play this mission (see deck.ts's buildBeastDeck). Chained after the Mission 10 pull above so the two
  // mechanics could in principle compose, even though no mission currently uses both.
  const beastDeckMechanic = action.beastDeckMechanic ?? false;
  const beastBuild = beastDeckMechanic ? buildBeastDeck(partyForReserve, buildRng) : null;
  if (beastBuild) partyForReserve = beastBuild.leftoverParty;
  const capturedPilesActive = action.capturedPilesActive ?? false;
  // Mission 9: 30 cards are split out of the party into 3 captured piles before anything is dealt — the reserve
  // deck for the mission is built from whatever's left of the party, plus any mission-only extras (e.g. a fresh
  // pool of Pilgrim survivor cards), plus jesters.
  let capturedPiles: CapturedPile[] = [];
  let reserveDeck: Card[];
  if (capturedPilesActive) {
    const split = buildCapturedPiles(partyForReserve, buildRng);
    capturedPiles = split.piles;
    reserveDeck = buildLegacyReserveDeck([...split.leftoverParty, ...(action.extraReserveCards ?? [])], action.jesterCount, buildRng);
  } else {
    reserveDeck = buildLegacyReserveDeck([...partyForReserve, ...(action.extraReserveCards ?? [])], action.jesterCount, buildRng);
  }
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
  state.playerCourtTier = 0;
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
  state.corruptedReturnQueue = action.corruptedReturnQueue ?? false;
  state.exactKillSplashDamage = action.exactKillSplashDamage ?? false;
  state.rollingZoneBonus = action.rollingZoneBonus ?? false;
  state.rollingZoneCard = null;
  state.zoneVengeanceOnKill = action.zoneVengeanceOnKill ?? false;
  state.pilgrimMechanic = action.pilgrimMechanic ?? false;
  // A small, fixed set of named survivors (not shuffled) — they surface in the same narrative order every time,
  // like Mission 5/6's presetMissionZone.
  state.pilgrimDeck = action.pilgrimCards ? [...action.pilgrimCards] : [];
  state.pilgrimZone = [];
  state.ascendingZone = action.ascendingZone ?? false;
  state.zoneOpenForPlacement = false;
  state.zoneClosed = false;
  state.zonePurge = null;
  state.chanterWindow = null;
  state.capturedPilesActive = capturedPilesActive;
  state.capturedPiles = capturedPiles;
  state.corruptedPartyEnemies = corruptedPartyEnemies;
  state.startOfTurnZoneFlip = action.startOfTurnZoneFlip ?? false;
  state.restoredPartyCards = [];
  state.beastDeckMechanic = beastDeckMechanic;
  state.beastDeck = beastBuild ? beastBuild.beastDeck : [];
  state.beastDeckDiscard = [];
  state.skipNextBeastDeckFlip = false;
  state.pileTopEnemyBonus = action.pileTopEnemyBonus ?? false;
  state.restoredCardMechanic = action.restoredCardMechanic ?? false;
  state.skipNextBanishZoneFlip = false;

  log(state, `Mission started with ${n} player(s). First enemy: ${enemyLabel(state.currentEnemy)}.`);
  flipPilgrimCard(state); // the first player's turn is starting right now, so the Mission 7 flip applies here too
  flipStartOfTurnZoneCard(state); // Mission 10: same reasoning — the first turn's start-of-turn flip fires here too
  flipBeastDeckCard(state); // Mission 11: same reasoning — the first turn's beast-deck flip fires here too
  flipBanishPileZoneCard(state); // Mission 12: same reasoning — the first turn's flip fires here too (a no-op, the banish pile starts empty)
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
  if (state.playerCourtTier > 0) {
    // Fresh Jacks/Queens shuffled into this round's deck should reflect whatever court tier the run has already
    // earned (see applyPlayerCourtTier) — only these newly built cards need the sweep; the previous round's
    // hands/discard are about to be discarded/cleared below.
    for (const card of tavernDeck) {
      if (card.kind === 'suited' && (card.rank === 'J' || card.rank === 'Q')) {
        card.tier = Math.max(card.tier ?? 0, state.playerCourtTier);
      }
    }
  }

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
  const shape = validatePlayShape(cards, state.endlessLoop);
  if ('error' in shape) return fail(shape.error);

  log(
    state,
    `${player.name} plays ${cards.length > 1 ? 'a combo' : 'a card'} for ${shape.totalValue}${claimedJester ? ', combined with the claimed Jester — ignoring immunity' : ''}.`,
  );
  if (state.ruleset === 'legacy') checkPilgrimRescue(state, shape.totalValue);
  const arcaneBonus = state.ruleset === 'legacy' ? resolveArcaneBolts(state, cards) : 0;
  // Mage, Reaver, Guardian, Druid, Chanter, and Evergreen cards' printed suits don't join the combined
  // suit-power resolution below — a Mage's (or a secondClassArcane card's bonus) class power is the arcane bolt
  // above instead (which already resolved), a Reaver's is the reserve-deck tear resolved just below, a
  // Guardian's is the permanent shield resolved just after that, a Druid's is the banish-pile salvage resolved
  // after that, a Chanter's is the chant resolved further down, and an Evergreen card's is the all-four-powers
  // resolution forced further down still (Mage always goes first, per legacy/classes.ts). A secondClassArcane
  // card is deliberately NOT excluded here — it keeps its own suit power on top of the arcane bolt it already
  // triggered above (see SuitedCard.secondClassArcane).
  const nonArcaneCards = cards.filter(
    (c): c is Extract<Card, { kind: 'suited' }> =>
      c.kind === 'suited' && !c.arcane && !c.reaver && !c.guardian && !c.druid && !c.chanter && !c.evergreen,
  );
  const nonArcaneSuits = Array.from(new Set(nonArcaneCards.flatMap(cardSuits)));

  // Corrupted cards: their class power always ignores immunity, at the cost of banishing the top of the
  // reserve deck the instant they're played (see SuitedCard.corrupted) — unless the Evergreen Mother relic is
  // in play, in which case the cost becomes another player banishing a card from their own hand instead (see
  // applyCorruptedCost).
  const corruptedCards = nonArcaneCards.filter((c) => c.corrupted);
  const corruptedSuits = Array.from(new Set(corruptedCards.flatMap(cardSuits)));
  for (const c of corruptedCards) {
    applyCorruptedCost(state, player, c.name ?? 'A corrupted card');
  }

  // Restored cards (Mission 12, "Decay to Growth"): the campaign-finale upgrade of a corrupted card — same
  // immunity-ignoring class power, but instead of banishing the reserve deck's top card as the cost, it heals the
  // banish pile's top card back into the game, returned to the bottom of the reserve deck (see applyRestoredHeal).
  const restoredCards = nonArcaneCards.filter((c) => c.restored);
  const restoredSuits = Array.from(new Set(restoredCards.flatMap(cardSuits)));
  for (const c of restoredCards) {
    applyRestoredHeal(state, c.name ?? 'A restored card');
  }

  // Corrupted enemy (Mission 4's corruptedReturnQueue): a defeated enemy that's rejoined the fight queue
  // corrupted follows the same rule as a corrupted card — every play against it ignores its class immunity, at
  // the cost of one applyCorruptedCost payment per play (not per card, since the corruption belongs to the
  // enemy here, not to any of the cards played against it).
  const enemyCorrupted = state.ruleset === 'legacy' && Boolean(state.currentEnemy?.corrupted);
  if (enemyCorrupted) {
    applyCorruptedCost(state, player, state.currentEnemy!.name ?? 'The corrupted enemy');
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
      banishCards(state, revealed);
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

  // Druids (Mission 7): playing one activates Regrowth — salvage cards back out of the banish pile and return
  // them to the bottom of the reserve deck. Wellspring salvages 2 instead of 1. Pulls the most recently banished
  // cards first (end of banishPile), same "reverse of banishment" ordering used nowhere else yet but the
  // simplest deterministic choice here.
  const druidCards = cards.filter((c): c is Extract<Card, { kind: 'suited' }> => c.kind === 'suited' && Boolean(c.druid));
  if (state.ruleset === 'legacy' && druidCards.length > 0) {
    const salvageCount = hasSpecial(druidCards, 'WELLSPRING') ? 2 : 1;
    const salvaged: Card[] = [];
    for (let i = 0; i < salvageCount; i++) {
      const card = state.banishPile.pop();
      if (card) salvaged.push(card);
    }
    if (salvaged.length > 0) {
      toReserveDeck(state, salvaged, 'bottom');
      const salvagedLabel = salvaged
        .map((c) => (c.kind === 'suited' ? c.name ?? `a ${c.rank}` : 'a Jester'))
        .join(' and ');
      log(state, `${druidCards[0].name ?? 'A Druid'} channels Regrowth — ${salvagedLabel} returns from the banish pile to the bottom of the reserve deck.`);
    } else {
      log(state, 'The banish pile is empty — nothing for Regrowth to salvage.');
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

  // Gøran's Evergreen (Mission 9): playing his card resolves all four base class powers at once — heal, draw,
  // double damage, reduce enemy strength — and always ignores enemy immunity, regardless of which suits are
  // actually in the play or what the enemy is immune to.
  const evergreenActive = state.ruleset === 'legacy' && cards.some((c) => c.kind === 'suited' && c.evergreen);
  if (evergreenActive) {
    log(state, `${(cards.find((c) => c.kind === 'suited' && c.evergreen) as Extract<Card, { kind: 'suited' }> | undefined)?.name ?? 'Evergreen'} surges — all four powers resolve at once, ignoring immunity.`);
  }
  const effectiveSuits: Suit[] = evergreenActive ? Array.from(new Set([...nonArcaneSuits, 'H', 'D', 'C', 'S'])) : nonArcaneSuits;
  const ignoreImmunityForPlay = Boolean(claimedJester) || evergreenActive || enemyCorrupted;

  // Both corrupted and restored cards ignore immunity, per-suit only (not the whole play) — see
  // SuitedCard.corrupted / SuitedCard.restored.
  const immunityIgnoringSuits = Array.from(new Set([...corruptedSuits, ...restoredSuits]));
  const clubsMultiplier = resolveSuitPowers(state, cards, effectiveSuits, shape.totalValue, ignoreImmunityForPlay, immunityIgnoringSuits);
  const rawDamage = (shape.totalValue + reaverBonus) * clubsMultiplier + arcaneBonus;
  // Mission 10: an enemy Paladin's extra power reduces the damage it takes by its own base strength (see
  // applyEnemyPaladinDamageReduction) — a no-op for every other mission/enemy.
  const damage = applyEnemyPaladinDamageReduction(state, rawDamage);
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
    endTurnOrAwaitRescue(state);
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

  const shape = validatePlayShape(cards, state.endlessLoop);
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

  // Kinfolk Flute (Mission 1): with room left in the combo (fewer than 4 cards, total under 10) and no claimed
  // Jester complicating things, open an assist window instead of resolving immediately — any other player may
  // silently add one matching card before the attacker calls RESOLVE_COMBO.
  const kinfolkAssist =
    state.relics.includes('KINFOLK_FLUTE') &&
    cards.every((c) => c.kind === 'suited') &&
    cards.length < 4 &&
    shape.totalValue < 10;

  // Scarlet Whistle (Mission 4): the same silent-assist window, opened instead whenever a lone Animal or Beast
  // Companion is played alone — any other player may silently add one card from hand to help the attack, which
  // then resolves as a normal companion pairing (see rules.ts's validatePlayShape / RESOLVE_COMBO reusing the
  // same resolveCommittedPlay path Kinfolk Flute's window already uses).
  const scarletAssist =
    state.relics.includes('SCARLET_WHISTLE') &&
    cards.length === 1 &&
    cards[0].kind === 'suited' &&
    isCompanionCard(cards[0]);

  // Solo play has no one else to slip in a card, so the assist window would just force a pointless manual
  // "resolve" click every attack — skip it and resolve immediately instead.
  const canOpenComboAssist =
    state.ruleset === 'legacy' && !claimedJester && state.players.length > 1 && (kinfolkAssist || scarletAssist);

  if (canOpenComboAssist) {
    state.comboAssist = { attackerId: player.id, cardIds: cards.map((c) => c.id) };
    state.turnPhase = 'AWAIT_COMBO_ASSIST';
    log(
      state,
      kinfolkAssist
        ? `${player.name} commits ${cards.length > 1 ? 'a combo' : 'a card'} to the attack — the Kinfolk Flute lets others silently add a matching card before it resolves.`
        : `${player.name} attacks alone with a Companion card — the Scarlet Whistle lets another player silently add a card before it resolves.`,
    );
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
  const combined = validatePlayShape([...existing, card], state.endlessLoop);
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
    endTurnOrAwaitRescue(state);
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
    // Feigning death is a deliberate rescue, not a no-op — it earns a fresh chance rather than reading as an
    // extension of the yield that opened this defend window (see checkForStuckLoss's solo-play condition, which
    // would otherwise treat "hand now empty" plus "last action was a yield" as an immediate, undeserved loss).
    // A normal defend leaves the flag alone on purpose: completing the SAME yield-opened turn without feigning
    // death shouldn't erase that the turn started as a yield (see the "cannot yield if everyone else just
    // yielded" rule, which reads this same flag on the *other* player(s) after their yield-then-defend turn).
    state.lastActionWasYield[state.currentPlayerIndex] = false;
  } else {
    log(state, `${player.name} discards ${cards.length} card(s) to cover ${state.pendingDamage} damage.`);
  }
  endTurnOrAwaitRescue(state);
  return ok(state);
}

/** Mission 9, from AWAIT_END_OF_TURN: banishes a hand card to rescue one captured pile's face-up card into the discard pile, then flips that pile's next card and advances the turn. */
function banishForRescue(state: GameState, action: Extract<GameAction, { type: 'BANISH_FOR_RESCUE' }>): EngineResult {
  const err = requireCurrentPlayerTurn(state, action.playerId, 'AWAIT_END_OF_TURN');
  if (err) return fail(err);

  const player = currentPlayer(state);
  const card = player.hand.find((c) => c.id === action.cardId);
  if (!card) return fail(`Card ${action.cardId} is not in your hand.`);
  const pile = state.capturedPiles[action.pileIndex];
  if (!pile || !pile.faceUp) return fail('That captured pile has no face-up card to rescue.');

  player.hand = player.hand.filter((c) => c.id !== card.id);
  banishCards(state, [card]);
  state.discardPile.push(pile.faceUp);
  log(
    state,
    `${player.name} banishes ${card.kind === 'suited' ? card.name ?? `the ${card.rank}` : 'the Jester'} to rescue ${pile.faceUp.kind === 'suited' ? pile.faceUp.name ?? `the ${pile.faceUp.rank}` : 'the Jester'} from the captured pile.`,
  );
  pile.faceUp = pile.faceDown.shift() ?? null;
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
  // Building the run only opens up right after an enemy kill (see GameState.zoneOpenForPlacement).
  if (!state.zoneOpenForPlacement) return fail('The mission zone can only be built onto right after defeating an enemy.');
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
  banishCards(state, toBanish);
  const shuffled = shuffleWithState(remaining, state);
  toReserveDeck(state, shuffled, 'bottom'); // bottom of the reserve deck
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
    toReserveDeck(state, [card], 'top');
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

/** Mission 9, from AWAIT_END_OF_TURN: declines to banish — every captured pile's face-up card cycles face-down to the bottom of its own pile and the next card flips up, then the turn advances. */
function declineRescue(state: GameState, action: Extract<GameAction, { type: 'DECLINE_RESCUE' }>): EngineResult {
  const err = requireCurrentPlayerTurn(state, action.playerId, 'AWAIT_END_OF_TURN');
  if (err) return fail(err);

  for (const pile of state.capturedPiles) {
    if (!pile.faceUp) continue;
    pile.faceDown.push(pile.faceUp);
    pile.faceUp = pile.faceDown.shift() ?? null;
  }
  log(state, `${currentPlayer(state).name} declines to rescue — each captured pile cycles to its next card.`);
  advanceToNextPlayer(state);
  return ok(state);
}

/** Mission 9, from AWAIT_RESCUE_CHOICE: an exact kill's bonus — sends one captured pile's face-up card straight to the top of the reserve deck, then resumes the same player's turn. */
function chooseExactKillRescue(state: GameState, action: Extract<GameAction, { type: 'CHOOSE_EXACT_KILL_RESCUE' }>): EngineResult {
  const err = requireCurrentPlayerTurn(state, action.playerId, 'AWAIT_RESCUE_CHOICE');
  if (err) return fail(err);

  const pile = state.capturedPiles[action.pileIndex];
  if (!pile || !pile.faceUp) return fail('That captured pile has no face-up card to rescue.');

  const rescued = pile.faceUp;
  toReserveDeck(state, [rescued], 'top');
  pile.faceUp = pile.faceDown.shift() ?? null;
  log(state, `${rescued.kind === 'suited' ? rescued.name ?? `the ${rescued.rank}` : 'The Jester'} is rescued straight to the top of the reserve deck!`);
  state.turnPhase = 'AWAIT_PLAY';
  state.pendingDamage = 0;
  checkForStuckLoss(state);
  return ok(state);
}

/**
 * Mission 11 only: resolves the AWAIT_BEAST_REWARD_CHOICE window opened once the mission's last enemy falls (see
 * dealDamageAndCheckDefeat). Validated against the window being open, not turn ownership — any player may make
 * the pick for the party, same as CLAIM_JESTER. The chosen card is fed into GameState.restoredPartyCards, reusing
 * the same mission-end fold Mission 10's "deck rehabilitation" reward already uses (see party.ts's
 * applyBeastCardChoice / RoomManager's completeLegacyMission) — the mission only actually completes (phase ->
 * WON) once this resolves.
 */
function chooseBeastReward(state: GameState, action: Extract<GameAction, { type: 'CHOOSE_BEAST_REWARD' }>): EngineResult {
  if (state.phase !== 'IN_PROGRESS' || state.turnPhase !== 'AWAIT_BEAST_REWARD_CHOICE') {
    return fail('There is no open beast-card reward to choose right now.');
  }
  const player = findPlayer(state, action.playerId);
  if (!player) return fail('Unknown player.');
  const pool = [...state.beastDeck, ...state.beastDeckDiscard];
  const chosen = pool.find((c) => c.id === action.cardId);
  if (!chosen) return fail('That card is not part of the beast-card reward pool.');

  state.restoredPartyCards.push(chosen);
  state.beastDeck = [];
  state.beastDeckDiscard = [];
  log(state, `${player.name} chooses ${chosen.kind === 'suited' ? chosen.name ?? `the ${chosen.rank}` : 'a Jester'} to carry into the next mission.`);

  state.phase = 'WON';
  state.currentEnemy = null;
  log(state, 'All enemies defeated — the mission is complete!');
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
    playerCourtTier: 0,
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
    corruptedReturnQueue: false,
    exactKillSplashDamage: false,
    rollingZoneBonus: false,
    rollingZoneCard: null,
    zoneVengeanceOnKill: false,
    pilgrimMechanic: false,
    pilgrimDeck: [],
    pilgrimZone: [],
    ascendingZone: false,
    zoneOpenForPlacement: false,
    zoneClosed: false,
    zonePurge: null,
    chanterWindow: null,
    capturedPilesActive: false,
    capturedPiles: [],
    corruptedPartyEnemies: false,
    startOfTurnZoneFlip: false,
    restoredPartyCards: [],
    beastDeckMechanic: false,
    beastDeck: [],
    beastDeckDiscard: [],
    skipNextBeastDeckFlip: false,
    pileTopEnemyBonus: false,
    restoredCardMechanic: false,
    skipNextBanishZoneFlip: false,
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
    case 'BANISH_FOR_RESCUE':
      return banishForRescue(draft, action);
    case 'DECLINE_RESCUE':
      return declineRescue(draft, action);
    case 'CHOOSE_EXACT_KILL_RESCUE':
      return chooseExactKillRescue(draft, action);
    case 'CHOOSE_BEAST_REWARD':
      return chooseBeastReward(draft, action);
    case 'START_ENDLESS_ROUND':
      return startEndlessRound(draft);
    default:
      return fail('Unknown action.');
  }
}
