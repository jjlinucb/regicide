import type { Card, CapturedPile, ChanterResolution, EnemyState, EngineResult, GameAction, GameState, PlayerState, SpecialAbilityId, Suit, SuitedCard, TurnPhase } from './types.js';
import {
  buildBeastDeck,
  buildCapturedPiles,
  buildCastleDeck,
  buildCorruptedPartyEnemies,
  buildEndlessCastleDeck,
  CORRUPTED_PARTY_ENEMY_COUNT,
  buildLegacyReserveDeck,
  buildTavernDeck,
  JESTERS_BY_PLAYER_COUNT,
  makeJesters,
  makeLegacyEnemy,
  makeRng,
  MAX_HAND_SIZE_BY_PLAYER_COUNT,
  shuffle,
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
  matchesAscendingZoneSlot,
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

/**
 * `idleYield` is true only when the turn now ending was a yield that resolved with zero enemy attack — the one
 * genuinely-idle path (see yieldTurn), as opposed to every other way a turn can end (a successful defend, a
 * kill, a rescue, a zone placement, feign death, ...), all of which represent real progress even when they
 * happen to leave the hand empty too. Callers that aren't yieldTurn's own zero-attack branch always omit this
 * (defaulting to false) — see every other call site of advanceToNextPlayer/endTurnOrAwaitRescue/finishAdvanceToNextPlayer.
 */
function checkForStuckLoss(state: GameState, idleYield = false): void {
  if (state.phase !== 'IN_PROGRESS') return;
  const p = currentPlayer(state);
  if (p.hand.length !== 0) return;
  // Solo play has no "other players" for allOtherPlayersYieldedLastTurn to ever be true about (it hard-returns
  // false below player count 2, which is also the correct answer for yieldTurn's own unrelated use of the same
  // helper — yielding alone is always legitimate). An empty hand alone isn't fatal there either: a play that
  // spends the last card to defeat an enemy, feign death, successfully defend, or place a card still deserves its
  // shot at whatever that action set up next — `idleYield` is what tells those genuinely-productive cases apart
  // from a truly wasted turn (lastActionWasYield can't be reused here: it deliberately stays true through a
  // successful non-feign-death defend, for the "cannot yield if everyone else just yielded" rule's own unrelated
  // bookkeeping — see defend()'s comment). What's genuinely terminal is a *forced*, zero-effect yield — the only
  // legal move once the hand is empty — that changes nothing: with no one else at the table, that's the solo
  // equivalent of every other player having already yielded. Without this, a solo game can wedge forever: an
  // empty hand plus a fully-shielded (0-attack) enemy lets YIELD keep advancing the turn indefinitely with no way
  // to ever draw another card.
  const stuck = state.players.length <= 1 ? idleYield : allOtherPlayersYieldedLastTurn(state);
  if (stuck) {
    state.phase = 'LOST';
    state.lossReason = `${p.name} has no cards left and cannot yield — the party has fallen.`;
    log(state, state.lossReason);
  }
}

function advanceToNextPlayer(state: GameState, idleYield = false): void {
  // Mission 10: the current enemy's end-of-turn power fires for the turn that's ending, before the
  // current-player pointer moves on to whoever's turn is starting next (see resolveCorruptedEnemyEndOfTurnEffect).
  // An enemy Bard's power opens a real player choice (AWAIT_BARD_SURRENDER) rather than resolving immediately —
  // when that happens, pause here without advancing anything further; finishAdvanceToNextPlayer picks the rest of
  // this back up once SURRENDER_CARD_TO_ZONE resolves it (see surrenderCardToZone). That resumption is always a
  // genuine player action, never idle, so it's fine that idleYield doesn't carry across the pause.
  resolveCorruptedEnemyEndOfTurnEffect(state);
  if (state.turnPhase === 'AWAIT_BARD_SURRENDER') return;
  finishAdvanceToNextPlayer(state, idleYield);
}

/**
 * The actual turn-advancement work — split out of advanceToNextPlayer so a Mission 10 Bard-surrender choice can
 * pause partway through and resume later (see surrenderCardToZone) instead of forcing that choice to resolve
 * synchronously inside a single engine call, the same way Mission 9's AWAIT_END_OF_TURN pauses endTurnOrAwaitRescue.
 */
function finishAdvanceToNextPlayer(state: GameState, idleYield = false): void {
  state.pendingDamage = 0;
  state.turnPhase = 'AWAIT_PLAY';
  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
  state.kinfolkBankedThisTurn = false;
  flipMissionZoneCard(state);
  rollMissionZoneBonusCard(state);
  flipStartOfTurnZoneCard(state);
  flipBeastDeckCard(state);
  flipBanishPileZoneCard(state);
  // Mission 8's placement window only ever covers the turn a kill happened on (or the continued turn right
  // after it) — once play moves on to a fresh turn with no kill behind it, close the window back up.
  state.zoneOpenForPlacement = false;
  if (state.zoneCommittedPlay.length > 0) {
    // Whatever's left unclaimed from the window's kill(s), once the window closes for good, falls to the
    // discard pile the same way an ordinary kill's played cards always do (see finishEnemyDefeatTail).
    pushToDiscardPile(state, state.zoneCommittedPlay);
    state.zoneCommittedPlay = [];
  }
  checkForStuckLoss(state, idleYield);
}

/**
 * Mission 9 only: called everywhere a turn would normally end outright (defend succeeds, or the enemy's attack
 * was already 0) — opens the AWAIT_END_OF_TURN banish-to-rescue/decline choice instead of advancing immediately,
 * as long as at least one captured pile still has a face-up card to offer. Never called when a kill lets the
 * same player continue their turn (dealDamageAndCheckDefeat's "continue" path calls neither this nor
 * advanceToNextPlayer directly), which is exactly how the mission's "no end-of-turn effects after a kill" rule
 * falls out for free. `idleYield` — see checkForStuckLoss — only ever arrives true from yieldTurn's own
 * zero-attack branch; every other caller omits it.
 */
function endTurnOrAwaitRescue(state: GameState, idleYield = false): void {
  if (state.ruleset === 'legacy' && state.capturedPilesActive && state.capturedPiles.some((p) => p.faceUp)) {
    state.turnPhase = 'AWAIT_END_OF_TURN';
    return;
  }
  advanceToNextPlayer(state, idleYield);
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
  if (card.kind !== 'suited') {
    log(state, 'The mission zone flips a Jester.');
    return;
  }
  // A Mercenary "19" (see SuitedCard.noSuitPower) carries an inert placeholder suit and must never grant zone
  // immunity, same as every other suit-immunity-bookkeeping site it's excluded from — it still flips normally,
  // it just never adds to zoneImmuneSuits.
  if (card.noSuitPower) {
    log(state, `The mission zone flips ${card.name ?? `a ${card.rank}`} — it carries no class of its own, so nothing changes.`);
    return;
  }
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
}

/**
 * Mission 5 ("High and Mighty") only: every turn, the top card of the BANISH pile (not the reserve deck) recycles
 * into `rollingZoneCards`, where it accumulates alongside whatever's already sitting there — nothing is banished
 * or replaced here, unlike every other zone-flip in this file. The accumulator keeps growing until the next enemy
 * kill resets it (see dealDamageAndCheckDefeat), so its rate of growth is naturally bounded by how often the
 * banish pile actually receives fresh cards, not guaranteed every turn — sourced research's "accumulates ALL
 * cards recycled from the banish pile since the last kill and sums their total value," correcting the earlier
 * shipped "one fresh card per turn off the reserve deck, single-slot" reading. `missionZone` itself is untouched
 * by this mission (Myla is an ordinary reserve-deck card, not a zone fixture — see missions.ts's Mission 5 entry).
 * Only called from advanceToNextPlayer, so a kill that lets the same player continue their turn naturally skips
 * a cycle that turn, same as flipMissionZoneCard.
 */
function rollMissionZoneBonusCard(state: GameState): void {
  if (!state.rollingZoneBonus) return;
  const card = state.banishPile.pop(); // top of the banish pile
  if (!card) return;
  state.rollingZoneCards.push(card);
  const label = card.kind === 'suited' ? card.name ?? `the ${card.rank}` : 'a Jester';
  log(state, `${label} recycles out of the banish pile into the rolling zone — the enemy grows bolder while it (and everything else piled up there) sits.`);
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
 * discard pile's top card into the mission zone — no player choice involved, so it resolves immediately.
 *
 * A Bard enemy forces that same player to move a card from hand into the zone instead, skipped entirely if their
 * hand is empty. Sourced correction (regicidelegacy.com's compendium, corroborated by BGG threads and a working
 * fan digital reimplementation's own UI — see the legacy-missions-transcript-mismatches memory doc's Mission 10
 * section): this used to auto-pick the player's lowest-value card, on the theory that the transcript's "must move
 * a card" left the player no say in the matter — but the sourced material says which card is a real player
 * choice. This now opens AWAIT_BARD_SURRENDER and returns without touching the hand; advanceToNextPlayer sees
 * that phase and pauses mid-advance (see finishAdvanceToNextPlayer) until SURRENDER_CARD_TO_ZONE resolves it.
 *
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
    state.turnPhase = 'AWAIT_BARD_SURRENDER';
    log(state, `${enemyLabel(state.currentEnemy)} demands ${player.name} surrender a card from hand into the mission zone.`);
  }
}

/**
 * Mission 10, from AWAIT_BARD_SURRENDER: the ending player's chosen answer to an enemy Bard's forced move (see
 * resolveCorruptedEnemyEndOfTurnEffect) — moves `cardId` out of their hand into the mission zone, then resumes
 * the turn-advancement that paused to open this choice (see finishAdvanceToNextPlayer). Validated against the
 * same player whose turn is ending, not whoever's about to go next — requireCurrentPlayerTurn still reads
 * currentPlayerIndex, which this phase deliberately leaves unmoved until it resolves.
 */
function surrenderCardToZone(state: GameState, action: Extract<GameAction, { type: 'SURRENDER_CARD_TO_ZONE' }>): EngineResult {
  const err = requireCurrentPlayerTurn(state, action.playerId, 'AWAIT_BARD_SURRENDER');
  if (err) return fail(err);

  const player = currentPlayer(state);
  const card = player.hand.find((c) => c.id === action.cardId);
  if (!card) return fail(`Card ${action.cardId} is not in your hand.`);

  player.hand = player.hand.filter((c) => c.id !== card.id);
  state.missionZone.push(card);
  const label = card.kind === 'suited' ? card.name ?? `the ${card.rank}` : 'the Jester';
  log(state, `${player.name} surrenders ${label} into the mission zone.`);
  finishAdvanceToNextPlayer(state);
  return ok(state);
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
 * (see GameState.beastDeck / deck.ts's buildBeastDeck) for a one-shot effect keyed to its SUIT (sourced
 * correction — the previously-shipped version keyed this off the card's derived CLASS via classForSuit instead;
 * the two happen to coincide for every Beast Companion card that currently exists, since each one's `class` and
 * `suit` are always the matching pair, but the sourced rule is explicit that this reads the printed suit
 * directly) — Clubs (Warrior) banishes the discard pile's top card, Spades (Paladin) discards the reserve deck's
 * top card, Hearts (Cleric) has the current player discard from hand, Diamonds (Bard) has the current player
 * banish from hand (skipped entirely if their hand is empty). Which card the current player gives up isn't
 * specified by the transcript for Hearts/Diamonds — same judgment call as Mission 10's enemy-Bard forced move
 * (see resolveCorruptedEnemyEndOfTurnEffect) — so this always picks their lowest-value card. Once the deck runs
 * dry it reshuffles from its own used-card pile (GameState.beastDeckDiscard) and the cycle continues — since the
 * beast deck is always exactly the 4 base-suited Beast Companions, one full cycle always flips all 4 suits
 * exactly once before clearing and restarting; skipped entirely for the turn right after an exact kill (see
 * GameState.skipNextBeastDeckFlip, consumed here). Called both once at mission start (the first player's first
 * turn) and from advanceToNextPlayer, same as every other start-of-turn flip in this file.
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
  const suit = card.suit;

  if (suit === 'C') {
    const banished = state.discardPile.pop();
    if (banished) {
      banishCards(state, [banished]);
      log(state, `${label} flips (Warrior) — the top of the discard pile is banished.`);
    } else {
      log(state, `${label} flips (Warrior) — the discard pile is empty, nothing to banish.`);
    }
    return;
  }
  if (suit === 'S') {
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
  if (suit === 'H') {
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
  } else if (suit === 'D') {
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
 *
 * Deliberately NOT capped the way Mission 3's flipMissionZoneCard is: that cap was only added after playtest data
 * showed it was needed there, and applying it here on top of Mission 12's own boss-immunity fix (see missions.ts's
 * Mission 12 comment) would silently gut this mission's own documented immunity-granting mechanic, breaking its
 * existing test coverage below. Revisit with real playtest data if this mission turns out to need it too.
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
  // A Mercenary "19" (see SuitedCard.noSuitPower) carries an inert placeholder suit and must never grant zone
  // immunity, same as every other suit-immunity-bookkeeping site it's excluded from.
  if (card.kind === 'suited' && !card.noSuitPower) {
    for (const s of cardSuits(card)) {
      if (!state.zoneImmuneSuits.includes(s)) state.zoneImmuneSuits.push(s);
    }
  }
  const label = card.kind === 'suited' ? card.name ?? `the ${card.rank}` : 'a Jester';
  const outcome =
    card.kind === 'suited' && card.noSuitPower
      ? 'the enemy grows bolder, but it carries no class of its own to grant.'
      : 'the enemy grows bolder and gains its immunity.';
  log(state, `The mission zone pulls ${label} from the top of the banish pile — ${outcome}`);
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
 *
 * Also applies the same low-to-high cleanup ordering pushToDiscardPile does when GameState.discardCleanupLowToHigh
 * is set (see that function's doc comment for the sourced rule and rationale) — Mission 11's own pileTopEnemyBonus
 * reads the banish pile's top value exactly the way it reads the discard pile's (see rules.ts's
 * banishPileTopValue/pileTopImmuneSuits, engine.ts's resolvedEnemyAttack), and a defeated enemy's accumulated
 * table cards are routed here instead of to the discard pile for that same mission (see finishEnemyDefeatTail),
 * so leaving this pile's ordering arbitrary would reopen the identical self-reinforcing spiral the discard-pile
 * fix closed, just one pile over. Only reached via the plain (non-restored-card) branch below, since no mission
 * sets both discardCleanupLowToHigh and restoredCardMechanic at once (Mission 12's own three-step cleanup bulk-
 * banishes with order explicitly preserved instead — see missions.ts's restoredCardMechanic doc comment).
 */
function banishCards(state: GameState, cards: Card[]): void {
  if (cards.length === 0) return;
  if (!state.restoredCardMechanic) {
    const ordered = state.discardCleanupLowToHigh && cards.length > 1 ? lowToHighForCleanup(cards) : cards;
    state.banishPile.push(...ordered);
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
 * Shared low-to-high cleanup sort used by both pushToDiscardPile and banishCards below when
 * GameState.discardCleanupLowToHigh is active: reorders a same-batch cleanup push (2+ cards collected for a single
 * covered DEFEND or a single enemy's played table cards) so the LOWEST-value card ends up on top of the
 * destination pile (the array's last element, matching how rules.ts's discardPileTopValue/banishPileTopValue read
 * "top") — sourced from an independent fan digital-reimplementation's rules doc's "M4+ Cleanup discard ordering:
 * when discarding played cards during cleanup, place them low-to-high, lowest value on top." That quote is about
 * ordering the cards WITHIN one such batch relative to each other, not about the batch versus whatever already
 * sits on the pile — a single-card push has nothing to order and is intentionally left alone by both callers.
 */
function lowToHighForCleanup(cards: Card[]): Card[] {
  // Descending by value: the highest card is pushed first, the lowest last — so the lowest ends up on top.
  return [...cards].sort((a, b) => cardValue(b) - cardValue(a));
}

/**
 * Legacy-only (Missions 4 and 11): pushes `cards` onto the discard pile — the shared tail for both a covered
 * DEFEND and an enemy's played table cards on defeat (exact or overkill). When GameState.discardCleanupLowToHigh
 * is set, sorts the batch via lowToHighForCleanup (see its doc comment for the sourced rule) instead of using
 * whatever order the caller collected the cards in. A no-op wrapper (behaves exactly like
 * `state.discardPile.push(...)`) for every mission that doesn't set the flag, or for a single-card push (nothing
 * to order), same shape as banishCards/toReserveDeck above.
 */
function pushToDiscardPile(state: GameState, cards: Card[]): void {
  if (cards.length === 0) return;
  if (!state.discardCleanupLowToHigh || cards.length === 1) {
    state.discardPile.push(...cards);
    return;
  }
  state.discardPile.push(...lowToHighForCleanup(cards));
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
 *
 * DECISION (see the Spades branch below): since Legacy's own Jester claim never sets enemy.immunityBroken — that's
 * deliberate and tested, not a bug, see legacy.test.ts's "not a permanent immunity break" case — a Spades play
 * blocked by immunity under ruleset 'legacy' banks into enemy.blockedSpadesShield but can NEVER be redeemed:
 * the only code that ever folds blockedSpadesShield into real spadesShield is activateJester, which is classic
 * Regicide's Jester action and is never reachable in a Legacy game (Legacy uses playJester/claimJester instead,
 * gated separately). Rewiring claimJester to also permanently break immunity was considered and rejected — it
 * would contradict the sourced, footage-confirmed, already-tested one-shot behavior above, for every Legacy
 * mission's Jester interactions, not just the dual-immune/Paladin edge case this was found from. Instead, the log
 * message below is ruleset-aware so it never promises a payoff that can't happen.
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
  // (see GameState.pileTopEnemyBonus / rules.ts's pileTopImmuneSuits, which bounds this against the enemy's own
  // inherent immunity so the two piles can never combine into an all-4-classes lockout).
  const pileImmuneSuits = state.pileTopEnemyBonus ? pileTopImmuneSuits(state.discardPile, state.banishPile, enemy) : [];
  const blocked = (s: 'H' | 'D' | 'C' | 'S') =>
    !ignoreImmunity &&
    !enemy.immunityBroken &&
    !corruptedSuits.includes(s) &&
    (isSuitBlockedByImmunity(s, enemy) || state.zoneImmuneSuits.includes(s) || pileImmuneSuits.includes(s));
  const immuneNoun = state.ruleset === 'legacy' ? 'class' : 'suit';
  // Which of blocked()'s three OR'd sources is actually responsible for a given blocked suit, so the log names
  // the real cause instead of always implying the enemy's own printed class/suit. Checked in the same precedence
  // blocked()'s OR uses (own class, then Mission 12's mission-zone flip, then Mission 11's discard/banish pile
  // tops), so a suit blocked by more than one source at once reports the first that applies. Only meaningful to
  // call when blocked(s) is already known true.
  const blockedClause = (s: 'H' | 'D' | 'C' | 'S') => {
    if (isSuitBlockedByImmunity(s, enemy)) return `the enemy is immune to its own ${immuneNoun}`;
    if (state.zoneImmuneSuits.includes(s)) return `the enemy is immune to ${immuneNoun} via the mission zone`;
    return `the enemy is immune to ${immuneNoun} via the discard/banish piles`;
  };

  if (suits.includes('H')) {
    if (blocked('H')) log(state, `${powerLabel(state, 'H')} blocked — ${blockedClause('H')}.`);
    else resolveHearts(state, totalValue, hasSpecial(cards, 'REVIVE') ? 2 : 0);
  }
  if (suits.includes('D')) {
    if (blocked('D')) log(state, `${powerLabel(state, 'D')} blocked — ${blockedClause('D')}.`);
    else resolveDiamonds(state, totalValue, hasSpecial(cards, 'INSPIRE') ? 2 : 0);
  }
  let clubsMultiplier = 1;
  if (suits.includes('C')) {
    if (blocked('C')) log(state, `${powerLabel(state, 'C')} blocked — ${blockedClause('C')}.`);
    else {
      clubsMultiplier = hasSpecial(cards, 'CLEAVE') ? 3 : 2;
      if (clubsMultiplier === 3) log(state, `${powerLabel(state, 'C')}: damage tripled (Cleave).`);
    }
  }
  if (suits.includes('S')) {
    if (blocked('S')) {
      enemy.blockedSpadesShield += totalValue;
      // Only classic Regicide's Jester (activateJester) ever redeems blockedSpadesShield — Legacy's claimJester
      // never sets immunityBroken (see this function's own doc comment above), so under ruleset 'legacy' this
      // value can never convert into real shield. Don't promise a payoff Legacy can't deliver.
      const canRedeemLater = state.ruleset !== 'legacy';
      log(
        state,
        `${powerLabel(state, 'S')} blocked — ${blockedClause('S')}${canRedeemLater ? ' (shield banked for later).' : '.'}`,
      );
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

const RANK_NAME: Record<'J' | 'Q' | 'K', string> = { J: 'Jack', Q: 'Queen', K: 'King' };

/**
 * UNSOURCED BALANCE JUDGMENT CALL — not from the transcript or any community research (see the
 * legacy-mission-playtest-findings memory doc's Mission 10 section, and this mission's own regression tests for
 * the reasoning). Neither of this pass's two sourced corrections (drawing enemies from already-corrupted party
 * cards; the Bard's forced move becoming a player choice) touches the actual collapse mechanism playtesting
 * found: `missionZone`'s combined value has no decay and no ceiling, so it grows by a fresh card every single
 * turn a boss fight drags on — feeding straight onto that enemy's live attack, then doubled again on top of that
 * for a Warrior-suited enemy — and simulated play still collapsed to a 0% win rate across 8 fresh seeded games
 * (1p/2p/4p) even with both sourced fixes applied. Capping the zone's contribution keeps the mission's own
 * escalating-corruption flavor (the zone still visibly grows every turn) while stopping a boss fight that runs
 * long from becoming mathematically unsurvivable. The cap's specific value (10 — one average card's worth of
 * "extra" strength past whatever a fight opens with) is a judgment call with no source backing it at all; treat
 * it as a starting point for real playtesting, not a confirmed number.
 */
const MISSION_10_ZONE_BONUS_CAP = 10;

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
    // currentEnemyAttackWithDiscardBuff. The raw zone sum is capped at MISSION_10_ZONE_BONUS_CAP — see that
    // constant's own comment for why this line exists at all; it has no source, unlike the formula shape above.
    const rawZoneBonus = state.startOfTurnZoneFlip ? state.missionZone.reduce((sum, c) => sum + cardValue(c), 0) : 0;
    const zoneBonus = Math.min(rawZoneBonus, MISSION_10_ZONE_BONUS_CAP);
    const totalStrength = enemy.baseAttack + zoneBonus;
    const isWarrior = classForSuit(enemy.suit).id === 'WARRIOR';
    const multiplied = isWarrior ? totalStrength * 2 : totalStrength;
    return Math.max(0, multiplied - enemy.spadesShield);
  }
  let buff = 0;
  if (state.discardTopBuffsAttack) buff += discardPileTopValue(state.discardPile);
  if (state.ascendingZone) buff += ascendingZoneAttackBuff(state.missionZone);
  // Mission 5: bonus strength from every card recycled into the rolling zone since the last kill, summed
  // together (see GameState.rollingZoneBonus / rollMissionZoneBonusCard) — not just the single most-recent one.
  if (state.rollingZoneBonus) buff += missionZoneValueSum(state.rollingZoneCards);
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

/**
 * Returns true if the enemy was defeated by this hit (win or new enemy revealed either way).
 * `attackIncludesGuardian` is Legacy-only (Mission 6, sourced from the official rules card): true when the play
 * that landed this kill included a Guardian card — cancels Myla's team-damage step entirely for this kill (see
 * GameState.zoneVengeanceOnKill / finishEnemyDefeatTail). Absent for the recursive splash-damage self-call
 * (Mission 5's exactKillSplashDamage — never combined with Mission 6's zoneVengeanceOnKill in practice, but
 * threaded through anyway so a chained kill from the same play stays covered by the same shield).
 * `forcedPlay` — true when the play that landed this hit only happened because YIELD was rejected by
 * allOtherPlayersYieldedLastTurn (every other player at the table had already yielded, leaving the current player
 * no legal way to pass — see playCards/resolveComboAssist, which compute this fresh from state right before
 * calling in). Exempts the exactKillOnly overkill-recycle branch just below: with no real choice but to play
 * *something*, an overkill here isn't a decision the player made, so the enemy should go down for good like any
 * other kill instead of shrugging it off and healing (see legacy-mission-playtest-findings for the bug this
 * closes). Absent (false) for the recursive splash-damage self-call and for CLAIM_JESTER's call, neither of
 * which is a response to a rejected yield.
 */
function dealDamageAndCheckDefeat(state: GameState, damage: number, attackIncludesGuardian = false, forcedPlay = false): boolean {
  const enemy = state.currentEnemy!;
  enemy.damageTaken += damage;
  const remaining = enemy.maxHealth - enemy.damageTaken;
  if (remaining > 0) return false;

  if (state.ruleset === 'legacy' && state.exactKillOnly && remaining < 0 && !forcedPlay) {
    // Overkill on an exact-kill-only enemy doesn't defeat it — it recycles to the back of the enemy line,
    // wounds healed, to be fought again later (see GameState.exactKillOnly). Exempted when forcedPlay is true —
    // see this function's own doc comment.
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
    // `state.exactKillOnly` alone used to be enough to tell this was an exact hit, since every overkill was caught
    // by the recycle branch above — no longer true now that a forcedPlay overkill can fall through here too, so
    // this checks `remaining === 0` directly instead.
    log(
      state,
      state.exactKillOnly
        ? remaining === 0
          ? `${enemyLabel(enemy)} felled by an exact hit — banished for good!`
          : `${enemyLabel(enemy)} is overwhelmed by the forced attack — banished for good despite the overkill!`
        : `${enemyLabel(enemy)} defeated!`,
    );
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
    if (state.rollingZoneBonus && state.rollingZoneCards.length > 0) {
      // Mission 5: a kill resets the "since the last kill" accumulation window — every card recycled into the
      // rolling zone this stretch goes back to the banish pile (available to recycle out again later), and the
      // buff it was feeding the just-defeated enemy doesn't carry over to whatever's revealed next.
      banishCards(state, state.rollingZoneCards);
      state.rollingZoneCards = [];
      log(state, 'The rolling zone is banished — its buff resets for the next foe.');
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
      // Mission 6, sourced fix (regicidelegacy.com compendium + a fan digital-reimplementation's rules doc —
      // see legacy-missions-transcript-mismatches.md): whatever's left on the enemy's table after this kill
      // doesn't fall to the discard pile automatically — a PLAYER chooses which single card, from the play area
      // just committed to this kill, is sacrificed permanently into the (never-cleared) mission zone alongside
      // Myla. The shipped version instead auto-picked the lowest-value card, taking the choice away from the
      // player entirely and routinely dragging a second or third suit into Myla's permanent immunity on the very
      // first kill. Modeled as a genuine pending choice (see CHOOSE_ZONE_VENGEANCE_SACRIFICE /
      // chooseZoneVengeanceSacrifice), the same shape as Mission 9's AWAIT_RESCUE_CHOICE — the rest of this
      // kill's resolution (finishEnemyDefeatTail) waits for it.
      if (enemy.tableCards.length > 0) {
        state.zoneVengeanceChoice = { remaining, attackIncludesGuardian };
        state.turnPhase = 'AWAIT_ZONE_VENGEANCE_CHOICE';
        log(state, 'Choose one card from the play area to sacrifice permanently into the mission zone.');
        return true;
      }
      // No card left on the enemy's table to sacrifice this kill (rare) — the zone doesn't grow, straight on to
      // the rest of the defeat resolution.
      return finishEnemyDefeatTail(state, enemy, remaining, attackIncludesGuardian);
    }
    if (state.pilgrimMechanic && remaining === 0) {
      // Mission 7: sourced even by this mission's own transcript (though never actually coded until now) — an
      // exact-damage kill banishes one Pilgrim for free, releasing it from whichever hand has been carrying it as
      // dead weight (see SuitedCard.pilgrim / this mission's PLAY_CARDS/DEFEND hand-trap rejection). Scoped
      // judgment call, not itself sourced: which Pilgrim/whose hand isn't specified anywhere, so this picks the
      // first one found scanning hands in turn order starting from the current player. A no-op if nobody's
      // holding one yet.
      const n = state.players.length;
      let freed: Card | null = null;
      for (let i = 0; i < n && !freed; i++) {
        const p = state.players[(state.currentPlayerIndex + i) % n];
        const idx = p.hand.findIndex((c) => c.kind === 'suited' && c.pilgrim);
        if (idx !== -1) [freed] = p.hand.splice(idx, 1);
      }
      if (freed) {
        banishCards(state, [freed]);
        log(state, `The exact hit frees ${freed.kind === 'suited' ? freed.name ?? 'a Pilgrim' : 'a Pilgrim'} from a weary hand — banished for good.`);
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
  } else if (state.endlessLoop > 0) {
    // Endless Mode: the deck already contains exactly one card of every suit+rank — carried forward from the
    // classic win that unlocked Endless Mode, or from earlier loops (see startEndlessRound) — so defeating a
    // castle enemy never adds a new card. It strengthens the ONE matching suit+rank card already in the deck
    // (wherever it currently sits: tavern deck, discard pile, or a hand) by 1 tier. Each suit/rank levels up
    // independently — defeating the Jack of Clubs only strengthens the Jack of Clubs, not every Jack.
    const isMatch = (c: Card): c is Extract<Card, { kind: 'suited' }> =>
      c.kind === 'suited' && c.suit === enemy.suit && c.rank === enemy.rank;
    const existing =
      state.tavernDeck.find(isMatch) ?? state.discardPile.find(isMatch) ?? state.players.flatMap((p) => p.hand).find(isMatch);
    if (existing) {
      existing.tier = (existing.tier ?? 0) + 1;
      log(state, `${enemyLabel(enemy)} defeated — your ${RANK_NAME[enemy.rank]} of ${enemy.suit} grows stronger (tier ${existing.tier}).`);
    } else {
      log(state, `${enemyLabel(enemy)} defeated!`);
    }
  } else {
    // Classic Regicide's base recycling rule: an exact-damage kill returns the defeated enemy's own card to the
    // top of the Tavern deck; otherwise it goes to the discard pile.
    const defeatedCard: Card = {
      id: `enemy-${enemy.suit}${enemy.rank}-${Date.now()}-${Math.floor(nextRandom(state) * 1e6)}`,
      kind: 'suited',
      suit: enemy.suit,
      rank: enemy.rank,
    };
    if (remaining === 0) {
      state.tavernDeck.unshift(defeatedCard); // top of tavern deck
      log(state, `${enemyLabel(enemy)} defeated with an exact hit — returns to the top of the Tavern deck!`);
    } else {
      state.discardPile.push(defeatedCard);
      log(state, `${enemyLabel(enemy)} defeated!`);
    }
  }
  return finishEnemyDefeatTail(state, enemy, remaining, attackIncludesGuardian);
}

/**
 * The shared tail of a confirmed enemy defeat, once every ruleset/mission-specific inline effect above has run
 * (or, for Mission 6's zoneVengeanceOnKill, once its AWAIT_ZONE_VENGEANCE_CHOICE has been resolved — see
 * chooseZoneVengeanceSacrifice). Split out of dealDamageAndCheckDefeat so that choice can pause mid-resolution
 * and resume here afterward, the same way CHOOSE_EXACT_KILL_RESCUE resumes its own
 * mission's flow from a dedicated resolve function. `attackIncludesGuardian` — see dealDamageAndCheckDefeat.
 */
function finishEnemyDefeatTail(state: GameState, enemy: EnemyState, remaining: number, attackIncludesGuardian: boolean): boolean {
  if (state.ruleset === 'legacy' && (state.pileTopEnemyBonus || state.restoredCardMechanic)) {
    // Mission 11: "defeating the enemy always banishes it" — its played cards go to the banish pile instead of
    // the discard pile, directly feeding the very pile-top bonus/immunity mechanic this flag names (see
    // resolvedEnemyAttack / resolveSuitPowers's blocked check). Mission 12 reuses the same rule as step two of its
    // own three-step cleanup (see the restoredCardMechanic block above for step one, and just below for step three).
    banishCards(state, enemy.tableCards);
  } else if (state.ruleset === 'legacy' && state.ascendingZone && !state.zoneClosed) {
    // Mission 8, sourced fix (see GameAction's PLACE_IN_ZONE / GameState.zoneCommittedPlay): the ascending zone's
    // placement no longer costs a fresh hand card — it instead reuses a card already committed to THIS kill's
    // own winning attack, at no extra cost. Hold this kill's played cards here instead of discarding them
    // immediately; whatever isn't claimed by a placement gets swept to the discard pile once the placement
    // window closes (finishAdvanceToNextPlayer) or the zone purges at 10 (placeInZone).
    state.zoneCommittedPlay.push(...enemy.tableCards);
  } else {
    pushToDiscardPile(state, enemy.tableCards);
  }
  if (state.ruleset === 'legacy' && state.restoredCardMechanic) {
    // Mission 12's cleanup, step three: banish the ENTIRE discard pile too — order preserved, right after the
    // mission zone and the enemy's own table cards above.
    banishCards(state, state.discardPile);
    state.discardPile = [];
  }

  if (state.castleDeck.length === 0) {
    // Mission 11's reward (Esme's permanent evergreen upgrade, see party.ts's applyEvergreenUpgrade) resolves
    // entirely outside GameState at mission-grant time — sourced correction: the previously-shipped version
    // opened a pending AWAIT_BEAST_REWARD_CHOICE window here for the party to pick one of the beast-deck cards to
    // carry forward, which no longer happens (the beast cards simply return to the party untouched instead).
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
    dealDamageAndCheckDefeat(state, splash, attackIncludesGuardian);
    return true;
  }

  if (state.ruleset === 'legacy' && state.zoneVengeanceOnKill && state.missionZone.length > 0) {
    if (attackIncludesGuardian) {
      // Mission 6, sourced fix (official rules card, per legacy-missions-transcript-mismatches.md): a winning
      // attack that includes a Guardian cancels Myla's team-damage step entirely — the shield the Guardian
      // raises against the enemy also holds against the garden's own retaliation this kill. Not implemented at
      // all in the shipped version.
      log(state, "A Guardian's shield holds against the garden itself — Myla's strike is cancelled this time.");
    } else {
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
    kinfolkSlot: null,
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
  state.pendingJesterRefill = null;
  state.endlessLoop = 0;
  state.exactKillOnly = false;
  state.relics = [];
  state.comboAssist = null;
  state.kinfolkBankedThisTurn = false;
  state.azureEmblemWindow = null;
  state.endOfTurnZoneFlip = false;
  state.missionZone = [];
  state.zoneImmuneSuits = [];
  state.banishPile = [];
  state.jesterClaimNextPlayerOnly = false;
  state.discardTopBuffsAttack = false;
  state.exactKillToReserveDeck = false;
  state.corruptedReturnQueue = false;
  state.discardCleanupLowToHigh = false;
  state.exactKillSplashDamage = false;
  state.rollingZoneBonus = false;
  state.rollingZoneCards = [];
  state.zoneVengeanceOnKill = false;
  state.pilgrimMechanic = false;
  state.pilgrimDeck = [];
  state.pilgrimZone = [];
  state.ascendingZone = false;
  state.zoneOpenForPlacement = false;
  state.zoneCommittedPlay = [];
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
    // UNSOURCED BALANCE JUDGMENT CALL (see buildCapturedPiles's own doc comment): scale each pile down for a
    // smaller table instead of always carving out the sourced 30-card fixed split — a solo or 2-player fight gets
    // a smaller pile, leaving more of the party in the actual tavern deck.
    //
    // SECOND-PASS BALANCE FIX (2026-08-28, unsourced — see the mission-9-recheck sim, deleted after use, and the
    // legacy-mission-playtest-findings memory doc): the first pass's `Math.min(10, 4 + 2*n)` grows the pile size
    // monotonically with player count, reaching the sourced 10/pile (30 total) "once there are enough players
    // (3-4)" — but this engine's OWN per-player-count hand limit (8/7/6/5) times player count means the initial
    // hand deal alone claims MORE total cards as n grows (8, 14, 18, 20) even though each individual hand shrinks,
    // while the leftover-party pool the first pass left behind actually SHRANK as n grew (22, 16, 10, 10 before
    // extras/jesters). Measured against the actual numbers this produces: a solo game keeps 22 cards in the
    // tavern deck after the opening deal (fine — this is what the first pass fixed) and a 2-player game keeps 10
    // (tight but survivable), but a 3-player game is left with exactly 1 card and a 4-player game is left with
    // exactly 0 — the entire reserve deck is consumed by dealing starting hands, before a single turn is played,
    // at precisely the player counts (3-4) the sourced 30-card split was supposedly tested at. That's a
    // reintroduction of the same bug the first pass fixed, just relocated to higher player counts instead of
    // solo. This now additionally caps the pile size so the tavern deck always keeps a minimum buffer of cards
    // after the opening deal, computed directly from this mission's own actual numbers (party size, extras,
    // jesters, and the real per-count hand limit) rather than a flat player-count formula, so it holds regardless
    // of how those inputs change — and only trims the pile size, never grows it past the first pass's own
    // `Math.min(10, 4 + 2*n)` cap, so a solo/2-player fight (already comfortably above the buffer) is unaffected.
    const MIN_STARTING_RESERVE = 10;
    const initialHandDeal = n * (MAX_HAND_SIZE_BY_PLAYER_COUNT[n] ?? 5);
    const extrasAndJesters = (action.extraReserveCards?.length ?? 0) + action.jesterCount;
    const maxPileSizeForReserve = Math.floor(
      (partyForReserve.length + extrasAndJesters - initialHandDeal - MIN_STARTING_RESERVE) / 3,
    );
    const pileSize = Math.max(1, Math.min(10, 4 + 2 * n, maxPileSizeForReserve));
    const split = buildCapturedPiles(partyForReserve, buildRng, pileSize);
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
    kinfolkSlot: null,
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
  state.pendingJesterRefill = null;
  state.endlessLoop = 0;
  state.exactKillOnly = action.exactKillOnly ?? false;
  state.relics = action.relics ?? [];
  state.comboAssist = null;
  state.kinfolkBankedThisTurn = false;
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
  state.discardCleanupLowToHigh = action.discardCleanupLowToHigh ?? false;
  state.exactKillSplashDamage = action.exactKillSplashDamage ?? false;
  state.rollingZoneBonus = action.rollingZoneBonus ?? false;
  state.rollingZoneCards = [];
  state.zoneVengeanceOnKill = action.zoneVengeanceOnKill ?? false;
  state.zoneVengeanceChoice = null;
  state.pilgrimMechanic = action.pilgrimMechanic ?? false;
  // Vestigial (see GameState.pilgrimMechanic) — no mission sets action.pilgrimCards anymore, so this is always
  // empty; Mission 7's actual Pilgrim cards ride in through extraReserveCards below, shuffled into the reserve
  // deck like any other card.
  state.pilgrimDeck = action.pilgrimCards ? [...action.pilgrimCards] : [];
  state.pilgrimZone = [];
  state.ascendingZone = action.ascendingZone ?? false;
  state.zoneOpenForPlacement = false;
  state.zoneCommittedPlay = [];
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
  flipStartOfTurnZoneCard(state); // Mission 10: same reasoning — the first turn's start-of-turn flip fires here too
  flipBeastDeckCard(state); // Mission 11: same reasoning — the first turn's beast-deck flip fires here too
  flipBanishPileZoneCard(state); // Mission 12: same reasoning — the first turn's flip fires here too (a no-op, the banish pile starts empty)
  return ok(state);
}

/**
 * Classic Regicide only: continues a WON game into another round instead of ending it. Reshuffles the SAME deck
 * the just-won game ended with (all 52 cards, plus any per-card tier bumps already earned — see
 * dealDamageAndCheckDefeat) into a fresh Tavern deck, rather than rebuilding from a template — Endless Mode is a
 * continuation of that one deck across loops, not a series of independent rounds. Hand size and the Castle
 * deck's enemy stats both scale with the loop count, so the fight escalates indefinitely.
 */
function startEndlessRound(state: GameState): EngineResult {
  if (state.phase !== 'WON') return fail('Endless Mode can only be started after winning.');
  if (state.ruleset !== 'regicide') return fail('Endless Mode is only available in classic Regicide.');

  const n = state.players.length;
  const loop = state.endlessLoop + 1;
  const rng = () => nextRandom(state);
  // Endless Mode continues playing with the SAME deck the just-won game ended with — not a fresh template — so
  // every tier already earned on individual cards (see dealDamageAndCheckDefeat's per-suit/rank tier bump)
  // carries forward untouched. Jesters don't carry over (played ones are gone for good), so a fresh set is added
  // per player count, same as a brand new game.
  const carriedCards = [...state.tavernDeck, ...state.discardPile, ...state.players.flatMap((p) => p.hand)];
  const tavernDeck = shuffle([...carriedCards, ...makeJesters(JESTERS_BY_PLAYER_COUNT[n] ?? 0)], rng);
  const castleDeck = buildEndlessCastleDeck(loop, rng);
  // Hand size grows by 1 per loop on top of the normal player-count base, mirroring the same "+2 per loop" scaling
  // already applied to the combo cap and the Castle deck's enemy stats (see validatePlayShape / buildEndlessCastleDeck).
  const baseHandSize = MAX_HAND_SIZE_BY_PLAYER_COUNT[n] ?? 5;
  state.maxHandSize = baseHandSize + loop;

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
  state.pendingJesterRefill = null;
  state.endlessLoop = loop;

  log(
    state,
    `Endless Round ${loop} begins! Hand size grows to ${state.maxHandSize}. Defeating a Jack, Queen, or King strengthens that suit's card in your deck. First enemy: ${enemyLabel(state.currentEnemy)}.`,
  );
  return ok(state);
}

/**
 * Resolves a play already committed to the enemy's table (cards moved out of hand, already in tableCards):
 * class powers, damage, and the resulting AWAIT_DEFEND/turn-advance. Shared by the immediate PLAY_CARDS path
 * (including a Kinfolk Flute combo card folded in), by RESOLVE_COMBO once an open Scarlet Whistle assist window
 * is locked in, and by claimJester's synthetic 8-strength Jester attack.
 * `forcedPlay` — see dealDamageAndCheckDefeat's own doc comment; threaded straight through to it. playCards and
 * resolveComboAssist both compute this fresh (allOtherPlayersYieldedLastTurn(state)) right before calling in,
 * since neither path has done anything by that point that would change what that check reports; claimJester never
 * passes it (defaults to false) since a Jester claim isn't a response to a rejected yield.
 */
function resolveCommittedPlay(state: GameState, player: PlayerState, cards: Card[], claimedJester: Card | null, forcedPlay = false): EngineResult {
  const shape = validatePlayShape(cards, state.endlessLoop);
  if ('error' in shape) return fail(shape.error);

  const arcaneBonus = state.ruleset === 'legacy' ? resolveArcaneBolts(state, cards) : 0;
  // Mage, Reaver, Guardian, Druid, Chanter, and Evergreen cards' printed suits don't join the combined
  // suit-power resolution below — a Mage's (or a secondClassArcane card's bonus) class power is the arcane bolt
  // above instead (which already resolved), a Reaver's is the reserve-deck tear resolved just below, a
  // Guardian's is the permanent shield resolved just after that, a Druid's is the banish-pile salvage resolved
  // after that, a Chanter's is the chant resolved further down, and an Evergreen card's is the all-four-powers
  // resolution forced further down still (Mage always goes first, per legacy/classes.ts). A secondClassArcane
  // card is deliberately NOT excluded here — it keeps its own suit power on top of the arcane bolt it already
  // triggered above (see SuitedCard.secondClassArcane). A Mercenary "19" (noSuitPower) is excluded for a
  // different reason than the rest — it doesn't substitute its own effect, it genuinely has none — which is also
  // what keeps it out of immunity-blocking, since that's computed only from cards that reach this filter.
  const nonArcaneCards = cards.filter(
    (c): c is Extract<Card, { kind: 'suited' }> =>
      c.kind === 'suited' && !c.arcane && !c.reaver && !c.guardian && !c.druid && !c.chanter && !c.evergreen && !c.noSuitPower,
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
  // Mission 6 reward, sourced fix: a secondClassGuardian card (the Guardian sticker granted to an existing
  // rank-8 party card, see party.ts's applyGuardianSticker) fires this same shield ability on top of its own
  // suit power, exactly like a secondClassArcane card's bonus arcane bolt fires on top of its own suit power.
  const guardianCards = cards.filter(
    (c): c is Extract<Card, { kind: 'suited' }> => c.kind === 'suited' && Boolean(c.guardian || c.secondClassGuardian),
  );
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
  // Logged here — after Clubs' clubsMultiplier, a Reaver's reaverBonus, an Arcane bolt's arcaneBonus, and any
  // Paladin damage reduction are all folded in — rather than up front off the pre-bonus shape.totalValue, so the
  // number shown always matches what actually lands on the enemy (enemy.damageTaken below).
  log(
    state,
    `${player.name} plays ${cards.length > 1 ? 'a combo' : 'a card'} for ${damage}${claimedJester ? ', combined with the claimed Jester — ignoring immunity' : ''}.`,
  );
  state.lastActionWasYield[state.currentPlayerIndex] = false;

  // Mission 6, sourced fix: a winning attack that includes a Guardian cancels Myla's zoneVengeanceOnKill
  // team-damage step entirely (see finishEnemyDefeatTail) — a documented mechanic missing from the shipped
  // version. Inert on every other mission, since guardianCards is always empty there.
  const defeated = dealDamageAndCheckDefeat(state, damage, guardianCards.length > 0, forcedPlay);

  if (state.phase !== 'IN_PROGRESS') return ok(state);

  if (defeated) {
    // Sourced fix: a Chanter's chant fires on ANY play it's part of, including one that also lands the killing
    // blow — dealDamageAndCheckDefeat has already fully resolved what happens next (continue against the newly
    // revealed enemy, Mission 9's exact-kill rescue choice, etc.); beginChant's forced draw (and any resulting
    // trim window) now runs on top of that, restoring this already-decided turnPhase/pendingDamage once trimming
    // is done rather than resolving a deferred attack against an enemy that's already dead (see
    // ChanterResolution's 'resumeResolved'). The shipped version only ever called beginChant below this early
    // return, so a play that included BOTH a Chanter and the killing blow silently dropped the chant entirely.
    if (chantCount > 0) {
      return beginChant(state, chantCount, { kind: 'resumeResolved', turnPhase: state.turnPhase, pendingDamage: state.pendingDamage });
    }
    return ok(state); // enemy was defeated, same player continues against the next one
  }

  if (chantCount > 0) {
    return beginChant(state, chantCount, { kind: 'deferredAttack', blockNextAttack: guardianBlocksNextAttack });
  }

  // Azure Emblem (Mission 6 relic), sourced fix: whenever a Mage joins the attack, the Mage's OWN player gets
  // one chance to bank one of this play's Mage card(s) onto the reserve deck instead of losing it to the
  // discard pile whenever the enemy is eventually defeated — the shipped version had this backwards (every
  // OTHER player silently placing a card from hand). Skipped if a Chanter also fired in the same play (see
  // chantCount above) — the two mission-specific windows never need to stack in practice, since each faction's
  // cards are unique.
  const mageCardIds = state.ruleset === 'legacy' && state.relics.includes('AZURE_EMBLEM')
    ? cards.filter((c): c is Extract<Card, { kind: 'suited' }> => c.kind === 'suited' && Boolean(c.arcane)).map((c) => c.id)
    : [];
  if (mageCardIds.length > 0) {
    return beginAzureEmblem(state, player.id, mageCardIds, guardianBlocksNextAttack);
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

const BASE_SUITS: Suit[] = ['H', 'D', 'C', 'S'];

/**
 * Resolves any Mercenary any-suit Ace(s) among `cards` (see SuitedCard.wildSuit) by mutating each one's `suit` to
 * its chosen value from `chosenSuits` (cardId -> one of the 4 base suits) — the earliest point in a play's
 * resolution a suit is ever needed, before validatePlayShape/cardSuits reads it. `cards` holds direct references
 * into the owning player's hand (or, from assistCombo, the assister's), so mutating in place here is visible
 * everywhere downstream. Returns an error string if a wildSuit card has no (or an invalid) choice, null otherwise.
 */
function applyChosenSuits(cards: Card[], chosenSuits: Record<string, Suit> | undefined): string | null {
  for (const card of cards) {
    if (card.kind !== 'suited' || !card.wildSuit) continue;
    const chosen = chosenSuits?.[card.id];
    if (!chosen) return 'Choose a suit for the any-suit Ace before playing it.';
    if (!BASE_SUITS.includes(chosen)) return 'Invalid suit choice for the any-suit Ace — must be Hearts, Diamonds, Clubs, or Spades.';
    card.suit = chosen;
  }
  return null;
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
  // Mission 7's Pilgrim hand-trap: once drawn into a hand, a Pilgrim card can never be played, for any reason
  // (see SuitedCard.pilgrim / GameState.pilgrimMechanic) — reject the whole play rather than silently dropping it.
  if (state.pilgrimMechanic && cards.some((c) => c.kind === 'suited' && c.pilgrim)) {
    return fail('A Pilgrim card is dead weight — it cannot be played.');
  }

  // A Mercenary any-suit Ace (see SuitedCard.wildSuit) needs its suit resolved before validatePlayShape ever
  // reads it — the earliest point in this play's resolution a suit is needed at all. `cards` holds direct
  // references into player.hand, so mutating `.suit` here is visible everywhere downstream (tableCards, etc.).
  const wildSuitErr = applyChosenSuits(cards, action.chosenSuits);
  if (wildSuitErr) return fail(wildSuitErr);

  // Kinfolk Flute: fold the player's own banked slot card into this play as an extra combo card — pulled back
  // out of storage the instant it helps complete a valid same-rank combo (see PlayerState.kinfolkSlot). Never a
  // standalone play of just the slot card; a real hand card must still be played alongside it.
  let kinfolkCard: Card | null = null;
  if (action.includeKinfolkSlot) {
    if (!state.relics.includes('KINFOLK_FLUTE')) return fail('The Kinfolk Flute has not been earned yet.');
    if (!player.kinfolkSlot) return fail('Your Kinfolk slot is empty.');
    if (cards.length === 0) return fail('Play at least one hand card alongside your Kinfolk Flute card.');
    kinfolkCard = player.kinfolkSlot;
  }
  const shapeCards = kinfolkCard ? [...cards, kinfolkCard] : cards;

  const shape = validatePlayShape(shapeCards, state.endlessLoop);
  if ('error' in shape) return fail(kinfolkCard ? `That doesn't combo with your Kinfolk Flute card: ${shape.error}` : shape.error);

  // Remove played cards from hand, move to the enemy's table pile for this fight.
  const idSet = new Set(action.cardIds);
  player.hand = player.hand.filter((c) => !idSet.has(c.id));
  state.currentEnemy!.tableCards.push(...cards);
  if (kinfolkCard) {
    state.currentEnemy!.tableCards.push(kinfolkCard);
    player.kinfolkSlot = null;
    log(state, `${player.name} pulls the banked card off the Kinfolk Flute to complete the combo.`);
  }

  // Scarlet Whistle (Mission 4): playing a lone Animal/Beast Companion opens a silent-assist window instead of
  // resolving immediately — any other player may add one card from hand before the attacker calls RESOLVE_COMBO
  // (see assistCombo/resolveComboAssist, reusing the same resolveCommittedPlay path below). Moot whenever the
  // player's own Kinfolk slot already supplied the second card — that resolves immediately, no window needed.
  const scarletAssist =
    state.relics.includes('SCARLET_WHISTLE') &&
    !kinfolkCard &&
    cards.length === 1 &&
    cards[0].kind === 'suited' &&
    isCompanionCard(cards[0]);

  // Solo play has no one else to slip in a card, so the assist window would just force a pointless manual
  // "resolve" click every attack — skip it and resolve immediately instead.
  const canOpenComboAssist = state.ruleset === 'legacy' && state.players.length > 1 && scarletAssist;

  if (canOpenComboAssist) {
    state.comboAssist = { attackerId: player.id, cardIds: cards.map((c) => c.id) };
    state.turnPhase = 'AWAIT_COMBO_ASSIST';
    log(state, `${player.name} attacks alone with a Companion card — the Scarlet Whistle lets another player silently add a card before it resolves.`);
    return ok(state);
  }

  // See dealDamageAndCheckDefeat's own doc comment: true here means every other player had already yielded, so
  // this player's own YIELD would have been rejected by allOtherPlayersYieldedLastTurn — this play was compulsory,
  // not a voluntary choice to attack (let alone to overkill).
  const forcedPlay = allOtherPlayersYieldedLastTurn(state);
  return resolveCommittedPlay(state, player, shapeCards, null, forcedPlay);
}

/**
 * Legacy-only, gated by the 'KINFOLK_FLUTE' relic: banks one hand card (value 2-5) onto the player's own
 * kinfolkSlot instead of attacking — a free side-action alongside their normal turn (doesn't touch turnPhase),
 * capped at once per turn and only while the slot is empty.
 */
function bankKinfolkCard(state: GameState, action: Extract<GameAction, { type: 'BANK_KINFOLK_CARD' }>): EngineResult {
  if (state.ruleset !== 'legacy') return fail('BANK_KINFOLK_CARD is only available in Regicide Legacy.');
  if (!state.relics.includes('KINFOLK_FLUTE')) return fail('The Kinfolk Flute has not been earned yet.');
  const err = requireCurrentPlayerTurn(state, action.playerId, 'AWAIT_PLAY');
  if (err) return fail(err);

  const player = currentPlayer(state);
  if (player.kinfolkSlot) return fail('Your Kinfolk slot is already holding a card.');
  if (state.kinfolkBankedThisTurn) return fail('You can only bank one card onto the Kinfolk Flute per turn.');

  const card = player.hand.find((c) => c.id === action.cardId);
  if (!card) return fail(`Card ${action.cardId} is not in your hand.`);
  if (card.kind !== 'suited') return fail('Only a suited card worth 2-5 can be banked onto the Kinfolk Flute.');
  if (state.pilgrimMechanic && card.pilgrim) {
    return fail('A Pilgrim card is dead weight — it cannot be banked, even onto the Kinfolk Flute.');
  }
  const value = cardValue(card);
  if (value < 2 || value > 5) return fail('Only a card worth 2-5 can be banked onto the Kinfolk Flute.');

  player.hand = player.hand.filter((c) => c.id !== card.id);
  player.kinfolkSlot = card;
  state.kinfolkBankedThisTurn = true;
  log(state, `${player.name} banks ${card.name ?? `the ${card.rank}`} onto the Kinfolk Flute, ready to complete a combo later.`);
  return ok(state);
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
  // Mission 7's Pilgrim hand-trap extends to a silent Scarlet Whistle assist too — slipping one in is still
  // "playing" it (see GameState.pilgrimMechanic / playCards' own rejection).
  if (state.pilgrimMechanic && card.pilgrim) {
    return fail('A Pilgrim card is dead weight — it cannot be played, even silently assisted in.');
  }

  // A Mercenary any-suit Ace (see SuitedCard.wildSuit) can be the assisting card too — this window can open on a
  // lone Companion-pairing play, whose validatePlayShape branch reads suits immediately (see playCards's own
  // applyChosenSuits call for why this must happen before validatePlayShape, not after).
  const wildSuitErr = applyChosenSuits([card], action.chosenSuit ? { [card.id]: action.chosenSuit } : undefined);
  if (wildSuitErr) return fail(wildSuitErr);

  const existing = state.currentEnemy!.tableCards.filter((c) => state.comboAssist!.cardIds.includes(c.id));
  const combined = validatePlayShape([...existing, card], state.endlessLoop);
  if ('error' in combined) return fail(`That card doesn't fit the combo: ${combined.error}`);

  assister.hand = assister.hand.filter((c) => c.id !== card.id);
  state.currentEnemy!.tableCards.push(card);
  state.comboAssist.cardIds.push(card.id);
  log(state, `${assister.name} silently slips a card into the open attack (Scarlet Whistle).`);
  return ok(state);
}

function resolveComboAssist(state: GameState, action: Extract<GameAction, { type: 'RESOLVE_COMBO' }>): EngineResult {
  if (state.turnPhase !== 'AWAIT_COMBO_ASSIST' || !state.comboAssist) return fail('No open attack to resolve.');
  if (action.playerId !== state.comboAssist.attackerId) return fail('Only the attacking player can resolve this combo.');

  const player = currentPlayer(state);
  const cards = state.currentEnemy!.tableCards.filter((c) => state.comboAssist!.cardIds.includes(c.id));
  // Recomputed fresh rather than carried over from playCards' own opening of this window — nothing that happens
  // during an open assist window (only ASSIST_COMBO, which never touches lastActionWasYield) can change what this
  // reports, so it's exactly what it would have been back when the attacker committed to this play instead of
  // yielding. See dealDamageAndCheckDefeat's own doc comment.
  const forcedPlay = allOtherPlayersYieldedLastTurn(state);
  state.comboAssist = null;
  state.turnPhase = 'AWAIT_PLAY';
  return resolveCommittedPlay(state, player, cards, null, forcedPlay);
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

  const enemyAttack = resolvedEnemyAttack(state);
  if (enemyAttack <= 0) {
    // This yield resolved with nothing to defend against — genuinely idle, the one case checkForStuckLoss's solo
    // branch needs to catch (see its own comment).
    endTurnOrAwaitRescue(state, true);
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
  state.kinfolkBankedThisTurn = false;
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

/**
 * Reads state.turnPhase through a function boundary rather than inline — used by claimJester right after a call
 * that can reassign it (resolveCommittedPlay), where TS's control-flow narrowing would otherwise keep treating
 * state.turnPhase as whatever literal it was narrowed to just before that call, since TS can't see into an
 * arbitrary function to know it mutates a passed-in object's property.
 */
function currentTurnPhase(state: GameState): TurnPhase {
  return state.turnPhase;
}

/**
 * Legacy-only: claims an open Jester window. Validated against the window being open, not turn ownership — any
 * player may claim. Resolves immediately as its own attack (see below) rather than handing the claimant a
 * separate PLAY_CARDS step, matching the base game's own printed Jester text ("play it on its own, instead of
 * playing from your hand") that Legacy's compendium has never overridden — see GameAction's CLAIM_JESTER comment.
 */
function claimJester(state: GameState, action: Extract<GameAction, { type: 'CLAIM_JESTER' }>): EngineResult {
  if (state.ruleset !== 'legacy') return fail('CLAIM_JESTER is only available in Regicide Legacy.');
  if (state.phase !== 'IN_PROGRESS') return fail('The game is not in progress.');
  if (state.turnPhase !== 'AWAIT_JESTER_CLAIM' || !state.jesterClaim || state.jesterClaim.claimedBy !== null) {
    return fail('There is no open Jester to claim right now.');
  }
  const player = findPlayer(state, action.playerId);
  if (!player) return fail('Unknown player.');
  if (!BASE_SUITS.includes(action.attackSuit)) {
    return fail('Choose a class to attack with — Hearts, Diamonds, Clubs, or Spades.');
  }

  // Modified Jester rule (Mission 2's hydras only): the oppressive dual immunities restrict the claim to
  // whoever's turn comes next, instead of being open to the whole table.
  if (state.jesterClaimNextPlayerOnly) {
    const nextPlayer = state.players[(state.currentPlayerIndex + 1) % state.players.length];
    if (player.id !== nextPlayer.id) {
      return fail('Only the next player in turn order may claim this Jester.');
    }
  }

  const jesterCard = state.jesterClaim.card;
  state.jesterClaim = null;
  state.currentPlayerIndex = state.players.findIndex((p) => p.id === player.id);
  state.turnPhase = 'AWAIT_PLAY';
  state.kinfolkBankedThisTurn = false;
  log(state, `${player.name} claims the Jester — a free 8-strength attack, ignoring immunity.`);

  // The claimed Jester itself is the only "real" card here — it goes to the enemy's table (and eventually the
  // discard pile) same as any played card. The 8-strength attack it grants is computed via a throwaway synthetic
  // card, never entered into tableCards/discardPile itself, so it can't leak an extra card into the deck economy.
  state.currentEnemy!.tableCards.push(jesterCard);
  const syntheticAttack: SuitedCard = { id: `${jesterCard.id}-attack`, kind: 'suited', suit: action.attackSuit, rank: '8' };
  const result = resolveCommittedPlay(state, player, [syntheticAttack], jesterCard);
  if (!result.ok || state.phase !== 'IN_PROGRESS') return result;

  // Bug-fix (see GameState.pendingJesterRefill): if the synthetic attack didn't kill the enemy, the claimant now
  // owes a defend against its dealt damage (turnPhase is AWAIT_DEFEND). Refilling right here, before that defend
  // is resolved, would swap the claimant's hand out from under them while they're still deciding how to cover
  // that damage — turning what might have been a coverable hit into a lethal one. Defer the refill to defend()
  // instead; every other outcome (the enemy died, or dealt no damage back) has nothing left to resolve, so it
  // still refills immediately, exactly as before.
  // (Routed through currentTurnPhase() rather than reading state.turnPhase inline: TS's control-flow narrowing
  // otherwise carries the 'AWAIT_PLAY' literal this same function assigned a few lines above straight through the
  // resolveCommittedPlay() call — which does reassign it internally, TS just has no way to see that — and flags
  // the comparison below as comparing non-overlapping literals. A function-call boundary resets that narrowing.)
  if (currentTurnPhase(state) === 'AWAIT_DEFEND') {
    state.pendingJesterRefill = { playerId: player.id };
  } else {
    refillHandFromDeck(state, player, 'the Jester');
  }
  return ok(state);
}

/**
 * Discards `player`'s entire hand and redraws it back up to `state.maxHandSize` — the base game's own printed
 * Jester power (see useSoloJester), reused here for Legacy's CLAIM_JESTER, which never suspends it.
 *
 * Two bug-fixes layered on top of that discard:
 *  - Routes through pushToDiscardPile instead of a raw push, so Missions 4/11/12's discardCleanupLowToHigh
 *    ordering (which their pileTopEnemyBonus-style mechanics depend on) isn't silently bypassed just because the
 *    discard happened to originate from a Jester claim instead of a covered DEFEND.
 *  - Mission 7's Pilgrim hand-trap (see GameState.pilgrimMechanic): a Pilgrim card can never be discarded once
 *    drawn into a hand, by ANY path, this one included. A stuck Pilgrim is carved out of the discard and simply
 *    stays in `player.hand` across the refill, same as it would survive a normal PLAY_CARDS/DEFEND rejection.
 */
function refillHandFromDeck(state: GameState, player: PlayerState, sourceLabel: string): void {
  const stuckPilgrims = state.pilgrimMechanic ? player.hand.filter((c) => c.kind === 'suited' && c.pilgrim) : [];
  const discardable = stuckPilgrims.length > 0 ? player.hand.filter((c) => !(c.kind === 'suited' && c.pilgrim)) : player.hand;
  pushToDiscardPile(state, discardable);
  player.hand = stuckPilgrims;
  while (player.hand.length < state.maxHandSize && drawOneCard(state, player)) {
    // keep drawing until the hand limit or the deck runs dry
  }
  log(state, `${player.name}'s hand is discarded and refilled to ${player.hand.length} (${sourceLabel}).`);
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
  // Mission 7's Pilgrim hand-trap: once drawn into a hand, a Pilgrim card can never be discarded either — not to
  // cover damage, and not as part of a Feign Death (which requires discarding the WHOLE hand; a Pilgrim sitting
  // there makes that impossible on its own, exactly per the sourced rule that it "blocks Feign Death while held").
  if (state.pilgrimMechanic && cards.some((c) => c.kind === 'suited' && c.pilgrim)) {
    return fail('A Pilgrim card is dead weight — it cannot be discarded. Choose other cards to cover the damage.');
  }
  const discardTotal = cards.reduce((sum, c) => sum + cardValue(c), 0);
  const isEntireHand = cards.length === player.hand.length;
  // Legacy "Feign Death": discarding a full hand always succeeds, but only if you didn't play a card this turn
  // (so your hand wasn't reduced below your limit) — i.e. you yielded straight into this defend. Gated on the
  // literal whole hand (isEntireHand), so a Pilgrim sitting in hand makes Feign Death permanently unreachable —
  // its dead-weight card can never be part of that whole-hand discard (see the rejection above) — exactly the
  // sourced rule that Feign Death is blocked while a Pilgrim is held.
  const feignDeath =
    state.ruleset === 'legacy' &&
    isEntireHand &&
    cards.length > 0 &&
    player.hand.length === state.maxHandSize &&
    state.lastActionWasYield[state.currentPlayerIndex];

  // Mission 7: since a Pilgrim can never be offered up (see the rejection above), "your whole hand" is an
  // impossible bar to clear whenever one is held — the base insufficient-discard check below would otherwise
  // reject every possible DEFEND action outright, soft-locking the game. Once every OTHER (non-Pilgrim) card in
  // hand has been offered, that's the most this player is capable of discarding — treat it the same way the base
  // rule treats emptying a Pilgrim-free hand, so an insufficient defense still resolves as a normal loss below
  // instead of being stuck rejecting forever.
  const maxDischargeableCount = state.pilgrimMechanic
    ? player.hand.filter((c) => !(c.kind === 'suited' && c.pilgrim)).length
    : player.hand.length;
  const offeredEverythingDischargeable = cards.length === maxDischargeableCount;

  if (discardTotal < state.pendingDamage && !offeredEverythingDischargeable) {
    return fail(`That only covers ${discardTotal} of ${state.pendingDamage} damage — select more cards or everything you're able to discard.`);
  }

  const idSet = new Set(action.cardIds);
  player.hand = player.hand.filter((c) => !idSet.has(c.id));
  pushToDiscardPile(state, cards);

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

  // Bug-fix (see GameState.pendingJesterRefill / claimJester): this specific attack's damage is now fully
  // resolved — a claimed Jester's own hand-refill deferred past the defend above happens right here, using
  // whatever's left of the claimant's hand AFTER they chose how to cover the damage, never before.
  if (state.pendingJesterRefill && state.pendingJesterRefill.playerId === player.id) {
    state.pendingJesterRefill = null;
    refillHandFromDeck(state, player, 'the Jester');
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

/**
 * Legacy-only (Mission 8): places a card into the ascending mission zone (see GameState.ascendingZone).
 * SOURCED CORRECTION (fan-reimplementation rules doc, see GameAction's PLACE_IN_ZONE): the card comes from
 * `state.zoneCommittedPlay` — cards already committed to the kill's own winning attack — not from hand, and
 * placing one doesn't cost anything extra or end the turn; the player simply continues from wherever the kill
 * left them (usually still AWAIT_PLAY against a freshly revealed enemy).
 */
function placeInZone(state: GameState, action: Extract<GameAction, { type: 'PLACE_IN_ZONE' }>): EngineResult {
  if (!state.ascendingZone) return fail('There is no ascending mission zone in this mission.');
  if (state.zoneClosed) return fail('The mission zone has closed — no more cards can be placed there.');
  // Building the run only opens up right after an enemy kill (see GameState.zoneOpenForPlacement).
  if (!state.zoneOpenForPlacement) return fail('The mission zone can only be built onto right after defeating an enemy.');
  const err = requireCurrentPlayerTurn(state, action.playerId, 'AWAIT_PLAY');
  if (err) return fail(err);

  const player = currentPlayer(state);
  const card = state.zoneCommittedPlay.find((c) => c.id === action.cardId);
  if (!card) {
    return fail('That card is not available to place — only a card from the attack that just landed the kill can be used, at no extra cost.');
  }
  if (card.kind !== 'suited') return fail('Only a suited card can be placed in the mission zone.');

  // The chain's required next slot is tracked by POSITION (how many cards are already in the zone), not by the
  // top card's own printed value — the mission's one "2/5" wildcard can fill an out-of-order slot (placed as a 2
  // when the chain still needs a 5 later, or vice versa), which would desync a value-derived "top + 1" the
  // moment one lands (see rules.ts's matchesAscendingZoneSlot / GameState.ascendingZone's doc).
  const required = state.missionZone.length + 1;
  if (!matchesAscendingZoneSlot(card, required)) {
    return fail(`The mission zone needs a card worth exactly ${required} next — that card can't fill that slot.`);
  }

  state.zoneCommittedPlay = state.zoneCommittedPlay.filter((c) => c.id !== card.id);
  state.missionZone.push(card);
  state.lastActionWasYield[state.currentPlayerIndex] = false;

  if (card.pilgrim) {
    log(state, `${player.name} guides ${card.name ?? 'a survivor'} into place, straight from the attack just finished — the chain now stands at ${required}.`);
  } else if (card.flexibleComboRank) {
    log(state, `${player.name} slots the 2/5 wildcard into the gap at ${required}, straight from the attack just finished — it always counts for just 2 while it sits there.`);
  } else {
    log(state, `${player.name} presses ${card.name ?? `a ${card.rank}`} into the gap at ${required}, straight from the attack just finished — the enemy grows bolder while it sits there.`);
  }

  if (required === 10) {
    state.discardPile.push(...state.missionZone, ...state.zoneCommittedPlay);
    state.missionZone = [];
    state.zoneCommittedPlay = [];
    state.zoneImmuneSuits = [];
    return beginZonePurge(state, player);
  }

  return ok(state);
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
 * Legacy-only (Mission 8): runs whatever a chant's `onResolved` (see ChanterResolution) says to do once every
 * pending player has trimmed back down — either resolving the play's own deferred enemy-attack-back tail, or
 * restoring the turnPhase/pendingDamage dealDamageAndCheckDefeat had already resolved before the chant ran.
 */
function runChantResolution(state: GameState, onResolved: ChanterResolution): EngineResult {
  if (onResolved.kind === 'deferredAttack') return finishDeferredAttackTurn(state, onResolved.blockNextAttack);
  state.turnPhase = onResolved.turnPhase;
  state.pendingDamage = onResolved.pendingDamage;
  return ok(state);
}

/**
 * Legacy-only (Mission 8): opens (or immediately clears) a chant — every player at the table draws `count`
 * cards at once, even past their hand limit, then whoever's now over their limit trims back down one player at
 * a time via RESOLVE_CHANT. `onResolved` (see ChanterResolution) is carried through to whenever the chant's tail
 * finally runs — either right away, if nobody ended up over their limit, or once the last trim resolves.
 */
function beginChant(state: GameState, count: number, onResolved: ChanterResolution): EngineResult {
  const totalDrawn = state.players.reduce((sum, p) => sum + forceDrawCards(state, p, count), 0);
  if (totalDrawn > 0) log(state, `The chant draws ${totalDrawn} card(s) across the table.`);

  const pendingPlayerIds = state.players.filter((p) => p.hand.length > state.maxHandSize).map((p) => p.id);
  if (pendingPlayerIds.length === 0) {
    return runChantResolution(state, onResolved);
  }

  state.chanterWindow = { pendingPlayerIds, onResolved };
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

  const { onResolved } = state.chanterWindow;
  if (rest.length === 0) {
    state.chanterWindow = null;
    return runChantResolution(state, onResolved);
  }

  state.chanterWindow = { pendingPlayerIds: rest, onResolved };
  return ok(state);
}

/**
 * Legacy-only (Mission 6), gated by the 'AZURE_EMBLEM' relic, sourced fix: opens the Azure Emblem window after a
 * play that included a Mage card — the Mage's OWN player (the attacker, `attackerId`) may bank one of
 * `eligibleCardIds` (this play's Mage card(s), still sitting on the enemy's table) onto the reserve deck via
 * RESOLVE_AZURE_EMBLEM, instead of losing it to the discard pile whenever the enemy eventually falls. The
 * shipped version instead opened this for every OTHER player to place a card from their own hand — backwards on
 * both who benefits and what moves (per the official rules card, see legacy-missions-transcript-mismatches.md).
 * `blockNextAttack` mirrors a Guardian shield raised in the same play.
 */
function beginAzureEmblem(state: GameState, attackerId: string, eligibleCardIds: string[], blockNextAttack: boolean): EngineResult {
  state.azureEmblemWindow = { pendingPlayerIds: [attackerId], eligibleCardIds, blockNextAttack };
  state.turnPhase = 'AWAIT_AZURE_EMBLEM';
  log(state, "Azure Emblem: the Mage's own player may bank one of this play's Mage card(s) onto the reserve deck instead of losing it to the discard pile.");
  return ok(state);
}

/** Legacy-only (Mission 6): the attacking player resolves their own open Azure Emblem window (see GameState.azureEmblemWindow). */
function resolveAzureEmblem(state: GameState, action: Extract<GameAction, { type: 'RESOLVE_AZURE_EMBLEM' }>): EngineResult {
  if (state.turnPhase !== 'AWAIT_AZURE_EMBLEM' || !state.azureEmblemWindow) return fail('There is no open Azure Emblem window to resolve.');
  const { pendingPlayerIds, eligibleCardIds, blockNextAttack } = state.azureEmblemWindow;
  const [attackerId] = pendingPlayerIds;
  if (action.playerId !== attackerId) return fail("It's not your Azure Emblem window to resolve.");

  if (action.cardId) {
    if (!eligibleCardIds.includes(action.cardId)) return fail('That card is not eligible to bank via the Azure Emblem.');
    const enemy = state.currentEnemy!;
    const idx = enemy.tableCards.findIndex((c) => c.id === action.cardId);
    if (idx === -1) return fail('That card is no longer available to bank.');
    const [banked] = enemy.tableCards.splice(idx, 1);
    toReserveDeck(state, [banked], 'top');
    log(state, `${banked.kind === 'suited' ? banked.name ?? 'A Mage' : 'A Jester'} is banked onto the reserve deck instead of falling to the discard pile (Azure Emblem).`);
  }

  state.azureEmblemWindow = null;
  state.turnPhase = 'AWAIT_PLAY';
  return finishDeferredAttackTurn(state, blockNextAttack);
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
 * Mission 6 only, sourced fix: resolves the AWAIT_ZONE_VENGEANCE_CHOICE window opened by zoneVengeanceOnKill (see
 * dealDamageAndCheckDefeat). The official rules card and a fan digital-reimplementation's rules doc agree a
 * PLAYER chooses which single card, from the play area just committed to the kill (the defeated enemy's own
 * table), is sacrificed permanently into the mission zone — the shipped version instead auto-picked the
 * lowest-value card for them. Gated on turn ownership like CHOOSE_EXACT_KILL_RESCUE, since this opens mid-turn
 * for the player who just landed the kill. Resuming the rest of the defeat resolution is delegated to
 * finishEnemyDefeatTail, the same tail dealDamageAndCheckDefeat itself falls through to.
 */
function chooseZoneVengeanceSacrifice(
  state: GameState,
  action: Extract<GameAction, { type: 'CHOOSE_ZONE_VENGEANCE_SACRIFICE' }>,
): EngineResult {
  const err = requireCurrentPlayerTurn(state, action.playerId, 'AWAIT_ZONE_VENGEANCE_CHOICE');
  if (err) return fail(err);
  const pending = state.zoneVengeanceChoice;
  if (!pending) return fail('There is no open zone-vengeance choice to resolve.');

  const enemy = state.currentEnemy!;
  const idx = enemy.tableCards.findIndex((c) => c.id === action.cardId);
  if (idx === -1) return fail('That card is not available to sacrifice into the mission zone.');

  const [sacrificed] = enemy.tableCards.splice(idx, 1);
  state.missionZone.push(sacrificed);
  // A Mercenary "19" (see SuitedCard.noSuitPower) carries an inert placeholder suit and must never grant zone
  // immunity, same as every other suit-immunity-bookkeeping site it's excluded from.
  state.zoneImmuneSuits = Array.from(
    new Set(state.missionZone.flatMap((c) => (c.kind === 'suited' && !c.noSuitPower ? cardSuits(c) : []))),
  );
  log(state, `${sacrificed.kind === 'suited' ? sacrificed.name ?? `the ${sacrificed.rank}` : 'the Jester'} is drawn permanently into the mission zone.`);

  state.zoneVengeanceChoice = null;
  finishEnemyDefeatTail(state, enemy, pending.remaining, pending.attackIncludesGuardian);
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
    pendingJesterRefill: null,
    endlessLoop: 0,
    exactKillOnly: false,
    relics: [],
    comboAssist: null,
    kinfolkBankedThisTurn: false,
    azureEmblemWindow: null,
    endOfTurnZoneFlip: false,
    missionZone: [],
    zoneImmuneSuits: [],
    banishPile: [],
    jesterClaimNextPlayerOnly: false,
    discardTopBuffsAttack: false,
    exactKillToReserveDeck: false,
    corruptedReturnQueue: false,
    discardCleanupLowToHigh: false,
    exactKillSplashDamage: false,
    rollingZoneBonus: false,
    rollingZoneCards: [],
    zoneVengeanceOnKill: false,
    zoneVengeanceChoice: null,
    pilgrimMechanic: false,
    pilgrimDeck: [],
    pilgrimZone: [],
    ascendingZone: false,
    zoneOpenForPlacement: false,
    zoneCommittedPlay: [],
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
    case 'BANK_KINFOLK_CARD':
      return bankKinfolkCard(draft, action);
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
    case 'CHOOSE_ZONE_VENGEANCE_SACRIFICE':
      return chooseZoneVengeanceSacrifice(draft, action);
    case 'SURRENDER_CARD_TO_ZONE':
      return surrenderCardToZone(draft, action);
    case 'START_ENDLESS_ROUND':
      return startEndlessRound(draft);
    default:
      return fail('Unknown action.');
  }
}
