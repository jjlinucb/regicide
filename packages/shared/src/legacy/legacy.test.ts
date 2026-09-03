import { describe, expect, it } from 'vitest';
import { applyAction, createLobbyState, resolvedEnemyAttack } from '../game/engine.js';
import { makeRng } from '../game/deck.js';
import { cardSuits, missionZoneValueSum } from '../game/rules.js';
import type { Card, EngineResult, GameState, LegacyEnemySpec, SuitedCard } from '../game/types.js';
import { CLASS_THEME } from './classes.js';
import { buildMercenaryCard, buildMercenaryLoadout, MERCENARY_CATALOG, mercenaryCoinsForLosses } from './mercenaries.js';
import { getMission, MISSIONS, missionEnemiesToSpecs, type MissionEnemySpec } from './missions.js';
import {
  applyCorruptAnotherCard,
  applyDruidStickerChoice,
  applyExtraSuitByName,
  applyDualClassStickers,
  applyEvergreenUpgrade,
  applyGuardianStickerChoice,
  druidStickerEligible,
  applyMageSticker,
  applyReaverStickerChoice,
  applyReward,
  applyRestoredPartyCards,
  applySecondSuitByName,
  buildInitialParty,
  buildRecruitCard,
  guardianStickerEligible,
  reaverStickerEligible,
} from './party.js';

function suited(suit: SuitedCard['suit'], rank: SuitedCard['rank']): SuitedCard {
  return { id: `${suit}${rank}-${Math.random()}`, kind: 'suited', suit, rank };
}

function jester(): Card {
  return { id: `jester-${Math.random()}`, kind: 'jester' };
}

function startMission(n: number, enemies: LegacyEnemySpec[], jesterCount = 0): GameState {
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const names = Array.from({ length: n }, (_, i) => `Player ${i}`);
  const res = applyAction(createLobbyState(), {
    type: 'START_LEGACY_MISSION',
    playerIds: ids,
    playerNames: names,
    seed: 'legacy-test',
    party: buildInitialParty(),
    enemies,
    jesterCount,
  });
  if (!res.ok) throw new Error(res.error);
  return res.state;
}

/** Give the current player an exact hand and set the current enemy directly, for deterministic scenario tests. */
function rig(state: GameState, hand: Card[], enemy?: Partial<NonNullable<GameState['currentEnemy']>>): GameState {
  const s = structuredClone(state);
  s.players[s.currentPlayerIndex].hand = hand;
  if (enemy && s.currentEnemy) Object.assign(s.currentEnemy, enemy);
  return s;
}

function ensureOk(res: EngineResult): Extract<EngineResult, { ok: true }> {
  if (!res.ok) throw new Error(res.error);
  return res;
}

/**
 * Resolves an open AWAIT_REAVER_REVEAL_COUNT window (see GameState.reaverRevealCountChoice) by choosing the
 * maximum count offered — the pre-existing behavior every reveal test below was written against, before players
 * could choose to reveal fewer than the play's full combined value.
 */
function chooseMaxReaverRevealCount(state: GameState): GameState {
  const window = state.reaverRevealCountChoice;
  if (!window) throw new Error('No open Reaver reveal-count choice to resolve.');
  return ensureOk(
    applyAction(state, { type: 'CHOOSE_REAVER_REVEAL_COUNT', playerId: window.playerId, count: window.maxCount }),
  ).state;
}

describe('legacy: mission setup', () => {
  it('builds a mission state from a party + enemy list, ruleset legacy, named enemies', () => {
    const enemies: LegacyEnemySpec[] = [
      { name: 'Test Foe', suit: 'H', health: 20, attack: 10 },
      { name: 'Test Boss', suit: 'C', health: 30, attack: 15 },
    ];
    const state = startMission(2, enemies, 0);
    expect(state.ruleset).toBe('legacy');
    expect(state.currentEnemy?.name).toBe('Test Foe');
    expect(state.castleDeck.length).toBe(1);
    expect(state.castleDeck[0].name).toBe('Test Boss');
    // Party (40) + 0 jesters, dealt to hands, rest in reserve deck.
    const handCount = state.players.reduce((sum, p) => sum + p.hand.length, 0);
    expect(handCount + state.tavernDeck.length).toBe(40);
  });

  it('every non-standard-castle, non-corrupted-party-enemies mission has at least one enemy and converts cleanly to engine specs', () => {
    expect(MISSIONS.length).toBe(12);
    for (const mission of MISSIONS) {
      // Mission 10's enemies aren't a static list either — like standardCastle, its queue is built at mission
      // start instead (see GameState.corruptedPartyEnemies), so `enemies` is deliberately left empty.
      if (mission.standardCastle || mission.corruptedPartyEnemies) continue;
      expect(mission.enemies.length).toBeGreaterThan(0);
      const specs = missionEnemiesToSpecs(mission.enemies);
      for (const spec of specs) {
        expect(spec.health).toBeGreaterThan(0);
        expect(spec.attack).toBeGreaterThan(0);
      }
    }
    expect(getMission(1)?.title).toBeTruthy();
    expect(getMission(999)).toBeUndefined();
  });

  it('mission 1 ("Call to Arms") is the standard 12-enemy Castle deck, sends exact kills to the reserve deck, and rewards the Kinfolk Flute relic plus corrupting a card and the High Arcana recruit', () => {
    const mission1 = getMission(1)!;
    expect(mission1.title).toBe('Call to Arms');
    expect(mission1.standardCastle).toBe(true);
    expect(mission1.exactKillToReserveDeck).toBe(true);
    expect(mission1.reward.relics).toEqual(['KINFOLK_FLUTE']);
    expect(mission1.reward.corruptAnotherCard).toBe(true);
    expect(mission1.reward.recruits).toEqual([{ name: 'High Arcana', class: 'BARD', rank: '25' }]);
    const ids = ['p0'];
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ids,
      playerNames: ['Player 0'],
      seed: 'mission-1-test',
      party: buildInitialParty(),
      enemies: [],
      jesterCount: 0,
      standardCastle: true,
    });
    const state = ensureOk(res).state;
    expect(state.castleDeck.length + 1).toBe(12);
    expect(state.currentEnemy?.name).toBeUndefined();
  });

  it('mission 2 hydras are immune to two classes at once, only die to an exact hit, and reward Dual-class Stickers', () => {
    const mission2 = getMission(2)!;
    expect(mission2.exactKillOnly).toBe(true);
    expect(mission2.reward.dualClassStickers).toBe(4);
    const specs = missionEnemiesToSpecs(mission2.enemies);
    expect(specs.length).toBe(6);
    expect(specs.every((s) => s.secondSuit)).toBe(true);
    expect(specs.every((s) => s.health === 20 && s.attack === 10)).toBe(true);
  });

  it('mission 2 uses standing Jesters (not shuffled into the deck, usable anytime)', () => {
    const mission2 = getMission(2)!;
    expect(mission2.standingJesters).toBe(true);
  });

  it('mission 3 sidelines a party member, flips the mission zone every turn, and rewards 10 Mage recruits', () => {
    const mission3 = getMission(3)!;
    expect(mission3.sidelineCount).toBe(1);
    expect(mission3.endOfTurnZoneFlip).toBe(true);
    expect(mission3.reward.recruits.length).toBe(10);
    expect(mission3.reward.recruits.every((r) => r.class === 'MAGE')).toBe(true);
    expect(mission3.reward.recruits.map((r) => r.rank).sort()).toEqual(
      ['10', '2', '3', '4', '5', '6', '7', '8', '9', 'A'].sort(),
    );
  });

  it('mission 3 also uses standing Jesters, and sidelines High Arcana (Mission 12\'s final boss) out of the deck', () => {
    const mission3 = getMission(3)!;
    expect(mission3.standingJesters).toBe(true);
    expect(mission3.sidelineIdentity).toEqual({ suit: 'D', rank: '25' });
  });

  it('mission 3 is a 6-enemy exact-kill-only gauntlet escalating in three stat tiers', () => {
    const mission3 = getMission(3)!;
    expect(mission3.enemies).toHaveLength(6);
    expect(mission3.exactKillOnly).toBe(true);
    expect(mission3.enemies.map((e) => [e.health, e.attack])).toEqual([
      [30, 10],
      [30, 10],
      [30, 10],
      [40, 15],
      [40, 15],
      [60, 20],
    ]);
  });

  it('mission 4 buffs enemy attack from the discard pile, seals exact kills to the reserve deck, and rewards Beast Companions + Goran + the Scarlet Whistle relic', () => {
    const mission4 = getMission(4)!;
    expect(mission4.discardTopBuffsAttack).toBe(true);
    expect(mission4.exactKillToReserveDeck).toBe(true);
    expect(mission4.discardCleanupLowToHigh).toBe(true);
    expect(mission4.reward.relics).toEqual(['SCARLET_WHISTLE']);
    expect(mission4.reward.recruits.length).toBe(5);
    expect(mission4.reward.recruits.filter((r) => r.beast).length).toBe(4);
    // "Dr. Darkness" story card (John's photo of the physical campaign book): corrupts one random existing
    // party member — reuses the corruptAnotherCard reward step Missions 1/5/8 already use.
    expect(mission4.reward.corruptAnotherCard).toBe(true);
    // SOURCED FIX (a full solo playthrough — see tutorial_vids/summaries/mission-4.md): Goran also joins here,
    // not (only) at Mission 8 as an earlier, shorter source had this codebase deferred to.
    const goran = mission4.reward.recruits.find((r) => r.name === 'Goran');
    expect(goran?.class).toBe('PALADIN');
    expect(goran?.rank).toBe('8');
  });
});

describe('legacy: mission 2 enemy order is randomized per attempt (unsourced judgment call)', () => {
  function enemyOrder(state: GameState): (string | undefined)[] {
    return [state.currentEnemy?.name, ...state.castleDeck.map((e) => e.name)];
  }

  function startWithSeed(enemies: MissionEnemySpec[], seed: string, randomizeEnemyOrder?: boolean): GameState {
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ['p0'],
      playerNames: ['Player 0'],
      seed,
      party: buildInitialParty(),
      enemies: missionEnemiesToSpecs(enemies),
      jesterCount: 0,
      randomizeEnemyOrder,
    });
    return ensureOk(res).state;
  }

  it('mission 2 fights its 6 hydra heads in a shuffled order that changes across seeds, including retries', () => {
    const mission2 = getMission(2)!;
    expect(mission2.randomizeEnemyOrder).toBe(true);
    const originalOrder = mission2.enemies.map((e) => e.name);
    const seeds = ['retry-a', 'retry-b', 'retry-c', 'retry-d', 'retry-e'];
    const orders = seeds.map((seed) => enemyOrder(startWithSeed(mission2.enemies, seed, mission2.randomizeEnemyOrder)));
    // Every produced order is still a permutation of the same 6 heads — nothing is dropped, duplicated, or renamed.
    for (const order of orders) {
      expect([...order].sort()).toEqual([...originalOrder].sort());
    }
    // At least one seed must diverge from the mission's own fixed source order (guards against a no-op shuffle).
    // Checked across several seeds so this isn't flaky on the rare chance one shuffle lands back on the original.
    expect(orders.some((order) => order.join('|') !== originalOrder.join('|'))).toBe(true);
    // And at least two seeds must diverge from EACH OTHER — proves each retry gets its own fresh shuffle rather
    // than one fixed "randomized" order applied every time.
    expect(new Set(orders.map((o) => o.join('|'))).size).toBeGreaterThan(1);
  });

  it('mission 3, a mission with a fixed/sourced enemy order, still fights the identical sequence across seeds', () => {
    const mission3 = getMission(3)!;
    expect(mission3.randomizeEnemyOrder).toBeUndefined();
    const originalOrder = mission3.enemies.map((e) => e.name);
    for (const seed of ['retry-a', 'retry-b', 'retry-c']) {
      const order = enemyOrder(startWithSeed(mission3.enemies, seed, mission3.randomizeEnemyOrder));
      expect(order).toEqual(originalOrder);
    }
  });

  it("mission 1's standardCastle path ignores randomizeEnemyOrder entirely (no `enemies` list to shuffle)", () => {
    const mission1 = getMission(1)!;
    expect(mission1.standardCastle).toBe(true);
    expect(mission1.randomizeEnemyOrder).toBeUndefined();
  });
});

describe('legacy: mission 5 enemy tier order is randomized within each 4-enemy tier (unsourced judgment call)', () => {
  function enemyOrder(state: GameState): (string | undefined)[] {
    return [state.currentEnemy?.name, ...state.castleDeck.map((e) => e.name)];
  }

  function startWithSeed(enemies: MissionEnemySpec[], seed: string, randomizeEnemyTierOrder?: boolean): GameState {
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ['p0'],
      playerNames: ['Player 0'],
      seed,
      party: buildInitialParty(),
      enemies: missionEnemiesToSpecs(enemies),
      jesterCount: 0,
      randomizeEnemyTierOrder,
    });
    return ensureOk(res).state;
  }

  it('mission 5 fights each 4-enemy tier in a shuffled order that changes across seeds, but never lets tier 2 precede tier 1', () => {
    const mission5 = getMission(5)!;
    expect(mission5.randomizeEnemyTierOrder).toBe(true);
    const weakTierNames = mission5.enemies.slice(0, 4).map((e) => e.name);
    const strongTierNames = mission5.enemies.slice(4, 8).map((e) => e.name);
    const originalOrder = mission5.enemies.map((e) => e.name);
    const seeds = ['retry-a', 'retry-b', 'retry-c', 'retry-d', 'retry-e'];
    const orders = seeds.map((seed) => enemyOrder(startWithSeed(mission5.enemies, seed, mission5.randomizeEnemyTierOrder)));
    for (const order of orders) {
      // Still a permutation of the same 8 enemies — nothing dropped, duplicated, or renamed.
      expect([...order].sort()).toEqual([...originalOrder].sort());
      // Every weak-tier enemy still fights before every strong-tier enemy.
      const weakIndices = weakTierNames.map((name) => order.indexOf(name));
      const strongIndices = strongTierNames.map((name) => order.indexOf(name));
      expect(Math.max(...weakIndices)).toBeLessThan(Math.min(...strongIndices));
    }
    // At least one seed must diverge from the mission's own fixed source order (guards against a no-op shuffle).
    expect(orders.some((order) => order.join('|') !== originalOrder.join('|'))).toBe(true);
    // And at least two seeds must diverge from EACH OTHER — proves each retry gets its own fresh shuffle rather
    // than one fixed "randomized" order applied every time.
    expect(new Set(orders.map((o) => o.join('|'))).size).toBeGreaterThan(1);
  });
});

describe('legacy: exact-kill-only recycling (hydra mission)', () => {
  const hydra: LegacyEnemySpec = { name: 'Test Hydra', suit: 'H', secondSuit: 'D', health: 20, attack: 10 };

  function startExactKillMission(enemies: LegacyEnemySpec[]): GameState {
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ['p0'],
      playerNames: ['Player 0'],
      seed: 'hydra-test',
      party: buildInitialParty(),
      enemies,
      jesterCount: 0,
      exactKillOnly: true,
    });
    return ensureOk(res).state;
  }

  it('is immune to both of its classes (blocks the class power, not the raw damage)', () => {
    let state = startExactKillMission([hydra]);
    state = rig(state, [suited('D', '5')]); // Diamonds = hydra's secondSuit
    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: state.players[0].hand.map((c) => c.id) }));
    state = res.state;
    expect(state.currentEnemy?.damageTaken).toBe(5); // damage still lands
    expect(state.log.some((e) => e.message.includes('blocked'))).toBe(true); // but the Diamonds draw power is blocked
  });

  it('overkilling a hydra recycles it to the back of the line with wounds healed, instead of defeating it', () => {
    let state = startExactKillMission([hydra, { name: 'Second Hydra', suit: 'C', health: 15, attack: 5 }]);
    state = rig(state, [suited('C', '10')], { damageTaken: 15 }); // 15 already taken, +10 overkills a 20-health hydra
    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: state.players[0].hand.map((c) => c.id) }));
    state = res.state;
    expect(state.currentEnemy?.name).toBe('Second Hydra'); // moved on to the next enemy
    expect(state.castleDeck.length).toBe(1);
    expect(state.castleDeck[0].name).toBe('Test Hydra'); // recycled to the back, not discarded
    expect(state.castleDeck[0].damageTaken).toBe(0); // wounds healed
  });

  it('an exact hit permanently defeats a hydra instead of recycling it', () => {
    let state = startExactKillMission([hydra]);
    state = rig(state, [suited('S', '10')], { damageTaken: 10 }); // Spades doesn't double damage — exactly lethal
    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: state.players[0].hand.map((c) => c.id) }));
    state = res.state;
    expect(state.phase).toBe('WON');
  });

  it('a forced play (YIELD rejected because everyone else already yielded) that overkills defeats the enemy for real, instead of recycling it', () => {
    // Same overkill setup as the voluntary-overkill test above (15 taken, +10 overkills a 20-health hydra), but
    // with a second player whose last action was a yield — so allOtherPlayersYieldedLastTurn is true and the
    // current player has no legal way to yield instead of playing.
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ['p0', 'p1'],
      playerNames: ['Player 0', 'Player 1'],
      seed: 'hydra-forced-test',
      party: buildInitialParty(),
      enemies: [hydra, { name: 'Second Hydra', suit: 'C', health: 15, attack: 5 }],
      jesterCount: 0,
      exactKillOnly: true,
    });
    let state = ensureOk(res).state;
    state = rig(state, [suited('C', '10')], { damageTaken: 15 });
    state.lastActionWasYield[1] = true; // Player 1 (the only other player) already yielded last turn

    // YIELD is rejected outright — the current player has no legal way to pass.
    const yieldRes = applyAction(state, { type: 'YIELD', playerId: state.players[0].id });
    expect(yieldRes.ok).toBe(false);

    // Forced to play instead: this overkills the hydra by 5, but since the player never had a real choice, the
    // enemy must go down for good rather than shrugging it off and healing back up.
    const playRes = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: state.players[0].hand.map((c) => c.id) }),
    );
    state = playRes.state;
    expect(state.currentEnemy?.name).toBe('Second Hydra'); // moved on to the next enemy
    expect(state.castleDeck.length).toBe(0); // NOT recycled to the back of the line (contrast: 1, healed, above)
    expect(state.log.some((e) => e.message.includes('shrugs off the overkill'))).toBe(false);
    expect(state.log.some((e) => e.message.includes('overwhelmed by the forced attack'))).toBe(true);
  });
});

describe('legacy: feign death', () => {
  const enemy: LegacyEnemySpec = { name: 'Brute', suit: 'S', health: 100, attack: 20 };

  it('succeeds discarding a full hand short of the damage, but only after a yield at hand limit', () => {
    let state = startMission(1, [enemy]);
    state = rig(state, [suited('D', '2'), suited('D', '3')]); // hand of 2, well under maxHandSize(8)... force limit below
    state.maxHandSize = 2; // pretend this player's limit is 2, so they're "at hand limit"
    let res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));
    state = res.state;
    expect(state.turnPhase).toBe('AWAIT_DEFEND');
    expect(state.pendingDamage).toBe(20);

    // Discard the whole (still-full) hand — total value only 5, far short of 20 — should succeed via Feign Death.
    res = ensureOk(applyAction(state, { type: 'DEFEND', playerId: state.players[0].id, cardIds: state.players[0].hand.map((c) => c.id) }));
    state = res.state;
    expect(state.phase).toBe('IN_PROGRESS');
    expect(state.lossReason).toBeNull();
  });

  it('fails (normal loss) if the player played a card this turn instead of yielding', () => {
    let state = startMission(1, [enemy]);
    state = rig(state, [suited('D', '2'), suited('D', '3')]);
    state.maxHandSize = 3;
    // Play a small card first (not a yield) — this leaves the player below their hand limit.
    let res: EngineResult = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = (res as any).state;
    expect(state.turnPhase).toBe('AWAIT_DEFEND');

    res = applyAction(state, { type: 'DEFEND', playerId: state.players[0].id, cardIds: state.players[0].hand.map((c) => c.id) });
    expect(res.ok).toBe(true);
    state = (res as any).state;
    expect(state.phase).toBe('LOST'); // no Feign Death: last action wasn't a yield
  });

  it('fails if the entire hand is discarded but the player was not at their hand-size limit', () => {
    let state = startMission(1, [enemy]);
    state = rig(state, [suited('D', '2')]); // only 1 card, but maxHandSize stays at the default (8) — not "at limit"
    let res: EngineResult = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));
    state = (res as any).state;
    res = applyAction(state, { type: 'DEFEND', playerId: state.players[0].id, cardIds: state.players[0].hand.map((c) => c.id) });
    expect(res.ok).toBe(true);
    state = (res as any).state;
    expect(state.phase).toBe('LOST'); // whole hand discarded, but not at hand limit — Feign Death doesn't apply
  });

  it('is not available in classic Regicide (ruleset gate)', () => {
    let state = startMission(1, [enemy]);
    state.ruleset = 'regicide';
    state = rig(state, [suited('D', '2'), suited('D', '3')]);
    state.maxHandSize = 2;
    let res: EngineResult = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));
    state = (res as any).state;
    res = applyAction(state, { type: 'DEFEND', playerId: state.players[0].id, cardIds: state.players[0].hand.map((c) => c.id) });
    expect(res.ok).toBe(true);
    state = (res as any).state;
    expect(state.phase).toBe('LOST');
  });
});

describe('legacy: jester claim', () => {
  it('lets any player claim an open jester for a free 8-strength attack that ignores immunity, and spares them the enemy\'s counter-attack entirely (John\'s house rule, stacking on top of the free attack + hand refill)', () => {
    // Cleric-class enemy (suit H) — immune to Cleric (Hearts) powers until the claimed attack ignores it. Health
    // is high enough to survive the 8-strength attack, so it would normally retaliate for its own attack (5).
    const enemy: LegacyEnemySpec = { name: 'Warden', suit: 'H', health: 100, attack: 5 };
    let state = startMission(2, [enemy], 0);
    const [p1, p2] = state.players;

    const j = jester();
    state = rig(state, [j]);
    let res = ensureOk(applyAction(state, { type: 'PLAY_JESTER', playerId: p1.id, cardId: j.id }));
    state = res.state;
    expect(state.turnPhase).toBe('AWAIT_JESTER_CLAIM');
    expect(state.jesterClaim?.claimedBy).toBeNull();

    const untouchedDiscard = [suited('C', '2'), suited('C', '3'), suited('C', '4')];
    state.discardPile = untouchedDiscard;
    const oldHand = [suited('S', '5')];
    state.players[1].hand = oldHand;

    // Player 2 (not the jester's player) claims it — a flat, suit-less attack that ignores this Hearts-class
    // enemy's own-class immunity, and does NOT trigger any class power (see resolveJesterAttack).
    res = ensureOk(applyAction(state, { type: 'CLAIM_JESTER', playerId: p2.id }));
    state = res.state;

    expect(state.jesterClaim).toBeNull(); // consumed
    expect(state.currentEnemy?.damageTaken).toBe(8); // flat 8-strength attack, no class power doubling it
    expect(state.currentEnemy?.immunityBroken).toBe(false); // one-shot only — NOT a permanent break like classic Regicide

    // The enemy survived (100 health) and would normally retaliate for its own attack (5) — but the claimed
    // Jester spares that counter-attack entirely: no Defend owed, the turn moves straight on to player 1.
    expect(state.turnPhase).not.toBe('AWAIT_DEFEND');
    expect(state.pendingDamage).toBe(0);
    expect(state.currentPlayerIndex).toBe(0);

    // The base game's own printed Jester power still refreshes the claimant's hand — immediately, since there's
    // no Defend left to defer it past.
    expect(state.players[1].hand.length).toBe(state.maxHandSize);
    expect(state.players[1].hand.some((c) => c.id === oldHand[0].id)).toBe(false);
    expect(state.discardPile.some((c) => c.id === oldHand[0].id)).toBe(true);
  });

  it('rejects PLAY_JESTER/CLAIM_JESTER outside Regicide Legacy', () => {
    const enemy: LegacyEnemySpec = { name: 'Warden', suit: 'H', health: 100, attack: 1 };
    let state = startMission(1, [enemy], 0);
    state.ruleset = 'regicide';
    const j = jester();
    state = rig(state, [j]);
    const res = applyAction(state, { type: 'PLAY_JESTER', playerId: state.players[0].id, cardId: j.id });
    expect(res.ok).toBe(false);
  });

  it('a claimed Jester never redeems a Paladin/dual-immune enemy\'s already-banked Spades value (one-shot only, unlike classic Regicide)', () => {
    // Dual immune, Paladin-class (Spades) among them — the shape of the dual-immune bosses (Mission 3, Mission
    // 12's original Hierarch, etc.) that actually surfaced this interaction: a Spades play against a Paladin
    // (or dual-immune) enemy banks into blockedSpadesShield instead of applying, and — per resolveSuitPowers's
    // own doc comment and this suite's "not a permanent immunity break" case above — nothing in Legacy ever sets
    // enemy.immunityBroken, so that banked value can never convert into real spadesShield the way classic
    // Regicide's Jester (activateJester) would (see engine.test.ts's mirror-image "retroactively activates"
    // case). Regression coverage for the fix: the blocked-Spades log message must not promise a payoff under
    // Legacy that structurally can never happen.
    const enemy: LegacyEnemySpec = { name: 'Ironclad Warden', suit: 'S', secondSuit: 'H', health: 100, attack: 5 };
    let state = startMission(2, [enemy], 0);
    const [p1, p2] = state.players;

    // Player 1 plays a Spades card against the Paladin-immune enemy — blocked and banked, not applied.
    const spadeCard = suited('S', '5');
    state = rig(state, [spadeCard]);
    let logLenBefore = state.log.length;
    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: p1.id, cardIds: [spadeCard.id] }));
    state = res.state;
    expect(state.currentEnemy?.spadesShield).toBe(0);
    expect(state.currentEnemy?.blockedSpadesShield).toBe(5);
    let newLogs = state.log.slice(logLenBefore).map((e) => e.message);
    expect(newLogs.some((m) => m.includes('blocked'))).toBe(true);
    // THE FIX: Legacy has no mechanism that can ever redeem this, so the log must not claim otherwise.
    expect(newLogs.some((m) => m.includes('banked for later'))).toBe(false);

    // Cover the counterattack so play passes to player 2.
    state = rig(state, [suited('D', '9')]);
    res = ensureOk(applyAction(state, { type: 'DEFEND', playerId: p1.id, cardIds: [state.players[state.currentPlayerIndex].hand[0].id] }));
    state = res.state;
    expect(state.currentPlayerIndex).toBe(1);

    // Player 2 plays the Jester into the open, then claims it themselves: a flat, suit-less 8-strength attack
    // (so it can't be confused with a fresh Spades play, and doesn't trigger any class power) plus a full hand
    // refill.
    const j = jester();
    state = rig(state, [j]);
    res = ensureOk(applyAction(state, { type: 'PLAY_JESTER', playerId: p2.id, cardId: j.id }));
    state = res.state;
    res = ensureOk(applyAction(state, { type: 'CLAIM_JESTER', playerId: p2.id }));
    state = res.state;

    // The claim resolves (8 damage dealt, on top of the 5 already dealt = 13) but does NOT retroactively unlock
    // the value banked before it, and does not permanently break immunity either.
    expect(state.currentEnemy?.damageTaken).toBe(13);
    expect(state.currentEnemy?.immunityBroken).toBe(false);
    expect(state.currentEnemy?.blockedSpadesShield).toBe(5);
    expect(state.currentEnemy?.spadesShield).toBe(0);

    // The claimed Jester also spares p2 the enemy's own counter-attack (5) entirely — no Defend owed, so play
    // passes straight back to player 1.
    expect(state.turnPhase).not.toBe('AWAIT_DEFEND');
    expect(state.currentPlayerIndex).toBe(0);

    // Proof this is a genuine dead end, not just a bookkeeping quirk: immunity is still fully live afterward — a
    // brand new Spades play still gets blocked and banked on top, exactly as if the Jester had never been claimed.
    const spadeCard2 = suited('S', '3');
    state = rig(state, [spadeCard2]);
    logLenBefore = state.log.length;
    res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: p1.id, cardIds: [spadeCard2.id] }));
    state = res.state;
    expect(state.currentEnemy?.blockedSpadesShield).toBe(8); // 5 (still stuck from before the claim) + 3 (freshly blocked)
    expect(state.currentEnemy?.spadesShield).toBe(0);
    expect(state.currentEnemy?.immunityBroken).toBe(false);
    newLogs = state.log.slice(logLenBefore).map((e) => e.message);
    expect(newLogs.some((m) => m.includes('banked for later'))).toBe(false);
  });
});

describe('legacy: jester claim discard-cleanup low-to-high ordering (bug-fix)', () => {
  it("sorts the claimant's discarded old hand low-to-high on the discard pile when discardCleanupLowToHigh is set, same as a normal covered DEFEND", () => {
    // Health low enough that the flat 8-strength claim attack overkills it outright — no defend to resolve
    // first, so the refill (and its discard) fires immediately inside claimJester itself. A second enemy keeps
    // the mission IN_PROGRESS after that kill (defeating the party's only remaining enemy would WON the mission
    // instead, and claimJester's own pre-existing "nothing left to resolve" early-return skips the refill
    // entirely once the game's already over — not what this test is trying to isolate).
    const enemy: LegacyEnemySpec = { name: 'Weakling', suit: 'S', health: 5, attack: 1 };
    const filler: LegacyEnemySpec = { name: 'Filler', suit: 'D', health: 50, attack: 1 };
    const res0 = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ['p0'],
      playerNames: ['Player 0'],
      seed: 'jester-cleanup-test',
      party: buildInitialParty(),
      enemies: [enemy, filler],
      jesterCount: 0,
      discardCleanupLowToHigh: true,
    });
    if (!res0.ok) throw new Error(res0.error);
    let state = res0.state;

    const j = jester();
    const oldHand = [suited('H', '9'), suited('C', '4'), suited('D', '7')];
    state.players[0].hand = [j, ...oldHand];
    const playerId = state.players[0].id;

    let res = ensureOk(applyAction(state, { type: 'PLAY_JESTER', playerId, cardId: j.id }));
    state = res.state;
    res = ensureOk(applyAction(state, { type: 'CLAIM_JESTER', playerId }));
    state = res.state;

    expect(state.currentEnemy?.name).not.toBe('Weakling'); // defeated — a new enemy (or WON) follows
    // The claimant's OLD hand (9, 4, 7) was discarded by the refill — sorted low-to-high, lowest value on top,
    // the same ordering rule Missions 4/11/12's pileTopEnemyBonus-style mechanics depend on (see
    // engine.ts's pushToDiscardPile). Filtered to just this batch since the defeated enemy's own Jester card
    // also lands in the discard pile as a separate, earlier (single-card) push.
    const oldHandIds = new Set(oldHand.map((c) => c.id));
    const oldHandInDiscard = state.discardPile.filter((c) => oldHandIds.has(c.id));
    expect(oldHandInDiscard.map((c) => (c.kind === 'suited' ? c.rank : 'jester'))).toEqual(['9', '7', '4']);
    const top = state.discardPile[state.discardPile.length - 1];
    expect(top.kind === 'suited' && top.rank).toBe('4'); // lowest of the whole pile, regardless of claim order
  });
});

describe('legacy: party & rewards', () => {
  it('starts with the standard 40-card roster, all named', () => {
    const party = buildInitialParty();
    expect(party.length).toBe(40);
    expect(party.every((c) => c.kind === 'suited' && typeof c.name === 'string' && c.name.length > 0)).toBe(true);
  });

  it('applies a mission reward by adding named recruits mapped to the right class/suit', () => {
    const party = buildInitialParty();
    const grown = applyReward(party, { recruits: [{ name: 'Test Recruit', class: 'WARRIOR', rank: '5' }] });
    expect(grown.length).toBe(41);
    const recruitCard = grown[grown.length - 1];
    expect(recruitCard.kind).toBe('suited');
    if (recruitCard.kind === 'suited') {
      expect(recruitCard.suit).toBe(CLASS_THEME.WARRIOR.suit);
      expect(recruitCard.name).toBe('Test Recruit');
    }
    // Original party is untouched (pure function).
    expect(party.length).toBe(40);
  });

  it('grants a special reward its class signature ability, and leaves it off a normal reward', () => {
    const specialCard = buildRecruitCard({ name: 'Champion', class: 'WARRIOR', rank: '10', special: true });
    expect(specialCard.kind).toBe('suited');
    if (specialCard.kind === 'suited') expect(specialCard.special).toBe(CLASS_THEME.WARRIOR.specialAbility);

    const normalCard = buildRecruitCard({ name: 'Regular', class: 'WARRIOR', rank: '5' });
    expect(normalCard.kind).toBe('suited');
    if (normalCard.kind === 'suited') expect(normalCard.special).toBeUndefined();
  });

  it('every mission-reward special recruit is tagged with a class matching its own signature ability', () => {
    const specials = MISSIONS.flatMap((m) => m.reward.recruits).filter((r) => r.special);
    expect(specials.length).toBeGreaterThan(0);
    for (const r of specials) {
      const card = buildRecruitCard(r);
      expect(card.kind === 'suited' && card.special).toBe(CLASS_THEME[r.class].specialAbility);
    }
  });

  it('a Mage recruit takes its explicit suit (Mage has none of its own) and is flagged arcane', () => {
    const card = buildRecruitCard({ name: 'Test Mage', class: 'MAGE', rank: '5', suit: 'D' });
    expect(card.kind).toBe('suited');
    if (card.kind === 'suited') {
      expect(card.suit).toBe('D');
      expect(card.arcane).toBe(true);
    }
  });

  it('throws building a Mage recruit with no suit given', () => {
    expect(() => buildRecruitCard({ name: 'No Suit Mage', class: 'MAGE', rank: '5' })).toThrow();
  });

  it('Mission 3 introduces the Mage class as its reward', () => {
    const recruits = getMission(3)?.reward.recruits ?? [];
    expect(recruits.length).toBeGreaterThan(0);
    expect(recruits.every((r) => r.class === 'MAGE')).toBe(true);
  });
});

describe('legacy: mission playthrough', () => {
  it('defeats a single-enemy mission and reaches WON', () => {
    // Non-Clubs enemy so an 8 of Clubs isn't immune, and doubles to defeat 16 health exactly.
    const enemy: LegacyEnemySpec = { name: 'Training Dummy', suit: 'H', health: 16, attack: 1 };
    let state = startMission(1, [enemy]);
    const club8 = suited('C', '8');
    state = rig(state, [club8]);
    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [club8.id] }));
    state = res.state;
    expect(state.phase).toBe('WON');
    expect(state.currentEnemy).toBeNull();
    expect(state.victoryMedal).toBeNull(); // Legacy doesn't use Regicide's solo victory-medal scoring
  });

  it("a Mage's reveal lets the player tuck a chosen card under the attack, adding its value and bypassing its own suit's immunity", () => {
    // Enemy is immune to Hearts (its own suit) — the Mage card is Hearts-suited, so a base Cleric play would be
    // blocked, but a Mage's power isn't a suit power, so its reveal (and the chosen card's bonus) lands anyway.
    const enemy: LegacyEnemySpec = { name: 'Warded Foe', suit: 'H', health: 30, attack: 1 };
    let state = startMission(1, [enemy]);
    const mage7: SuitedCard = { ...suited('H', '7'), arcane: true };
    state = rig(state, [mage7]);
    const chosen = suited('D', '5');
    // Fully controls the reveal (7 cards, the play's own attack strength) so the outcome is deterministic.
    state.tavernDeck = [suited('S', '2'), suited('C', '2'), suited('S', '3'), chosen, suited('C', '3'), suited('S', '4'), suited('C', '4')];

    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [mage7.id] }));
    state = res.state;
    expect(state.turnPhase).toBe('AWAIT_MAGE_REVEAL');
    expect(state.mageReveal?.candidates.length).toBe(7);

    res = ensureOk(applyAction(state, { type: 'CHOOSE_MAGE_REVEAL_CARD', playerId: state.players[0].id, cardId: chosen.id }));
    state = res.state;
    // 7 from the normal play (no Clubs doubling) + 5 from the chosen reveal card = 12, no heal triggered.
    expect(state.currentEnemy?.damageTaken).toBe(12);
    expect(state.mageReveal).toBeNull();
    expect(state.turnPhase).toBe('AWAIT_DEFEND');
    // Every candidate not chosen falls to the discard pile.
    expect(state.discardPile.some((c) => c.kind === 'suited' && c.suit === 'S' && c.rank === '2')).toBe(true);
  });

  it("multiple Mages in one combo each trigger their own independent reveal, at the play's own total strength", () => {
    const enemy: LegacyEnemySpec = { name: 'Combo Target', suit: 'S', health: 100, attack: 1 };
    let state = startMission(1, [enemy]);
    const mageA: SuitedCard = { ...suited('H', '4'), arcane: true };
    const mageB: SuitedCard = { ...suited('D', '4'), arcane: true };
    state = rig(state, [mageA, mageB]);
    const chosenFirst = suited('S', '5');
    const chosenSecond = suited('S', '6');
    // 16 filler cards: the first 8 (play total 4+4=8) feed mageA's own reveal, the next 8 feed mageB's.
    state.tavernDeck = [
      suited('H', '2'), suited('D', '2'), suited('C', '2'), chosenFirst, suited('H', '3'), suited('D', '3'), suited('C', '3'), suited('H', '9'),
      suited('D', '9'), suited('C', '9'), suited('H', '8'), suited('D', '8'), chosenSecond, suited('C', '8'), suited('H', '7'), suited('D', '7'),
    ];

    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [mageA.id, mageB.id] }));
    state = res.state;
    expect(state.turnPhase).toBe('AWAIT_MAGE_REVEAL');
    expect(state.mageReveal?.candidates.length).toBe(8);

    res = ensureOk(applyAction(state, { type: 'CHOOSE_MAGE_REVEAL_CARD', playerId: state.players[0].id, cardId: chosenFirst.id }));
    state = res.state;
    expect(state.turnPhase).toBe('AWAIT_MAGE_REVEAL'); // mageB's own reveal opens next
    expect(state.mageReveal?.candidates.length).toBe(8);

    res = ensureOk(applyAction(state, { type: 'CHOOSE_MAGE_REVEAL_CARD', playerId: state.players[0].id, cardId: chosenSecond.id }));
    state = res.state;
    // Normal combo damage 4+4=8, plus 5 (mageA's chosen card) and 6 (mageB's chosen card) = 19.
    expect(state.currentEnemy?.damageTaken).toBe(19);
  });

  it("Arcane Surge doubles a Mage's own reveal count (unsourced for this mechanic — no recruit currently sets it)", () => {
    const enemy: LegacyEnemySpec = { name: 'Combo Target', suit: 'S', health: 100, attack: 1 };
    let state = startMission(1, [enemy]);
    const surged: SuitedCard = { ...suited('H', '4'), arcane: true, special: 'ARCANE_SURGE' };
    state = rig(state, [surged]);
    state.tavernDeck = [
      suited('S', '2'), suited('D', '2'), suited('S', '3'), suited('D', '3'), suited('S', '4'), suited('D', '4'), suited('S', '5'), suited('D', '5'),
    ];

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [surged.id] }));
    state = res.state;
    expect(state.turnPhase).toBe('AWAIT_MAGE_REVEAL');
    expect(state.mageReveal?.candidates.length).toBe(8); // doubled from the card's own value (4)
  });

  it('chains the reveal at the chosen card\'s own strength when it\'s itself a Mage', () => {
    const enemy: LegacyEnemySpec = { name: 'Combo Target', suit: 'S', health: 100, attack: 1 };
    let state = startMission(1, [enemy]);
    const mage3: SuitedCard = { ...suited('H', '3'), arcane: true };
    state = rig(state, [mage3]);
    const chainedMage: SuitedCard = { ...suited('D', '5'), arcane: true };
    state.tavernDeck = [suited('S', '2'), suited('C', '2'), chainedMage];
    const chainedChosen = suited('S', '6');
    // Appended once the first reveal (3 cards) is consumed — the chain reveal pulls the next 5 (chainedMage's own value).
    state.tavernDeck.push(suited('C', '3'), suited('S', '4'), chainedChosen, suited('C', '4'), suited('S', '5'));

    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [mage3.id] }));
    state = res.state;
    expect(state.mageReveal?.candidates.length).toBe(3);

    res = ensureOk(applyAction(state, { type: 'CHOOSE_MAGE_REVEAL_CARD', playerId: state.players[0].id, cardId: chainedMage.id }));
    state = res.state;
    // The chosen card is itself a Mage (value 5) — the reveal chains, pulling 5 more cards.
    expect(state.turnPhase).toBe('AWAIT_MAGE_REVEAL');
    expect(state.mageReveal?.candidates.length).toBe(5);

    res = ensureOk(applyAction(state, { type: 'CHOOSE_MAGE_REVEAL_CARD', playerId: state.players[0].id, cardId: chainedChosen.id }));
    state = res.state;
    // 3 (play) + 5 (chained Mage tucked under) + 6 (final chosen card) = 14.
    expect(state.currentEnemy?.damageTaken).toBe(14);
  });

  it('discards any Jesters/corrupted cards found in a Mage reveal instead of offering them as choices', () => {
    const enemy: LegacyEnemySpec = { name: 'Combo Target', suit: 'S', health: 100, attack: 1 };
    let state = startMission(1, [enemy]);
    const mage4: SuitedCard = { ...suited('H', '4'), arcane: true };
    state = rig(state, [mage4]);
    const corrupted: SuitedCard = { ...suited('D', '9'), corrupted: true };
    state.tavernDeck = [jester(), corrupted, suited('S', '2'), suited('C', '2')];

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [mage4.id] }));
    state = res.state;
    expect(state.turnPhase).toBe('AWAIT_MAGE_REVEAL');
    expect(state.mageReveal?.candidates.length).toBe(2); // Jester and corrupted card set aside
    expect(state.mageReveal?.candidates.some((c) => c.corrupted)).toBe(false);
    expect(state.discardPile.some((c) => c.kind === 'jester')).toBe(true);
    expect(state.discardPile.some((c) => c.kind === 'suited' && c.corrupted)).toBe(true);
  });

  it("John's house rule: a corrupted Mage pays the normal corrupted-card cost and passes its immunity-ignoring property to whatever its reveal chooses", () => {
    // Enemy is immune to Clubs (its own suit) — without the fix, a Clubs card tucked under the attack would have
    // its doubling blocked like any other immune suit.
    const enemy: LegacyEnemySpec = { name: 'Warded Foe', suit: 'C', health: 100, attack: 1 };
    let state = startMission(1, [enemy]);
    const cursedMage: SuitedCard = { ...suited('H', '4'), arcane: true, corrupted: true };
    state = rig(state, [cursedMage]);
    const costCard = suited('S', '9');
    const chosenClubs = suited('C', '5');
    // costCard is banished immediately as the corrupted-Mage cost, before the reveal draws its 4 (the play's own
    // total value) candidates from what's left.
    state.tavernDeck = [costCard, suited('S', '2'), suited('D', '2'), chosenClubs, suited('D', '3')];

    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [cursedMage.id] }));
    state = res.state;
    expect(state.turnPhase).toBe('AWAIT_MAGE_REVEAL');
    expect(state.mageReveal?.candidates.length).toBe(4);
    // The cost is paid the instant the corrupted Mage's reveal fires, not deferred until a card is chosen.
    expect(state.banishPile.some((c) => c.kind === 'suited' && c.suit === 'S' && c.rank === '9')).toBe(true);

    res = ensureOk(applyAction(state, { type: 'CHOOSE_MAGE_REVEAL_CARD', playerId: state.players[0].id, cardId: chosenClubs.id }));
    state = res.state;
    // Clubs power resolved (doubled) despite the enemy's own immunity — no "blocked" log entry for it.
    expect(state.log.some((e) => e.message.includes('blocked'))).toBe(false);
    // (4 play + 5 chosen) * 2 (Clubs double, no longer blocked) = 18.
    expect(state.currentEnemy?.damageTaken).toBe(18);
  });

  it('auto-continues without opening a choice when the reserve deck has nothing left to reveal', () => {
    const enemy: LegacyEnemySpec = { name: 'Combo Target', suit: 'S', health: 100, attack: 1 };
    let state = startMission(1, [enemy]);
    const mage4: SuitedCard = { ...suited('H', '4'), arcane: true };
    state = rig(state, [mage4]);
    state.tavernDeck = [];

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [mage4.id] }));
    state = res.state;
    // Nothing to reveal — resolves straight through to the normal deferred-attack tail.
    expect(state.mageReveal).toBeNull();
    expect(state.turnPhase).toBe('AWAIT_DEFEND');
    expect(state.currentEnemy?.damageTaken).toBe(4);
  });

  it('HOUSE RULE (overrides the sourced default): an exact kill by an attack that included a Mage sends its cards to the discard pile as normal, not the banish pile', () => {
    const enemy: LegacyEnemySpec = { name: 'Combo Target', suit: 'S', health: 4, attack: 1 };
    let state = startMission(1, [enemy]);
    const mage4: SuitedCard = { ...suited('H', '4'), arcane: true };
    state = rig(state, [mage4]);
    state.tavernDeck = [];

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [mage4.id] }));
    state = res.state;
    expect(state.currentEnemy).toBeNull(); // only enemy in the mission — WON
    expect(state.phase).toBe('WON');
    expect(state.discardPile.some((c) => c.id === mage4.id)).toBe(true);
    expect(state.banishPile.some((c) => c.id === mage4.id)).toBe(false);
  });

  it('HOUSE RULE: an overkill by an attack that included a Mage still banishes its cards instead of sending them to the discard pile', () => {
    const enemy: LegacyEnemySpec = { name: 'Combo Target', suit: 'S', health: 2, attack: 1 };
    let state = startMission(1, [enemy]);
    const mage4: SuitedCard = { ...suited('H', '4'), arcane: true }; // 4 damage vs 2 health — overkill
    state = rig(state, [mage4]);
    state.tavernDeck = [];

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [mage4.id] }));
    state = res.state;
    expect(state.currentEnemy).toBeNull(); // only enemy in the mission — WON
    expect(state.phase).toBe('WON');
    expect(state.banishPile.some((c) => c.id === mage4.id)).toBe(true);
    expect(state.discardPile.some((c) => c.id === mage4.id)).toBe(false);
  });

  it("a Mage's chosen reveal card buffs every other class power's amount too, not just damage", () => {
    // Hearts heals by the play's total value — folding the chosen reveal card into that total, not just damage,
    // is the real behavior change from the old, simpler arcane-bolt mechanic (see tutorial_vids/summaries/mission-3.md).
    // A pure Mage card contributes no suit power of its own (see nonArcaneCards), so it's combo'd here with a
    // same-rank Hearts card that supplies the actual heal.
    const enemy: LegacyEnemySpec = { name: 'Combo Target', suit: 'S', health: 100, attack: 1 };
    let state = startMission(1, [enemy]);
    const mage2: SuitedCard = { ...suited('C', '2'), arcane: true };
    const hearts2: SuitedCard = suited('H', '2');
    state = rig(state, [mage2, hearts2]);
    state.discardPile = [suited('C', '3'), suited('C', '4'), suited('C', '5'), suited('C', '6'), suited('C', '7'), suited('C', '8')];
    const chosen = suited('H', '9');
    state.tavernDeck = [chosen, suited('S', '2'), suited('S', '3'), suited('S', '4')]; // N=4, the play's own total value (2+2)

    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [mage2.id, hearts2.id] }));
    state = res.state;
    expect(state.turnPhase).toBe('AWAIT_MAGE_REVEAL');
    expect(state.mageReveal?.candidates.length).toBe(4);

    res = ensureOk(applyAction(state, { type: 'CHOOSE_MAGE_REVEAL_CARD', playerId: state.players[0].id, cardId: chosen.id }));
    state = res.state;
    // Effective total value 2+2+9=13 — Hearts heals that many cards back from the discard pile (only 6 there).
    expect(state.discardPile.length).toBe(0);
  });
});

describe('legacy: Dual-class Stickers reward (mission 2)', () => {
  it('gives exactly `count` eligible cards a second, different class icon — one per "Lucky 4" rank (3/5/7/9)', () => {
    const party = buildInitialParty();
    const stickered = applyDualClassStickers(party, 4);
    const withSecondSuit = stickered.filter((c) => c.kind === 'suited' && c.secondSuit);
    expect(withSecondSuit.length).toBe(4);
    expect(withSecondSuit.map((c) => c.kind === 'suited' && c.rank).sort()).toEqual(['3', '5', '7', '9']);
    for (const c of withSecondSuit) {
      if (c.kind === 'suited') expect(c.secondSuit).not.toBe(c.suit);
    }
    // Original party is untouched (pure function).
    expect(party.every((c) => c.kind === 'suited' && !c.secondSuit)).toBe(true);
  });

  it('skips Mage (arcane) cards and cards that already have a second class, even at an eligible rank', () => {
    const party = buildInitialParty().slice(0, 2);
    const arcaneCard: Card = { ...suited('H', '5'), arcane: true };
    const alreadyStickered: Card = { ...suited('D', '5'), secondSuit: 'C' };
    const stickered = applyDualClassStickers([arcaneCard, alreadyStickered], 2);
    expect(stickered).toEqual([arcaneCard, alreadyStickered]); // neither was eligible
  });
});

describe('legacy: party.ts reward randomness accepts a seeded rng (determinism)', () => {
  // These functions used to call Math.random() directly, breaking reproducibility for any seeded campaign
  // simulation/test from the point a mission grants one of these rewards onward. They now take an optional
  // `rng: () => number` (defaulting to Math.random so every existing call site is unaffected) — this locks in
  // that a shared seed reproduces the exact same pick, and a different seed can (not must, just in general)
  // diverge. The Guardian sticker isn't covered here anymore — it's a player choice now (see
  // applyGuardianStickerChoice below), not an rng-driven pick.
  it('applyDualClassStickers is reproducible under the same seed', () => {
    const party = buildInitialParty();
    const a = applyDualClassStickers(party, 4, makeRng('sticker-seed'));
    const b = applyDualClassStickers(party, 4, makeRng('sticker-seed'));
    expect(a).toEqual(b);
  });

  it('applyMageSticker is reproducible under the same seed', () => {
    const party = buildInitialParty();
    const a = applyMageSticker(party, makeRng('mage-seed'));
    const b = applyMageSticker(party, makeRng('mage-seed'));
    expect(a).toEqual(b);
  });

  it('applyCorruptAnotherCard is reproducible under the same seed', () => {
    const party = buildInitialParty();
    const a = applyCorruptAnotherCard(party, new Set(), makeRng('corrupt-seed'));
    const b = applyCorruptAnotherCard(party, new Set(), makeRng('corrupt-seed'));
    expect(a).toEqual(b);
  });

  it('applyReward threads the same seeded rng through to every sub-reward it applies', () => {
    // Mission 5's reward exercises both dualClassStickers and corruptAnotherCard in one call. The SAME base
    // party is reused for both runs (rather than calling buildInitialParty() twice) so only the rng-driven
    // picks can differ; ids are stripped before comparing since buildRecruitCard mints each new recruit's id
    // from Date.now()/Math.random() independent of this threading, and that's out of scope here.
    const mission5 = getMission(5)!;
    const basePartyForReward = buildInitialParty();
    const stripIds = (party: Card[]) => party.map(({ id: _id, ...rest }) => rest);
    const a = applyReward(basePartyForReward, mission5.reward, makeRng('reward-seed'));
    const b = applyReward(basePartyForReward, mission5.reward, makeRng('reward-seed'));
    expect(stripIds(a)).toEqual(stripIds(b));
  });
});

describe('legacy: Kinfolk Flute relic (mission 1) — personal storage slot', () => {
  function startMissionWithFlute(n: number, enemies: LegacyEnemySpec[]): GameState {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const names = Array.from({ length: n }, (_, i) => `Player ${i}`);
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ids,
      playerNames: names,
      seed: 'flute-test',
      party: buildInitialParty(),
      enemies,
      jesterCount: 0,
      relics: ['KINFOLK_FLUTE'],
    });
    if (!res.ok) throw new Error(res.error);
    return res.state;
  }

  const target: LegacyEnemySpec = { name: 'Combo Target', suit: 'S', health: 100, attack: 1 };

  it('banks a hand card (value 2-5) onto the slot as a free side-action, without consuming the turn', () => {
    let state = startMissionWithFlute(1, [target]);
    const fiveCard = suited('H', '5');
    state = rig(state, [fiveCard, suited('D', '9')]);
    const playerId = state.players[0].id;

    const res = ensureOk(applyAction(state, { type: 'BANK_KINFOLK_CARD', playerId, cardId: fiveCard.id }));
    state = res.state;

    expect(state.players[0].kinfolkSlot?.id).toBe(fiveCard.id);
    expect(state.players[0].hand.some((c) => c.id === fiveCard.id)).toBe(false);
    expect(state.turnPhase).toBe('AWAIT_PLAY'); // free side-action, doesn't consume the turn
    expect(state.kinfolkBankedThisTurn).toBe(true);
  });

  it('rejects banking without the relic, a card outside value 2-5, or onto an already-full slot', () => {
    const state = startMissionWithFlute(1, [target]);
    const playerId = state.players[0].id;

    let noRelic = structuredClone(state);
    noRelic.relics = [];
    noRelic = rig(noRelic, [suited('H', '3')]);
    expect(applyAction(noRelic, { type: 'BANK_KINFOLK_CARD', playerId, cardId: noRelic.players[0].hand[0].id }).ok).toBe(false);

    const withAce = rig(state, [suited('H', 'A')]); // value 1, out of range
    expect(applyAction(withAce, { type: 'BANK_KINFOLK_CARD', playerId, cardId: withAce.players[0].hand[0].id }).ok).toBe(false);

    let full = rig(state, [suited('H', '5'), suited('C', '2')]);
    const bankRes = ensureOk(applyAction(full, { type: 'BANK_KINFOLK_CARD', playerId, cardId: full.players[0].hand[0].id }));
    full = bankRes.state;
    const secondBank = applyAction(full, { type: 'BANK_KINFOLK_CARD', playerId, cardId: full.players[0].hand[0].id });
    expect(secondBank.ok).toBe(false); // slot already holds a card
  });

  it('caps banking at once per turn even if the slot is emptied again the same turn', () => {
    let state = startMissionWithFlute(1, [target]);
    const playerId = state.players[0].id;
    const five = suited('H', '5');
    const otherFive = suited('D', '5');
    state = rig(state, [five, otherFive]);

    let res = ensureOk(applyAction(state, { type: 'BANK_KINFOLK_CARD', playerId, cardId: five.id }));
    state = res.state;
    res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId, cardIds: [otherFive.id], includeKinfolkSlot: true }),
    );
    state = res.state;
    expect(state.players[0].kinfolkSlot).toBeNull(); // emptied out again, same turn

    state = rig(state, [suited('C', '3')]);
    const secondBank = applyAction(state, { type: 'BANK_KINFOLK_CARD', playerId, cardId: state.players[0].hand[0].id });
    expect(secondBank.ok).toBe(false);
  });

  it('plays the banked slot card together with a matching-rank hand card as a normal combo, clearing the slot', () => {
    let state = startMissionWithFlute(1, [target]);
    const playerId = state.players[0].id;
    const bankedFive = suited('H', '5');
    state = rig(state, [bankedFive]);
    let res = ensureOk(applyAction(state, { type: 'BANK_KINFOLK_CARD', playerId, cardId: bankedFive.id }));
    state = res.state;

    const matchingFive = suited('D', '5');
    state = rig(state, [matchingFive]);
    res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId, cardIds: [matchingFive.id], includeKinfolkSlot: true }),
    );
    state = res.state;

    expect(state.players[0].kinfolkSlot).toBeNull();
    expect(state.currentEnemy?.damageTaken).toBe(10); // 5 + 5 combo total
    expect(state.currentEnemy?.tableCards.some((c) => c.id === bankedFive.id)).toBe(true);
  });

  it("rejects folding in the slot card when ranks don't match, or when the slot is empty", () => {
    let state = startMissionWithFlute(1, [target]);
    const playerId = state.players[0].id;
    const bankedFive = suited('H', '5');
    state = rig(state, [bankedFive]);
    const res = ensureOk(applyAction(state, { type: 'BANK_KINFOLK_CARD', playerId, cardId: bankedFive.id }));
    state = res.state;

    const mismatched = suited('D', '4');
    state = rig(state, [mismatched]);
    const badPlay = applyAction(state, { type: 'PLAY_CARDS', playerId, cardIds: [mismatched.id], includeKinfolkSlot: true });
    expect(badPlay.ok).toBe(false);
    expect(state.players[0].kinfolkSlot?.id).toBe(bankedFive.id); // untouched on failure

    state = structuredClone(state);
    state.players[0].kinfolkSlot = null;
    state = rig(state, [suited('D', '5')]);
    const emptySlot = applyAction(state, { type: 'PLAY_CARDS', playerId, cardIds: [state.players[0].hand[0].id], includeKinfolkSlot: true });
    expect(emptySlot.ok).toBe(false);
  });

  it('no longer opens the old multiplayer combo-assist window — a lone play just resolves immediately', () => {
    let state = startMissionWithFlute(2, [target]);
    state = rig(state, [suited('H', '3')]);
    const attackerId = state.players[0].id;
    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: attackerId, cardIds: [state.players[0].hand[0].id] }),
    );
    state = res.state;
    expect(state.turnPhase).not.toBe('AWAIT_COMBO_ASSIST');
    expect(state.currentEnemy?.damageTaken).toBe(3); // resolved immediately, no assist window
  });
});

describe('legacy: mission 1 mechanics (exact-kill to reserve deck, killer skips retaliation and acts first)', () => {
  function startCallToArms(n: number, enemies: LegacyEnemySpec[]): GameState {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const names = Array.from({ length: n }, (_, i) => `Player ${i}`);
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ids,
      playerNames: names,
      seed: 'call-to-arms-test',
      party: buildInitialParty(),
      enemies,
      jesterCount: 0,
      exactKillToReserveDeck: true,
    });
    if (!res.ok) throw new Error(res.error);
    return res.state;
  }

  it('sends an exact kill to the top of the reserve deck instead of the discard pile', () => {
    const boss: LegacyEnemySpec = { name: 'Court Guard', suit: 'C', health: 10, attack: 1 };
    let state = startCallToArms(1, [boss]);
    state = rig(state, [suited('S', '10')]); // exact 10 damage, Spades doesn't double

    const beforeReserveTop = state.tavernDeck[0];
    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.tavernDeck[0]).not.toBe(beforeReserveTop);
    expect(state.tavernDeck[0].kind).toBe('suited');
    if (state.tavernDeck[0].kind === 'suited') expect(state.tavernDeck[0].suit).toBe('C');
    // The played card itself still lands in the discard pile.
    expect(state.discardPile.some((c) => c.kind === 'suited' && c.suit === 'S' && c.rank === '10')).toBe(true);
  });

  it('whoever lands the killing blow suffers no retaliation and immediately acts first against the next enemy', () => {
    const first: LegacyEnemySpec = { name: 'Court Guard', suit: 'H', health: 10, attack: 50 }; // huge attack to prove retaliation was skipped
    const second: LegacyEnemySpec = { name: 'Court Champion', suit: 'D', health: 20, attack: 5 };
    let state = startCallToArms(2, [first, second]);
    const killerId = state.players[state.currentPlayerIndex].id;
    state = rig(state, [suited('C', '9')]); // Clubs doubles: 18 damage, overkills the 10-health guard

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: killerId, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    // No retaliation from the felled guard's huge attack: straight back to AWAIT_PLAY, not AWAIT_DEFEND.
    expect(state.turnPhase).toBe('AWAIT_PLAY');
    expect(state.pendingDamage).toBe(0);
    // The killer, not the next player in turn order, immediately faces the new enemy.
    expect(state.players[state.currentPlayerIndex].id).toBe(killerId);
    expect(state.currentEnemy?.name).toBe('Court Champion');
  });
});

describe('legacy: mission 2 standing Jesters (unsourced house rule)', () => {
  function startStandingJesterMission(n: number, attack = 0): GameState {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const names = Array.from({ length: n }, (_, i) => `Player ${i}`);
    const enemy: LegacyEnemySpec = { name: 'Hydra Head', suit: 'H', secondSuit: 'D', health: 100, attack };
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ids,
      playerNames: names,
      seed: 'standing-jester-test',
      party: buildInitialParty(),
      enemies: [enemy],
      jesterCount: 2,
      standingJesters: true,
    });
    return ensureOk(res).state;
  }

  it('keeps both Jesters out of the reserve deck and every hand, as a standing pool instead', () => {
    const state = startStandingJesterMission(2);
    expect(state.standingJesters.length).toBe(2);
    expect(state.tavernDeck.some((c) => c.kind === 'jester')).toBe(false);
    expect(state.players.flatMap((p) => p.hand).some((c) => c.kind === 'jester')).toBe(false);
  });

  it('lets the current player use a standing Jester directly, ignoring immunity, with no draw needed first', () => {
    const state = startStandingJesterMission(2);
    const player = state.players[state.currentPlayerIndex];
    const res = ensureOk(applyAction(state, { type: 'USE_STANDING_JESTER', playerId: player.id }));
    expect(res.state.standingJesters.length).toBe(1);
    expect(res.state.currentEnemy?.damageTaken).toBe(8); // the dual immunity was ignored
  });

  it('SOURCED FIX: a used standing Jester never resurfaces in the discard pile, even once the enemy it attacked is later killed', () => {
    let state = startStandingJesterMission(1);
    const player = state.players[state.currentPlayerIndex];
    const jesterCard = state.standingJesters[0];
    let res = ensureOk(applyAction(state, { type: 'USE_STANDING_JESTER', playerId: player.id }));
    state = res.state;
    expect(state.currentEnemy?.tableCards.some((c) => c.id === jesterCard.id)).toBe(false); // never joined the table

    // Finish off the same enemy so its table cards flush to the discard pile.
    state = rig(state, [suited('C', '9')], { damageTaken: state.currentEnemy!.maxHealth - 18 }); // 18 remaining
    res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: player.id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.discardPile.some((c) => c.id === jesterCard.id)).toBe(false);
  });

  it('rejects a standing Jester use from anyone but the current player', () => {
    const state = startStandingJesterMission(2);
    const otherPlayer = state.players[(state.currentPlayerIndex + 1) % state.players.length];
    const res = applyAction(state, { type: 'USE_STANDING_JESTER', playerId: otherPlayer.id });
    expect(res.ok).toBe(false);
  });

  it('tops the hand up to the limit without discarding what is already held', () => {
    let state = startStandingJesterMission(1);
    state = rig(state, [suited('C', '2')]); // a single held card, well under the hand limit
    const player = state.players[state.currentPlayerIndex];
    const res = ensureOk(applyAction(state, { type: 'USE_STANDING_JESTER', playerId: player.id }));
    const hand = res.state.players[0].hand;
    expect(hand.some((c) => c.kind === 'suited' && c.suit === 'C' && c.rank === '2')).toBe(true); // original card kept
    expect(hand.length).toBe(res.state.maxHandSize);
  });

  it("John's house rule: a standing Jester spares the caller the enemy's counter-attack entirely, even against a survivor that would otherwise strike back — so an empty hand is never left facing a Defend at all", () => {
    let state = startStandingJesterMission(1, 5); // enemy survives 8 dmg (100 health) and would otherwise counter for 5
    state = rig(state, []); // hand already empty before calling the standing Jester
    const player = state.players[state.currentPlayerIndex];
    const res = ensureOk(applyAction(state, { type: 'USE_STANDING_JESTER', playerId: player.id }));

    expect(res.state.turnPhase).not.toBe('AWAIT_DEFEND'); // no counter-attack to answer
    expect(res.state.pendingDamage).toBe(0);
    expect(res.state.players[0].hand.length).toBe(res.state.maxHandSize); // still refilled, same as always
  });

  it('rejects using a standing Jester once none remain', () => {
    let state = startStandingJesterMission(1);
    const player = state.players[state.currentPlayerIndex];
    state = ensureOk(applyAction(state, { type: 'USE_STANDING_JESTER', playerId: player.id })).state;
    state = ensureOk(applyAction(state, { type: 'USE_STANDING_JESTER', playerId: player.id })).state;
    expect(state.standingJesters.length).toBe(0);
    const res = applyAction(state, { type: 'USE_STANDING_JESTER', playerId: player.id });
    expect(res.ok).toBe(false);
  });

  it('SOURCED FIX: a Mercenary Camp Jester purchase joins the standing pool instead of being shuffled into the deck', () => {
    const ids = ['p0'];
    const enemy: LegacyEnemySpec = { name: 'Hydra Head', suit: 'H', secondSuit: 'D', health: 100, attack: 0 };
    const res = ensureOk(
      applyAction(createLobbyState(), {
        type: 'START_LEGACY_MISSION',
        playerIds: ids,
        playerNames: ['Player 0'],
        seed: 'standing-jester-mercenary-test',
        party: buildInitialParty(),
        enemies: [enemy],
        jesterCount: 2,
        standingJesters: true,
        extraReserveCards: [buildMercenaryCard('JESTER')],
      }),
    );
    expect(res.state.standingJesters.length).toBe(3); // 2 base + 1 bought
    expect(res.state.tavernDeck.some((c) => c.kind === 'jester')).toBe(false);
    expect(res.state.players.flatMap((p) => p.hand).some((c) => c.kind === 'jester')).toBe(false);
  });
});

describe('legacy: mission 3 mechanics (end-of-turn mission zone)', () => {
  function startZoneMission(n: number, enemies: LegacyEnemySpec[]): GameState {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const names = Array.from({ length: n }, (_, i) => `Player ${i}`);
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ids,
      playerNames: names,
      seed: 'zone-test',
      party: buildInitialParty(),
      enemies,
      jesterCount: 0,
      endOfTurnZoneFlip: true,
    });
    if (!res.ok) throw new Error(res.error);
    return res.state;
  }

  it('flips the top reserve card into the mission zone at end of turn, but grants no NEW immunity once the enemy already has its own', () => {
    // Second-pass balance fix (see engine.ts's flipMissionZoneCard doc comment): simulation showed the zone
    // compounding on top of the enemy's own inherent immunity was the actual driver of Mission 3's ~0% win rate,
    // not something a partial cap could fix — so the zone now never pushes an enemy past however many classes it
    // was already immune to on its own. The card still flips into the shared zone (feeding the exact-kill-save
    // and banish-on-defeat cleanup below) — it just stops adding to zoneImmuneSuits once that ceiling is hit,
    // which for every Mission 3 enemy (single-class, no secondSuit since the first-pass fix) means immediately.
    const boss: LegacyEnemySpec = { name: 'Archive Boss', suit: 'S', health: 100, attack: 1 };
    let state = startZoneMission(1, [boss]);
    state = structuredClone(state);
    state.tavernDeck = [suited('H', '5'), ...state.tavernDeck];
    state = rig(state, [suited('D', '2')]);

    const res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));
    state = res.state;
    // Solo game: yielding with a live enemy attack goes to AWAIT_DEFEND — cover it to actually trigger
    // advanceToNextPlayer's end-of-turn flip.
    const res2 = ensureOk(applyAction(state, { type: 'DEFEND', playerId: state.players[0].id, cardIds: state.players[0].hand.map((c) => c.id) }));
    state = res2.state;

    expect(state.missionZone.length).toBe(1); // the card still visibly flips into the zone
    expect(state.zoneImmuneSuits).toEqual([]); // but grants no new immunity — the Spades-immune boss already has its own
    expect(state.log.some((e) => e.message.includes('resistance is already spent'))).toBe(true);
  });

  it('the immunity cap is measured against however many classes the enemy itself already resists, not a hardcoded number', () => {
    // No shipped Mission 3 enemy carries a secondSuit any more (see missions.ts), but the cap is written against
    // "however many classes this enemy already resists" rather than a hardcoded number, so a dual-immune enemy
    // (2 inherent classes) still gets zero new ones from the zone, exactly like a single-immune enemy does —
    // verified directly since nothing else exercises that path.
    const boss: LegacyEnemySpec = { name: 'Two-Headed Boss', suit: 'S', secondSuit: 'C', health: 100, attack: 1 };
    let state = startZoneMission(1, [boss]);
    state = structuredClone(state);
    state.tavernDeck = [suited('H', '5'), suited('D', '3'), ...state.tavernDeck];
    state = rig(state, [suited('D', '2'), suited('D', '9')]); // 2 cards on hand — one to defend with each of the 2 turns below

    let res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));
    state = res.state;
    res = ensureOk(applyAction(state, { type: 'DEFEND', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;
    expect(state.zoneImmuneSuits).toEqual([]); // already at its own 2-class ceiling (S + C) before the flip

    res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));
    state = res.state;
    res = ensureOk(applyAction(state, { type: 'DEFEND', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;
    expect(state.missionZone.length).toBe(2); // both cards still visibly accumulate in the zone
    expect(state.zoneImmuneSuits).toEqual([]); // still nothing new — the enemy started at its own ceiling already
  });

  it('banishes the mission zone (saving one card to discard on an exact kill) when the enemy is defeated, and skips that turn\'s flip', () => {
    const boss: LegacyEnemySpec = { name: 'Archive Boss', suit: 'S', health: 10, attack: 1 };
    let state = startZoneMission(1, [boss]);
    state = structuredClone(state);
    state.missionZone = [suited('H', '3'), suited('D', '4')];
    state.zoneImmuneSuits = ['H', 'D'];
    state = rig(state, [suited('S', '10')], { damageTaken: 0 }); // Spades doesn't double — exact kill: 10 vs 10 health

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.missionZone.length).toBe(0);
    expect(state.zoneImmuneSuits.length).toBe(0);
    expect(state.banishPile.length).toBe(1); // one card banished, one saved
    expect(state.discardPile.some((c) => c.kind === 'suited' && c.suit === 'D' && c.rank === '4')).toBe(true);
  });

  it('an overkill under exactKillOnly also banishes the escalating mission zone, not just an exact kill', () => {
    const boss: LegacyEnemySpec = { name: 'Archive Boss', suit: 'S', health: 20, attack: 1 };
    const startRes = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ['p0'],
      playerNames: ['Player 0'],
      seed: 'zone-overkill-test',
      party: buildInitialParty(),
      enemies: [boss, { name: 'Second Boss', suit: 'C', health: 15, attack: 5 }],
      jesterCount: 0,
      endOfTurnZoneFlip: true,
      exactKillOnly: true,
    });
    let state = ensureOk(startRes).state;
    state = structuredClone(state);
    state.missionZone = [suited('H', '3'), suited('D', '4')];
    state.zoneImmuneSuits = ['H', 'D'];
    state = rig(state, [suited('C', '10')], { damageTaken: 15 }); // 15 already taken, +10 overkills a 20-health boss

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: state.players[0].hand.map((c) => c.id) }));
    state = res.state;

    expect(state.currentEnemy?.name).toBe('Second Boss'); // recycled and moved on, not an exact kill
    expect(state.missionZone.length).toBe(0);
    expect(state.zoneImmuneSuits.length).toBe(0);
    expect(state.banishPile.length).toBe(2); // both zone cards banished — no exact kill, so nothing saved to discard
  });

  it('a corrupted card ignores mission-zone immunity for its own class, at the cost of banishing the top reserve card', () => {
    const boss: LegacyEnemySpec = { name: 'Archive Boss', suit: 'S', health: 100, attack: 1 };
    let state = startZoneMission(1, [boss]);
    state = structuredClone(state);
    state.zoneImmuneSuits = ['H']; // Hearts is currently blocked by the mission zone
    state.tavernDeck = [suited('C', '9'), ...state.tavernDeck]; // will be banished as the corrupted-play cost
    const corruptedHeart: SuitedCard = { ...suited('H', '5'), corrupted: true };
    state = rig(state, [corruptedHeart]);

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [corruptedHeart.id] }));
    state = res.state;

    // Hearts power resolved despite the zone immunity — no "blocked" log entry for it.
    expect(state.log.some((e) => e.message.includes('blocked'))).toBe(false);
    expect(state.banishPile.some((c) => c.kind === 'suited' && c.suit === 'C' && c.rank === '9')).toBe(true);
  });
});

describe('legacy: mission 4 mechanics (discard-pile attack buff + exact-kill to reserve deck)', () => {
  function startFusionMission(n: number, enemies: LegacyEnemySpec[]): GameState {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const names = Array.from({ length: n }, (_, i) => `Player ${i}`);
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ids,
      playerNames: names,
      seed: 'fusion-test',
      party: buildInitialParty(),
      enemies,
      jesterCount: 0,
      discardTopBuffsAttack: true,
      exactKillToReserveDeck: true,
    });
    if (!res.ok) throw new Error(res.error);
    return res.state;
  }

  it("adds the discard pile's top card value onto the enemy's attack when covering damage", () => {
    const boss: LegacyEnemySpec = { name: 'Experiment', suit: 'S', health: 100, attack: 15 };
    let state = startFusionMission(1, [boss]);
    state = structuredClone(state);
    state.discardPile = [suited('D', '9')]; // top of discard = 9
    state = rig(state, [suited('D', '2')]); // a harmless play against Spades-immune enemy isn't needed; just trigger AWAIT_DEFEND

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    // 15 base + 9 from the discard pile's top card = 24 pending damage.
    expect(state.pendingDamage).toBe(24);
  });

  it('recomputes the buff live off whatever card the Hearts reshuffle leaves on top', () => {
    const boss: LegacyEnemySpec = { name: 'Experiment', suit: 'C', health: 100, attack: 10 };
    let state = startFusionMission(1, [boss]);
    state = structuredClone(state);
    // 6 cards in the pile, a Hearts-5 heal only pulls 5 — one is guaranteed to remain on top regardless of shuffle.
    state.discardPile = [suited('S', '2'), suited('S', '3'), suited('S', '4'), suited('S', '6'), suited('S', '7'), suited('S', '8')];
    state = rig(state, [suited('H', '5')]); // Hearts heal reshuffles the discard pile

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.discardPile.length).toBe(1); // 6 - 5 healed
    // Whatever's left on top after the Hearts shuffle-and-heal is what buffs the attack — not the pre-shuffle top.
    const expectedTop = state.discardPile[state.discardPile.length - 1];
    const expectedBuff = expectedTop.kind === 'suited' ? Number(expectedTop.rank) : 0;
    expect(state.pendingDamage).toBe(10 + expectedBuff);
  });

  it('seals a specimen card atop the reserve deck on an exact kill instead of sending it to the discard pile', () => {
    const boss: LegacyEnemySpec = { name: 'Experiment', suit: 'C', health: 10, attack: 1 };
    let state = startFusionMission(1, [boss]);
    state = structuredClone(state);
    state = rig(state, [suited('S', '10')]); // exact 10 damage vs 10 health, Spades doesn't double

    const beforeReserveTop = state.tavernDeck[0];
    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.tavernDeck[0]).not.toBe(beforeReserveTop);
    expect(state.tavernDeck[0].kind).toBe('suited');
    if (state.tavernDeck[0].kind === 'suited') {
      expect(state.tavernDeck[0].suit).toBe('C');
    }
    // The played card itself still lands in the discard pile as normal.
    expect(state.discardPile.some((c) => c.kind === 'suited' && c.suit === 'S' && c.rank === '10')).toBe(true);
  });

  it('sends the played cards to the discard pile as normal on a non-exact (overkill) kill', () => {
    const boss: LegacyEnemySpec = { name: 'Experiment', suit: 'H', health: 10, attack: 1 };
    let state = startFusionMission(1, [boss]);
    // Clubs doubles damage and the enemy isn't immune to Clubs: 9 * 2 = 18 > 10 health, an overkill (not exact).
    state = rig(state, [suited('C', '9')]);
    const beforeReserveTop = state.tavernDeck[0];

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    const after = res.state;

    expect(after.tavernDeck[0]).toStrictEqual(beforeReserveTop); // reserve deck untouched
    expect(after.discardPile.some((c) => c.kind === 'suited' && c.suit === 'C' && c.rank === '9')).toBe(true);
  });
});

describe('legacy: mission 4 discard-cleanup low-to-high ordering (sourced fix for the discard-buff spiral)', () => {
  function startFusionMission(enemies: LegacyEnemySpec[], cleanup: boolean): GameState {
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ['p0'],
      playerNames: ['Player 0'],
      seed: 'fusion-cleanup-test',
      party: buildInitialParty(),
      enemies,
      jesterCount: 0,
      discardTopBuffsAttack: true,
      discardCleanupLowToHigh: cleanup,
    });
    if (!res.ok) throw new Error(res.error);
    return res.state;
  }

  it('a covered DEFEND places the lowest-value discarded card on top, regardless of the order the player selected them in', () => {
    const boss: LegacyEnemySpec = { name: 'Experiment', suit: 'S', health: 100, attack: 20 };
    let state = startFusionMission([boss], true);
    const nine = suited('H', '9');
    const four = suited('C', '4');
    const seven = suited('S', '7');
    // A harmless Diamonds-2 play just opens AWAIT_DEFEND without meaningfully denting the boss's 100 health.
    state = rig(state, [suited('D', '2'), nine, four, seven]);
    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;
    expect(state.turnPhase).toBe('AWAIT_DEFEND');
    expect(state.pendingDamage).toBe(20); // discard pile is still empty, so no buff yet

    // Cover the 20 damage with all 3 remaining cards (9 + 4 + 7 = 20), selected in a scrambled order.
    res = ensureOk(applyAction(state, { type: 'DEFEND', playerId: state.players[0].id, cardIds: [nine.id, four.id, seven.id] }));
    state = res.state;

    expect(state.discardPile.length).toBe(3);
    const top = state.discardPile[state.discardPile.length - 1];
    const bottom = state.discardPile[0];
    expect(top.kind === 'suited' && top.rank).toBe('4'); // lowest of the batch, regardless of selection order
    expect(bottom.kind === 'suited' && bottom.rank).toBe('9'); // highest goes in first
  });

  it('without the flag, a covered DEFEND preserves whatever order the cardIds were given in (pre-fix behavior)', () => {
    const boss: LegacyEnemySpec = { name: 'Experiment', suit: 'S', health: 100, attack: 20 };
    let state = startFusionMission([boss], false);
    const nine = suited('H', '9');
    const four = suited('C', '4');
    const seven = suited('S', '7');
    state = rig(state, [suited('D', '2'), nine, four, seven]);
    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    res = ensureOk(applyAction(state, { type: 'DEFEND', playerId: state.players[0].id, cardIds: [nine.id, four.id, seven.id] }));
    state = res.state;

    // Whatever order the player selected lands in the discard pile unchanged — the LAST one selected (7) is on top.
    expect(state.discardPile.map((c) => (c.kind === 'suited' ? c.rank : 'jester'))).toEqual(['9', '4', '7']);
  });

  it('an enemy kill (overkill) sorts the whole accumulated table-cards batch low-to-high, capping the next enemy\'s buff at the lowest card', () => {
    const enemyA: LegacyEnemySpec = { name: 'Specimen A', suit: 'D', health: 30, attack: 1 };
    const enemyB: LegacyEnemySpec = { name: 'Specimen B', suit: 'H', health: 20, attack: 10 };
    let state = startFusionMission([enemyA, enemyB], true);
    state = rig(state, [suited('C', '9')], { tableCards: [suited('H', '2'), suited('D', '3')], damageTaken: 25 }); // 5 health left

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );
    state = res.state;

    expect(state.currentEnemy?.name).toBe('Specimen B'); // Clubs doubles 9 to 18 vs 5 health left — an overkill
    // The finishing card (9) plus the two already on the table (2, 3) all land in the discard pile, lowest on top.
    expect(state.discardPile.length).toBe(3);
    const top = state.discardPile[state.discardPile.length - 1];
    expect(top.kind === 'suited' && top.rank).toBe('2');
    // Specimen B's live attack reads only that lowest card: 10 base + 2, not the 9 that actually landed the kill.
    expect(resolvedEnemyAttack(state)).toBe(12);
  });

  it('without the flag, the kill (overkill) preserves table-card order, so the finishing card can land on top and buff the next enemy at its worst', () => {
    const enemyA: LegacyEnemySpec = { name: 'Specimen A', suit: 'D', health: 30, attack: 1 };
    const enemyB: LegacyEnemySpec = { name: 'Specimen B', suit: 'H', health: 20, attack: 10 };
    let state = startFusionMission([enemyA, enemyB], false);
    state = rig(state, [suited('C', '9')], { tableCards: [suited('H', '2'), suited('D', '3')], damageTaken: 25 });

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );
    state = res.state;

    // Pre-fix behavior: table cards land in play order [2, 3, 9] — the finishing (highest) card ends up on top.
    expect(state.discardPile.map((c) => (c.kind === 'suited' ? c.rank : 'jester'))).toEqual(['2', '3', '9']);
    // The next enemy inherits the worst case: +9 instead of +2 — exactly the self-reinforcing spiral the fix closes.
    expect(resolvedEnemyAttack(state)).toBe(19);
  });
});

describe('legacy: mission 4 Beast Companions (strength-copying pair) + Scarlet Whistle relic', () => {
  function startBeastMission(): GameState {
    const boss: LegacyEnemySpec = { name: 'Specimen A', suit: 'H', health: 100, attack: 1 };
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ['p0', 'p1'],
      playerNames: ['Player 0', 'Player 1'],
      seed: 'beast-test',
      party: buildInitialParty(),
      enemies: [boss],
      jesterCount: 0,
      relics: ['SCARLET_WHISTLE'],
    });
    if (!res.ok) throw new Error(res.error);
    return res.state;
  }

  it('a Beast Companion paired with a card copies that card\'s strength instead of adding its own flat value', () => {
    let state = startBeastMission();
    const beast: SuitedCard = { ...suited('C', 'A'), beast: true };
    const partner = suited('C', '7');
    state = rig(state, [beast, partner]);

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [beast.id, partner.id] }),
    );
    state = res.state;

    // Clubs doubles: (7 copied + 7) * 2 = 28 — an ordinary Animal Companion would only have added its own 1.
    expect(state.currentEnemy?.damageTaken).toBe(28);
  });

  it('two plain Animal Companions (Aces) paired together still just sum their own values, unaffected by the beast rule', () => {
    let state = startBeastMission();
    const aceA = suited('C', 'A');
    const aceB = suited('D', 'A');
    state = rig(state, [aceA, aceB]);

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [aceA.id, aceB.id] }),
    );
    state = res.state;

    // Clubs doubles: (1 + 1) * 2 = 4.
    expect(state.currentEnemy?.damageTaken).toBe(4);
  });

  it('Scarlet Whistle opens a silent-assist window when a lone Animal/Beast Companion is played alone', () => {
    let state = startBeastMission();
    const beast: SuitedCard = { ...suited('S', 'A'), beast: true };
    state = rig(state, [beast]);
    const attackerId = state.players[0].id;
    const assisterId = state.players[1].id;
    state.players[1].hand = [suited('S', '6')];

    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: attackerId, cardIds: [beast.id] }));
    state = res.state;
    expect(state.turnPhase).toBe('AWAIT_COMBO_ASSIST');

    const assistCardId = state.players[1].hand[0].id;
    res = ensureOk(applyAction(state, { type: 'ASSIST_COMBO', playerId: assisterId, cardId: assistCardId }));
    state = res.state;
    res = ensureOk(applyAction(state, { type: 'RESOLVE_COMBO', playerId: attackerId }));
    state = res.state;

    // Beast copies the assisted-in Spades-6's value: Spades reduces attack by 6 (copied) + 6 (the real card) = 12.
    expect(state.currentEnemy?.spadesShield).toBe(12);
  });

  function startBeastMissionSolo(): GameState {
    const boss: LegacyEnemySpec = { name: 'Specimen A', suit: 'H', health: 100, attack: 1 };
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ['p0'],
      playerNames: ['Player 0'],
      seed: 'beast-test-solo',
      party: buildInitialParty(),
      enemies: [boss],
      jesterCount: 0,
      relics: ['SCARLET_WHISTLE'],
    });
    if (!res.ok) throw new Error(res.error);
    return res.state;
  }

  it("solo variant, John's house rule: opens a real choice among the WHOLE discard pile, not an automatic pull of just its top card", () => {
    let state = startBeastMissionSolo();
    const beast: SuitedCard = { ...suited('S', 'A'), beast: true };
    state = rig(state, [beast]);
    const bottomCard = suited('S', '9');
    const topCard = suited('S', '6'); // "top" = last element, same convention as every other discardPile push site
    state.discardPile = [bottomCard, topCard];

    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [beast.id] }));
    state = res.state;
    expect(state.turnPhase).toBe('AWAIT_SCARLET_WHISTLE_SOLO');
    expect(state.scarletWhistleSoloChoice?.candidates.length).toBe(2);

    // Deliberately choosing the BOTTOM card proves this is a real pick, not the old sourced behavior's automatic
    // top-of-pile pull (which could only ever have grabbed topCard here).
    res = ensureOk(
      applyAction(state, { type: 'CHOOSE_SCARLET_WHISTLE_DISCARD_CARD', playerId: state.players[0].id, cardId: bottomCard.id }),
    );
    state = res.state;

    expect(state.turnPhase).not.toBe('AWAIT_SCARLET_WHISTLE_SOLO');
    expect(state.discardPile.some((c) => c.id === bottomCard.id)).toBe(false); // pulled out
    expect(state.discardPile.some((c) => c.id === topCard.id)).toBe(true); // the other candidate is left alone
    // Beast copies the pulled Spades-9's value: Spades reduces the enemy's attack by 9 (copied) + 9 (the real card) = 18.
    expect(state.currentEnemy?.spadesShield).toBe(18);
  });

  it("solo variant, John's ruling: the pairing is optional — declining attacks with the Companion alone and leaves the discard pile untouched", () => {
    let state = startBeastMissionSolo();
    const beast: SuitedCard = { ...suited('S', 'A'), beast: true };
    state = rig(state, [beast]);
    const bottomCard = suited('S', '9');
    const topCard = suited('S', '6');
    state.discardPile = [bottomCard, topCard];

    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [beast.id] }));
    state = res.state;
    expect(state.turnPhase).toBe('AWAIT_SCARLET_WHISTLE_SOLO');

    res = ensureOk(applyAction(state, { type: 'DECLINE_SCARLET_WHISTLE_SOLO', playerId: state.players[0].id }));
    state = res.state;

    expect(state.turnPhase).not.toBe('AWAIT_SCARLET_WHISTLE_SOLO');
    expect(state.scarletWhistleSoloChoice).toBeNull();
    // Nothing was taken: both candidates are still sitting in the discard pile.
    expect(state.discardPile.some((c) => c.id === bottomCard.id)).toBe(true);
    expect(state.discardPile.some((c) => c.id === topCard.id)).toBe(true);
    // The Companion resolved alone — a Beast with no partner to copy contributes only its own Spades-A value of 1.
    expect(state.currentEnemy?.spadesShield).toBe(1);
  });

  it('solo variant: declining is rejected when no Scarlet Whistle window is open', () => {
    const state = startBeastMissionSolo();
    const res = applyAction(state, { type: 'DECLINE_SCARLET_WHISTLE_SOLO', playerId: state.players[0].id });
    expect(res.ok).toBe(false);
  });

  it('solo variant: still offers a choice among the discard pile\'s suited cards even when a Jester sits on top (the Jester itself is never offered)', () => {
    let state = startBeastMissionSolo();
    const beast: SuitedCard = { ...suited('S', 'A'), beast: true };
    state = rig(state, [beast]);
    const belowJester = suited('S', '6');
    state.discardPile = [belowJester, jester()];

    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [beast.id] }));
    state = res.state;
    expect(state.turnPhase).toBe('AWAIT_SCARLET_WHISTLE_SOLO');
    expect(state.scarletWhistleSoloChoice?.candidates.length).toBe(1);
    expect(state.scarletWhistleSoloChoice?.candidates[0].id).toBe(belowJester.id);

    res = ensureOk(
      applyAction(state, { type: 'CHOOSE_SCARLET_WHISTLE_DISCARD_CARD', playerId: state.players[0].id, cardId: belowJester.id }),
    );
    state = res.state;
    expect(state.discardPile.length).toBe(1);
    expect(state.discardPile[0].kind).toBe('jester'); // the Jester itself was never a candidate — still sitting there
    expect(state.currentEnemy?.spadesShield).toBe(12);
  });

  it('solo variant: resolves the lone Companion alone, no window opened, when the discard pile is empty', () => {
    let state = startBeastMissionSolo();
    const beast: SuitedCard = { ...suited('S', 'A'), beast: true };
    state = rig(state, [beast]);
    state.discardPile = [];

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [beast.id] }));
    state = res.state;

    expect(state.turnPhase).not.toBe('AWAIT_SCARLET_WHISTLE_SOLO');
    // No partner to copy — falls back to a Beast Companion's own printed value (an Ace's flat 1).
    expect(state.currentEnemy?.spadesShield).toBe(1);
  });

  it('solo variant: resolves the lone Companion alone, no window opened, when the discard pile holds only Jesters', () => {
    let state = startBeastMissionSolo();
    const beast: SuitedCard = { ...suited('S', 'A'), beast: true };
    state = rig(state, [beast]);
    state.discardPile = [jester()];

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [beast.id] }));
    state = res.state;

    expect(state.turnPhase).not.toBe('AWAIT_SCARLET_WHISTLE_SOLO');
    expect(state.discardPile.length).toBe(1); // left untouched
    expect(state.currentEnemy?.spadesShield).toBe(1); // resolves the Companion alone instead
  });
});

describe('legacy: mission 5 mechanics (Reaver reveal-and-add, rolling banish-pile zone, exact-kill splash)', () => {
  function reaverCard(suit: SuitedCard['suit'], rank: SuitedCard['rank']): SuitedCard {
    return { ...suited(suit, rank), reaver: true };
  }

  function startCrimsonMission(
    n: number,
    enemies: LegacyEnemySpec[],
    opts: { presetMissionZone?: Card[]; exactKillSplashDamage?: boolean; rollingZoneBonus?: boolean } = {},
  ): GameState {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const names = Array.from({ length: n }, (_, i) => `Player ${i}`);
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ids,
      playerNames: names,
      seed: 'crimson-test',
      party: buildInitialParty(),
      enemies,
      jesterCount: 0,
      ...opts,
    });
    if (!res.ok) throw new Error(res.error);
    return res.state;
  }

  it('reveals cards equal to the play\'s total value (a lone card\'s own rank, absent any combo), lets the player choose one to add, banishes everything revealed, and doubles the total unconditionally', () => {
    const boss: LegacyEnemySpec = { name: 'Sporeling', suit: 'S', health: 100, attack: 1 };
    let state = startCrimsonMission(1, [boss]);
    state = structuredClone(state);
    state.tavernDeck = [suited('C', '6'), suited('D', '2'), suited('D', '2'), suited('D', '2'), ...state.tavernDeck];
    const reserveBefore = state.tavernDeck.length;
    state = rig(state, [reaverCard('D', '4')]);

    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.turnPhase).toBe('AWAIT_REAVER_REVEAL_COUNT');
    expect(state.reaverRevealCountChoice?.maxCount).toBe(4); // lone card, so total value = its own rank (4)
    state = chooseMaxReaverRevealCount(state);

    expect(state.turnPhase).toBe('AWAIT_REAVER_REVEAL');
    expect(state.reaverReveal?.candidates.length).toBe(4); // lone card, so total value = its own rank (4)
    const chosen = state.reaverReveal!.candidates.find((c) => c.rank === '6')!;

    res = ensureOk(applyAction(state, { type: 'CHOOSE_REAVER_REVEAL_CARD', playerId: state.players[0].id, cardId: chosen.id }));
    state = res.state;

    // (4 + 6) * 2 (Reaver's own doubling, unconditional) = 20. All 4 revealed cards are banished, not just the chosen one.
    expect(state.currentEnemy?.damageTaken).toBe(20);
    expect(state.tavernDeck.length).toBe(reserveBefore - 4);
    expect(state.banishPile.filter((c) => c.kind === 'suited' && c.rank === '2').length).toBe(3);
    expect(state.banishPile.some((c) => c.kind === 'suited' && c.rank === '6')).toBe(true);
  });

  it('lets the player decline the reveal\'s bonus entirely (John\'s house rule) — revealed cards are still banished, but no value is added', () => {
    const boss: LegacyEnemySpec = { name: 'Sporeling', suit: 'S', health: 100, attack: 1 };
    let state = startCrimsonMission(1, [boss]);
    state = structuredClone(state);
    state.tavernDeck = [suited('C', '6'), suited('D', '2'), suited('D', '2'), suited('D', '2'), ...state.tavernDeck];
    const reserveBefore = state.tavernDeck.length;
    state = rig(state, [reaverCard('D', '4')]);

    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.turnPhase).toBe('AWAIT_REAVER_REVEAL_COUNT');
    state = chooseMaxReaverRevealCount(state);

    expect(state.turnPhase).toBe('AWAIT_REAVER_REVEAL');
    res = ensureOk(applyAction(state, { type: 'DECLINE_REAVER_REVEAL', playerId: state.players[0].id }));
    state = res.state;

    // 4 * 2 (Reaver's own doubling, unconditional) = 8 — no bonus from the declined reveal.
    expect(state.currentEnemy?.damageTaken).toBe(8);
    expect(state.turnPhase).not.toBe('AWAIT_REAVER_REVEAL');
    expect(state.tavernDeck.length).toBe(reserveBefore - 4); // still revealed (and consumed) even though declined
    expect(state.banishPile.filter((c) => c.kind === 'suited' && c.rank === '2').length).toBe(3);
    expect(state.banishPile.some((c) => c.kind === 'suited' && c.rank === '6')).toBe(true); // banished, not added to the attack
  });

  it('declining the bonus can preserve an exact kill (and its Mission 5 death-throes splash) that choosing a card would have overkilled', () => {
    const first: LegacyEnemySpec = { name: 'First Sporeling', suit: 'C', health: 8, attack: 7 };
    const second: LegacyEnemySpec = { name: 'Second Sporeling', suit: 'D', health: 20, attack: 3 };
    let state = startCrimsonMission(1, [first, second], { exactKillSplashDamage: true });
    state = structuredClone(state);
    state.tavernDeck = [suited('C', '5'), ...state.tavernDeck]; // a bonus that would overkill if chosen
    state = rig(state, [reaverCard('D', '4')]); // (4 + 0) * 2 (Reaver's own doubling) = 8, an exact kill

    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.turnPhase).toBe('AWAIT_REAVER_REVEAL_COUNT');
    state = chooseMaxReaverRevealCount(state);

    expect(state.turnPhase).toBe('AWAIT_REAVER_REVEAL');
    res = ensureOk(applyAction(state, { type: 'DECLINE_REAVER_REVEAL', playerId: state.players[0].id }));
    state = res.state;

    expect(state.currentEnemy?.name).toBe('Second Sporeling');
    expect(state.currentEnemy?.damageTaken).toBe(7); // First Sporeling's base attack (7), splashed in
  });

  it('doubles unconditionally on its own, and quadruples when combined with a Warrior (Clubs) card in the same play', () => {
    const boss: LegacyEnemySpec = { name: 'Sporeling', suit: 'H', health: 400, attack: 1 };
    let state = startCrimsonMission(1, [boss]);
    state = structuredClone(state);
    state.tavernDeck = [suited('S', '6'), suited('S', '1'), suited('S', '1'), suited('S', '1'), suited('S', '1'), ...state.tavernDeck];
    state = rig(state, [suited('C', '5'), reaverCard('D', '5')]); // same-rank combo: Clubs 5 + Reaver 5

    let res = ensureOk(
      applyAction(state, {
        type: 'PLAY_CARDS',
        playerId: state.players[0].id,
        cardIds: state.players[0].hand.map((c) => c.id),
      }),
    );
    state = res.state;

    expect(state.turnPhase).toBe('AWAIT_REAVER_REVEAL_COUNT');
    expect(state.reaverRevealCountChoice?.maxCount).toBe(10);
    state = chooseMaxReaverRevealCount(state);

    expect(state.turnPhase).toBe('AWAIT_REAVER_REVEAL');
    expect(state.reaverReveal?.candidates.length).toBe(10); // reveal count = the whole play's combined total (5 Clubs + 5 Reaver), not just the Reaver's own rank
    const chosen = state.reaverReveal!.candidates.find((c) => c.rank === '6')!;
    res = ensureOk(applyAction(state, { type: 'CHOOSE_REAVER_REVEAL_CARD', playerId: state.players[0].id, cardId: chosen.id }));
    state = res.state;

    // (5 + 5 + 6) * 2 (Reaver) * 2 (Clubs) = 64.
    expect(state.currentEnemy?.damageTaken).toBe(64);
  });

  it("sourced correction (live play, 2026-08-30): the reveal count scales with the whole play's combined total, not just the Reaver's own rank — a Reaver-5 combo'd with another 5 (e.g. via the Kinfolk Flute) reveals 10, not 5", () => {
    const boss: LegacyEnemySpec = { name: 'Sporeling', suit: 'S', health: 100, attack: 1 };
    let state = startCrimsonMission(1, [boss]);
    state = structuredClone(state);
    state = rig(state, [suited('H', '5'), reaverCard('D', '5')]); // same-rank combo: Bard 5 + Reaver 5, no Clubs involved

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: state.players[0].hand.map((c) => c.id) }),
    );
    state = res.state;

    expect(state.turnPhase).toBe('AWAIT_REAVER_REVEAL_COUNT');
    expect(state.reaverRevealCountChoice?.maxCount).toBe(10);
    state = chooseMaxReaverRevealCount(state);

    expect(state.turnPhase).toBe('AWAIT_REAVER_REVEAL');
    expect(state.reaverReveal?.candidates.length).toBe(10);
  });

  it('reveals fewer cards than its rank if the reserve deck runs low, and still doubles even with nothing to add', () => {
    const boss: LegacyEnemySpec = { name: 'Sporeling', suit: 'S', health: 100, attack: 1 };
    let state = startCrimsonMission(1, [boss]);
    state = structuredClone(state);
    state.tavernDeck = []; // nothing left to reveal
    state = rig(state, [reaverCard('H', '3')]);

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    // (3 + 0) * 2 (Reaver's own doubling still applies even with no bonus to add) = 6.
    expect(state.currentEnemy?.damageTaken).toBe(6);
    expect(state.turnPhase).not.toBe('AWAIT_REAVER_REVEAL'); // resolved immediately — no window opened
  });

  it("confirmed live (2026-09-02): the player chooses HOW MANY cards to reveal (1 up to the play's total value), not forced to reveal all of them", () => {
    const boss: LegacyEnemySpec = { name: 'Sporeling', suit: 'S', health: 100, attack: 1 };
    let state = startCrimsonMission(1, [boss]);
    state = structuredClone(state);
    state.tavernDeck = [suited('C', '6'), suited('D', '2'), suited('D', '2'), suited('D', '2'), ...state.tavernDeck];
    const reserveBefore = state.tavernDeck.length;
    state = rig(state, [reaverCard('D', '4')]); // total value 4 — maxCount should be 4

    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.turnPhase).toBe('AWAIT_REAVER_REVEAL_COUNT');
    expect(state.reaverRevealCountChoice?.maxCount).toBe(4);

    // Choosing 2 (less than the max of 4) reveals only the top 2 cards, not all 4.
    res = ensureOk(applyAction(state, { type: 'CHOOSE_REAVER_REVEAL_COUNT', playerId: state.players[0].id, count: 2 }));
    state = res.state;

    expect(state.turnPhase).toBe('AWAIT_REAVER_REVEAL');
    expect(state.reaverReveal?.allRevealed.length).toBe(2);
    expect(state.reaverReveal?.candidates.length).toBe(2); // both revealed cards happen to be suited (D-2, D-2)
    expect(state.tavernDeck.length).toBe(reserveBefore - 2); // only 2 cards pulled off the reserve deck, not 4

    const chosen = state.reaverReveal!.candidates[0];
    res = ensureOk(applyAction(state, { type: 'CHOOSE_REAVER_REVEAL_CARD', playerId: state.players[0].id, cardId: chosen.id }));
    state = res.state;

    // Only the 2 revealed cards are banished — the other 2 (that would have been pulled at count=4) stay untouched
    // in the reserve deck, which is the whole point of choosing a smaller count.
    expect(state.banishPile.length).toBe(2);
    expect(state.tavernDeck.some((c) => c.kind === 'suited' && c.rank === '6')).toBe(true); // the Clubs 6 never got pulled
  });

  it("choosing a count of 1 is the safest play: the single revealed card is either the only candidate (auto-taken) or costs nothing but itself", () => {
    const boss: LegacyEnemySpec = { name: 'Sporeling', suit: 'S', health: 100, attack: 1 };
    let state = startCrimsonMission(1, [boss]);
    state = structuredClone(state);
    state.tavernDeck = [suited('C', '9'), ...state.tavernDeck];
    state = rig(state, [reaverCard('D', '5')]);

    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;
    res = ensureOk(applyAction(state, { type: 'CHOOSE_REAVER_REVEAL_COUNT', playerId: state.players[0].id, count: 1 }));
    state = res.state;

    expect(state.turnPhase).toBe('AWAIT_REAVER_REVEAL');
    expect(state.reaverReveal?.candidates.length).toBe(1);
    expect(state.reaverReveal?.candidates[0].rank).toBe('9');
  });

  it('rejects a chosen count outside [1, maxCount]', () => {
    const boss: LegacyEnemySpec = { name: 'Sporeling', suit: 'S', health: 100, attack: 1 };
    let state = startCrimsonMission(1, [boss]);
    state = rig(state, [reaverCard('D', '4')]);

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(applyAction(state, { type: 'CHOOSE_REAVER_REVEAL_COUNT', playerId: state.players[0].id, count: 0 }).ok).toBe(false);
    expect(applyAction(state, { type: 'CHOOSE_REAVER_REVEAL_COUNT', playerId: state.players[0].id, count: 5 }).ok).toBe(false); // maxCount is 4
    expect(applyAction(state, { type: 'CHOOSE_REAVER_REVEAL_COUNT', playerId: state.players[0].id, count: 1.5 }).ok).toBe(false);
  });

  it("the engine's generic presetMissionZone capability still seeds a fixed, static set of cards at mission start (no longer how Mission 5 itself uses Myla — see the mission-5 reward describe block below)", () => {
    const boss: LegacyEnemySpec = { name: 'Sporeling', suit: 'S', health: 20, attack: 5 };
    const myla: Card = { id: 'myla', kind: 'suited', suit: 'H', rank: '7', name: 'Myla' };
    const state = startCrimsonMission(1, [boss], { presetMissionZone: [myla] });

    expect(state.missionZone.length).toBe(1);
    expect(state.zoneImmuneSuits).toEqual(['H']);
    expect(state.endOfTurnZoneFlip).toBe(false); // static — never flips or clears on its own
  });

  it('deals an exact kill\'s base attack as splash damage into the newly revealed enemy', () => {
    const first: LegacyEnemySpec = { name: 'First Sporeling', suit: 'C', health: 10, attack: 7 };
    const second: LegacyEnemySpec = { name: 'Second Sporeling', suit: 'D', health: 20, attack: 3 };
    let state = startCrimsonMission(1, [first, second], { exactKillSplashDamage: true });
    state = rig(state, [suited('S', '10')]); // exact 10 damage, Spades doesn't double

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.currentEnemy?.name).toBe('Second Sporeling');
    expect(state.currentEnemy?.damageTaken).toBe(7); // First Sporeling's base attack (7), splashed in
  });

  it('recycles the top card of the BANISH pile (not the reserve deck) into the rolling zone every turn, accumulating instead of replacing', () => {
    const boss: LegacyEnemySpec = { name: 'Sporeling', suit: 'S', health: 100, attack: 1 };
    let state = startCrimsonMission(1, [boss], { rollingZoneBonus: true });
    state = structuredClone(state);
    state.banishPile = [suited('C', '4'), suited('D', '2')]; // 'D'-2 is on top — popped first
    state = rig(state, [suited('H', '3'), suited('H', '3')]); // enough hand to cover 2 turns of the 1-attack boss
    expect(state.rollingZoneCards).toEqual([]); // nothing recycled in yet — only happens at end of turn

    // Turn 1: yield -> AWAIT_DEFEND (solo game, live enemy attack) -> defend to trigger the end-of-turn cycle.
    let res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));
    state = res.state;
    res = ensureOk(applyAction(state, { type: 'DEFEND', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    // The rolling zone picked up the banish pile's top card ('D'-2), and the reserve deck was never touched.
    expect(state.rollingZoneCards).toMatchObject([{ suit: 'D', rank: '2' }]);
    expect(state.banishPile).toMatchObject([{ suit: 'C', rank: '4' }]);

    // Turn 2: the 'C'-4 recycles in too, ON TOP of the 'D'-2 — accumulating, not replacing it.
    res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));
    state = res.state;
    res = ensureOk(applyAction(state, { type: 'DEFEND', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.rollingZoneCards).toMatchObject([{ suit: 'D', rank: '2' }, { suit: 'C', rank: '4' }]);
    expect(state.banishPile).toEqual([]); // the whole pile has been recycled out
  });

  it("buffs the current enemy's attack by the rolling zone's combined value, not just the most recent card", () => {
    const boss: LegacyEnemySpec = { name: 'Sporeling', suit: 'S', health: 100, attack: 5 };
    let state = startCrimsonMission(1, [boss], { rollingZoneBonus: true });
    state = structuredClone(state);
    state.rollingZoneCards = [suited('C', '4'), suited('D', '3')]; // pretend 2 cards already accumulated
    state = rig(state, [suited('D', '12')]); // covers the buffed attack exactly

    const res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));
    state = res.state;
    expect(state.pendingDamage).toBe(12); // 5 base + 4 + 3 from both cards still accumulated in the zone
  });

  it('an enemy kill banishes the whole rolling-zone accumulation back to the banish pile and resets it to empty', () => {
    const boss: LegacyEnemySpec = { name: 'Sporeling', suit: 'H', health: 10, attack: 1 };
    let state = startCrimsonMission(1, [boss], { rollingZoneBonus: true });
    state = structuredClone(state);
    state.rollingZoneCards = [suited('C', '4'), suited('D', '3')]; // accumulated across a couple of turns
    state = rig(state, [suited('S', '10')]); // exact 10 damage, Spades doesn't double

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );
    state = res.state;

    expect(state.currentEnemy).toBeNull(); // no more enemies left — the mission is won
    expect(state.rollingZoneCards).toEqual([]);
    expect(state.banishPile).toMatchObject([{ suit: 'C', rank: '4' }, { suit: 'D', rank: '3' }]);
  });

  it('REGRESSION (playtest cross-check, 2026-08-28): the ACTUAL mission-5 definition seeds Reaver cards into its own fight, so the banish pile — and the rolling zone buff it feeds — isn\'t permanently inert in real play', () => {
    // Earlier bug: mission-5's extraReserveCards carried Myla only; the only Reaver cards ever created for this
    // campaign came from reward.recruits, granted AFTER the mission already ended. With zero Reaver cards ever
    // playable during the fight itself, nothing could ever call banishCards, so rollingZoneBonus's accumulator
    // (fed exclusively from the banish pile — see rollMissionZoneBonusCard) could never grow no matter how the
    // fight was played. This test uses the mission's own real definition end-to-end (not a hand-rigged banishPile,
    // unlike the accumulation-mechanics test above) to prove that's no longer true.
    const mission5 = getMission(5)!;

    // Structural guard on the root cause: Mission 5's own fight setup must actually include playable Reaver
    // cards, not just Myla.
    const reaverSetupCards = mission5.extraReserveCards?.filter((c) => c.kind === 'suited' && c.reaver) ?? [];
    expect(reaverSetupCards.length).toBeGreaterThan(0);

    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ['p0'],
      playerNames: ['Player 0'],
      seed: 'crimson-regression-test',
      party: buildInitialParty(),
      enemies: missionEnemiesToSpecs(mission5.enemies),
      jesterCount: 0,
      extraReserveCards: mission5.extraReserveCards,
      rollingZoneBonus: mission5.rollingZoneBonus,
      exactKillSplashDamage: mission5.exactKillSplashDamage,
    });
    if (!res.ok) throw new Error(res.error);
    let state = res.state;
    expect(state.banishPile).toEqual([]);
    expect(state.rollingZoneCards).toEqual([]);

    // Simulate having drawn one of the mission's own Reaver companions into hand (the deterministic equivalent of
    // it eventually coming up in the shuffled reserve deck during real play), and play it against the live enemy.
    // Deliberately picked as a non-Clubs Reaver so playing it alone doesn't also trigger Warrior doubling and
    // overkill the boss — this test is about the banish pile/rolling zone plumbing, not attack math.
    const drawnReaver = reaverSetupCards.find((c) => c.kind === 'suited' && c.suit !== 'C') as SuitedCard;
    expect(drawnReaver).toBeDefined();
    state = structuredClone(state);
    state.tavernDeck = [suited('C', '6'), ...state.tavernDeck]; // top card the Reaver tears and banishes
    // A second hand card, untouched by the Reaver play, to cover the boss's own attack once the turn is yielded.
    state = rig(state, [{ ...drawnReaver, id: 'hand-reaver' }, suited('D', '10')]);

    let step = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: ['hand-reaver'] }));
    state = step.state;

    expect(state.turnPhase).toBe('AWAIT_REAVER_REVEAL_COUNT');
    state = chooseMaxReaverRevealCount(state);

    expect(state.turnPhase).toBe('AWAIT_REAVER_REVEAL');
    const chosen = state.reaverReveal!.candidates.find((c) => c.kind === 'suited' && c.suit === 'C' && c.rank === '6')!;
    step = ensureOk(applyAction(state, { type: 'CHOOSE_REAVER_REVEAL_CARD', playerId: state.players[0].id, cardId: chosen.id }));
    state = step.state;

    // The Reaver's own reveal-and-add mechanic actually fired: the banish pile now holds the torn reserve card.
    expect(state.banishPile.some((c) => c.kind === 'suited' && c.suit === 'C' && c.rank === '6')).toBe(true);
    expect(state.currentEnemy).not.toBeNull(); // not an overkill — still fighting the same boss

    // A non-killing attack immediately triggers the enemy's own counter-attack (AWAIT_DEFEND) within this same
    // action — cover it so the turn actually ends and rollMissionZoneBonusCard's end-of-turn cycle runs.
    expect(state.turnPhase).toBe('AWAIT_DEFEND');
    step = ensureOk(applyAction(state, { type: 'DEFEND', playerId: state.players[0].id, cardIds: state.players[0].hand.map((c) => c.id) }));
    state = step.state;
    expect(state.phase).not.toBe('LOST');

    // The rolling zone actually accumulated a banished card — the buff is no longer permanently stuck at zero.
    // (The Reaver's reveal banishes every card it turned up, not just the chosen one, so which one ends up on
    // top of the banish pile — and thus gets pulled into the rolling zone first — isn't the C-6 specifically.)
    expect(state.rollingZoneCards.length).toBeGreaterThan(0);
    expect(missionZoneValueSum(state.rollingZoneCards)).toBeGreaterThan(0);
  });
});

describe('legacy: mission 6 mechanics (zone vengeance on kill)', () => {
  function startGardenMission(n: number, enemies: LegacyEnemySpec[], presetMissionZone: Card[]): GameState {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const names = Array.from({ length: n }, (_, i) => `Player ${i}`);
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ids,
      playerNames: names,
      seed: 'garden-test',
      party: buildInitialParty(),
      enemies,
      jesterCount: 0,
      presetMissionZone,
      zoneVengeanceOnKill: true,
    });
    if (!res.ok) throw new Error(res.error);
    return res.state;
  }

  const myla: Card = { id: 'myla', kind: 'suited', suit: 'H', rank: '7', name: 'Myla' };

  /** Resolves an open AWAIT_ZONE_VENGEANCE_CHOICE window for the current player. */
  function chooseSacrifice(state: GameState, cardId: string): GameState {
    return ensureOk(applyAction(state, { type: 'CHOOSE_ZONE_VENGEANCE_SACRIFICE', playerId: state.players[0].id, cardId })).state;
  }

  it('sourced fix: opens a player choice instead of auto-sacrificing — the card never falls to the mission zone until chosen', () => {
    const boss: LegacyEnemySpec = { name: 'Statue', suit: 'S', health: 8, attack: 1 };
    let state = startGardenMission(1, [boss], [myla]);
    state = rig(state, [suited('D', '9')]);

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.turnPhase).toBe('AWAIT_ZONE_VENGEANCE_CHOICE');
    expect(state.zoneVengeanceChoice).toEqual({ remaining: -1, attackIncludesGuardian: false, attackIncludesMage: false });
    expect(state.missionZone.length).toBe(1); // Myla only — nothing sacrificed yet
    expect(state.currentEnemy?.tableCards.some((c) => c.kind === 'suited' && c.suit === 'D' && c.rank === '9')).toBe(true);

    state = chooseSacrifice(state, state.currentEnemy!.tableCards[0].id);

    expect(state.missionZone.length).toBe(2); // Myla + the chosen 9
    expect(state.missionZone.some((c) => c.kind === 'suited' && c.suit === 'D' && c.rank === '9')).toBe(true);
    expect(state.discardPile.some((c) => c.kind === 'suited' && c.suit === 'D' && c.rank === '9')).toBe(false);
  });

  it('sourced fix: the player may sacrifice ANY card from the play area, not just the lowest-value one', () => {
    // Three separate turns' worth of cards pile up on the boss's table before the killing blow — the shipped
    // auto-sacrifice would always take the lowest (the 3). This proves the player can choose otherwise.
    const boss: LegacyEnemySpec = { name: 'Statue', suit: 'S', health: 15, attack: 0 };
    const next: LegacyEnemySpec = { name: 'Next Statue', suit: 'C', health: 20, attack: 1 };
    let state = startGardenMission(1, [boss, next], [myla]);

    state = rig(state, [suited('D', '3')]);
    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] })).state;
    expect(state.turnPhase).toBe('AWAIT_PLAY'); // enemy attack is 0 — turn just advances, no kill yet

    state = rig(state, [suited('S', '4')]);
    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] })).state;
    expect(state.turnPhase).toBe('AWAIT_PLAY');

    state = rig(state, [suited('H', '8')]); // 3 + 4 + 8 = 15 — exact kill
    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] })).state;
    expect(state.turnPhase).toBe('AWAIT_ZONE_VENGEANCE_CHOICE');
    expect(state.currentEnemy?.tableCards.length).toBe(3);

    // Deliberately sacrifice the middle-value card (4), not the lowest (3).
    const chosen = state.currentEnemy!.tableCards.find((c) => c.kind === 'suited' && c.suit === 'S' && c.rank === '4')!;
    state = chooseSacrifice(state, chosen.id);

    expect(state.missionZone.some((c) => c.kind === 'suited' && c.suit === 'S' && c.rank === '4')).toBe(true);
    expect(state.discardPile.some((c) => c.kind === 'suited' && c.suit === 'D' && c.rank === '3')).toBe(true);
    expect(state.discardPile.some((c) => c.kind === 'suited' && c.suit === 'H' && c.rank === '8')).toBe(true);
    expect(state.discardPile.some((c) => c.kind === 'suited' && c.suit === 'S' && c.rank === '4')).toBe(false);
  });

  it("Myla strikes for the zone's live sum right after the chosen sacrifice lands, routed through AWAIT_DEFEND", () => {
    const boss: LegacyEnemySpec = { name: 'Statue', suit: 'S', health: 8, attack: 1 };
    const next: LegacyEnemySpec = { name: 'Next Statue', suit: 'D', health: 20, attack: 1 };
    let state = startGardenMission(1, [boss, next], [myla]);
    state = rig(state, [suited('D', '9')]);

    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] })).state;
    state = chooseSacrifice(state, state.currentEnemy!.tableCards[0].id);

    // Overkill (8 health, 9 damage) — not an exact kill, so no card is spared: 7 (Myla) + 9 = 16.
    expect(state.turnPhase).toBe('AWAIT_DEFEND');
    expect(state.pendingDamage).toBe(16);
  });

  it("sourced fix: an exact-damage kill opens a choice to permanently discard one non-Myla zone card before Myla's strike", () => {
    const boss: LegacyEnemySpec = { name: 'Statue', suit: 'S', health: 9, attack: 1 };
    const next: LegacyEnemySpec = { name: 'Next Statue', suit: 'D', health: 20, attack: 1 };
    let state = startGardenMission(1, [boss, next], [myla]);
    state = rig(state, [suited('D', '9')]);

    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] })).state;
    state = chooseSacrifice(state, state.currentEnemy!.tableCards[0].id);

    // Exact kill: zone becomes [Myla(7), 9] — the 1st-edition reading just excluded the 9 from this one strike
    // and left it in the zone forever; the 2nd-edition errata instead makes the player permanently discard one
    // non-Myla card first.
    expect(state.missionZone.length).toBe(2);
    expect(state.turnPhase).toBe('AWAIT_ZONE_RELIEF_CHOICE');
    expect(state.zoneReliefChoice).toEqual({ attackIncludesGuardian: false, remaining: 0 });

    const nine = state.missionZone.find((c) => c.kind === 'suited' && c.suit === 'D' && c.rank === '9')!;
    // Myla herself is never an eligible pick.
    expect(applyAction(state, { type: 'CHOOSE_ZONE_RELIEF_CARD', playerId: state.players[0].id, cardId: state.missionZone[0].id }).ok).toBe(false);
    state = ensureOk(applyAction(state, { type: 'CHOOSE_ZONE_RELIEF_CARD', playerId: state.players[0].id, cardId: nine.id })).state;

    expect(state.missionZone.length).toBe(1); // Myla only — the 9 is gone for good, not just excluded this once
    expect(state.discardPile.some((c) => c.kind === 'suited' && c.suit === 'D' && c.rank === '9')).toBe(true);
    expect(state.turnPhase).toBe('AWAIT_DEFEND');
    expect(state.pendingDamage).toBe(7); // just Myla's own 7 — the 9 no longer counts toward the total at all
  });

  it('sourced fix: a winning attack that includes a Guardian cancels the strike entirely, but an exact kill still opens zone relief', () => {
    const boss: LegacyEnemySpec = { name: 'Statue', suit: 'S', health: 5, attack: 1 };
    const next: LegacyEnemySpec = { name: 'Next Statue', suit: 'D', health: 20, attack: 1 };
    let state = startGardenMission(1, [boss, next], [myla]);
    const shield: SuitedCard = { ...suited('D', '5'), guardian: true };
    state = rig(state, [shield]);

    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] })).state;
    expect(state.zoneVengeanceChoice).toEqual({ remaining: 0, attackIncludesGuardian: true, attackIncludesMage: false });
    state = chooseSacrifice(state, state.currentEnemy!.tableCards[0].id);

    expect(state.missionZone.length).toBe(2); // the zone still grows — sacrifice isn't affected by the Guardian
    // 5 damage on 5 health is ALSO an exact kill — the errata is explicit a Guardian only cancels the team-damage
    // step below, not this discard, so the relief choice still opens even though a Guardian is in this attack.
    expect(state.turnPhase).toBe('AWAIT_ZONE_RELIEF_CHOICE');
    expect(state.zoneReliefChoice).toEqual({ attackIncludesGuardian: true, remaining: 0 });

    const zoneCard = state.missionZone.find((c) => c.kind === 'suited' && c.suit === 'D' && c.rank === '5')!;
    state = ensureOk(applyAction(state, { type: 'CHOOSE_ZONE_RELIEF_CARD', playerId: state.players[0].id, cardId: zoneCard.id })).state;

    expect(state.missionZone.length).toBe(1); // Myla only — the sacrificed 5 was discarded via zone relief
    expect(state.discardPile.some((c) => c.kind === 'suited' && c.suit === 'D' && c.rank === '5')).toBe(true);
    expect(state.turnPhase).toBe('AWAIT_PLAY'); // no Myla strike — same player continues, no AWAIT_DEFEND
    expect(state.pendingDamage).toBe(0);
  });

  it('rejects a sacrifice choice from the wrong player, wrong phase, or a card not on the table', () => {
    const boss: LegacyEnemySpec = { name: 'Statue', suit: 'S', health: 8, attack: 1 };
    let state = startGardenMission(2, [boss], [myla]);
    state = rig(state, [suited('D', '9')]);
    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] })).state;

    const cardId = state.currentEnemy!.tableCards[0].id;
    expect(applyAction(state, { type: 'CHOOSE_ZONE_VENGEANCE_SACRIFICE', playerId: state.players[1].id, cardId }).ok).toBe(false);
    expect(applyAction(state, { type: 'CHOOSE_ZONE_VENGEANCE_SACRIFICE', playerId: state.players[0].id, cardId: 'not-a-real-card' }).ok).toBe(false);

    state = chooseSacrifice(state, cardId);
    expect(
      applyAction(state, { type: 'CHOOSE_ZONE_VENGEANCE_SACRIFICE', playerId: state.players[0].id, cardId }).ok,
    ).toBe(false); // window already closed
  });

  it('leaves the mission zone permanently grown after a kill — nothing clears it', () => {
    const boss: LegacyEnemySpec = { name: 'Statue', suit: 'S', health: 5, attack: 1 };
    let state = startGardenMission(1, [boss], [myla]);
    state = rig(state, [suited('H', '5')]);

    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] })).state;
    state = chooseSacrifice(state, state.currentEnemy!.tableCards[0].id);

    expect(state.missionZone.length).toBe(2); // Myla + the sacrificed 5, permanently
  });

  it('UNSOURCED BALANCE FIX: the growing mission zone never grants suit immunity — a boss stays immune to only its own suit', () => {
    const boss: LegacyEnemySpec = { name: 'Statue', suit: 'S', health: 5, attack: 1 };
    const next: LegacyEnemySpec = { name: 'Next Statue', suit: 'C', health: 20, attack: 1 };
    let state = startGardenMission(1, [boss, next], [myla]);
    expect(state.zoneImmuneSuits).toEqual([]); // Myla (Hearts) is in the zone from the very start, but grants nothing

    state = rig(state, [suited('H', '5')]); // exact kill
    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] })).state;
    state = chooseSacrifice(state, state.currentEnemy!.tableCards[0].id); // sacrifices the Hearts 5 into the zone

    expect(state.missionZone.length).toBe(2); // Myla (H) + the sacrificed 5 (H) — zone now holds 2 Hearts cards
    expect(state.zoneImmuneSuits).toEqual([]); // still grants no suit immunity, no matter how the zone grows
    // The next boss (Clubs) is immune to its own suit only — never to Hearts, despite the zone being all-Hearts.
    expect(state.currentEnemy?.suit).toBe('C');
    expect(state.currentEnemy?.secondSuit).toBeUndefined();
  });

  it('BUG FIX: Myla is not duplicated between the mission zone and the party/reserve deck when she was already recruited (Mission 5)', () => {
    // By the time Mission 6 starts, a real Myla card already lives permanently in the party (granted by Mission
    // 5's own reward — see missions.ts's Mission 5 recruits). presetMissionZone seeds a SEPARATE freshly-built
    // Myla card (zoneCompanion) straight into the mission zone; without filtering the party's copy out, both
    // would exist at once — one locked in the zone, one still drawable and playable from the reserve deck/hand.
    const recruitedMyla: Card = { id: 'party-myla', kind: 'suited', suit: 'H', rank: '7', name: 'Myla', noSuitPower: true };
    const boss: LegacyEnemySpec = { name: 'Statue', suit: 'S', health: 8, attack: 1 };
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ['p0'],
      playerNames: ['Player 0'],
      seed: 'myla-dup-test',
      party: [...buildInitialParty(), recruitedMyla],
      enemies: [boss],
      jesterCount: 0,
      presetMissionZone: [myla],
      zoneVengeanceOnKill: true,
    });
    const state = ensureOk(res).state;

    const allDealtAndDrawableCards = [...state.tavernDeck, ...state.players.flatMap((p) => p.hand)];
    const mylaCopiesOutsideZone = allDealtAndDrawableCards.filter((c) => c.kind === 'suited' && c.name === 'Myla');
    expect(mylaCopiesOutsideZone).toEqual([]);
    expect(state.missionZone.filter((c) => c.kind === 'suited' && c.name === 'Myla').length).toBe(1);
  });
});

describe('legacy: mission 6 setup, bug fix — Guardian cards seeded as fight setup, not just the eventual reward', () => {
  it('seeds all 4 Guardian faction cards into extraReserveCards — before this fix, no Guardian card existed anywhere until the mission was already won', () => {
    const mission6 = getMission(6)!;
    expect(mission6.extraReserveCards?.length).toBe(4);
    expect(mission6.extraReserveCards?.every((c) => c.kind === 'suited' && c.guardian)).toBe(true);
    expect(mission6.extraReserveCards?.some((c) => c.kind === 'suited' && c.name === 'Ferro')).toBe(true);
    // The base 40-card party alone (no extraReserveCards) has zero Guardian cards — confirming the fight-setup
    // seeding above, not the base party, is what makes the mission's own Guardian-cancels-Myla mechanic
    // (zoneVengeanceOnKill) reachable during Mission 6 itself instead of only after it's already won.
    expect(buildInitialParty().some((c) => c.kind === 'suited' && c.guardian)).toBe(false);
  });

  it('shuffles the 4 fight-setup Guardian cards into the live reserve deck at mission start, alongside the party', () => {
    const mission6 = getMission(6)!;
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ['p0'],
      playerNames: ['Player 0'],
      seed: 'garden-setup-test',
      party: buildInitialParty(),
      enemies: missionEnemiesToSpecs(mission6.enemies),
      jesterCount: 0,
      presetMissionZone: mission6.presetMissionZone,
      zoneVengeanceOnKill: mission6.zoneVengeanceOnKill,
      extraReserveCards: mission6.extraReserveCards,
    });
    const state = ensureOk(res).state;
    expect(state.missionZone.length).toBe(1); // Myla, preset per presetMissionZone
    const allCirculatingCards = [...state.players.flatMap((p) => p.hand), ...state.tavernDeck];
    // 40 party + 4 fight-setup Guardians = 44 total in circulation (Myla's preset zone card isn't drawable).
    expect(allCirculatingCards.length).toBe(44);
    expect(allCirculatingCards.filter((c) => c.kind === 'suited' && c.guardian).length).toBe(4);
  });

  it("playing one of the mission's own fight-setup Guardian cards in the winning attack cancels Myla's strike entirely", () => {
    const mission6 = getMission(6)!;
    const ferro = mission6.extraReserveCards!.find((c) => c.kind === 'suited' && c.name === 'Ferro')!;
    // Boss suit deliberately not Spades (Ferro's suit) — a Guardian's shield power is never immunity-gated (see
    // engine.ts's guardianCards handling), but keeping suits distinct rules that out as a confound for this test.
    const boss: LegacyEnemySpec = { name: 'Statue', suit: 'H', health: 3, attack: 1 };
    const next: LegacyEnemySpec = { name: 'Next Statue', suit: 'D', health: 20, attack: 1 };

    const started = ensureOk(
      applyAction(createLobbyState(), {
        type: 'START_LEGACY_MISSION',
        playerIds: ['p0'],
        playerNames: ['Player 0'],
        seed: 'garden-guardian-test',
        party: buildInitialParty(),
        enemies: [boss, next],
        jesterCount: 0,
        presetMissionZone: mission6.presetMissionZone,
        zoneVengeanceOnKill: mission6.zoneVengeanceOnKill,
        extraReserveCards: mission6.extraReserveCards,
      }),
    );
    let state = rig(started.state, [ferro]); // Ferro (value 3) exactly kills the 3-health boss

    state = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    ).state;

    expect(state.turnPhase).toBe('AWAIT_ZONE_VENGEANCE_CHOICE');
    expect(state.zoneVengeanceChoice?.attackIncludesGuardian).toBe(true);

    state = ensureOk(
      applyAction(state, {
        type: 'CHOOSE_ZONE_VENGEANCE_SACRIFICE',
        playerId: state.players[0].id,
        cardId: state.currentEnemy!.tableCards[0].id,
      }),
    ).state;

    // Exact kill (Ferro's value 3 on a 3-health boss) — the relief choice opens even under this same attack's
    // own Guardian, since the errata only has the Guardian cancel the team-damage step, not this discard.
    expect(state.missionZone.length).toBe(2);
    expect(state.turnPhase).toBe('AWAIT_ZONE_RELIEF_CHOICE');

    const zoneFerro = state.missionZone.find((c) => c.id === ferro.id)!;
    state = ensureOk(
      applyAction(state, { type: 'CHOOSE_ZONE_RELIEF_CARD', playerId: state.players[0].id, cardId: zoneFerro.id }),
    ).state;

    expect(state.missionZone.length).toBe(1); // Myla only — Ferro was discarded via zone relief
    expect(state.turnPhase).toBe('AWAIT_PLAY'); // no Myla strike, no AWAIT_DEFEND
    expect(state.pendingDamage).toBe(0);
  });
});

describe('legacy: mission 5 reward (rank-5 Reaver kept, Myla joins with no ability, Goran gains a second suit, a player-chosen Reaver sticker, Dual-class Stickers, corrupt-another-card)', () => {
  it('keeps only the Reaver recruit (Haror, rank 5) permanently — not all 4 originally shipped, and not rank 3', () => {
    // Sourced research (regicidelegacy.com compendium / BGG threads / a fan digital reimplementation's rules
    // doc) found the shipped version over-granted: this repo's own mission-5 transcript note ("how to
    // permanently retire cards from the party roster, used here to trim the new Reavers back down after the
    // mission") and the sourced material agree only Haror survives. Ranks are 3/5/7/9 (John's ruling). Confirmed
    // live (2026-08-30): Haror is the rank-5 one, not rank 3 as an earlier reading had it — see missions.ts's
    // Mission 5 extraReserveCards for the corresponding fight-setup rank swap.
    const mission5 = getMission(5)!;
    const reavers = mission5.reward.recruits.filter((r) => r.class === 'REAVER');
    expect(reavers.length).toBe(1);
    expect(reavers[0]).toMatchObject({ name: 'Haror', rank: '5' });
  });

  it('rewards Myla as a joinable rank-7 card with NO class power, a second round of Dual-class Stickers, and a corrupt-another-card effect', () => {
    const mission5 = getMission(5)!;
    const myla = mission5.reward.recruits.find((r) => r.name === 'Myla');
    expect(myla?.rank).toBe('7');
    expect(myla?.noSuitPower).toBe(true);
    expect(mission5.reward.dualClassStickers).toBe(4);
    expect(mission5.reward.corruptAnotherCard).toBe(true);

    const party = applyReward(buildInitialParty(), mission5.reward);
    const mylaCard = party.find((c) => c.kind === 'suited' && c.name === 'Myla');
    expect(mylaCard).toBeDefined();
    if (mylaCard?.kind === 'suited') {
      expect(mylaCard.suit).toBe('H'); // kept for identity/immunity bookkeeping, even with no live suit power
      expect(mylaCard.noSuitPower).toBe(true);
      expect(mylaCard.guardian).toBeUndefined();
      expect(mylaCard.reaver).toBeUndefined();
    }
    // The corrupt-another-card effect landed on some existing party member, never on Myla or Haror themselves.
    const corrupted = party.filter((c) => c.kind === 'suited' && c.corrupted);
    expect(corrupted.length).toBe(1);
    expect(corrupted[0].name).not.toBe('Myla');
    expect(corrupted[0].name).not.toBe('Haror');
  });

  it('recruits Goran inert at Mission 4, then switches on Clubs/Warrior as his real suit at Mission 5, confirmed live', () => {
    const mission4 = getMission(4)!;
    const mission5 = getMission(5)!;
    expect(mission5.reward.suitByName).toEqual({ name: 'Goran', suit: 'C' });

    let party = applyReward(buildInitialParty(), mission4.reward);
    const goranAfterM4 = party.find((c) => c.kind === 'suited' && c.name === 'Goran');
    expect(goranAfterM4).toBeDefined();
    if (goranAfterM4?.kind === 'suited') {
      expect(goranAfterM4.noSuitPower).toBe(true); // inert until Mission 5

    }

    party = applyReward(party, mission5.reward);
    const goran = party.find((c) => c.kind === 'suited' && c.name === 'Goran');
    expect(goran).toBeDefined();
    if (goran?.kind === 'suited') {
      expect(goran.noSuitPower).toBeFalsy(); // class power now live
      expect(goran.suit).toBe('C'); // Clubs/Warrior is now his working suit
    }
  });

  it('flags a player-chosen (not automatic) Reaver sticker as this mission\'s reward, unlike the Mage/Guardian stickers elsewhere', () => {
    const mission5 = getMission(5)!;
    expect(mission5.reward.reaverStickerChoice).toBe(true);
    // Deliberately not auto-applied by applyReward — no party card should ever come out of a Mission 5 reward
    // already carrying the sticker without the player having picked a target.
    const party = applyReward(buildInitialParty(), mission5.reward);
    expect(party.some((c) => c.kind === 'suited' && c.secondClassReaver)).toBe(false);
  });

  it('seeds Myla straight into the banish pile (presetBanishPile) instead of the static presetMissionZone, the rolling zone, or the reserve deck, per the newer sourced transcript', () => {
    const mission5 = getMission(5)!;
    expect(mission5.presetMissionZone).toBeUndefined();
    expect(mission5.extraReserveCards?.some((c) => c.kind === 'suited' && c.name === 'Myla')).toBe(false);
    expect(mission5.presetBanishPile?.some((c) => c.kind === 'suited' && c.name === 'Myla' && c.suit === 'H')).toBe(true);
  });

  it("sourced correction: Myla is NOT live from turn 1 — she starts in the banish pile and the enemy's first attack is unbuffed; only the end-of-turn recycle into the rolling zone (turn 2 onward) adds her +7", () => {
    const mission5 = getMission(5)!;
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ['p0'],
      playerNames: ['Player 0'],
      seed: 'crimson-myla-timing-test',
      party: buildInitialParty(),
      enemies: missionEnemiesToSpecs(mission5.enemies),
      jesterCount: 0,
      rollingZoneBonus: mission5.rollingZoneBonus,
      presetBanishPile: mission5.presetBanishPile,
    });
    if (!res.ok) throw new Error(res.error);
    let state = res.state;

    // Mission start: Myla is sitting in the banish pile, not yet live in the rolling zone.
    expect(state.banishPile.some((c) => c.kind === 'suited' && c.name === 'Myla')).toBe(true);
    expect(state.rollingZoneCards).toEqual([]);
    const baseAttack = state.currentEnemy!.baseAttack;

    // Turn 1: yield straight into the boss's live attack — the rolling zone is still empty, so no +7 yet.
    state = rig(state, [suited('H', '10'), suited('H', '10')]);
    let step = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));
    state = step.state;
    expect(state.pendingDamage).toBe(baseAttack);
    step = ensureOk(applyAction(state, { type: 'DEFEND', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = step.state;

    // End of turn 1's recycle pulls Myla out of the banish pile and into the rolling zone.
    expect(state.rollingZoneCards.some((c) => c.kind === 'suited' && c.name === 'Myla')).toBe(true);
    expect(state.banishPile.some((c) => c.kind === 'suited' && c.name === 'Myla')).toBe(false);

    // Turn 2: the same boss's attack is now buffed by Myla's +7.
    step = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));
    state = step.state;
    expect(state.pendingDamage).toBe(baseAttack + 7);
  });
});

describe('legacy: applyCorruptAnotherCard (mixed-bag reward primitive)', () => {
  it('permanently corrupts exactly one eligible existing party member', () => {
    const party = buildInitialParty();
    const result = applyCorruptAnotherCard(party);
    const corrupted = result.filter((c) => c.kind === 'suited' && c.corrupted);
    expect(corrupted.length).toBe(1);
  });

  it('never corrupts a card whose id is excluded (e.g. a recruit this same reward just granted)', () => {
    const party = buildInitialParty();
    const excludeIds = new Set(party.map((c) => c.id));
    const result = applyCorruptAnotherCard(party, excludeIds);
    expect(result).toEqual(party); // nothing eligible — every id was excluded
  });

  it('is a no-op on an already-fully-corrupted party', () => {
    const party = buildInitialParty().map((c) => (c.kind === 'suited' ? { ...c, corrupted: true } : c));
    const result = applyCorruptAnotherCard(party);
    expect(result).toEqual(party);
  });
});

describe('legacy: mission 6 reward, sourced fix (only the rank-3 Guardian kept, plus a player-chosen Guardian sticker)', () => {
  it('keeps only the rank-3 Guardian (Ferro) as a permanent recruit — ranks 5/7/9 are not granted', () => {
    const mission6 = getMission(6)!;
    expect(mission6.reward.recruits.length).toBe(1);
    expect(mission6.reward.recruits[0]).toMatchObject({ name: 'Ferro', class: 'GUARDIAN', rank: '3' });

    const party = applyReward(buildInitialParty(), mission6.reward);
    const guardians = party.filter((c) => c.kind === 'suited' && c.guardian);
    expect(guardians.length).toBe(1);
    expect(guardians[0].kind === 'suited' && guardians[0].name).toBe('Ferro');
  });

  it('flags a player-chosen (not automatic) Guardian sticker as this mission\'s reward, confirmed live 2026-09-02', () => {
    const mission6 = getMission(6)!;
    expect(mission6.reward.guardianStickerChoice).toBe(true);
    // Deliberately not auto-applied by applyReward — no party card should ever come out of a Mission 6 reward
    // already carrying the sticker without the player having picked a target.
    const party = applyReward(buildInitialParty(), mission6.reward);
    expect(party.some((c) => c.kind === 'suited' && c.secondClassGuardian)).toBe(false);
  });

  it('never offers Goran as a Guardian-sticker target, even though he is rank 8 and not yet Evergreen', () => {
    // Walk the real reward timeline up to the point the sticker is actually picked: Goran joins at Mission 4 and
    // is still an ordinary (non-Evergreen) rank-8 card here — Mission 9 is what sets `evergreen` on him — so
    // nothing else in guardianStickerEligible would have excluded him.
    let party = buildInitialParty();
    for (const id of [4, 5, 6]) party = applyReward(party, getMission(id)!.reward);
    const goran = party.find((c) => c.kind === 'suited' && c.name === 'Goran');
    expect(goran).toBeDefined();
    expect(goran?.kind === 'suited' && goran.rank).toBe('8');
    expect(goran?.kind === 'suited' && goran.evergreen).toBeFalsy();

    const eligible = party.filter(guardianStickerEligible);
    expect(eligible.length).toBeGreaterThan(0); // the ordinary rank-8s are still offered
    expect(eligible.some((c) => c.name === 'Goran')).toBe(false);

    // And the apply path refuses him too, not just the picker's filter.
    expect(applyGuardianStickerChoice(party, goran!.id)).toBe(party);
  });

  it('a Guardian recruit takes its explicit suit (Guardian has none of its own) and is flagged guardian', () => {
    const card = buildRecruitCard({ name: 'Test Guardian', class: 'GUARDIAN', rank: '5', suit: 'D' });
    expect(card.kind === 'suited' && card.guardian).toBe(true);
    expect(card.kind === 'suited' && card.suit).toBe('D');
  });

  it('also grants the Azure Emblem relic', () => {
    const mission6 = getMission(6)!;
    expect(mission6.reward.relics).toEqual(['AZURE_EMBLEM']);
  });

  it('gives Goran (switched on with Clubs/Warrior by Mission 5) Spades/Paladin as a real second suit, confirmed live 2026-09-02', () => {
    const mission4 = getMission(4)!;
    const mission5 = getMission(5)!;
    const mission6 = getMission(6)!;
    expect(mission6.reward.secondSuitByName).toEqual({ name: 'Goran', suit: 'S' });

    let party = applyReward(buildInitialParty(), mission4.reward);
    party = applyReward(party, mission5.reward);
    party = applyReward(party, mission6.reward);
    const goran = party.find((c) => c.kind === 'suited' && c.name === 'Goran');
    expect(goran).toBeDefined();
    if (goran?.kind === 'suited') {
      expect(goran.suit).toBe('C'); // Clubs/Warrior, live since Mission 5
      expect(goran.secondSuit).toBe('S'); // Spades/Paladin added here
    }
  });

  it('also carries the sourced-but-previously-missing "corrupt another card" effect', () => {
    const mission6 = getMission(6)!;
    expect(mission6.reward.corruptAnotherCard).toBe(true);
  });
});

describe('legacy: bonus Guardian sticker (secondClassGuardian — Mission 6\'s player-chosen reward, keeps its own suit power AND raises the shield)', () => {
  it('resolves both its printed suit power and the Guardian shield when played', () => {
    const boss: LegacyEnemySpec = { name: 'Test', suit: 'S', health: 100, attack: 20 };
    let state = startMission(1, [boss]);
    const stickered: SuitedCard = { ...suited('C', '4'), secondClassGuardian: true }; // Warrior + bonus shield
    state = rig(state, [stickered]);

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));

    expect(res.state.currentEnemy?.damageTaken).toBe(8); // Clubs doubles the play's value (4*2=8)
    expect(res.state.turnPhase).toBe('AWAIT_PLAY'); // the shield blocked the enemy's attack — no damage suffered
  });

  it('guardianStickerEligible restricts to rank 8, excluding anything already special or already stickered — any suit qualifies', () => {
    expect(guardianStickerEligible(suited('S', '8'))).toBe(true); // Paladin
    expect(guardianStickerEligible(suited('C', '8'))).toBe(true); // Warrior — unlike the Reaver sticker, not excluded
    expect(guardianStickerEligible(suited('D', '8'))).toBe(true); // Bard
    expect(guardianStickerEligible(suited('H', '8'))).toBe(true); // Cleric
    expect(guardianStickerEligible(suited('S', '7'))).toBe(false); // wrong rank
    expect(guardianStickerEligible({ ...suited('S', '8'), guardian: true })).toBe(false); // already a primary special class
    expect(guardianStickerEligible({ ...suited('S', '8'), secondClassGuardian: true })).toBe(false); // already stickered
  });

  it('applyGuardianStickerChoice applies the sticker to exactly the chosen card, and is a no-op for an ineligible id', () => {
    const target = suited('S', '8');
    const party = [target, suited('C', '8'), suited('H', '3')];

    const next = applyGuardianStickerChoice(party, target.id);
    const stickered = next.find((c) => c.id === target.id);
    expect(stickered?.kind === 'suited' && stickered.secondClassGuardian).toBe(true);
    expect(next.filter((c) => c.kind === 'suited' && c.secondClassGuardian).length).toBe(1);

    const unchanged = applyGuardianStickerChoice(party, 'not-a-real-id');
    expect(unchanged).toBe(party); // same reference — no-op
  });
});

describe('legacy: bonus Reaver sticker (secondClassReaver — Mission 5\'s player-chosen reward, keeps its own suit power AND triggers the full Reveal and Add mechanic)', () => {
  it('resolves both its printed suit power and the Reaver mechanic (reveal-and-add, unconditional doubling) when played', () => {
    const boss: LegacyEnemySpec = { name: 'Test', suit: 'S', health: 100, attack: 1 };
    let state = startMission(1, [boss]);
    state = structuredClone(state);
    // Hearts (Cleric) has no damage-affecting suit power of its own, so this isolates the Reaver math cleanly —
    // unlike the Guardian-sticker test above, which deliberately used Clubs to prove the suit power ALSO fires.
    state.tavernDeck = [suited('D', '9'), suited('S', '1'), suited('S', '1'), suited('S', '1'), suited('S', '1'), suited('S', '1'), ...state.tavernDeck];
    const stickered: SuitedCard = { ...suited('H', '6'), secondClassReaver: true }; // Cleric-6 + bonus Reaver sticker
    state = rig(state, [stickered]);

    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.turnPhase).toBe('AWAIT_REAVER_REVEAL_COUNT'); // the bonus sticker triggers a real reveal, not just a suit power
    state = chooseMaxReaverRevealCount(state);

    expect(state.turnPhase).toBe('AWAIT_REAVER_REVEAL');
    expect(state.reaverReveal?.candidates.length).toBe(6); // reveal count = the play's own total value (6), same as a pure Reaver
    const chosen = state.reaverReveal!.candidates.find((c) => c.rank === '9')!;
    res = ensureOk(applyAction(state, { type: 'CHOOSE_REAVER_REVEAL_CARD', playerId: state.players[0].id, cardId: chosen.id }));
    state = res.state;

    // (6 + 9) * 2 (Reaver's unconditional doubling, same as a pure Reaver card) = 30.
    expect(state.currentEnemy?.damageTaken).toBe(30);
  });

  it('reaverStickerEligible restricts to rank-6 Bard/Cleric/Paladin, excluding Warrior and anything already special or already stickered', () => {
    expect(reaverStickerEligible(suited('D', '6'))).toBe(true); // Bard
    expect(reaverStickerEligible(suited('H', '6'))).toBe(true); // Cleric
    expect(reaverStickerEligible(suited('S', '6'))).toBe(true); // Paladin
    expect(reaverStickerEligible(suited('C', '6'))).toBe(false); // Warrior — explicitly excluded
    expect(reaverStickerEligible(suited('H', '7'))).toBe(false); // wrong rank
    expect(reaverStickerEligible({ ...suited('H', '6'), reaver: true })).toBe(false); // already a primary special class
    expect(reaverStickerEligible({ ...suited('H', '6'), secondClassReaver: true })).toBe(false); // already stickered
  });

  it('applyReaverStickerChoice applies the sticker to exactly the chosen card, and is a no-op for an ineligible id', () => {
    const target = suited('D', '6');
    const party = [target, suited('C', '6'), suited('H', '3')];

    const next = applyReaverStickerChoice(party, target.id);
    const stickered = next.find((c) => c.id === target.id);
    expect(stickered?.kind === 'suited' && stickered.secondClassReaver).toBe(true);
    expect(next.filter((c) => c.kind === 'suited' && c.secondClassReaver).length).toBe(1);

    const unchanged = applyReaverStickerChoice(party, 'not-a-real-id');
    expect(unchanged).toBe(party); // same reference — no-op
  });
});

describe("legacy: Azure Emblem relic (mission 6), sourced fix — banks the Mage's OWN player's card", () => {
  function mageCard(suit: SuitedCard['suit'], rank: SuitedCard['rank']): SuitedCard {
    return { ...suited(suit, rank), arcane: true };
  }

  function startEmblemMission(n: number, enemies: LegacyEnemySpec[]): GameState {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const names = Array.from({ length: n }, (_, i) => `Player ${i}`);
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ids,
      playerNames: names,
      seed: 'emblem-test',
      party: buildInitialParty(),
      enemies,
      jesterCount: 0,
      relics: ['AZURE_EMBLEM'],
    });
    if (!res.ok) throw new Error(res.error);
    return res.state;
  }

  /** Fully controls the reserve deck so a single mage4's own reveal (4 cards, its own attack strength) is deterministic — none are Jesters/corrupted, so all 4 become choosable candidates. */
  function mageRevealDeck(chosen: SuitedCard): Card[] {
    return [suited('S', '2'), suited('C', '3'), chosen, suited('D', '5')];
  }

  it("opens a window for the Mage's OWN player (not the others) once a Mage card joins the attack, deferring the enemy retaliation", () => {
    const boss: LegacyEnemySpec = { name: 'Wyvern', suit: 'S', health: 100, attack: 10 };
    let state = startEmblemMission(3, [boss]);
    state = structuredClone(state);
    const player0Id = state.players[0].id;
    const played = mageCard('H', '4');
    state.players[0].hand = [played];
    const chosen = suited('H', '4');
    state.tavernDeck = mageRevealDeck(chosen);

    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: player0Id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;
    expect(state.turnPhase).toBe('AWAIT_MAGE_REVEAL');
    res = ensureOk(applyAction(state, { type: 'CHOOSE_MAGE_REVEAL_CARD', playerId: player0Id, cardId: chosen.id }));
    state = res.state;

    expect(state.turnPhase).toBe('AWAIT_AZURE_EMBLEM');
    expect(state.azureEmblemWindow).toEqual({ pendingPlayerIds: [player0Id], eligibleCardIds: [played.id], blockNextAttack: false });
    expect(state.currentEnemy?.damageTaken).toBe(8); // 4 from the normal play + 4 from the chosen reveal card, as usual
  });

  it("lets the Mage's own player bank that Mage card onto the reserve deck instead of losing it to the discard pile", () => {
    const boss: LegacyEnemySpec = { name: 'Wyvern', suit: 'S', health: 100, attack: 10 };
    let state = startEmblemMission(3, [boss]);
    state = structuredClone(state);
    const player0Id = state.players[0].id;
    const played = mageCard('H', '4');
    state.players[0].hand = [played];
    const chosen = suited('H', '4');
    state.tavernDeck = mageRevealDeck(chosen);

    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: player0Id, cardIds: [state.players[0].hand[0].id] })).state;
    state = ensureOk(applyAction(state, { type: 'CHOOSE_MAGE_REVEAL_CARD', playerId: player0Id, cardId: chosen.id })).state;

    const res = ensureOk(applyAction(state, { type: 'RESOLVE_AZURE_EMBLEM', playerId: player0Id, cardId: played.id }));
    state = res.state;

    expect(state.tavernDeck[0]).toEqual(played);
    expect(state.currentEnemy?.tableCards.some((c) => c.id === played.id)).toBe(false); // banked, not left on the table
    expect(state.azureEmblemWindow).toBeNull();
    expect(state.turnPhase).toBe('AWAIT_DEFEND'); // deferred attack now resolves
    expect(state.pendingDamage).toBe(10);
  });

  it('lets the Mage\'s own player decline — the card stays on the table (bound for the discard pile like any other)', () => {
    const boss: LegacyEnemySpec = { name: 'Wyvern', suit: 'S', health: 100, attack: 10 };
    let state = startEmblemMission(2, [boss]);
    state = structuredClone(state);
    const player0Id = state.players[0].id;
    const played = mageCard('H', '4');
    state.players[0].hand = [played];
    const chosen = suited('H', '4');
    state.tavernDeck = mageRevealDeck(chosen);

    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: player0Id, cardIds: [state.players[0].hand[0].id] })).state;
    state = ensureOk(applyAction(state, { type: 'CHOOSE_MAGE_REVEAL_CARD', playerId: player0Id, cardId: chosen.id })).state;
    state = ensureOk(applyAction(state, { type: 'RESOLVE_AZURE_EMBLEM', playerId: player0Id })).state;

    expect(state.azureEmblemWindow).toBeNull();
    expect(state.currentEnemy?.tableCards.some((c) => c.id === played.id)).toBe(true); // left in place, declined
    expect(state.turnPhase).toBe('AWAIT_DEFEND');
  });

  it('rejects a response from anyone but the Mage\'s own player, rejects banking an ineligible card, and is inert without the relic', () => {
    const boss: LegacyEnemySpec = { name: 'Wyvern', suit: 'S', health: 100, attack: 10 };
    let state = startEmblemMission(2, [boss]);
    state = structuredClone(state);
    const player0Id = state.players[0].id;
    const player1Id = state.players[1].id;
    const played = mageCard('H', '4');
    state.players[0].hand = [played];

    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: player0Id, cardIds: [state.players[0].hand[0].id] })).state;

    expect(applyAction(state, { type: 'RESOLVE_AZURE_EMBLEM', playerId: player1Id }).ok).toBe(false); // not their window
    expect(applyAction(state, { type: 'RESOLVE_AZURE_EMBLEM', playerId: player0Id, cardId: 'not-eligible' }).ok).toBe(false);

    // Without the relic, the same Mage play never opens the window at all.
    let plain = startMission(2, [boss]);
    plain = structuredClone(plain);
    plain.players[0].hand = [mageCard('H', '4')];
    const plainRes = ensureOk(
      applyAction(plain, { type: 'PLAY_CARDS', playerId: plain.players[0].id, cardIds: [plain.players[0].hand[0].id] }),
    );
    expect(plainRes.state.turnPhase).not.toBe('AWAIT_AZURE_EMBLEM');
  });
});

describe('legacy: Guardian class power (absolute shield, one attack at a time)', () => {
  function guardianCard(suit: SuitedCard['suit'], rank: SuitedCard['rank'], special?: boolean): SuitedCard {
    return { ...suited(suit, rank), guardian: true, ...(special ? { special: 'AEGIS' } : {}) };
  }

  it("blocks the enemy's very next attack entirely, regardless of the card's own value, ignoring its printed suit's power", () => {
    const boss: LegacyEnemySpec = { name: 'Statue', suit: 'S', health: 100, attack: 20 };
    let state = startMission(1, [boss]);
    state = rig(state, [guardianCard('D', '3')]); // Diamonds (Bard/draw) power never fires for a Guardian card

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.currentEnemy?.spadesShield).toBe(0); // spent, not a stacking reduction
    expect(state.turnPhase).toBe('AWAIT_PLAY'); // no damage suffered, same player continues
  });

  it("does not carry over — the following turn's attack lands at full strength again", () => {
    const boss: LegacyEnemySpec = { name: 'Statue', suit: 'S', health: 100, attack: 20 };
    let state = startMission(1, [boss]);
    state = rig(state, [guardianCard('D', '3')]);
    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;
    expect(state.turnPhase).toBe('AWAIT_PLAY'); // first attack blocked

    state = rig(state, [suited('D', '4')]); // an ordinary card, no shield this time
    res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;
    expect(state.turnPhase).toBe('AWAIT_DEFEND');
    expect(state.pendingDamage).toBe(20); // full attack — the earlier block didn't persist
  });

  it('Aegis holds the shield permanently instead, same final effect as Bulwark', () => {
    const boss: LegacyEnemySpec = { name: 'Statue', suit: 'S', health: 100, attack: 20 };
    let state = startMission(1, [boss]);
    state = rig(state, [guardianCard('D', '3', true)]);

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.currentEnemy?.spadesShield).toBe(20);
    expect(state.turnPhase).toBe('AWAIT_PLAY'); // no damage suffered, same player continues
  });
});

describe('legacy: mission 7 setup (Tales of Rebirth Pilgrim deck)', () => {
  it('is a 12-enemy 3-wave gauntlet with a 24-card Pilgrim deck and 4 Druid companions, gated by pilgrimMechanic', () => {
    const mission7 = getMission(7)!;
    expect(mission7.enemies.length).toBe(12);
    expect(mission7.pilgrimMechanic).toBe(true);
    // Pilgrims live in their own face-down deck — never shuffled into the reserve deck.
    expect(mission7.pilgrimCards?.length).toBe(24);
    expect(mission7.pilgrimCards?.every((c) => c.kind === 'suited' && c.pilgrim && c.noSuitPower)).toBe(true);
    // Sourced correction (2026-09-03 live play): 4 copies each of strength 2 through 7, all identically named.
    const byValue = new Map<number, number>();
    for (const c of mission7.pilgrimCards ?? []) {
      if (c.kind !== 'suited') continue;
      byValue.set(Number(c.rank), (byValue.get(Number(c.rank)) ?? 0) + 1);
    }
    expect([...byValue.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [2, 4],
      [3, 4],
      [4, 4],
      [5, 4],
      [6, 4],
      [7, 4],
    ]);
    expect(new Set((mission7.pilgrimCards ?? []).map((c) => (c.kind === 'suited' ? c.name : null)))).toEqual(new Set(['Pilgrim']));
    // Every card carries a unique id despite the shared name (24 same-named cards would otherwise collide).
    expect(new Set((mission7.pilgrimCards ?? []).map((c) => c.id)).size).toBe(24);
    // Only the 4 Druid companions ride in through the reserve deck.
    expect(mission7.extraReserveCards?.length).toBe(4);
    expect(mission7.extraReserveCards?.every((c) => c.kind === 'suited' && c.druid)).toBe(true);
  });

  it('seeds the Pilgrim deck separately and flips its first card into the zone on the opening turn', () => {
    const mission7 = getMission(7)!;
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ['p0'],
      playerNames: ['Player 0'],
      seed: 'well-setup-test',
      party: buildInitialParty(),
      enemies: missionEnemiesToSpecs(mission7.enemies),
      jesterCount: 0,
      pilgrimMechanic: mission7.pilgrimMechanic,
      pilgrimCards: mission7.pilgrimCards,
      extraReserveCards: mission7.extraReserveCards,
    });
    const state = ensureOk(res).state;
    expect(state.pilgrimMechanic).toBe(true);
    // The opening turn's own flip already fired: 1 in the zone, 5 still face-down.
    expect(state.pilgrimZone.length).toBe(1);
    expect(state.pilgrimDeck.length).toBe(23);
    const handCount = state.players.reduce((sum, p) => sum + p.hand.length, 0);
    // 40 party + 4 Druids = 44 in circulation (hands + reserve deck) — no Pilgrims among them.
    expect(handCount + state.tavernDeck.length).toBe(44);
    expect([...state.tavernDeck, ...state.players.flatMap((p) => p.hand)].some((c) => c.kind === 'suited' && c.pilgrim)).toBe(false);
  });
});

describe('legacy: mission 7 mechanics (Pilgrim zone burn)', () => {
  function startWellMission(n: number, enemies: LegacyEnemySpec[], pilgrimCards?: Card[]): GameState {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const names = Array.from({ length: n }, (_, i) => `Player ${i}`);
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ids,
      playerNames: names,
      seed: 'well-test',
      party: buildInitialParty(),
      enemies,
      jesterCount: 0,
      pilgrimMechanic: true,
      pilgrimCards,
    });
    if (!res.ok) throw new Error(res.error);
    return res.state;
  }

  const fenwick: Card = { id: 'fenwick', kind: 'suited', suit: 'H', rank: '2', name: 'Old Fenwick', pilgrim: true };
  const sae: Card = { id: 'sae', kind: 'suited', suit: 'D', rank: '3', name: 'Little Sae', pilgrim: true };

  it('flips one Pilgrim into the zone per turn, accumulating them', () => {
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 200, attack: 0 };
    // The deck is shuffled per attempt (see startLegacyMission), so assert counts, not a fixed order.
    let state = startWellMission(1, [boss], [structuredClone(fenwick), structuredClone(sae)]);
    expect(state.pilgrimZone.length).toBe(1);
    expect(state.pilgrimDeck.length).toBe(1);

    // Yield to end the turn; the next turn's start flips the second Pilgrim in on top.
    state = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id })).state;
    expect(state.pilgrimZone.length).toBe(2);
    expect(new Set(state.pilgrimZone.map((c) => c.id))).toEqual(new Set(['fenwick', 'sae']));
    expect(state.pilgrimDeck.length).toBe(0);
  });

  it('banishes two 3-Pilgrims when a combo of two 3s is played (per-card matching, not the combined total)', () => {
    // Regression (John's live play): a combo of two 3s totals 6, so total-based matching cleared neither of the
    // two waiting 3-Pilgrims and both then burned 6 cards off the reserve deck on the kill.
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 200, attack: 0 };
    const p3a: Card = { id: 'p3a', kind: 'suited', suit: 'H', rank: '3', name: 'Pilgrim', pilgrim: true, noSuitPower: true };
    const p3b: Card = { id: 'p3b', kind: 'suited', suit: 'D', rank: '3', name: 'Pilgrim', pilgrim: true, noSuitPower: true };
    let state = startWellMission(1, [boss], [p3a, p3b]);
    state = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id })).state;
    expect(state.pilgrimZone.length).toBe(2); // both 3s waiting

    state = rig(state, [suited('C', '3'), suited('S', '3')]);
    state = ensureOk(
      applyAction(state, {
        type: 'PLAY_CARDS',
        playerId: state.players[0].id,
        cardIds: state.players[0].hand.slice(0, 2).map((c) => c.id),
      }),
    ).state;

    expect(state.pilgrimZone.length).toBe(0); // both banished, one per matching card
    expect(state.banishPile.filter((c) => c.id === 'p3a' || c.id === 'p3b').length).toBe(2);
  });

  it('pairs matching cards one-for-one — a single 3 clears only one of two waiting 3-Pilgrims', () => {
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 200, attack: 0 };
    const p3a: Card = { id: 'p3a', kind: 'suited', suit: 'H', rank: '3', name: 'Pilgrim', pilgrim: true, noSuitPower: true };
    const p3b: Card = { id: 'p3b', kind: 'suited', suit: 'D', rank: '3', name: 'Pilgrim', pilgrim: true, noSuitPower: true };
    let state = startWellMission(1, [boss], [p3a, p3b]);
    state = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id })).state;

    state = rig(state, [suited('C', '3')]);
    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] })).state;
    expect(state.pilgrimZone.length).toBe(1);
    expect(state.banishPile.length).toBe(1);
  });

  it('does not match on the combined total of a combo whose individual cards match nothing', () => {
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 200, attack: 0 };
    const p6: Card = { id: 'p6', kind: 'suited', suit: 'H', rank: '6', name: 'Pilgrim', pilgrim: true, noSuitPower: true };
    let state = startWellMission(1, [boss], [p6]);
    expect(state.pilgrimZone.length).toBe(1);

    // Two 3s total 6, which the old total-based rule would have matched against the 6-Pilgrim. Per-card, a 3
    // matches nothing in the zone, so the 6 stays put (combos are same-rank, so this is the realistic shape).
    state = rig(state, [suited('C', '3'), suited('S', '3')]);
    state = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: state.players[0].hand.slice(0, 2).map((c) => c.id) }),
    ).state;
    expect(state.pilgrimZone.map((c) => c.id)).toEqual(['p6']);
  });

  it('banishes a waiting Pilgrim when a play\'s printed value matches it exactly', () => {
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 200, attack: 0 };
    let state = startWellMission(1, [boss], [structuredClone(sae)]);
    expect(state.pilgrimZone.length).toBe(1);
    state = rig(state, [suited('D', '3')]); // 3 exactly matches Little Sae

    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] })).state;
    expect(state.pilgrimZone.length).toBe(0);
    expect(state.banishPile.some((c) => c.id === 'sae')).toBe(true);
    expect(state.discardPile.some((c) => c.id === 'sae')).toBe(false);
  });

  it('leaves the zone alone when no waiting Pilgrim matches the play\'s value', () => {
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 200, attack: 0 };
    let state = startWellMission(1, [boss], [structuredClone(sae)]);
    state = rig(state, [suited('D', '4')]); // 4 vs the zone's lone 3

    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] })).state;
    expect(state.pilgrimZone.map((c) => c.id)).toEqual(['sae']);
    expect(state.banishPile.length).toBe(0);
  });

  it('burns the zone\'s combined value off the reserve deck on a kill, then sweeps the zone to the discard pile', () => {
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 4, attack: 0 };
    const next: LegacyEnemySpec = { name: 'Murkgill', suit: 'S', health: 200, attack: 0 };
    let state = startWellMission(1, [boss, next], [structuredClone(sae)]); // zone holds a 3
    state = rig(state, [suited('S', '8')]); // overkill, so no exact-kill relief
    const deckBefore = state.tavernDeck.length;

    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] })).state;

    expect(state.tavernDeck.length).toBe(deckBefore - 3); // 3 burned, one per point of zone value
    expect(state.pilgrimZone.length).toBe(0); // swept
    expect(state.discardPile.some((c) => c.id === 'sae')).toBe(true); // to the discard pile, not banished
    expect(state.banishPile.some((c) => c.id === 'sae')).toBe(false);
  });

  it('an exact kill carries the zone\'s highest-value Pilgrim clear first, shrinking the burn', () => {
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 8, attack: 0 };
    const next: LegacyEnemySpec = { name: 'Murkgill', suit: 'S', health: 200, attack: 0 };
    // Both Pilgrims are already in the zone before the kill: the 2 and the 3.
    let state = startWellMission(1, [boss, next], [structuredClone(fenwick), structuredClone(sae)]);
    state = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id })).state;
    expect(state.pilgrimZone.length).toBe(2);
    state = rig(state, [suited('S', '8')]); // exactly lethal
    const deckBefore = state.tavernDeck.length;

    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] })).state;

    expect(state.banishPile.some((c) => c.id === 'sae')).toBe(true); // the 3, banished out of the tally
    expect(state.tavernDeck.length).toBe(deckBefore - 2); // only the remaining 2 burns
    expect(state.discardPile.some((c) => c.id === 'fenwick')).toBe(true); // swept with the rest of the zone
    expect(state.pilgrimZone.length).toBe(0);
  });

  it('burns nothing on a kill with an empty zone', () => {
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 4, attack: 0 };
    const next: LegacyEnemySpec = { name: 'Murkgill', suit: 'S', health: 200, attack: 0 };
    let state = startWellMission(1, [boss, next], []); // no Pilgrim deck at all
    state = rig(state, [suited('S', '8')]);
    const deckBefore = state.tavernDeck.length;

    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] })).state;
    expect(state.tavernDeck.length).toBe(deckBefore);
  });

  it('never puts a Pilgrim in a hand, so nothing about playing/discarding/Feign Death is blocked any more', () => {
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 200, attack: 0 };
    const state = startWellMission(1, [boss], [structuredClone(fenwick)]);
    expect(state.players[0].hand.some((c) => c.kind === 'suited' && c.pilgrim)).toBe(false);
    expect(state.tavernDeck.some((c) => c.kind === 'suited' && c.pilgrim)).toBe(false);
  });
});

describe('legacy: mission 7 reward (Druid faction)', () => {
  it('keeps only the rank-7 Druid (Alanta) permanently — 3/5/9 and the Wellspring special are dropped', () => {
    const mission7 = getMission(7)!;
    expect(mission7.reward.recruits.length).toBe(1);
    expect(mission7.reward.recruits[0]).toMatchObject({ name: 'Alanta', class: 'DRUID', rank: '7' });

    const party = applyReward(buildInitialParty(), mission7.reward);
    const druids = party.filter((c) => c.kind === 'suited' && c.druid);
    expect(druids.length).toBe(1);
    expect(druids[0].kind === 'suited' && druids[0].name).toBe('Alanta');
    expect(party.some((c) => c.kind === 'suited' && c.special === 'WELLSPRING')).toBe(false);
  });

  it("gives Goran Hearts as a THIRD suit, keeping Mission 5's Clubs and Mission 6's Spades", () => {
    const mission7 = getMission(7)!;
    expect(mission7.reward.extraSuitByName).toEqual({ name: 'Goran', suit: 'H' });

    // Walk the real timeline: recruited inert at 4, Clubs at 5, Spades at 6, Hearts here.
    let party = buildInitialParty();
    for (const id of [4, 5, 6, 7]) party = applyReward(party, getMission(id)!.reward);
    const goran = party.find((c) => c.kind === 'suited' && c.name === 'Goran');
    expect(goran).toBeDefined();
    if (goran?.kind !== 'suited') throw new Error('expected a suited card');

    expect(goran.suit).toBe('C'); // Mission 5
    expect(goran.secondSuit).toBe('S'); // Mission 6 — NOT overwritten by this mission's grant
    expect(goran.extraSuits).toEqual(['H']); // Mission 7
    // All three resolve together when he's played.
    expect([...cardSuits(goran)].sort()).toEqual(['C', 'H', 'S']);
  });

  it('never stacks a duplicate suit, and is a no-op for an unknown name', () => {
    let party = buildInitialParty();
    for (const id of [4, 5, 6, 7]) party = applyReward(party, getMission(id)!.reward);

    // Hearts again — already resolving, so nothing changes.
    expect(applyExtraSuitByName(party, { name: 'Goran', suit: 'H' })).toBe(party);
    // Clubs is his printed suit, not in extraSuits — still must not be added twice.
    expect(applyExtraSuitByName(party, { name: 'Goran', suit: 'C' })).toBe(party);
    // Spades sits in secondSuit — same.
    expect(applyExtraSuitByName(party, { name: 'Goran', suit: 'S' })).toBe(party);
    expect(applyExtraSuitByName(party, { name: 'Nobody At All', suit: 'D' })).toBe(party);

    // A genuinely new suit does append (this is Mission 8's unimplemented Diamonds step).
    const withD = applyExtraSuitByName(party, { name: 'Goran', suit: 'D' });
    const goran = withD.find((c) => c.kind === 'suited' && c.name === 'Goran')!;
    expect(goran.kind === 'suited' && goran.extraSuits).toEqual(['H', 'D']);
    expect(goran.kind === 'suited' && [...cardSuits(goran)].sort()).toEqual(['C', 'D', 'H', 'S']);
  });

  it('grants a player-chosen Druid sticker (4 of Diamonds/Clubs/Spades only) plus a corrupt-another-card step', () => {
    const mission7 = getMission(7)!;
    expect(mission7.reward.druidStickerChoice).toBe(true);
    expect(mission7.reward.corruptAnotherCard).toBe(true);

    // Deliberately not auto-applied — the player has to pick a target first.
    const party = applyReward(buildInitialParty(), mission7.reward);
    expect(party.some((c) => c.kind === 'suited' && c.secondClassDruid)).toBe(false);

    // Exactly the three rank-4 cards the source names are eligible — the 4 of Hearts is not.
    const eligible = buildInitialParty().filter(druidStickerEligible);
    expect(eligible.map((c) => c.suit).sort()).toEqual(['C', 'D', 'S']);
    expect(eligible.every((c) => c.rank === '4')).toBe(true);
  });

  it('applies the chosen Druid sticker to that one card, keeping its own suit power', () => {
    const party = buildInitialParty();
    const target = party.filter(druidStickerEligible).find((c) => c.suit === 'D')!;
    const next = applyDruidStickerChoice(party, target.id);
    const stickered = next.filter((c) => c.kind === 'suited' && c.secondClassDruid);
    expect(stickered.length).toBe(1);
    expect(stickered[0].id).toBe(target.id);
    expect(stickered[0].kind === 'suited' && stickered[0].suit).toBe('D'); // still a Bard
    // A no-op for an ineligible target (the 4 of Hearts).
    const hearts4 = party.find((c) => c.kind === 'suited' && c.suit === 'H' && c.rank === '4')!;
    expect(applyDruidStickerChoice(party, hearts4.id)).toBe(party);
  });

  it('a Druid recruit takes its explicit suit (Druid has none of its own) and is flagged druid', () => {
    const card = buildRecruitCard({ name: 'Test Druid', class: 'DRUID', rank: '5', suit: 'D' });
    expect(card.kind === 'suited' && card.druid).toBe(true);
    expect(card.kind === 'suited' && card.suit).toBe('D');
  });
});

describe('legacy: Druid class power (Regrowth — deal out the discard pile)', () => {
  function druidCard(suit: SuitedCard['suit'], rank: SuitedCard['rank']): SuitedCard {
    return { ...suited(suit, rank), druid: true };
  }

  it('deals the whole discard pile out and opens a Regrowth window for the only player', () => {
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 100, attack: 0 };
    let state = startMission(1, [boss]);
    state.discardPile = [suited('H', '6'), suited('C', '4'), suited('D', '9'), suited('S', '2'), suited('H', '5')];
    state = rig(state, [druidCard('H', '3')]);

    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] })).state;

    expect(state.turnPhase).toBe('AWAIT_REGROWTH');
    expect(state.discardPile.length).toBe(0); // the whole pile was dealt out
    expect(state.druidWindow?.pendingPlayerIds).toEqual([state.players[0].id]);
    expect(state.druidWindow?.dealt[state.players[0].id]?.length).toBe(5);
  });

  it('sends one card each to hand, banish, top of deck and bottom of deck, returning the rest to the discard pile', () => {
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 100, attack: 0 };
    let state = startMission(1, [boss]);
    state.discardPile = [suited('H', '6'), suited('C', '4'), suited('D', '9'), suited('S', '2'), suited('H', '5')];
    state = rig(state, [druidCard('H', '3')]);
    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] })).state;

    const me = state.players[0].id;
    const dealt = state.druidWindow!.dealt[me]!;
    const handBefore = state.players[0].hand.length;
    const deckBefore = state.tavernDeck.length;

    state = ensureOk(
      applyAction(state, {
        type: 'RESOLVE_REGROWTH',
        playerId: me,
        toHandCardId: dealt[0].id,
        toBanishCardId: dealt[1].id,
        toDeckTopCardId: dealt[2].id,
        toDeckBottomCardId: dealt[3].id,
      }),
    ).state;

    expect(state.players[0].hand.some((c) => c.id === dealt[0].id)).toBe(true);
    expect(state.banishPile.some((c) => c.id === dealt[1].id)).toBe(true);
    expect(state.tavernDeck[0].id).toBe(dealt[2].id); // top of the reserve deck
    expect(state.tavernDeck[state.tavernDeck.length - 1].id).toBe(dealt[3].id); // bottom
    expect(state.discardPile.map((c) => c.id)).toEqual([dealt[4].id]); // the 5th was unassigned
    expect(state.players[0].hand.length).toBe(handBefore + 1);
    expect(state.tavernDeck.length).toBe(deckBefore + 2);
    expect(state.druidWindow).toBeNull(); // window closed, only player resolved
  });

  it('rejects assigning the same card to two destinations, or a card that was not dealt to you', () => {
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 100, attack: 0 };
    let state = startMission(1, [boss]);
    state.discardPile = [suited('H', '6'), suited('C', '4'), suited('D', '9'), suited('S', '2')];
    state = rig(state, [druidCard('H', '3')]);
    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] })).state;
    const me = state.players[0].id;
    const dealt = state.druidWindow!.dealt[me]!;

    const dup = applyAction(state, {
      type: 'RESOLVE_REGROWTH',
      playerId: me,
      toHandCardId: dealt[0].id,
      toBanishCardId: dealt[0].id,
      toDeckTopCardId: dealt[1].id,
      toDeckBottomCardId: dealt[2].id,
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toMatch(/one destination|chosen twice/i);

    const foreign = applyAction(state, {
      type: 'RESOLVE_REGROWTH',
      playerId: me,
      toHandCardId: 'not-a-dealt-card',
      toBanishCardId: dealt[1].id,
      toDeckTopCardId: dealt[2].id,
      toDeckBottomCardId: dealt[3].id,
    });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error).toMatch(/not dealt to you/i);
  });

  it('a player dealt fewer than 4 cards assigns exactly as many as they hold (John\'s ruling)', () => {
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 100, attack: 0 };
    let state = startMission(1, [boss]);
    state.discardPile = [suited('H', '6'), suited('C', '4')]; // only 2 cards for the lone player
    state = rig(state, [druidCard('H', '3')]);
    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] })).state;
    const me = state.players[0].id;
    const dealt = state.druidWindow!.dealt[me]!;
    expect(dealt.length).toBe(2);

    // Assigning all 4 destinations is impossible; assigning only 1 is rejected as too few.
    const tooFew = applyAction(state, { type: 'RESOLVE_REGROWTH', playerId: me, toHandCardId: dealt[0].id });
    expect(tooFew.ok).toBe(false);
    if (!tooFew.ok) expect(tooFew.error).toMatch(/must assign exactly 2/i);

    // Exactly 2, and the player chooses WHICH two destinations to use.
    state = ensureOk(
      applyAction(state, { type: 'RESOLVE_REGROWTH', playerId: me, toHandCardId: dealt[0].id, toDeckTopCardId: dealt[1].id }),
    ).state;
    expect(state.players[0].hand.some((c) => c.id === dealt[0].id)).toBe(true);
    expect(state.tavernDeck[0].id).toBe(dealt[1].id);
    expect(state.discardPile.length).toBe(0);
    expect(state.turnPhase).not.toBe('AWAIT_REGROWTH');
  });

  it('deals round-robin across a 2-player table and queues both players, front of the queue first', () => {
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 100, attack: 0 };
    let state = startMission(2, [boss]);
    state.discardPile = [suited('H', '6'), suited('C', '4'), suited('D', '9')];
    state = rig(state, [druidCard('H', '3')]);
    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] })).state;

    const [p0, p1] = state.players.map((p) => p.id);
    expect(state.druidWindow?.dealt[p0]?.length).toBe(2); // dealing starts from the current player
    expect(state.druidWindow?.dealt[p1]?.length).toBe(1);
    expect(state.druidWindow?.pendingPlayerIds).toEqual([p0, p1]);

    // The back of the queue can't jump ahead.
    const outOfTurn = applyAction(state, { type: 'RESOLVE_REGROWTH', playerId: p1, toHandCardId: state.druidWindow!.dealt[p1]![0].id });
    expect(outOfTurn.ok).toBe(false);

    state = ensureOk(
      applyAction(state, {
        type: 'RESOLVE_REGROWTH',
        playerId: p0,
        toHandCardId: state.druidWindow!.dealt[p0]![0].id,
        toBanishCardId: state.druidWindow!.dealt[p0]![1].id,
      }),
    ).state;
    expect(state.druidWindow?.pendingPlayerIds).toEqual([p1]); // p0 done, p1 still owes a pick
    state = ensureOk(
      applyAction(state, { type: 'RESOLVE_REGROWTH', playerId: p1, toDeckTopCardId: state.druidWindow!.dealt[p1]![0].id }),
    ).state;
    expect(state.druidWindow).toBeNull();
  });

  it('opens no window at all when the discard pile is empty', () => {
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 100, attack: 0 };
    let state = startMission(1, [boss]);
    state.discardPile = [];
    state = rig(state, [druidCard('H', '3')]);

    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] })).state;
    expect(state.turnPhase).not.toBe('AWAIT_REGROWTH');
    expect(state.druidWindow).toBeNull();
  });

  it("ignores the Druid card's own printed suit power (Hearts never heals)", () => {
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 100, attack: 0 };
    let state = startMission(1, [boss]);
    state.discardPile = [suited('H', '6')];
    state = rig(state, [druidCard('H', '3')]);

    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] })).state;
    // The pile was dealt out for Regrowth, not shuffled under the deck by a Cleric heal.
    expect(state.druidWindow?.dealt[state.players[0].id]?.length).toBe(1);
  });
});

describe('legacy: mission 8 setup (Winds of Chaos)', () => {
  it('is a 12-enemy 2-wave gauntlet (6 dual-immune Trolls, 6 dual-immune Wyverns), ascendingZone enabled, with 9 Pilgrims + 1 wildcard + 4 fight-setup Chanters as extra reserve cards, and a preset Puppy anchor', () => {
    const mission8 = getMission(8)!;
    expect(mission8.enemies.length).toBe(12);
    expect(mission8.enemies.every((e) => e.secondClass !== undefined)).toBe(true); // every enemy, both waves, is dual-immune
    // All 6 distinct pairs of the 4 base classes appear exactly once per wave (Trolls: enemies 0-5; Wyverns: 6-11).
    const pairKey = (e: MissionEnemySpec) => [e.class, e.secondClass].sort().join('+');
    expect(new Set(mission8.enemies.slice(0, 6).map(pairKey)).size).toBe(6);
    expect(new Set(mission8.enemies.slice(6, 12).map(pairKey)).size).toBe(6);
    expect(mission8.ascendingZone).toBe(true);
    expect(mission8.extraReserveCards?.length).toBe(14);
    expect(mission8.extraReserveCards?.filter((c) => c.kind === 'suited' && c.pilgrim).length).toBe(9);
    expect(mission8.extraReserveCards?.filter((c) => c.kind === 'suited' && c.chanter).length).toBe(4);
    expect(mission8.extraReserveCards?.filter((c) => c.kind === 'suited' && c.flexibleComboRank).length).toBe(1);
    expect(mission8.presetMissionZone?.length).toBe(1);
    expect(mission8.presetMissionZone?.[0]).toMatchObject({ rank: 'A', pilgrim: true });
  });

  it('shuffles the extra reserve cards into the reserve deck alongside the party at mission start', () => {
    const mission8 = getMission(8)!;
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ['p0'],
      playerNames: ['Player 0'],
      seed: 'edge-setup-test',
      party: buildInitialParty(),
      enemies: missionEnemiesToSpecs(mission8.enemies),
      jesterCount: 0,
      ascendingZone: mission8.ascendingZone,
      presetMissionZone: mission8.presetMissionZone,
      extraReserveCards: mission8.extraReserveCards,
    });
    const state = ensureOk(res).state;
    expect(state.ascendingZone).toBe(true);
    expect(state.missionZone.length).toBe(1);
    const handCount = state.players.reduce((sum, p) => sum + p.hand.length, 0);
    // 40 party + 14 extras (9 Pilgrims + 1 wildcard + 4 fight-setup Chanters) = 54 total in circulation.
    expect(handCount + state.tavernDeck.length).toBe(54);
  });
});

describe('legacy: mission 8 mechanics (ascending mission zone chain)', () => {
  function startEdgeMission(
    n: number,
    enemies: LegacyEnemySpec[],
    opts: { presetMissionZone?: Card[] } = {},
  ): GameState {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const names = Array.from({ length: n }, (_, i) => `Player ${i}`);
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ids,
      playerNames: names,
      seed: 'edge-test',
      party: buildInitialParty(),
      enemies,
      jesterCount: 0,
      ascendingZone: true,
      ...opts,
    });
    if (!res.ok) throw new Error(res.error);
    // PLACE_IN_ZONE is gated to right after an enemy kill (see GameState.zoneOpenForPlacement) — most of these
    // scenario tests exercise the placement mechanic directly rather than replaying a full kill first, so open
    // the window here the same way a kill normally would.
    const state = structuredClone(res.state);
    state.zoneOpenForPlacement = true;
    return state;
  }

  const puppy: Card = { id: 'puppy', kind: 'suited', suit: 'H', rank: 'A', name: 'Scrap', pilgrim: true };

  /** 9 cards already in the zone (puppy + 8 fillers) — required next is 10, one placement away from the purge. */
  function nineCardZone(): Card[] {
    const fillers: Card[] = Array.from({ length: 8 }, (_, i) => ({
      id: `filler-${i}`,
      kind: 'suited' as const,
      suit: 'H' as const,
      rank: '2' as const,
      pilgrim: true,
    }));
    return [puppy, ...fillers];
  }

  it('grants no suit immunity from the preset Pilgrim Puppy (unlike Missions 3/5/6 zone modes)', () => {
    const boss: LegacyEnemySpec = { name: 'Troll', suit: 'H', health: 20, attack: 10 };
    const state = startEdgeMission(1, [boss], { presetMissionZone: [puppy] });
    expect(state.missionZone).toEqual([puppy]);
    expect(state.zoneImmuneSuits).toEqual([]);
  });

  it('places a card worth exactly one more than the zone top, sourced ONLY from zoneCommittedPlay (the attack just finished) at no extra cost; a Pilgrim card never buffs the enemy and placing never ends the turn', () => {
    const boss: LegacyEnemySpec = { name: 'Troll', suit: 'S', health: 20, attack: 10 };
    let state = startEdgeMission(1, [boss], { presetMissionZone: [puppy] });
    const two: Card = { id: 'p2', kind: 'suited', suit: 'D', rank: '2', name: 'Old Yarrow', pilgrim: true };
    state.zoneCommittedPlay = [two];

    const res = ensureOk(applyAction(state, { type: 'PLACE_IN_ZONE', playerId: state.players[0].id, cardId: two.id }));
    state = res.state;

    expect(state.missionZone.map((c) => c.id)).toEqual(['puppy', 'p2']);
    expect(state.zoneCommittedPlay).toEqual([]); // claimed out of the pool
    expect(resolvedEnemyAttack(state)).toBe(10); // no attack buff from a Pilgrim card
    // Sourced fix: placing no longer costs anything extra or ends the turn — the window stays open.
    expect(state.turnPhase).toBe('AWAIT_PLAY');
    expect(state.zoneOpenForPlacement).toBe(true);
  });

  it("rejects a card that doesn't match the zone's required next value, even from the committed pool", () => {
    const boss: LegacyEnemySpec = { name: 'Troll', suit: 'S', health: 20, attack: 10 };
    let state = startEdgeMission(1, [boss], { presetMissionZone: [puppy] });
    const five: Card = { id: 'wrong', kind: 'suited', suit: 'D', rank: '5' };
    state.zoneCommittedPlay = [five];
    const res = applyAction(state, { type: 'PLACE_IN_ZONE', playerId: state.players[0].id, cardId: five.id });
    expect(res.ok).toBe(false);
  });

  it('rejects a hand card even when its value would fit — only a card from zoneCommittedPlay qualifies, never hand (the sourced "no extra cost" fix)', () => {
    const boss: LegacyEnemySpec = { name: 'Troll', suit: 'S', health: 20, attack: 10 };
    let state = startEdgeMission(1, [boss], { presetMissionZone: [puppy] });
    state = rig(state, [suited('D', '2')]); // matching value, but sitting in hand — not the attack just finished
    const res = applyAction(state, {
      type: 'PLACE_IN_ZONE',
      playerId: state.players[0].id,
      cardId: state.players[0].hand[0].id,
    });
    expect(res.ok).toBe(false);
  });

  it("a non-Pilgrim card bridging a gap buffs the current enemy's attack for as long as it sits there", () => {
    const boss: LegacyEnemySpec = { name: 'Troll', suit: 'S', health: 20, attack: 10 };
    let state = startEdgeMission(1, [boss], { presetMissionZone: [puppy] });
    const bridge: Card = { id: 'bridge', kind: 'suited', suit: 'D', rank: '2' }; // an ordinary card, not a Pilgrim
    state.zoneCommittedPlay = [bridge];

    const res = ensureOk(applyAction(state, { type: 'PLACE_IN_ZONE', playerId: state.players[0].id, cardId: bridge.id }));
    state = res.state;

    // 10 base attack + 2 (the bridging card's own value, still sitting in the zone) = 12.
    expect(resolvedEnemyAttack(state)).toBe(12);
  });

  it('the sourced "2/5" wildcard can fill the 2 slot via its flagged alternate, and always counts as 2 for the attack buff regardless', () => {
    const boss: LegacyEnemySpec = { name: 'Troll', suit: 'S', health: 20, attack: 10 };
    let state = startEdgeMission(1, [boss], { presetMissionZone: [puppy] }); // required next = 2
    const wildcard: Card = { id: 'wild', kind: 'suited', suit: 'C', rank: '5', flexibleComboRank: '2', name: 'The Wandering Coin' };
    state.zoneCommittedPlay = [wildcard];

    const res = ensureOk(applyAction(state, { type: 'PLACE_IN_ZONE', playerId: state.players[0].id, cardId: wildcard.id }));
    state = res.state;

    expect(state.missionZone.map((c) => c.id)).toEqual(['puppy', 'wild']);
    // 10 base + 2 (the wildcard's alternate, NOT its printed value of 5).
    expect(resolvedEnemyAttack(state)).toBe(12);
  });

  it('rejects the wildcard when the required slot is neither 2 nor 5', () => {
    const boss: LegacyEnemySpec = { name: 'Troll', suit: 'S', health: 20, attack: 10 };
    const two: Card = { id: 'two', kind: 'suited', suit: 'H', rank: '2', pilgrim: true };
    // Zone already at [puppy, two] (length 2) — required next is 3, which the wildcard can't satisfy.
    let state = startEdgeMission(1, [boss], { presetMissionZone: [puppy, two] });
    const wildcard: Card = { id: 'wild', kind: 'suited', suit: 'C', rank: '5', flexibleComboRank: '2', name: 'The Wandering Coin' };
    state.zoneCommittedPlay = [wildcard];

    const res = applyAction(state, { type: 'PLACE_IN_ZONE', playerId: state.players[0].id, cardId: wildcard.id });
    expect(res.ok).toBe(false);
  });

  it('completing the chain at 10 purges the zone to the discard pile, opens the Ultimate Banishment, and closes the zone', () => {
    const boss: LegacyEnemySpec = { name: 'Troll', suit: 'S', health: 100, attack: 1 };
    const ten: Card = { id: 'ten', kind: 'suited', suit: 'H', rank: '10', name: 'Goran', pilgrim: true };
    let state = startEdgeMission(1, [boss], { presetMissionZone: nineCardZone() });
    state.zoneCommittedPlay = [ten];

    const res = ensureOk(applyAction(state, { type: 'PLACE_IN_ZONE', playerId: state.players[0].id, cardId: ten.id }));
    state = res.state;

    expect(state.missionZone.length).toBe(0);
    expect(state.zoneClosed).toBe(true);
    expect(state.turnPhase).toBe('AWAIT_ZONE_PURGE');
    expect(state.zonePurge?.playerId).toBe(state.players[0].id);
    expect(state.discardPile.map((c) => c.id).sort()).toEqual(
      ['puppy', 'ten', 'filler-0', 'filler-1', 'filler-2', 'filler-3', 'filler-4', 'filler-5', 'filler-6', 'filler-7'].sort(),
    );
  });

  it('rejects further placements once the zone has closed', () => {
    const boss: LegacyEnemySpec = { name: 'Troll', suit: 'S', health: 100, attack: 1 };
    const ten: Card = { id: 'ten', kind: 'suited', suit: 'H', rank: '10', pilgrim: true };
    let state = startEdgeMission(1, [boss], { presetMissionZone: nineCardZone() });
    state.zoneCommittedPlay = [ten];
    state = ensureOk(applyAction(state, { type: 'PLACE_IN_ZONE', playerId: state.players[0].id, cardId: ten.id })).state;

    const two: Card = { id: 'two-again', kind: 'suited', suit: 'D', rank: '2' };
    state.zoneCommittedPlay = [two];
    const res = applyAction(state, { type: 'PLACE_IN_ZONE', playerId: state.players[0].id, cardId: two.id });
    expect(res.ok).toBe(false);
  });

  it('RESOLVE_ZONE_PURGE banishes the chosen cards forever and shuffles the rest into the bottom of the reserve deck', () => {
    const boss: LegacyEnemySpec = { name: 'Troll', suit: 'S', health: 100, attack: 1 };
    const ten: Card = { id: 'ten', kind: 'suited', suit: 'H', rank: '10', pilgrim: true };
    let state = startEdgeMission(1, [boss], { presetMissionZone: nineCardZone() });
    state.zoneCommittedPlay = [ten];
    state = ensureOk(applyAction(state, { type: 'PLACE_IN_ZONE', playerId: state.players[0].id, cardId: ten.id })).state;
    const reserveBefore = state.tavernDeck.length;
    const discardCountBefore = state.discardPile.length;

    const res = ensureOk(
      applyAction(state, { type: 'RESOLVE_ZONE_PURGE', playerId: state.players[0].id, banishCardIds: ['puppy'] }),
    );
    state = res.state;

    expect(state.banishPile.map((c) => c.id)).toEqual(['puppy']);
    expect(state.discardPile.length).toBe(0);
    expect(state.tavernDeck.length).toBe(reserveBefore + discardCountBefore - 1); // everything but 'puppy' shuffled to the bottom
    expect(state.zonePurge).toBeNull();
    expect(state.zoneClosed).toBe(true); // still closed — the purge only fires once
  });
});

describe('legacy: mission 8 placement gating (zoneOpenForPlacement)', () => {
  it('rejects PLACE_IN_ZONE on a normal turn with no recent kill', () => {
    const boss: LegacyEnemySpec = { name: 'Troll', suit: 'S', health: 100, attack: 1 };
    const puppy: Card = { id: 'puppy', kind: 'suited', suit: 'H', rank: 'A', name: 'Scrap', pilgrim: true };
    const ids = ['p0'];
    const names = ['Player 0'];
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ids,
      playerNames: names,
      seed: 'gate-test',
      party: buildInitialParty(),
      enemies: [boss],
      jesterCount: 0,
      ascendingZone: true,
      presetMissionZone: [puppy],
    });
    let state = ensureOk(res).state;
    expect(state.zoneOpenForPlacement).toBe(false); // no kill has happened yet
    state = rig(state, [suited('D', '2')]);

    const placeRes = applyAction(state, { type: 'PLACE_IN_ZONE', playerId: state.players[0].id, cardId: state.players[0].hand[0].id });
    expect(placeRes.ok).toBe(false);
  });

  it('opens the window on the turn immediately after a kill, populates zoneCommittedPlay with the kill\'s own card, and closes the window (flushing anything unclaimed) once that turn actually ends', () => {
    const weak: LegacyEnemySpec = { name: 'Weakling', suit: 'S', health: 1, attack: 1 };
    const boss: LegacyEnemySpec = { name: 'Troll', suit: 'S', health: 100, attack: 0 };
    const puppy: Card = { id: 'puppy', kind: 'suited', suit: 'H', rank: 'A', name: 'Scrap', pilgrim: true };
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ['p0'],
      playerNames: ['Player 0'],
      seed: 'gate-test-2',
      party: buildInitialParty(),
      enemies: [weak, boss],
      jesterCount: 0,
      ascendingZone: true,
      presetMissionZone: [puppy],
    });
    let state = ensureOk(res).state;
    // A Spades card, no immunity here, kills the 1-health Weakling outright. Flagged `pilgrim` so that once it's
    // placed into the zone it doesn't ALSO buff the Troll's attack (see ascendingZoneAttackBuff) — keeping this
    // test's "0 attack -> yield ends the turn outright" assumption clean; the separate "a non-Pilgrim card
    // bridging a gap buffs the attack" test above already covers that other case.
    const strike = { ...suited('S', '2'), pilgrim: true };
    state = rig(state, [strike, suited('D', '3')]); // an extra card so the hand isn't empty after the kill

    const killRes = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [strike.id] }));
    state = killRes.state;

    // The kill let the same player continue their turn against the Troll — the placement window is now open, and
    // the killing card itself (value 2 — exactly the zone's required next slot) is available at no extra cost.
    expect(state.currentEnemy?.name).toBe('Troll');
    expect(state.turnPhase).toBe('AWAIT_PLAY');
    expect(state.zoneOpenForPlacement).toBe(true);
    expect(state.zoneCommittedPlay.map((c) => c.id)).toEqual([strike.id]);

    const placeRes = ensureOk(applyAction(state, { type: 'PLACE_IN_ZONE', playerId: state.players[0].id, cardId: strike.id }));
    state = placeRes.state;
    expect(state.missionZone.map((c) => c.id)).toEqual(['puppy', strike.id]);

    // Sourced fix: placing doesn't end the turn — same open window, same turn.
    expect(state.turnPhase).toBe('AWAIT_PLAY');
    expect(state.zoneOpenForPlacement).toBe(true);
    expect(state.zoneCommittedPlay).toEqual([]);

    // Only once the player actually ends their turn (yielding against the harmless 0-attack Troll) does the
    // window close — and a later turn with no fresh kill can't place again.
    state = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id })).state;
    expect(state.zoneOpenForPlacement).toBe(false);

    const three: Card = { id: 'p3', kind: 'suited', suit: 'D', rank: '3', pilgrim: true };
    state = rig(state, [three]);
    const secondPlaceRes = applyAction(state, { type: 'PLACE_IN_ZONE', playerId: state.players[0].id, cardId: three.id });
    expect(secondPlaceRes.ok).toBe(false);
  });
});

describe('legacy: mission 8 ascending run — several placements can share one window', () => {
  it("places 2, 3 and 4 in a single window from one enemy's accumulated table pile", () => {
    // Confirmed correct by John (2026-09-03). The placement window stays open until the turn actually moves on,
    // and the pool is the defeated enemy's WHOLE table pile — every card played against it while wearing it
    // down, not just the killing blow — so one kill can walk the chain up several steps at once. Untested until
    // now, and a neighbouring comment used to assert the opposite (see the wave-math describe below).
    const puppy: Card = { id: 'puppy', kind: 'suited', suit: 'H', rank: 'A', name: 'Scrap', pilgrim: true };
    // Immune to its own suit ('H'), so the Diamond cards below always land. Health 9 = 2+3+4, so the 4 is a
    // clean exact kill and all three cards are sitting on its table by then. Attack 0 keeps the turns simple.
    const troll: LegacyEnemySpec = { name: 'Troll', suit: 'H', health: 9, attack: 0 };
    const trailer: LegacyEnemySpec = { name: 'Trailer', suit: 'H', health: 100, attack: 0 };
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ['p0'],
      playerNames: ['Player 0'],
      seed: 'multi-placement-test',
      party: buildInitialParty(),
      enemies: [troll, trailer],
      jesterCount: 0,
      ascendingZone: true,
      presetMissionZone: [puppy],
    });
    let state = ensureOk(res).state;

    // Wear the Troll down over three turns so its table pile accumulates a 2, a 3 and a 4.
    const chain: SuitedCard[] = (['2', '3', '4'] as const).map((rank) => ({
      id: `chain-${rank}`,
      kind: 'suited' as const,
      suit: 'D' as const,
      rank,
      pilgrim: true, // Pilgrims never buff the enemy while they sit in the zone
    }));
    for (const card of chain) {
      state = rig(state, [card]);
      state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [card.id] })).state;
    }

    // The 4 killed it, and all three cards it soaked are now available at no extra cost.
    expect(state.currentEnemy?.name).toBe('Trailer');
    expect(state.zoneOpenForPlacement).toBe(true);
    expect(state.zoneCommittedPlay.map((c) => c.id).sort()).toEqual(['chain-2', 'chain-3', 'chain-4']);

    // Three placements, one after another, all inside this single window.
    for (const card of chain) {
      state = ensureOk(applyAction(state, { type: 'PLACE_IN_ZONE', playerId: state.players[0].id, cardId: card.id })).state;
      expect(state.zoneOpenForPlacement).toBe(true); // placing never closes the window
    }
    expect(state.missionZone.map((c) => c.id)).toEqual(['puppy', 'chain-2', 'chain-3', 'chain-4']);
    expect(state.zoneCommittedPlay).toEqual([]);

    // Still strictly ascending: the next slot is 5, so a spare 2 can't be slipped in behind it.
    const spare: Card = { id: 'spare-2', kind: 'suited', suit: 'D', rank: '2', pilgrim: true };
    state.zoneCommittedPlay = [spare];
    const outOfOrder = applyAction(state, { type: 'PLACE_IN_ZONE', playerId: state.players[0].id, cardId: spare.id });
    expect(outOfOrder.ok).toBe(false);
  });
});

describe('legacy: mission 8 chain-vs-wave math (documents the corrected "before Wave 2" framing)', () => {
  it('the real Mission 8 data needs 9 chain placements while Wave 1 opens only 6 placement windows', () => {
    // Locks in the arithmetic behind the missions.ts comment correction above: a prior version of that comment
    // implied the chain (and its purge) must finish before Wave 2 arrives, with no source for the deadline.
    // NOTE: windows are not 1:1 with placements — several cards can go in during one window (see the describe
    // above), so 6 windows do not cap you at 6 placements. Wave 1 finishing the chain is merely unlikely, not
    // impossible; what actually rules out the deadline is that the source states no deadline at all.
    const mission8 = getMission(8)!;
    const chainPlacementsNeeded = 9; // values 2 through 10, on top of the preseeded Ace (presetMissionZone)
    const wave1KillCount = mission8.enemies.slice(0, 6).length;
    const totalKillCount = mission8.enemies.length;
    expect(wave1KillCount).toBe(6);
    expect(totalKillCount).toBe(12);
    expect(wave1KillCount).toBeLessThan(chainPlacementsNeeded); // fewer windows than placements needed
    // The whole mission's kills (minus the very last, whose window never opens — see finishEnemyDefeatTail's
    // castleDeck.length === 0 branch) comfortably cover the 9 needed — a whole-mission goal, not a Wave-1 cutoff.
    expect(totalKillCount - 1).toBeGreaterThanOrEqual(chainPlacementsNeeded);
  });

  it('BEHAVIORAL: taking just one placement per kill, Wave 1 stalls the chain at required=8; the next 3 kills finish it', () => {
    const puppy: Card = { id: 'puppy', kind: 'suited', suit: 'H', rank: 'A', name: 'Scrap', pilgrim: true };
    // Enemies are immune to whatever suit their own `suit` field names (see LegacyEnemySpec) — 'H' here, so the
    // Diamond-suited kill cards below are never blocked. Healths are set to exactly the matching kill card's
    // value so each play is a clean exact kill. A harmless 10th "Trailer" enemy keeps the castle deck non-empty
    // after the value-10 kill, so that kill's own placement window still opens (mirrors the real mission's own
    // trailing margin — see the missions.ts comment above on the very-last-kill edge case).
    const wave1: LegacyEnemySpec[] = [2, 3, 4, 5, 6, 7].map((h, i) => ({ name: `Wave1 Troll ${i}`, suit: 'H', health: h, attack: 0 }));
    const wave2: LegacyEnemySpec[] = [8, 9, 10].map((h, i) => ({ name: `Wave2 Wyvern ${i}`, suit: 'H', health: h, attack: 0 }));
    const trailer: LegacyEnemySpec = { name: 'Trailer', suit: 'H', health: 100, attack: 0 };

    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ['p0'],
      playerNames: ['Player 0'],
      seed: 'wave-math-test',
      party: buildInitialParty(),
      enemies: [...wave1, ...wave2, trailer],
      jesterCount: 0,
      ascendingZone: true,
      presetMissionZone: [puppy],
    });
    let state = ensureOk(res).state;

    const killCards: SuitedCard[] = (['2', '3', '4', '5', '6', '7', '8', '9', '10'] as const).map((rank) => ({
      id: `kill-${rank}`,
      kind: 'suited' as const,
      suit: 'D' as const,
      rank,
      pilgrim: true,
    }));
    state = rig(state, killCards);

    // Wave 1: kill all 6 Trolls, placing the matching card each time.
    for (const card of killCards.slice(0, 6)) {
      state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [card.id] })).state;
      expect(state.zoneOpenForPlacement).toBe(true);
      state = ensureOk(applyAction(state, { type: 'PLACE_IN_ZONE', playerId: state.players[0].id, cardId: card.id })).state;
    }
    // puppy + 6 placements (values 2-7) — required next is 8, and Wave 1 has nothing left to offer.
    expect(state.missionZone.length).toBe(7);
    expect(state.zoneClosed).toBe(false);

    // Wave 2: the remaining 3 kills (values 8, 9, 10) finish the chain and trigger the purge.
    for (const card of killCards.slice(6, 9)) {
      state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [card.id] })).state;
      expect(state.zoneOpenForPlacement).toBe(true);
      state = ensureOk(applyAction(state, { type: 'PLACE_IN_ZONE', playerId: state.players[0].id, cardId: card.id })).state;
    }
    expect(state.zoneClosed).toBe(true);
    expect(state.turnPhase).toBe('AWAIT_ZONE_PURGE');
  });
});

describe('legacy: Chanter class power (chant — every player draws at once, then trims back down)', () => {
  function chanterCard(suit: SuitedCard['suit'], rank: SuitedCard['rank'], special?: boolean): SuitedCard {
    return { ...suited(suit, rank), chanter: true, ...(special ? { special: 'ENCORE' as const } : {}) };
  }

  it("draws its own value in cards for every player at once, skipping the trim window entirely when nobody goes over their hand limit", () => {
    const boss: LegacyEnemySpec = { name: 'Wyvern', suit: 'S', health: 100, attack: 10 };
    let state = startMission(1, [boss]);
    state = rig(state, [chanterCard('D', '2')]); // hand limit 8, well under after drawing 2

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.chanterWindow).toBeNull();
    expect(state.players[0].hand.length).toBe(2); // played card gone, 2 drawn back
    expect(state.currentEnemy?.damageTaken).toBe(2); // plain damage — Diamonds' draw power never fired
    expect(state.turnPhase).toBe('AWAIT_DEFEND'); // straight to the deferred attack tail
    expect(state.pendingDamage).toBe(10);
  });

  it('draws for every player at the table at once, even past hand limit, and queues only the ones now over it to trim', () => {
    const boss: LegacyEnemySpec = { name: 'Wyvern', suit: 'S', health: 100, attack: 10 };
    let state = startMission(2, [boss]); // hand limit 7 for 2 players
    state = structuredClone(state);
    state.players[0].hand = [chanterCard('D', '3')];
    state.players[1].hand = Array.from({ length: 6 }, () => suited('H', '2'));
    const player0Id = state.players[0].id;
    const player1Id = state.players[1].id;

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: player0Id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    // Player 0's hand: card played (0 left), draws 3 -> 3, under the 7 limit, no trim needed.
    // Player 1's hand: 6 + 3 drawn = 9, over the 7 limit by 2 -> queued to trim.
    expect(state.players[0].hand.length).toBe(3);
    expect(state.players[1].hand.length).toBe(9);
    expect(state.turnPhase).toBe('AWAIT_CHANT_TRIM');
    expect(state.chanterWindow).toEqual({
      pendingPlayerIds: [player1Id],
      onResolved: { kind: 'deferredAttack', blockNextAttack: false },
    });
  });

  it("rejects a trim attempt from anyone but the front of the queue, and rejects the wrong discard count", () => {
    const boss: LegacyEnemySpec = { name: 'Wyvern', suit: 'S', health: 100, attack: 10 };
    let state = startMission(2, [boss]);
    state = structuredClone(state);
    state.players[0].hand = [chanterCard('D', '3')];
    state.players[1].hand = Array.from({ length: 6 }, () => suited('H', '2'));
    const player0Id = state.players[0].id;

    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: player0Id, cardIds: [state.players[0].hand[0].id] })).state;
    // Player 0 is not in the trim queue (player 1 is) — their attempt should be rejected.
    const wrongPlayer = applyAction(state, { type: 'RESOLVE_CHANT', playerId: player0Id, discardCardIds: [] });
    expect(wrongPlayer.ok).toBe(false);

    const player1Id = state.players[1].id;
    const tooFew = applyAction(state, { type: 'RESOLVE_CHANT', playerId: player1Id, discardCardIds: [state.players[1].hand[0].id] });
    expect(tooFew.ok).toBe(false); // needs exactly 2 (9 cards, limit 7), tried 1
  });

  it('trims the queued player back to their hand limit, then resolves the deferred attack once the queue empties', () => {
    const boss: LegacyEnemySpec = { name: 'Wyvern', suit: 'S', health: 100, attack: 10 };
    let state = startMission(2, [boss]);
    state = structuredClone(state);
    state.players[0].hand = [chanterCard('D', '3')];
    state.players[1].hand = Array.from({ length: 6 }, () => suited('H', '2'));
    const player0Id = state.players[0].id;

    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: player0Id, cardIds: [state.players[0].hand[0].id] })).state;
    const player1 = state.players[1];
    const toDiscard = player1.hand.slice(0, 2).map((c) => c.id);

    const res = ensureOk(applyAction(state, { type: 'RESOLVE_CHANT', playerId: player1.id, discardCardIds: toDiscard }));
    state = res.state;

    expect(state.chanterWindow).toBeNull();
    expect(state.players[1].hand.length).toBe(7); // trimmed back to the limit
    expect(state.discardPile.length).toBe(2);
    // Turn is still player 0's (the chanting player) — the deferred enemy attack now resolves for them.
    expect(state.turnPhase).toBe('AWAIT_DEFEND');
    expect(state.pendingDamage).toBe(10);
  });

  it("Encore doubles how many cards everyone draws", () => {
    const boss: LegacyEnemySpec = { name: 'Wyvern', suit: 'S', health: 100, attack: 10 };
    let state = startMission(1, [boss]);
    state = rig(state, [chanterCard('D', '3', true)]);

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.players[0].hand.length).toBe(6); // 0 (played) + 6 drawn (Encore doubles 3 -> 6)
  });

  it('REGRESSION: a Chanter whose own play also lands the killing blow still fires the chant, then the same player continues against the newly-revealed enemy', () => {
    const boss: LegacyEnemySpec = { name: 'Wyvern', suit: 'S', health: 100, attack: 10 };
    const next: LegacyEnemySpec = { name: 'Drake', suit: 'S', health: 100, attack: 5 };
    let state = startMission(1, [boss, next]);
    // A single Diamonds Chanter card worth 5, with the current enemy's health set to exactly 5 — this one card
    // both lands the killing blow AND should still trigger the chant (the bug: the shipped version's beginChant
    // call sat behind the "enemy defeated" early return, so the chant was silently dropped whenever the killing
    // play included a Chanter).
    state = rig(state, [chanterCard('D', '5')], { maxHealth: 5 });

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    // The kill resolved (new enemy revealed, same player continues, no defend) ...
    expect(state.currentEnemy?.name).toBe('Drake');
    expect(state.turnPhase).toBe('AWAIT_PLAY');
    expect(state.pendingDamage).toBe(0);
    // ... AND the chant still fired: the played card is gone, then 5 were drawn back.
    expect(state.players[0].hand.length).toBe(5);
    expect(state.chanterWindow).toBeNull();
  });

  it('REGRESSION: when the killing play also overflows a hand, the chant trim window still opens, then resumes to "continue against the new enemy" instead of a deferred attack', () => {
    const boss: LegacyEnemySpec = { name: 'Wyvern', suit: 'S', health: 100, attack: 10 };
    const next: LegacyEnemySpec = { name: 'Drake', suit: 'S', health: 100, attack: 5 };
    let state = startMission(2, [boss, next]); // hand limit 7 for 2 players
    state = structuredClone(state);
    state.players[0].hand = [chanterCard('D', '3')];
    state.players[1].hand = Array.from({ length: 6 }, () => suited('H', '2'));
    if (state.currentEnemy) state.currentEnemy.maxHealth = 3; // this single card is also the killing blow
    const player0Id = state.players[0].id;
    const player1Id = state.players[1].id;

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: player0Id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    // The kill already revealed the next enemy before the chant's trim window even opens.
    expect(state.currentEnemy?.name).toBe('Drake');
    expect(state.turnPhase).toBe('AWAIT_CHANT_TRIM');
    expect(state.chanterWindow).toEqual({
      pendingPlayerIds: [player1Id],
      onResolved: { kind: 'resumeResolved', turnPhase: 'AWAIT_PLAY', pendingDamage: 0 },
    });

    const toDiscard = state.players[1].hand.slice(0, 2).map((c) => c.id);
    const trimRes = ensureOk(applyAction(state, { type: 'RESOLVE_CHANT', playerId: player1Id, discardCardIds: toDiscard }));
    state = trimRes.state;

    // Resumes to "same player continues their turn against the new enemy" — NOT a deferred attack, since the
    // enemy that would have attacked back is already dead.
    expect(state.chanterWindow).toBeNull();
    expect(state.turnPhase).toBe('AWAIT_PLAY');
    expect(state.pendingDamage).toBe(0);
    expect(state.currentPlayerIndex).toBe(0);
  });
});

describe('legacy: mission 8 reward (only Bram kept, plus corrupt-another-card)', () => {
  it('SOURCED FIX: the other 3 Chanters (fight setup, not a reward) are never granted — only Bram (rank 9, Encore) is kept permanently', () => {
    const mission8 = getMission(8)!;
    // The 4 Chanters are fight SETUP now (extraReserveCards), not part of the reward.
    const setupChanters = mission8.extraReserveCards?.filter((c) => c.kind === 'suited' && c.chanter) ?? [];
    expect(setupChanters.length).toBe(4);

    const party = applyReward(buildInitialParty(), mission8.reward);
    const chanters = party.filter((c) => c.kind === 'suited' && c.chanter);
    expect(chanters.length).toBe(1);
    expect(chanters[0]?.kind === 'suited' && chanters[0]?.name).toBe('Bram the Refrainkeeper');
    expect(chanters[0]?.kind === 'suited' && chanters[0]?.special).toBe('ENCORE');
  });

  it('corrupts another card, and no longer recruits Goran here (moved to Mission 4 — see that mission\'s own reward)', () => {
    const mission8 = getMission(8)!;
    expect(mission8.reward.corruptAnotherCard).toBe(true);
    expect(mission8.reward.recruits.some((r) => r.name === 'Goran')).toBe(false);
  });

  it('a Chanter recruit takes its explicit suit (Chanter has none of its own) and is flagged chanter', () => {
    const card = buildRecruitCard({ name: 'Test Chanter', class: 'CHANTER', rank: '5', suit: 'D' });
    expect(card.kind === 'suited' && card.chanter).toBe(true);
    expect(card.kind === 'suited' && card.suit).toBe('D');
  });
});
describe('legacy: mission 9 mechanics (captured piles)', () => {
  function startTempleMission(
    n: number,
    enemies: LegacyEnemySpec[],
    opts: { extraReserveCards?: Card[] } = {},
  ): GameState {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const names = Array.from({ length: n }, (_, i) => `Player ${i}`);
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ids,
      playerNames: names,
      seed: 'temple-test',
      party: buildInitialParty(),
      enemies,
      jesterCount: 0,
      capturedPilesActive: true,
      extraReserveCards: opts.extraReserveCards,
    });
    if (!res.ok) throw new Error(res.error);
    return res.state;
  }

  it('UNSOURCED BALANCE FIX: scales the pile split down for a solo game (6/pile, 18 total) instead of the fixed 30, leaving much more of the party in the reserve deck', () => {
    const boss: LegacyEnemySpec = { name: 'Loreguard', suit: 'S', health: 20, attack: 10 };
    const state = startTempleMission(1, [boss]);

    expect(state.capturedPiles.length).toBe(3);
    for (const pile of state.capturedPiles) {
      expect(pile.faceUp).not.toBeNull();
      expect(pile.faceDown.length).toBe(5);
    }
    const totalCaptured = state.capturedPiles.reduce((sum, p) => sum + p.faceDown.length + (p.faceUp ? 1 : 0), 0);
    expect(totalCaptured).toBe(18); // Math.min(10, 4 + 2*1) = 6 per pile, not the sourced fixed 10/pile
    // 40-card starting party minus 18 captured = 22 leftover, dealt to the hand and/or left in the reserve deck —
    // versus only 10 under the old fixed-30 split (see legacy-mission-playtest-findings' Mission 9 note).
    const handCount = state.players.reduce((sum, p) => sum + p.hand.length, 0);
    expect(handCount + state.tavernDeck.length).toBe(22);
  });

  it('SECOND-PASS BALANCE FIX: caps the pile split for a 4-player game well below the sourced 30-card figure, since this engine\'s own hand-size table means the opening deal alone would otherwise drain the tavern deck to 0', () => {
    const boss: LegacyEnemySpec = { name: 'Loreguard', suit: 'S', health: 20, attack: 10 };
    // No extras/jesters here (see startTempleMission's own jesterCount: 0 and unset extraReserveCards) — the real
    // Mission 9 has 8 Pilgrim extras + 2 jesters at 4p to help absorb the opening deal, so this synthetic
    // no-extras scenario needs an even smaller pile than the real mission does to keep the same reserve buffer.
    const state = startTempleMission(4, [boss]);

    const totalCaptured = state.capturedPiles.reduce((sum, p) => sum + p.faceDown.length + (p.faceUp ? 1 : 0), 0);
    // The first pass's Math.min(10, 4+2*4)=10/pile (30 total) left the tavern deck at exactly 0 cards after the
    // opening 4-player deal (4 * 5-card hand limit = 20 cards, against a 40-card party with none of this
    // scenario's extras/jesters to help) — see the mission-9-recheck sim (deleted after use). This mission's
    // actual reserve-deck math now also caps the pile size so at least 10 cards remain in the tavern deck after
    // the opening deal.
    const handCount = state.players.reduce((sum, p) => sum + p.hand.length, 0);
    expect(handCount + state.tavernDeck.length).toBe(40 - totalCaptured);
    expect(state.tavernDeck.length).toBeGreaterThanOrEqual(10);
    expect(totalCaptured).toBeLessThan(30);
  });

  it('shuffles extraReserveCards into the ordinary reserve deck, not the captured piles', () => {
    const boss: LegacyEnemySpec = { name: 'Loreguard', suit: 'S', health: 20, attack: 10 };
    const acolyte: Card = { id: 'acolyte-1', kind: 'suited', suit: 'H', rank: '3', name: 'Test Acolyte' };
    const state = startTempleMission(1, [boss], { extraReserveCards: [acolyte] });

    const inPiles = state.capturedPiles.some(
      (p) => p.faceUp?.id === 'acolyte-1' || p.faceDown.some((c) => c.id === 'acolyte-1'),
    );
    expect(inPiles).toBe(false);
    const inHandOrDeck =
      state.players.some((p) => p.hand.some((c) => c.id === 'acolyte-1')) ||
      state.tavernDeck.some((c) => c.id === 'acolyte-1');
    expect(inHandOrDeck).toBe(true);
  });

  it('opens AWAIT_END_OF_TURN instead of advancing once a turn would otherwise end, as long as a pile is still face-up', () => {
    const boss: LegacyEnemySpec = { name: 'Loreguard', suit: 'S', health: 100, attack: 0 };
    const state = startTempleMission(1, [boss]);

    const res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));
    expect(res.state.turnPhase).toBe('AWAIT_END_OF_TURN');
  });

  it('BANISH_FOR_RESCUE banishes the chosen hand card and moves the pile\'s face-up card to the discard pile, then flips the next one', () => {
    const boss: LegacyEnemySpec = { name: 'Loreguard', suit: 'S', health: 100, attack: 0 };
    let state = startTempleMission(1, [boss]);
    state.turnPhase = 'AWAIT_END_OF_TURN';
    const rescued: Card = { id: 'rescued-1', kind: 'suited', suit: 'H', rank: '5', name: 'Rescued Hero' };
    const next: Card = { id: 'next-1', kind: 'suited', suit: 'D', rank: '6', name: 'Next Hero' };
    state.capturedPiles = [{ faceUp: rescued, faceDown: [next] }, { faceUp: null, faceDown: [] }, { faceUp: null, faceDown: [] }];
    const banishCard = state.players[0].hand[0];

    const res = ensureOk(
      applyAction(state, { type: 'BANISH_FOR_RESCUE', playerId: state.players[0].id, cardId: banishCard.id, pileIndex: 0 }),
    );

    expect(res.state.banishPile.some((c) => c.id === banishCard.id)).toBe(true);
    expect(res.state.discardPile.some((c) => c.id === 'rescued-1')).toBe(true);
    expect(res.state.capturedPiles[0].faceUp?.id).toBe('next-1');
    expect(res.state.capturedPiles[0].faceDown.length).toBe(0);
    expect(res.state.turnPhase).toBe('AWAIT_PLAY'); // turn advanced
  });

  it('DECLINE_RESCUE cycles every face-up pile card to the bottom of its own pile and reveals the next one', () => {
    const boss: LegacyEnemySpec = { name: 'Loreguard', suit: 'S', health: 100, attack: 0 };
    let state = startTempleMission(1, [boss]);
    state.turnPhase = 'AWAIT_END_OF_TURN';
    const oldTop: Card = { id: 'old-top', kind: 'suited', suit: 'H', rank: '5' };
    const newTop: Card = { id: 'new-top', kind: 'suited', suit: 'D', rank: '6' };
    state.capturedPiles = [{ faceUp: oldTop, faceDown: [newTop] }, { faceUp: null, faceDown: [] }, { faceUp: null, faceDown: [] }];

    const res = ensureOk(applyAction(state, { type: 'DECLINE_RESCUE', playerId: state.players[0].id }));

    expect(res.state.capturedPiles[0].faceUp?.id).toBe('new-top');
    expect(res.state.capturedPiles[0].faceDown.map((c) => c.id)).toEqual(['old-top']); // cycled to the bottom, not discarded
    expect(res.state.banishPile.length).toBe(0);
    expect(res.state.discardPile.length).toBe(0);
    expect(res.state.turnPhase).toBe('AWAIT_PLAY'); // turn advanced
  });

  it('skips AWAIT_END_OF_TURN entirely when a kill lets the same player continue (no end-of-turn effects after defeating an enemy)', () => {
    const boss: LegacyEnemySpec = { name: 'Loreguard', suit: 'S', health: 5, attack: 0 };
    const next: LegacyEnemySpec = { name: 'Next', suit: 'D', health: 100, attack: 0 };
    let state = startTempleMission(1, [boss, next]);
    state = rig(state, [suited('D', '7')]); // overkill (not exact) — 7 damage on 5 health

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));

    expect(res.state.turnPhase).toBe('AWAIT_PLAY'); // straight back to play, never AWAIT_END_OF_TURN
  });

  it('an exact-damage kill opens AWAIT_RESCUE_CHOICE, and choosing a pile sends its face-up card to the top of the reserve deck', () => {
    const boss: LegacyEnemySpec = { name: 'Loreguard', suit: 'S', health: 5, attack: 0 };
    const next: LegacyEnemySpec = { name: 'Next', suit: 'D', health: 100, attack: 0 };
    let state = startTempleMission(1, [boss, next]);
    const rescued: Card = { id: 'exact-rescue', kind: 'suited', suit: 'H', rank: '9', name: 'Prized Hero' };
    state.capturedPiles = [{ faceUp: rescued, faceDown: [] }, { faceUp: null, faceDown: [] }, { faceUp: null, faceDown: [] }];
    state = rig(state, [suited('D', '5')]); // exact kill (5 damage on 5 health)

    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    expect(res.state.turnPhase).toBe('AWAIT_RESCUE_CHOICE');

    res = ensureOk(applyAction(res.state, { type: 'CHOOSE_EXACT_KILL_RESCUE', playerId: state.players[0].id, pileIndex: 0 }));
    expect(res.state.tavernDeck[0]?.id).toBe('exact-rescue');
    expect(res.state.capturedPiles[0].faceUp).toBeNull();
    expect(res.state.turnPhase).toBe('AWAIT_PLAY'); // same player continues, no turn advance
  });
});

describe('legacy: Evergreen class power (Gøran — all four powers at once, ignores immunity)', () => {
  function evergreenCard(suit: SuitedCard['suit'], rank: SuitedCard['rank']): SuitedCard {
    return { ...suited(suit, rank), evergreen: true };
  }

  it('resolves heal, draw, double damage, and reduce-strength all at once, even against an enemy immune to that suit', () => {
    const boss: LegacyEnemySpec = { name: 'Myla', suit: 'H', health: 100, attack: 20 }; // immune to Hearts
    let state = startMission(1, [boss]);
    state.discardPile = [suited('C', '2'), suited('C', '3')]; // something for the heal to shuffle back
    state = rig(state, [evergreenCard('H', '4')]); // printed suit is Hearts, the enemy's own immunity

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    const s = res.state;

    expect(s.discardPile.length).toBe(0); // Hearts: healed despite the enemy's immunity to Hearts
    expect(s.currentEnemy?.damageTaken).toBe(8); // Clubs: 4 * 2 (double damage)
    expect(s.currentEnemy?.spadesShield).toBe(4); // Spades: reduces the enemy's attack
    // Diamonds: drew cards up to the hand limit (started at maxHandSize - 1 after playing the Evergreen card).
    expect(s.players[0].hand.length).toBeGreaterThan(0);
  });
});

describe('legacy: bonus Mage sticker (secondClassArcane — keeps its own suit power AND triggers a Mage reveal)', () => {
  it('resolves both its printed suit power and its own Mage reveal when played', () => {
    const boss: LegacyEnemySpec = { name: 'Test', suit: 'S', health: 100, attack: 10 };
    let state = startMission(1, [boss]);
    const stickered: SuitedCard = { ...suited('C', '4'), secondClassArcane: true }; // Warrior + bonus Mage reveal
    state = rig(state, [stickered]);
    const chosen = suited('D', '2');
    state.tavernDeck = [suited('S', '3'), suited('H', '5'), chosen, suited('S', '6')]; // N=4, the card's own value

    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    let s = res.state;
    expect(s.turnPhase).toBe('AWAIT_MAGE_REVEAL');

    res = ensureOk(applyAction(s, { type: 'CHOOSE_MAGE_REVEAL_CARD', playerId: state.players[0].id, cardId: chosen.id }));
    s = res.state;
    // Clubs doubles the play's effective value ((4 play + 2 chosen) * 2) = 12.
    expect(s.currentEnemy?.damageTaken).toBe(12);
  });

  it('applyMageSticker gives one random eligible party member secondClassArcane, skipping Mage/Reaver/Guardian/Druid/Evergreen cards', () => {
    const party = buildInitialParty();
    const next = applyMageSticker(party);
    const stickered = next.filter((c) => c.kind === 'suited' && c.secondClassArcane);
    expect(stickered.length).toBe(1);
  });
});

describe('legacy: Evergreen Mother relic (Mission 9 reward — corrupted-card cost redirect)', () => {
  function startWithRelic(n: number, enemies: LegacyEnemySpec[]): GameState {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const names = Array.from({ length: n }, (_, i) => `Player ${i}`);
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ids,
      playerNames: names,
      seed: 'relic-test',
      party: buildInitialParty(),
      enemies,
      jesterCount: 0,
      relics: ['EVERGREEN_MOTHER'],
    });
    if (!res.ok) throw new Error(res.error);
    return res.state;
  }

  it('redirects the cost to another player banishing a card from their own hand instead of the reserve deck', () => {
    const boss: LegacyEnemySpec = { name: 'Test', suit: 'S', health: 100, attack: 10 };
    let state = startWithRelic(2, [boss]);
    const corrupted: SuitedCard = { ...suited('H', '5'), corrupted: true };
    state = rig(state, [corrupted]);
    const tavernBefore = state.tavernDeck.length;
    const otherHandBefore = state.players[1].hand.length;

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));

    expect(res.state.tavernDeck.length).toBe(tavernBefore); // reserve deck untouched
    expect(res.state.players[1].hand.length).toBe(otherHandBefore - 1); // the other player lost a card
    expect(res.state.banishPile.length).toBe(1);
  });

  it('in solo play, banishes from the same player\'s own remaining hand instead', () => {
    const boss: LegacyEnemySpec = { name: 'Test', suit: 'S', health: 100, attack: 10 };
    let state = startWithRelic(1, [boss]);
    const corrupted: SuitedCard = { ...suited('H', '5'), corrupted: true };
    state = rig(state, [corrupted, suited('C', '2')]); // one extra card left in hand after playing the corrupted one

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));

    expect(res.state.players[0].hand.length).toBe(0); // the leftover card was banished
    expect(res.state.banishPile.some((c) => c.kind === 'suited' && c.rank === '2')).toBe(true);
  });

  it('does nothing when there is no eligible hand to banish from', () => {
    const boss: LegacyEnemySpec = { name: 'Test', suit: 'S', health: 100, attack: 10 };
    let state = startWithRelic(1, [boss]);
    const corrupted: SuitedCard = { ...suited('H', '5'), corrupted: true };
    state = rig(state, [corrupted]); // nothing left in hand after playing it

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));

    expect(res.state.banishPile.length).toBe(0);
  });
});

describe('legacy: mission 9 reward (Evergreen Mother relic, Goran upgraded to Evergreen in place, Mage sticker)', () => {
  it('SOURCED FIX: grants no new recruit here — instead upgrades the existing Goran (introduced by Mission 4\'s own reward) to Evergreen, plus the Evergreen Mother relic and a bonus Mage sticker', () => {
    const mission4 = getMission(4)!;
    const mission9 = getMission(9)!;
    expect(mission9.reward.relics).toEqual(['EVERGREEN_MOTHER']);
    expect(mission9.reward.mageSticker).toBe(true);
    expect(mission9.reward.recruits.length).toBe(0); // no brand-new recruit — sourced correction
    expect(mission9.reward.upgradeEvergreenCard).toBe('Goran');

    // Goran doesn't exist in this campaign's party until Mission 4's own reward introduces him — apply both
    // rewards in their actual campaign order to exercise the full arc.
    let party = applyReward(buildInitialParty(), mission4.reward);
    party = applyReward(party, mission9.reward);

    const goranCard = party.find((c) => c.kind === 'suited' && c.name === 'Goran');
    expect(goranCard).toBeDefined();
    if (goranCard?.kind === 'suited') {
      expect(goranCard.suit).toBe('S');
      expect(goranCard.rank).toBe('8');
      expect(goranCard.evergreen).toBe(true);
    }
    expect(party.filter((c) => c.kind === 'suited' && c.evergreen).length).toBe(1);
    expect(party.filter((c) => c.kind === 'suited' && c.secondClassArcane).length).toBe(1);
  });

  it('matching by name (not suit+rank) matters: Goran\'s suit+rank identity (Spades, 8) is already claimed by a pre-existing starting party member, who must NOT be the one upgraded', () => {
    const mission4 = getMission(4)!;
    const mission9 = getMission(9)!;
    let party = applyReward(buildInitialParty(), mission4.reward);
    const preexistingS8 = party.find((c) => c.kind === 'suited' && c.suit === 'S' && c.rank === '8' && c.name !== 'Goran');
    expect(preexistingS8).toBeDefined(); // sanity check: the collision this test guards against is real

    party = applyReward(party, mission9.reward);

    const stillUnupgraded = party.find((c) => c.id === preexistingS8!.id);
    expect(stillUnupgraded?.kind === 'suited' && stillUnupgraded.evergreen).toBeFalsy();
    const goranCard = party.find((c) => c.kind === 'suited' && c.name === 'Goran');
    expect(goranCard?.kind === 'suited' && goranCard.evergreen).toBe(true);
  });
});

describe('legacy: mission 10 setup (Pride to Fall)', () => {
  function startMission10(n: number, opts: { startOfTurnZoneFlip?: boolean; party?: Card[] } = {}): GameState {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const names = Array.from({ length: n }, (_, i) => `Player ${i}`);
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ids,
      playerNames: names,
      seed: 'mission-10-test',
      party: opts.party ?? buildInitialParty(),
      enemies: [],
      jesterCount: 0,
      corruptedPartyEnemies: true,
      startOfTurnZoneFlip: opts.startOfTurnZoneFlip ?? true,
    });
    if (!res.ok) throw new Error(res.error);
    return res.state;
  }

  it('the mission entry has no static enemy list (built from the party instead) and documents no transcript reward', () => {
    const mission10 = getMission(10)!;
    expect(mission10.title).toBe('Pride to Fall');
    expect(mission10.enemies).toEqual([]);
    expect(mission10.corruptedPartyEnemies).toBe(true);
    expect(mission10.startOfTurnZoneFlip).toBe(true);
    expect(mission10.reward.recruits).toEqual([]);
    expect(mission10.reward.relics).toBeUndefined();
  });

  it('builds an 8-enemy queue from the party, sorted weakest-to-strongest, health fixed at 5x each enemy\'s base strength', () => {
    // Isolate from the start-of-turn flip so the leftover-party accounting below stays a clean subtraction.
    const state = startMission10(1, { startOfTurnZoneFlip: false });
    const queue = [state.currentEnemy!, ...state.castleDeck];
    expect(queue.length).toBe(8);
    for (const e of queue) {
      expect(e.maxHealth).toBe(e.baseAttack * 5);
      expect(e.sourceCard).toBeDefined();
    }
    for (let i = 1; i < queue.length; i++) {
      expect(queue[i].baseAttack).toBeGreaterThanOrEqual(queue[i - 1].baseAttack);
    }
    // All 8 pulled from distinct party cards.
    expect(new Set(queue.map((e) => e.sourceCard!.id)).size).toBe(8);
    // The 40-card starting party minus the 8 pulled for the enemy queue = 32 left in circulation.
    const handCount = state.players.reduce((sum, p) => sum + p.hand.length, 0);
    expect(handCount + state.tavernDeck.length).toBe(32);
  });

  it(
    'prioritizes already-corrupted party members for the enemy queue over a random sample — sourced correction, ' +
      "see legacy-missions-transcript-mismatches memory doc's Mission 10 section",
    () => {
      const party = buildInitialParty();
      // Mark exactly 3 party cards corrupted (fewer than the 8 the queue needs — realistic today, since no
      // earlier mission's reward path actually sets this flag yet; see deck.ts's buildCorruptedPartyEnemies).
      const corruptedIds = new Set(party.slice(0, 3).map((c) => c.id));
      const seededParty = party.map((c) => (corruptedIds.has(c.id) ? { ...c, corrupted: true } : c));

      const state = startMission10(1, { startOfTurnZoneFlip: false, party: seededParty });
      const queue = [state.currentEnemy!, ...state.castleDeck];
      const queueSourceIds = new Set(queue.map((e) => e.sourceCard!.id));

      // All 3 corrupted members were pulled into the queue...
      for (const id of corruptedIds) expect(queueSourceIds.has(id)).toBe(true);
      // ...and the remaining 5 slots fell back to the old random-sample-from-the-whole-party behavior to fill
      // out the queue, exactly as before this fix, since only 3 corrupted members exist to draw from.
      expect(queue.length).toBe(8);
    },
  );

  it('falls back to a random sample from the whole party when no member is corrupted yet (today\'s realistic campaign state)', () => {
    // buildInitialParty() never marks anything corrupted — no earlier mission's reward path does that yet — so
    // this is the actual state a real campaign reaches Mission 10 in today, not a hypothetical.
    const state = startMission10(1, { startOfTurnZoneFlip: false });
    const queue = [state.currentEnemy!, ...state.castleDeck];
    expect(queue.length).toBe(8);
    expect(queue.every((e) => e.sourceCard?.kind === 'suited' && !e.sourceCard.corrupted)).toBe(true);
  });

  it('fails to start when the party has fewer than 8 eligible members to corrupt', () => {
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ['p0'],
      playerNames: ['Player 0'],
      seed: 'too-small',
      party: buildInitialParty().slice(0, 5),
      enemies: [],
      jesterCount: 0,
      corruptedPartyEnemies: true,
      startOfTurnZoneFlip: true,
    });
    expect(res.ok).toBe(false);
  });

  it('flips the top of the reserve deck into the mission zone at the START of every turn (not the end)', () => {
    let state = startMission10(1);
    // The first player's first turn already got its start-of-turn flip at mission start.
    expect(state.missionZone.length).toBe(1);
    // 0 attack (and a huge Spades shield, to swallow whatever the zone bonus turns out to be) so YIELD ends the
    // turn outright with no AWAIT_DEFEND detour.
    state = rig(state, [], { baseAttack: 0, spadesShield: 999 });
    const res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));
    // Yielding ends the turn (single player loops back to themselves) — a second flip should have fired.
    expect(res.state.missionZone.length).toBe(2);
  });
});

describe('legacy: mission 10 class powers (corrupted-hero enemies)', () => {
  function startMission10(opts: { startOfTurnZoneFlip?: boolean } = {}): GameState {
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ['p0'],
      playerNames: ['Player 0'],
      seed: 'mission-10-powers-test',
      party: buildInitialParty(),
      enemies: [],
      jesterCount: 0,
      corruptedPartyEnemies: true,
      startOfTurnZoneFlip: opts.startOfTurnZoneFlip ?? true,
    });
    if (!res.ok) throw new Error(res.error);
    return res.state;
  }

  it("an enemy Warrior doubles total strength (base + mission-zone bonus) BEFORE the players' own Spades shield is subtracted", () => {
    let state = startMission10();
    state = rig(state, [], { suit: 'C', baseAttack: 5, spadesShield: 3 }); // Warrior suit
    state.missionZone = [suited('D', '2')]; // zone bonus of 2, overwriting whatever the setup flip put there

    const res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));

    // (5 base + 2 zone) * 2 (Warrior) = 14, minus 3 Spades shield = 11.
    expect(res.state.pendingDamage).toBe(11);
    expect(res.state.turnPhase).toBe('AWAIT_DEFEND');
  });

  it('a non-Warrior enemy gets no doubling — just base + zone bonus, minus Spades shield', () => {
    let state = startMission10();
    state = rig(state, [], { suit: 'S', baseAttack: 5, spadesShield: 3 }); // Paladin suit, not Warrior
    state.missionZone = [suited('D', '2')];

    const res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));

    // 5 base + 2 zone - 3 shield = 4, no doubling.
    expect(res.state.pendingDamage).toBe(4);
  });

  it(
    'caps the mission zone\'s contribution to the enemy\'s attack — UNSOURCED balance judgment call (see ' +
      'MISSION_10_ZONE_BONUS_CAP\'s own comment in engine.ts and legacy-mission-playtest-findings for why)',
    () => {
      let state = startMission10();
      state = rig(state, [], { suit: 'S', baseAttack: 5, spadesShield: 0 }); // Paladin suit, not Warrior — keeps the math to base + capped zone
      // Raw zone sum is 4+5+6+8 = 23, far past the cap — only MISSION_10_ZONE_BONUS_CAP (10) of it should count.
      state.missionZone = [suited('D', '4'), suited('H', '5'), suited('C', '6'), suited('S', '8')];

      const res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));

      // 5 base + 10 (capped zone, not the raw 23) = 15.
      expect(res.state.pendingDamage).toBe(15);
    },
  );

  it('an enemy Paladin reduces damage it takes by its own base strength', () => {
    let state = startMission10();
    state = rig(state, [suited('D', '10')], { suit: 'S', baseAttack: 4, maxHealth: 100, damageTaken: 0 }); // Paladin suit

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );

    // 10 raw damage - 4 (the enemy's own base strength) = 6.
    expect(res.state.currentEnemy?.damageTaken).toBe(6);
  });

  it("floors an enemy Paladin's damage reduction at 0 rather than going negative", () => {
    let state = startMission10();
    state = rig(state, [suited('D', '2')], { suit: 'S', baseAttack: 4, maxHealth: 100, damageTaken: 0 });

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );

    expect(res.state.currentEnemy?.damageTaken).toBe(0);
  });

  it('an enemy Cleric drags the discard pile\'s top card into the mission zone at the end of the turn', () => {
    let state = startMission10({ startOfTurnZoneFlip: false }); // isolate from the unrelated zone-flip mechanic
    state = rig(state, [], { suit: 'H', baseAttack: 0 }); // Cleric suit, 0 attack so YIELD ends the turn outright
    state.discardPile = [suited('D', '3')];
    const draggedId = state.discardPile[0].id;

    const res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));

    expect(res.state.discardPile.length).toBe(0);
    expect(res.state.missionZone.map((c) => c.id)).toEqual([draggedId]);
  });

  it(
    'an enemy Bard opens a player CHOICE (AWAIT_BARD_SURRENDER) instead of auto-picking a card — sourced ' +
      'correction, see legacy-missions-transcript-mismatches memory doc\'s Mission 10 section',
    () => {
      let state = startMission10({ startOfTurnZoneFlip: false });
      const low = suited('C', '2');
      const mid = suited('H', '5');
      const high = suited('D', '8');
      state = rig(state, [mid, low, high], { suit: 'D', baseAttack: 0 }); // Bard suit, 0 attack

      const yielded = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));

      // Pauses right here — the whole hand is still intact, nothing has moved to the zone yet, and the
      // current-player pointer hasn't advanced (still whoever's turn is ending).
      expect(yielded.state.turnPhase).toBe('AWAIT_BARD_SURRENDER');
      expect(yielded.state.players[0].hand.map((c) => c.id).sort()).toEqual([high.id, low.id, mid.id].sort());
      expect(yielded.state.missionZone.length).toBe(0);
      expect(yielded.state.currentPlayerIndex).toBe(0);

      // The player picks — deliberately NOT the lowest-value card, proving this is a real choice rather than a
      // relabeled auto-pick.
      const res = ensureOk(
        applyAction(yielded.state, { type: 'SURRENDER_CARD_TO_ZONE', playerId: state.players[0].id, cardId: high.id }),
      );

      expect(res.state.players[0].hand.map((c) => c.id).sort()).toEqual([low.id, mid.id].sort());
      expect(res.state.missionZone.map((c) => c.id)).toEqual([high.id]);
      // Turn-advancement resumed and completed once the choice resolved.
      expect(res.state.turnPhase).toBe('AWAIT_PLAY');
    },
  );

  it("SURRENDER_CARD_TO_ZONE rejects a card not in the ending player's hand, and rejects a different player resolving it", () => {
    let state = startMission10({ startOfTurnZoneFlip: false });
    const inHand = suited('H', '4');
    state = rig(state, [inHand], { suit: 'D', baseAttack: 0 });
    const yielded = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));
    expect(yielded.state.turnPhase).toBe('AWAIT_BARD_SURRENDER');

    const notInHand = applyAction(yielded.state, {
      type: 'SURRENDER_CARD_TO_ZONE',
      playerId: state.players[0].id,
      cardId: 'not-a-real-card-id',
    });
    expect(notInHand.ok).toBe(false);

    const wrongPlayer = applyAction(yielded.state, { type: 'SURRENDER_CARD_TO_ZONE', playerId: 'someone-else', cardId: inHand.id });
    expect(wrongPlayer.ok).toBe(false);
    // Neither rejected attempt actually moved the card.
    expect(yielded.state.players[0].hand.map((c) => c.id)).toEqual([inHand.id]);
  });

  it("an enemy Bard's forced move is skipped entirely when the ending player's hand is empty", () => {
    let state = startMission10({ startOfTurnZoneFlip: false });
    state = rig(state, [], { suit: 'D', baseAttack: 0 });

    const res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));

    expect(res.state.missionZone.length).toBe(0);
  });

  it('defeating an enemy skips that turn\'s end-of-turn class effect entirely', () => {
    let state = startMission10({ startOfTurnZoneFlip: false });
    // Warrior suit (no always-on damage-taken interaction) so the overkill math below stays simple.
    state = rig(state, [suited('D', '9')], { suit: 'C', baseAttack: 0, maxHealth: 5, damageTaken: 0 });
    state.discardPile = [suited('H', '3')]; // would be dragged into the zone if a Cleric's effect fired — it's a Warrior here, but proves the *kill-skips-advanceToNextPlayer* path generally
    const untouchedId = state.discardPile[0].id;

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );

    // Overkill (9 damage on 5 health) defeats the enemy and lets the same player continue — advanceToNextPlayer,
    // and therefore resolveCorruptedEnemyEndOfTurnEffect and flipStartOfTurnZoneCard, never ran this turn.
    expect(res.state.turnPhase).toBe('AWAIT_PLAY');
    expect(res.state.missionZone.length).toBe(0);
    expect(res.state.discardPile.some((c) => c.id === untouchedId)).toBe(true);
  });
});

describe('legacy: mission 10 mission-zone defeat handling + deck-rehabilitation reward', () => {
  function startMission10(): GameState {
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ['p0'],
      playerNames: ['Player 0'],
      seed: 'mission-10-defeat-test',
      party: buildInitialParty(),
      enemies: [],
      jesterCount: 0,
      corruptedPartyEnemies: true,
      startOfTurnZoneFlip: false, // isolated from the unrelated start-of-turn flip mechanic
    });
    if (!res.ok) throw new Error(res.error);
    return res.state;
  }

  it('an exact kill sends the whole mission zone to the discard pile and restores the fallen hero, cleansed', () => {
    let state = startMission10();
    // Warrior suit avoids the enemy-Paladin damage-taken reduction, keeping the exact-kill math simple.
    state = rig(state, [suited('D', '9')], { suit: 'C', baseAttack: 0, maxHealth: 9, damageTaken: 0 });
    const zoneCards = [suited('H', '2'), suited('D', '3')];
    state.missionZone = zoneCards;
    const heroSourceCard = state.currentEnemy!.sourceCard!;

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );

    expect(res.state.missionZone.length).toBe(0);
    expect(res.state.banishPile.length).toBe(0);
    for (const c of zoneCards) expect(res.state.discardPile.some((d) => d.id === c.id)).toBe(true);
    expect(res.state.restoredPartyCards.map((c) => c.id)).toEqual([heroSourceCard.id]);
  });

  it('an overkill (non-exact) banishes the whole mission zone instead, and restores nothing', () => {
    let state = startMission10();
    state = rig(state, [suited('D', '9')], { suit: 'C', baseAttack: 0, maxHealth: 5, damageTaken: 0 });
    const zoneCards = [suited('H', '2'), suited('D', '3')];
    state.missionZone = zoneCards;

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );

    expect(res.state.missionZone.length).toBe(0);
    for (const c of zoneCards) expect(res.state.banishPile.some((d) => d.id === c.id)).toBe(true);
    expect(res.state.discardPile.some((d) => zoneCards.some((c) => c.id === d.id))).toBe(false);
    expect(res.state.restoredPartyCards.length).toBe(0);
  });
});

describe('legacy: mission 10 reward (applyRestoredPartyCards — "deck rehabilitation")', () => {
  it(
    'REPLACES (not skips) a party card whose id matches a restored card, cleansing its `corrupted` flag — this is ' +
      "the realistic case: RoomManager never removes the chosen card from the party when it becomes a Mission " +
      '10 enemy, so the restored card IS the same still-corrupted party card, still present at the same id. ' +
      'Regression test for a silent no-op: the old skip-if-present dedup treated this normal case as the rare ' +
      "\"came back another way\" edge case and threw the restoration away entirely.",
    () => {
      const party = buildInitialParty();
      const stillCorrupted = { ...party[0], corrupted: true };
      const partyWithCorruption = party.map((c) => (c.id === stillCorrupted.id ? stillCorrupted : c));

      const next = applyRestoredPartyCards(partyWithCorruption, [stillCorrupted]);

      expect(next.length).toBe(party.length); // replaced in place, not appended as a duplicate
      expect(next.filter((c) => c.id === stillCorrupted.id).length).toBe(1);
      const restored = next.find((c) => c.id === stillCorrupted.id)!;
      expect(restored.kind).toBe('suited');
      expect(restored.kind === 'suited' && restored.corrupted).toBeFalsy();
    },
  );

  it('appends a restored card whose id is genuinely absent from the party (defensive fallback)', () => {
    const party = buildInitialParty();
    const brandNew: Card = { id: 'restored-hero-1', kind: 'suited', suit: 'H', rank: '5', name: 'Cleansed Hero', corrupted: true };

    const next = applyRestoredPartyCards(party, [brandNew]);

    expect(next.length).toBe(party.length + 1);
    const added = next.find((c) => c.id === 'restored-hero-1');
    expect(added).toBeDefined();
    expect(added!.kind === 'suited' && added!.corrupted).toBeFalsy(); // appended cards are cleansed too
  });

  it('is a no-op (same reference) for an empty restored list', () => {
    const party = buildInitialParty();
    expect(applyRestoredPartyCards(party, [])).toBe(party);
  });
});

/** Mission 4's Beast Companion reward pool, freshly built (mirrors how RoomManager grants it via applyReward). Filtered to just the 4 beast recruits — Mission 4's reward also recruits Goran (a non-beast card) alongside them. */
function mission4BeastCards(): SuitedCard[] {
  return getMission(4)!.reward.recruits.filter((r) => r.beast).map((r) => buildRecruitCard(r) as SuitedCard);
}

function startMission11(n: number, opts: { party?: Card[] } = {}): GameState {
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const names = Array.from({ length: n }, (_, i) => `Player ${i}`);
  const mission11 = getMission(11)!;
  const res = applyAction(createLobbyState(), {
    type: 'START_LEGACY_MISSION',
    playerIds: ids,
    playerNames: names,
    seed: 'mission-11-test',
    party: opts.party ?? [...buildInitialParty(), ...mission4BeastCards()],
    enemies: missionEnemiesToSpecs(mission11.enemies),
    jesterCount: 0,
    beastDeckMechanic: mission11.beastDeckMechanic,
    pileTopEnemyBonus: mission11.pileTopEnemyBonus,
    discardCleanupLowToHigh: mission11.discardCleanupLowToHigh,
  });
  if (!res.ok) throw new Error(res.error);
  return res.state;
}

describe('legacy: mission 11 setup (Descent into Darkness)', () => {
  it('the mission entry has 5 enemies (4 weak mooks, one per base class, plus the final boss Evil Goran), the beast-deck and pile-top-bonus flags, sidelines Esme by identity, and rewards her upgrade instead of a recruit', () => {
    const mission11 = getMission(11)!;
    expect(mission11.title).toBe('Descent into Darkness');
    expect(mission11.enemies.length).toBe(5);
    expect(new Set(mission11.enemies.map((e) => e.class))).toEqual(new Set(['WARRIOR', 'BARD', 'CLERIC', 'PALADIN']));

    const mooks = mission11.enemies.slice(0, 4);
    expect(mooks.every((e) => e.health === 30 && e.attack === 10)).toBe(true);

    const boss = mission11.enemies[4];
    expect(boss.name).toBe('Evil Goran');
    expect(boss.health).toBe(90);
    expect(boss.attack).toBe(20);

    expect(mission11.beastDeckMechanic).toBe(true);
    expect(mission11.pileTopEnemyBonus).toBe(true);
    expect(mission11.discardCleanupLowToHigh).toBe(true);
    expect(mission11.sidelineIdentity).toEqual({ suit: 'C', rank: '6' });
    expect(mission11.reward.recruits).toEqual([]);
    expect(mission11.reward.upgradeSidelinedCard).toEqual({ suit: 'C', rank: '6' });
  });

  it('the starting party names the sidelined identity (6 of Clubs) "Esme"', () => {
    const esme = buildInitialParty().find((c) => c.kind === 'suited' && c.suit === 'C' && c.rank === '6');
    expect(esme?.name).toBe('Esme');
  });

  it('builds the beast deck from the mission-4 beast cards in the party, and none of them are available to draw or play this mission', () => {
    const beasts = mission4BeastCards();
    const party = [...buildInitialParty(), ...beasts];
    const state = startMission11(1, { party });

    // All 4 beast cards are accounted for between the face-down deck and its used-card pile (one's already been
    // flipped for the first turn's start-of-turn effect).
    const pool = [...state.beastDeck, ...state.beastDeckDiscard];
    expect(pool.length).toBe(4);
    const poolIds = new Set(pool.map((c) => c.id));
    expect(poolIds).toEqual(new Set(beasts.map((c) => c.id)));
    expect(pool.every((c) => c.kind === 'suited' && (c as SuitedCard).beast)).toBe(true);

    // None of the beast cards ended up in a hand or the reserve deck — unavailable to the active party this mission.
    const inCirculation = [...state.players.flatMap((p) => p.hand), ...state.tavernDeck];
    expect(inCirculation.some((c) => poolIds.has(c.id))).toBe(false);
  });

  it('is a no-op beast deck (empty) when the party has no beast cards at all', () => {
    const state = startMission11(1, { party: buildInitialParty() });
    expect(state.beastDeck.length).toBe(0);
    expect(state.beastDeckDiscard.length).toBe(0);
  });
});

describe('legacy: mission 11 beast-deck start-of-turn flip', () => {
  function classSpec(cls: 'WARRIOR' | 'BARD' | 'CLERIC' | 'PALADIN') {
    // Filtered to beast recruits — Mission 4's reward also recruits Goran (also PALADIN, not beast-flagged), which
    // would otherwise collide with Sabrielle (the PALADIN beast) on an unfiltered class lookup.
    return getMission(4)!.reward.recruits.find((r) => r.beast && r.class === cls)!;
  }

  it('Warrior-flip banishes the top of the discard pile', () => {
    let state = startMission11(1);
    state = rig(state, [], { baseAttack: 0, spadesShield: 999 });
    state.beastDeck = [buildRecruitCard(classSpec('WARRIOR'))];
    state.beastDeckDiscard = [];
    const discardTop = suited('H', '4');
    state.discardPile = [discardTop];

    const res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));

    expect(res.state.discardPile.length).toBe(0);
    expect(res.state.banishPile.some((c) => c.id === discardTop.id)).toBe(true);
  });

  it('Paladin-flip discards the top of the reserve deck', () => {
    let state = startMission11(1);
    state = rig(state, [], { baseAttack: 0, spadesShield: 999 });
    state.beastDeck = [buildRecruitCard(classSpec('PALADIN'))];
    state.beastDeckDiscard = [];
    const reserveTop = suited('D', '3');
    state.tavernDeck = [reserveTop, ...state.tavernDeck];

    const res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));

    expect(res.state.tavernDeck.some((c) => c.id === reserveTop.id)).toBe(false);
    expect(res.state.discardPile.some((c) => c.id === reserveTop.id)).toBe(true);
  });

  it('Cleric-flip has the current player discard a card from hand', () => {
    let state = startMission11(1);
    const low = suited('C', '2');
    const high = suited('H', '9');
    state = rig(state, [high, low], { baseAttack: 0, spadesShield: 999 });
    state.beastDeck = [buildRecruitCard(classSpec('CLERIC'))];
    state.beastDeckDiscard = [];

    const res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));

    expect(res.state.players[0].hand.map((c) => c.id)).toEqual([high.id]);
    expect(res.state.discardPile.some((c) => c.id === low.id)).toBe(true);
  });

  it('Bard-flip has the current player banish a card from hand', () => {
    let state = startMission11(1);
    const low = suited('S', '3');
    const high = suited('D', '8');
    state = rig(state, [high, low], { baseAttack: 0, spadesShield: 999 });
    state.beastDeck = [buildRecruitCard(classSpec('BARD'))];
    state.beastDeckDiscard = [];

    const res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));

    expect(res.state.players[0].hand.map((c) => c.id)).toEqual([high.id]);
    expect(res.state.banishPile.some((c) => c.id === low.id)).toBe(true);
  });

  it("Bard-flip is skipped entirely when the current player's hand is empty", () => {
    let state = startMission11(1);
    state = rig(state, [], { baseAttack: 0, spadesShield: 999 });
    state.beastDeck = [buildRecruitCard(classSpec('BARD'))];
    state.beastDeckDiscard = [];
    const banishPileBefore = state.banishPile.length;

    const res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));

    expect(res.state.players[0].hand.length).toBe(0);
    expect(res.state.banishPile.length).toBe(banishPileBefore);
    expect(res.state.log.some((e) => e.message.includes('no cards to banish'))).toBe(true);
  });

  it('reshuffles the beast deck from its own used-card pile once it runs dry, then keeps flipping', () => {
    let state = startMission11(1);
    const used = [suited('C', '2'), suited('D', '3')];
    state = rig(state, [], { baseAttack: 0, spadesShield: 999 });
    state.beastDeck = [];
    state.beastDeckDiscard = used;

    const res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));

    const poolIds = new Set([...res.state.beastDeck, ...res.state.beastDeckDiscard].map((c) => c.id));
    expect(poolIds).toEqual(new Set(used.map((c) => c.id)));
    expect(res.state.beastDeck.length).toBe(1); // reshuffled 2, then immediately flipped 1 back into beastDeckDiscard
    expect(res.state.beastDeckDiscard.length).toBe(1);
    expect(res.state.log.some((e) => e.message.includes('reshuffles'))).toBe(true);
  });

  it('an exact kill skips the beast-deck flip on the very next turn', () => {
    let state = startMission11(1);
    // Exact-kill the current (first) enemy: Diamonds doesn't multiply, 5 damage on 5 health.
    state = rig(state, [suited('D', '5')], { suit: 'S', baseAttack: 0, maxHealth: 5, damageTaken: 0, spadesShield: 0 });

    const res1 = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );
    expect(res1.state.skipNextBeastDeckFlip).toBe(true);
    expect(res1.state.turnPhase).toBe('AWAIT_PLAY'); // same player continues against the next of the 4 enemies

    const state2 = rig(res1.state, [], { baseAttack: 0, spadesShield: 999 });
    const beastDeckBefore = state2.beastDeck.map((c) => c.id);
    const beastDiscardBefore = state2.beastDeckDiscard.map((c) => c.id);

    const res2 = ensureOk(applyAction(state2, { type: 'YIELD', playerId: state2.players[0].id }));

    expect(res2.state.beastDeck.map((c) => c.id)).toEqual(beastDeckBefore);
    expect(res2.state.beastDeckDiscard.map((c) => c.id)).toEqual(beastDiscardBefore);
    expect(res2.state.skipNextBeastDeckFlip).toBe(false);
    expect(res2.state.log.some((e) => e.message.includes('spared it a flip'))).toBe(true);
  });
});

describe('legacy: mission 11 pile-top bonus strength & immunity, and banish-on-defeat', () => {
  it("the current enemy draws bonus strength from the discard pile's AND banish pile's top cards combined", () => {
    let state = startMission11(1);
    state = rig(state, [], { baseAttack: 5, spadesShield: 0 });
    state.discardPile = [suited('H', '3')];
    state.banishPile = [suited('D', '4')];

    const res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));

    // 5 base + 3 (discard top) + 4 (banish top) = 12.
    expect(res.state.pendingDamage).toBe(12);
    expect(res.state.turnPhase).toBe('AWAIT_DEFEND');
  });

  it('the current enemy is also immune to whatever class sits on top of the discard pile, even if unrelated to its own suit', () => {
    let state = startMission11(1);
    const heartsCard: SuitedCard = suited('H', '5');
    state = rig(state, [heartsCard], { suit: 'C', baseAttack: 0, spadesShield: 0, maxHealth: 100, damageTaken: 0 }); // Warrior suit, not Hearts
    state.discardPile = [suited('H', '9')]; // top of discard is Hearts-suited

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [heartsCard.id] }),
    );

    expect(res.state.log.some((e) => e.message.includes('blocked'))).toBe(true);
  });

  it('the current enemy is also immune to whatever class sits on top of the banish pile', () => {
    let state = startMission11(1);
    const diamondsCard: SuitedCard = suited('D', '5');
    state = rig(state, [diamondsCard], { suit: 'C', baseAttack: 0, spadesShield: 0, maxHealth: 100, damageTaken: 0 }); // Warrior suit, not Bard
    state.banishPile = [suited('D', '9')]; // top of the banish pile is Diamonds-suited

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [diamondsCard.id] }),
    );

    expect(res.state.log.some((e) => e.message.includes('blocked'))).toBe(true);
  });

  it('defeating an enemy always banishes its played cards — never sent to the discard pile, never recycled back into the queue', () => {
    let state = startMission11(1);
    state = rig(state, [suited('C', '10')], { suit: 'H', baseAttack: 0, maxHealth: 10, damageTaken: 0, spadesShield: 0 }); // Clubs doubles: 20 dmg, overkill
    const castleDeckSizeBefore = state.castleDeck.length;

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );

    expect(res.state.discardPile.some((c) => c.kind === 'suited' && c.suit === 'C' && c.rank === '10')).toBe(false);
    expect(res.state.banishPile.some((c) => c.kind === 'suited' && c.suit === 'C' && c.rank === '10')).toBe(true);
    // One enemy fell off the queue for good — not requeued (castleDeck shrank by exactly 1, never regrew).
    expect(res.state.castleDeck.length).toBe(castleDeckSizeBefore - 1);
  });
});

describe('legacy: mission 11 pile-top immunity ceiling (regression — no more all-4-class lockout)', () => {
  it('a Dual-class Stickers card on top of one pile no longer combines with the other pile to immunize the enemy to every class at once', () => {
    // Regression test for a reported bug: rules.ts's pileTopImmuneSuits had no ceiling on how many classes it
    // could add beyond the enemy's own inherent immunity. A single Dual-class Stickers card (see
    // SuitedCard.secondSuit) on top of the discard pile carries 2 classes by itself — combined with an ordinary
    // single-suited card on top of the banish pile, that's 3 classes from the piles plus the enemy's own class,
    // covering all 4 at once, including BOTH hand-refill suits (Hearts AND Diamonds) simultaneously. See rules.ts's
    // pileTopImmuneSuits doc comment for the fix and its reasoning (each pile-top card now grants at most ONE new
    // class, never both suits of a dual-suited card from a single pile).
    const diamondsCard: SuitedCard = suited('D', '5');
    // No beast cards in the party — an empty beast deck is a guaranteed no-op (see the discard-cleanup describe
    // block's own note below), isolating this from Mission 11's OTHER start-of-turn mechanic.
    let state = startMission11(1, { party: buildInitialParty() });
    state = rig(state, [diamondsCard], { suit: 'C', baseAttack: 0, spadesShield: 0, maxHealth: 100, damageTaken: 0 }); // Warrior suit
    // Discard-pile top carries BOTH hand-refill suits (Hearts and Diamonds) on one card. Banish-pile top adds a
    // 3rd class (Spades), unrelated to the enemy's own Clubs — uncapped, all 4 classes would be immune together.
    state.discardPile = [{ ...suited('H', '9'), secondSuit: 'D' }];
    state.banishPile = [suited('S', '9')];

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [diamondsCard.id] }),
    );

    // Diamonds must still work: at most one of the dual-suited discard-top's two classes can ever be granted, so
    // the other hand-refill suit is never simultaneously locked out by the same card.
    expect(res.state.log.some((e) => e.message.includes('blocked'))).toBe(false);
    expect(res.state.log.some((e) => e.message.includes('card(s) drawn'))).toBe(true);
  });
});

describe('legacy: mission 11 discard cleanup ordering fix (discardCleanupLowToHigh)', () => {
  it('the mission enables discardCleanupLowToHigh — the only multi-card discard-pile push this mission has (pileTopEnemyBonus routes every enemy-defeat table-card batch to the BANISH pile instead)', () => {
    const mission11 = getMission(11)!;
    expect(mission11.discardCleanupLowToHigh).toBe(true);
  });

  it('a covered DEFEND with multiple cards leaves the LOWEST-value card on top of the discard pile, regardless of the order the player selected them in', () => {
    const low = suited('H', '2');
    const mid = suited('D', '5');
    const high = suited('S', '9');

    // No beast cards in the party — an empty beast deck is a guaranteed no-op (see the "no-op beast deck" setup
    // test above), which isolates this assertion from Mission 11's OTHER mechanic (a start-of-turn beast flip
    // could otherwise banish the very top-of-discard-pile card this test is checking, as a Warrior flip does).
    let stateA = startMission11(1, { party: buildInitialParty() });
    stateA = rig(stateA, [low, mid, high], { baseAttack: 3, spadesShield: 0 });
    const yieldedA = ensureOk(applyAction(stateA, { type: 'YIELD', playerId: stateA.players[0].id }));
    expect(yieldedA.state.turnPhase).toBe('AWAIT_DEFEND');
    // Select in high, low, mid order — worst case for an unsorted push (the finishing card, mid, would land on top).
    const defendedA = ensureOk(
      applyAction(yieldedA.state, { type: 'DEFEND', playerId: yieldedA.state.players[0].id, cardIds: [high.id, low.id, mid.id] }),
    );

    let stateB = startMission11(1, { party: buildInitialParty() });
    stateB = rig(stateB, [suited('H', '2'), suited('D', '5'), suited('S', '9')], { baseAttack: 3, spadesShield: 0 });
    const [lowB, midB, highB] = stateB.players[0].hand;
    const yieldedB = ensureOk(applyAction(stateB, { type: 'YIELD', playerId: stateB.players[0].id }));
    // Select in the opposite order this time — low, mid, high.
    const defendedB = ensureOk(
      applyAction(yieldedB.state, { type: 'DEFEND', playerId: yieldedB.state.players[0].id, cardIds: [lowB.id, midB.id, highB.id] }),
    );

    for (const res of [defendedA, defendedB]) {
      const top = res.state.discardPile[res.state.discardPile.length - 1];
      expect(top.kind).toBe('suited');
      if (top.kind === 'suited') expect(top.rank).toBe('2'); // the lowest-value card, no matter the selection order
    }
  });

  it('without the flag, a covered DEFEND preserves whatever order the cards were selected in (proves the sort is gated by discardCleanupLowToHigh, not always-on)', () => {
    const enemy: LegacyEnemySpec = { name: 'Ungoverned Foe', suit: 'H', health: 100, attack: 3 };
    let state = startMission(1, [enemy]); // plain legacy mission, discardCleanupLowToHigh left unset
    expect(state.discardCleanupLowToHigh).toBe(false);
    const low = suited('D', '2');
    const high = suited('S', '9');
    state = rig(state, [high, low]); // enemy attack already 3, no rig override needed
    const yielded = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));
    // Select high first, low second — an unsorted push leaves the LAST-selected card (low) on top.
    const defended = ensureOk(
      applyAction(yielded.state, { type: 'DEFEND', playerId: yielded.state.players[0].id, cardIds: [high.id, low.id] }),
    );
    expect(defended.state.discardPile.map((c) => c.id)).toEqual([high.id, low.id]); // pushed in selection order, unsorted
  });

  it('caps the following turn\'s pileTopEnemyBonus discard-pile-top component at the lowest defended card, not the highest one that actually covered the hit', () => {
    // No beast cards — see the note on the previous test for why this isolates the assertion from the OTHER
    // Mission 11 mechanic (a start-of-turn beast flip firing between the DEFEND and the next YIELD).
    let state = startMission11(1, { party: buildInitialParty() });
    const low = suited('H', '2');
    const high = suited('S', '9');
    state = rig(state, [high, low], { baseAttack: 3, spadesShield: 0 });
    const yielded = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));
    // Select the high card first — the pre-fix bug would leave it landing last if selection order were reversed;
    // either way, the fix guarantees the LOW card ends up on top regardless.
    const defended = ensureOk(
      applyAction(yielded.state, { type: 'DEFEND', playerId: yielded.state.players[0].id, cardIds: [high.id, low.id] }),
    );
    expect(defended.state.turnPhase).toBe('AWAIT_PLAY'); // turn advanced, ready for the next hit

    // Force the next turn's attack to resolve immediately with a fresh (empty) hand and yield again.
    const state2 = rig(defended.state, [], { baseAttack: 5, spadesShield: 0 });
    const res2 = ensureOk(applyAction(state2, { type: 'YIELD', playerId: state2.players[0].id }));

    // 5 base + 2 (the lowest defended card, now on top of the discard pile) + 0 (banish pile empty) = 7 — not
    // 5 + 9 = 14, which is what the pre-fix arbitrary ordering could have handed back.
    expect(res2.state.pendingDamage).toBe(7);
  });
});

describe('legacy: mission 11 banish-pile cleanup ordering fix (discardCleanupLowToHigh now also governs banishCards)', () => {
  function startPileTopBonusMission(enemies: LegacyEnemySpec[], cleanup: boolean): GameState {
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ['p0'],
      playerNames: ['Player 0'],
      seed: 'pile-top-bonus-banish-test',
      party: buildInitialParty(),
      enemies,
      jesterCount: 0,
      pileTopEnemyBonus: true,
      discardCleanupLowToHigh: cleanup,
    });
    if (!res.ok) throw new Error(res.error);
    return res.state;
  }

  it("an enemy kill (overkill) sorts the whole accumulated table-cards batch low-to-high onto the BANISH pile (not the discard pile), capping the next enemy's pile-top bonus at the lowest card", () => {
    const enemyA: LegacyEnemySpec = { name: 'Warden A', suit: 'D', health: 30, attack: 1 };
    const enemyB: LegacyEnemySpec = { name: 'Warden B', suit: 'H', health: 20, attack: 10 };
    let state = startPileTopBonusMission([enemyA, enemyB], true);
    state = rig(state, [suited('C', '9')], { tableCards: [suited('H', '2'), suited('D', '3')], damageTaken: 25 }); // 5 health left

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );
    state = res.state;

    expect(state.currentEnemy?.name).toBe('Warden B'); // the 9 overkills Warden A's remaining 5 health
    expect(state.discardPile.length).toBe(0); // pileTopEnemyBonus routes a defeated enemy's table cards to BANISH, not here
    expect(state.banishPile.length).toBe(3);
    const top = state.banishPile[state.banishPile.length - 1];
    expect(top.kind === 'suited' && top.rank).toBe('2'); // lowest of the batch, regardless of table order
    // Warden B's live attack reads only that lowest card: 10 base + 0 (discard pile empty) + 2 (banish pile top).
    expect(resolvedEnemyAttack(state)).toBe(12);
  });

  it("without the flag, the kill (overkill) preserves table-card order on the banish pile too, so the finishing card can land on top and buff the next enemy at its worst", () => {
    const enemyA: LegacyEnemySpec = { name: 'Warden A', suit: 'D', health: 30, attack: 1 };
    const enemyB: LegacyEnemySpec = { name: 'Warden B', suit: 'H', health: 20, attack: 10 };
    let state = startPileTopBonusMission([enemyA, enemyB], false);
    state = rig(state, [suited('C', '9')], { tableCards: [suited('H', '2'), suited('D', '3')], damageTaken: 25 });

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );
    state = res.state;

    // Whatever order the cards accumulated on the table lands in the banish pile unchanged — the finishing card
    // (9) ends up on top, the pre-fix worst case.
    expect(state.banishPile.map((c) => (c.kind === 'suited' ? c.rank : 'jester'))).toEqual(['2', '3', '9']);
    expect(resolvedEnemyAttack(state)).toBe(19); // 10 base + 0 (discard) + 9 (unsorted banish-pile top)
  });

  it('a single-card banish is left alone regardless of the flag — nothing to order (mirrors pushToDiscardPile\'s own single-card guard)', () => {
    const enemyA: LegacyEnemySpec = { name: 'Warden A', suit: 'D', health: 30, attack: 1 };
    let state = startPileTopBonusMission([enemyA], true);
    state = rig(state, [suited('C', '9')], { tableCards: [], damageTaken: 29 }); // 1 health left, single-card overkill

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );
    state = res.state;

    expect(state.banishPile.length).toBe(1);
    const [only] = state.banishPile;
    expect(only.kind === 'suited' && only.rank).toBe('9');
  });
});

describe('legacy: mission 11 reward (Esme returns permanently upgraded)', () => {
  it("completes the mission immediately (WON) when the last enemy falls — no beast-card choice window", () => {
    const beasts = mission4BeastCards();
    let state = startMission11(1, { party: [...buildInitialParty(), ...beasts] });
    state = structuredClone(state);
    state.castleDeck = []; // the current enemy is the last of the 5
    state = rig(state, [suited('D', '9')], { suit: 'S', baseAttack: 0, maxHealth: 9, damageTaken: 0, spadesShield: 0 });

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );

    // Sourced correction: no pending choice window anymore — same shape as every other mission's final kill.
    expect(res.state.phase).toBe('WON');
    expect(res.state.currentEnemy).toBeNull();
  });

  it('applyEvergreenUpgrade grants the matching card SuitedCard.evergreen, leaving everything else untouched', () => {
    const party = buildInitialParty();
    const esme = party.find((c) => c.kind === 'suited' && c.suit === 'C' && c.rank === '6')!;

    const next = applyEvergreenUpgrade(party, { suit: 'C', rank: '6' });

    const upgraded = next.find((c) => c.id === esme.id) as SuitedCard;
    expect(upgraded.evergreen).toBe(true);
    expect(upgraded.name).toBe('Esme');
    // Nothing else in the party was touched — same length, same other ids, no other card upgraded.
    expect(next.length).toBe(party.length);
    expect(next.filter((c) => c.kind === 'suited' && (c as SuitedCard).evergreen).map((c) => c.id)).toEqual([esme.id]);
  });

  it('applyEvergreenUpgrade is a no-op (same reference) with no identity given', () => {
    const party = buildInitialParty();
    expect(applyEvergreenUpgrade(party, undefined)).toBe(party);
  });

  it('applyEvergreenUpgrade is a no-op (same reference) when no card matches the identity', () => {
    const party = buildInitialParty().filter((c) => !(c.kind === 'suited' && c.suit === 'C' && c.rank === '6'));
    expect(applyEvergreenUpgrade(party, { suit: 'C', rank: '6' })).toBe(party);
  });

  it("applyReward wires the mission's own reward.upgradeSidelinedCard through to Esme, and Beast Companions return unpruned", () => {
    const mission11 = getMission(11)!;
    const beasts = mission4BeastCards();
    const party = [...buildInitialParty(), ...beasts];

    const next = applyReward(party, mission11.reward);

    const esme = next.find((c) => c.kind === 'suited' && c.suit === 'C' && c.rank === '6') as SuitedCard;
    expect(esme.evergreen).toBe(true);
    // Sourced correction: the previously-shipped version pruned the beast-card slate down to one choice at reward
    // time (see the removed applyBeastCardChoice) — the real reward doesn't touch it, so all 4 survive untouched.
    const beastIdsInNext = next.filter((c) => c.kind === 'suited' && (c as SuitedCard).beast).map((c) => c.id);
    expect(new Set(beastIdsInNext)).toEqual(new Set(beasts.map((c) => c.id)));
    expect(next.length).toBe(party.length);
  });
});

function restoredCard(suit: SuitedCard['suit'], rank: SuitedCard['rank']): SuitedCard {
  return { ...suited(suit, rank), restored: true };
}
function corruptedCard(suit: SuitedCard['suit'], rank: SuitedCard['rank']): SuitedCard {
  return { ...suited(suit, rank), corrupted: true };
}

function startMission12(n: number, opts: { party?: Card[] } = {}): GameState {
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const names = Array.from({ length: n }, (_, i) => `Player ${i}`);
  const mission12 = getMission(12)!;
  const res = applyAction(createLobbyState(), {
    type: 'START_LEGACY_MISSION',
    playerIds: ids,
    playerNames: names,
    seed: 'mission-12-test',
    party: opts.party ?? buildInitialParty(),
    enemies: missionEnemiesToSpecs(mission12.enemies),
    jesterCount: 0,
    extraReserveCards: mission12.extraReserveCards,
    restoredCardMechanic: mission12.restoredCardMechanic,
  });
  if (!res.ok) throw new Error(res.error);
  return res.state;
}

describe('legacy: mission 12 setup (Decay to Growth)', () => {
  it('is a 9-enemy Queen/King/Hierarch gauntlet, restoredCardMechanic enabled, no reward', () => {
    const mission12 = getMission(12)!;
    expect(mission12.title).toBe('Decay to Growth');
    expect(mission12.enemies.length).toBe(9);
    expect(new Set(mission12.enemies.slice(0, 8).map((e) => e.class))).toEqual(new Set(['WARRIOR', 'BARD', 'CLERIC', 'PALADIN']));
    // Sourced correction: the Hierarch no longer carries a hard-coded secondClass immunity — the same
    // unsourced-dual-immunity bug already found and fixed on Mission 3 (see missions.ts's Mission 12 comment).
    // Immunity for the final boss now comes solely from the mission's own escalating zone.
    expect(mission12.enemies[8].secondClass).toBeUndefined();
    expect(mission12.restoredCardMechanic).toBe(true);
    expect(mission12.reward.recruits).toEqual([]);
    expect(mission12.reward.relics ?? []).toEqual([]);
  });

  it('seeds restored and corrupted flavor heroes into the reserve deck (not the persisted party)', () => {
    const state = startMission12(1);
    const inCirculation = [...state.players.flatMap((p) => p.hand), ...state.tavernDeck];
    const restoredCount = inCirculation.filter((c) => c.kind === 'suited' && (c as SuitedCard).restored).length;
    const corruptedCount = inCirculation.filter((c) => c.kind === 'suited' && (c as SuitedCard).corrupted).length;
    expect(restoredCount).toBe(4);
    expect(corruptedCount).toBe(2);
  });

  it("doesn't crash on the first turn's flip when the banish pile starts empty", () => {
    const state = startMission12(1);
    expect(state.missionZone).toEqual([]);
    expect(state.banishPile).toEqual([]);
  });
});

describe('legacy: mission 12 restored-card mechanic (ignores immunity, heals instead of banishing)', () => {
  it("a restored card's class power ignores enemy immunity to its own suit", () => {
    const boss: LegacyEnemySpec = { name: 'The Hierarch', suit: 'H', health: 200, attack: 10 };
    let state = startMission(1, [boss]);
    state.restoredCardMechanic = true;
    state.banishPile = []; // isolate: no heal side-effect to worry about
    state.discardPile = [suited('C', '2')];
    state = rig(state, [restoredCard('H', '3')]);

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );

    expect(res.state.log.some((e) => e.message.includes('blocked'))).toBe(false);
    expect(res.state.discardPile.length).toBe(0); // Hearts healed the lone discard card, unblocked
  });

  it('heals the banish pile\'s top card to the bottom of the reserve deck, instead of banishing the reserve deck\'s top card as a corrupted card would', () => {
    const boss: LegacyEnemySpec = { name: 'The Hierarch', suit: 'S', health: 200, attack: 10 };
    let state = startMission(1, [boss]);
    state.restoredCardMechanic = true;
    const toHeal = suited('D', '4');
    const reserveTop = suited('C', '9');
    state.banishPile = [toHeal];
    state.tavernDeck = [reserveTop, ...state.tavernDeck];
    state = rig(state, [restoredCard('H', '3')]);

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );

    expect(res.state.banishPile.some((c) => c.id === toHeal.id)).toBe(false);
    expect(res.state.tavernDeck[res.state.tavernDeck.length - 1]?.id).toBe(toHeal.id); // returned under the reserve deck
    expect(res.state.tavernDeck.some((c) => c.id === reserveTop.id)).toBe(true); // NOT banished as a cost
    expect(res.state.log.some((e) => e.message.includes('heals'))).toBe(true);
  });

  it('does nothing (no crash) when the banish pile is empty', () => {
    const boss: LegacyEnemySpec = { name: 'The Hierarch', suit: 'S', health: 200, attack: 10 };
    let state = startMission(1, [boss]);
    state.restoredCardMechanic = true;
    state.banishPile = [];
    state = rig(state, [restoredCard('H', '3')]);

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );
    expect(res.state.log.some((e) => e.message.includes('nothing to heal'))).toBe(true);
  });
});

describe('legacy: mission 12 corrupted-card redirect (into the reserve deck redirects to the bottom of the banish pile)', () => {
  it("a Hearts heal that would shuffle a corrupted card back under the reserve deck redirects it to the banish pile instead", () => {
    const boss: LegacyEnemySpec = { name: 'The Hierarch', suit: 'S', health: 200, attack: 10 };
    let state = startMission(1, [boss]);
    state.restoredCardMechanic = true;
    const corrupted = corruptedCard('D', '9');
    state.discardPile = [corrupted];
    state = rig(state, [suited('H', '5')]); // Hearts, value 5 — heals the lone discard card

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );

    expect(res.state.tavernDeck.some((c) => c.id === corrupted.id)).toBe(false);
    expect(res.state.banishPile.some((c) => c.id === corrupted.id)).toBe(true);
  });

  it('healing a corrupted card off the top of the banish pile (via a restored card) redirects it right back to the bottom of the banish pile, never into the reserve deck', () => {
    const boss: LegacyEnemySpec = { name: 'The Hierarch', suit: 'S', health: 200, attack: 10 };
    let state = startMission(1, [boss]);
    state.restoredCardMechanic = true;
    const corrupted = corruptedCard('D', '9');
    state.banishPile = [corrupted];
    state = rig(state, [restoredCard('H', '3')]);

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );

    expect(res.state.tavernDeck.some((c) => c.id === corrupted.id)).toBe(false);
    expect(res.state.banishPile.some((c) => c.id === corrupted.id)).toBe(true);
  });
});

describe('legacy: mission 12 restored-card redirect (can never land in the banish pile)', () => {
  function reaverRecruitCard(): SuitedCard {
    const spec = getMission(5)!.reward.recruits.find((r) => r.class === 'REAVER')!;
    return buildRecruitCard(spec) as SuitedCard;
  }

  it("a Reaver's reveal turning up a restored card off the reserve deck redirects it to the bottom of the reserve deck instead of the banish pile", () => {
    const boss: LegacyEnemySpec = { name: 'The Hierarch', suit: 'S', health: 200, attack: 10 };
    let state = startMission(1, [boss]);
    state.restoredCardMechanic = true;
    const toReveal = restoredCard('D', '4');
    state.tavernDeck = [toReveal, ...state.tavernDeck];
    state = rig(state, [reaverRecruitCard()]);

    let res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );
    expect(res.state.turnPhase).toBe('AWAIT_REAVER_REVEAL_COUNT');
    const afterCountChoice = chooseMaxReaverRevealCount(res.state);
    expect(afterCountChoice.turnPhase).toBe('AWAIT_REAVER_REVEAL');
    res = ensureOk(
      applyAction(afterCountChoice, { type: 'CHOOSE_REAVER_REVEAL_CARD', playerId: state.players[0].id, cardId: toReveal.id }),
    );

    expect(res.state.banishPile.some((c) => c.id === toReveal.id)).toBe(false);
    expect(res.state.tavernDeck[res.state.tavernDeck.length - 1]?.id).toBe(toReveal.id);
  });

  it("a corrupted card's own cost (banishing the reserve deck's top card) redirects a restored top card to the bottom of the reserve deck instead of the banish pile", () => {
    const boss: LegacyEnemySpec = { name: 'The Hierarch', suit: 'D', health: 200, attack: 10 };
    let state = startMission(1, [boss]);
    state.restoredCardMechanic = true;
    const reserveTop = restoredCard('D', '3');
    state.tavernDeck = [reserveTop, ...state.tavernDeck];
    state = rig(state, [corruptedCard('H', '4')]); // an unrelated corrupted card, its own cost is what banishes

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );

    expect(res.state.banishPile.some((c) => c.id === reserveTop.id)).toBe(false);
    expect(res.state.tavernDeck[res.state.tavernDeck.length - 1]?.id).toBe(reserveTop.id);
  });
});

describe('legacy: mission 12 start-of-turn banish-pile zone flip', () => {
  it('moves the top of the banish pile into the mission zone, buffing the current enemy\'s attack and granting immunity to its class', () => {
    let state = startMission12(1);
    // A throwaway card the player never plays — just enough that yielding with a 0-damage attack doesn't read as
    // a genuinely stuck solo player (see checkForStuckLoss's solo-play condition).
    state = rig(state, [suited('C', '2')], { baseAttack: 0, spadesShield: 999 });
    const bottomOfPile = suited('D', '3');
    const topOfPile = suited('H', '7');
    state.banishPile = [bottomOfPile, topOfPile];

    const flipRes = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));
    expect(flipRes.state.missionZone.some((c) => c.id === topOfPile.id)).toBe(true);
    expect(flipRes.state.banishPile.some((c) => c.id === topOfPile.id)).toBe(false);
    expect(flipRes.state.banishPile.some((c) => c.id === bottomOfPile.id)).toBe(true); // only the top card moved
    expect(flipRes.state.zoneImmuneSuits).toContain('H');

    // The zone's value now buffs the enemy's attack: base 5 + the flipped Hearts 7 = 12.
    const buffedState = rig(flipRes.state, [], { baseAttack: 5, spadesShield: 0 });
    const attackRes = ensureOk(applyAction(buffedState, { type: 'YIELD', playerId: buffedState.players[0].id }));
    expect(attackRes.state.pendingDamage).toBe(12);
  });

  it("grants the enemy immunity to the flipped card's class, blocking a matching play", () => {
    let state = startMission12(1);
    // Same throwaway-card reasoning as the test above.
    state = rig(state, [suited('C', '2')], { baseAttack: 0, spadesShield: 999 });
    state.banishPile = [suited('D', '9')]; // Diamonds (Bard) on top

    const flipRes = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));
    const attackerState = rig(flipRes.state, [suited('D', '4')], { suit: 'C', baseAttack: 0, spadesShield: 0, maxHealth: 100, damageTaken: 0 });

    const res = ensureOk(
      applyAction(attackerState, { type: 'PLAY_CARDS', playerId: attackerState.players[0].id, cardIds: [attackerState.players[0].hand[0].id] }),
    );
    expect(res.state.log.some((e) => e.message.includes('blocked'))).toBe(true);
  });

  it('an exact kill skips the flip on the very next turn', () => {
    let state = startMission12(1);
    state = rig(state, [suited('D', '5')], { suit: 'S', baseAttack: 0, maxHealth: 5, damageTaken: 0, spadesShield: 0 });

    const killRes = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );
    expect(killRes.state.skipNextBanishZoneFlip).toBe(true);
    expect(killRes.state.turnPhase).toBe('AWAIT_PLAY'); // same player continues against the next enemy

    let state2 = rig(killRes.state, [], { baseAttack: 0, spadesShield: 999 });
    state2.banishPile = [suited('H', '6')];
    const yieldRes = ensureOk(applyAction(state2, { type: 'YIELD', playerId: state2.players[0].id }));

    expect(yieldRes.state.missionZone.length).toBe(0);
    expect(yieldRes.state.banishPile.length).toBe(1); // untouched — the flip was skipped
    expect(yieldRes.state.skipNextBanishZoneFlip).toBe(false);
    expect(yieldRes.state.log.some((e) => e.message.includes('spared it a flip'))).toBe(true);
  });

  it('does nothing when the banish pile is empty', () => {
    let state = startMission12(1);
    state = rig(state, [], { baseAttack: 0, spadesShield: 999 });
    state.banishPile = [];

    const res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));
    expect(res.state.missionZone.length).toBe(0);
  });
});

describe('legacy: resolveSuitPowers blocked-log names the actual immunity source', () => {
  it("distinguishes the enemy's own class from Mission 12's mission-zone immunity and Mission 11's discard/banish-pile immunity, instead of always claiming the enemy's own class", () => {
    // A single Boss immune (by its own printed class) to Hearts only. Diamonds is blocked purely via a
    // Mission-12-style zoneImmuneSuits entry; Clubs is blocked purely via Mission 11's pileTopEnemyBonus reading
    // the discard pile's top card — neither mission's OWN flip/flip-timing mechanic is exercised here, just the
    // fields resolveSuitPowers actually reads (see its comment: the check "isn't gated per mission").
    const enemy: LegacyEnemySpec = { name: 'Test Boss', suit: 'H', health: 100, attack: 0 };
    let state = startMission(1, [enemy]);
    state.zoneImmuneSuits = ['D'];
    state.pileTopEnemyBonus = true;
    state.discardPile = [suited('C', 'K')]; // top of discard is Clubs-suited — pile-immune, not the enemy's own class

    const combo = [suited('H', '2'), suited('D', '2'), suited('C', '2')]; // same rank, combo total 6 — under the cap
    state = rig(state, combo);

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: combo.map((c) => c.id) }),
    );

    const blockedMessages = res.state.log.map((e) => e.message).filter((m) => m.includes('blocked'));
    expect(blockedMessages.length).toBe(3); // Hearts, Diamonds, and Clubs all blocked, for three different reasons

    const inherent = blockedMessages.filter((m) => m.includes('is immune to its own class') && !m.includes('via'));
    const zone = blockedMessages.filter((m) => m.includes('via the mission zone'));
    const pile = blockedMessages.filter((m) => m.includes('via the discard/banish piles'));
    expect(inherent.length).toBe(1); // Hearts — the enemy's own printed class
    expect(zone.length).toBe(1); // Diamonds — the mission zone, not the enemy's own class
    expect(pile.length).toBe(1); // Clubs — the discard/banish pile tops, not the enemy's own class

    // The bug: all three used to read identically ("immune to its own class") regardless of source.
    expect(new Set([inherent[0], zone[0], pile[0]]).size).toBe(3);
  });

  it('still says "its own class" for a Mission-11 pile-driven block that happens to match the class the pile-top card actually belongs to', () => {
    // Regression guard for the precedence order: an enemy inherently immune to Hearts, with a Hearts card ALSO
    // sitting on top of the discard pile, must report the inherent reason (its own class), not the pile — the
    // two sources overlap on the same suit here, and inherent immunity takes precedence in resolveSuitPowers's
    // own blocked() check (isSuitBlockedByImmunity is checked first).
    const enemy: LegacyEnemySpec = { name: 'Overlap Boss', suit: 'H', health: 100, attack: 0 };
    let state = startMission(1, [enemy]);
    state.pileTopEnemyBonus = true;
    state.discardPile = [suited('H', '9')]; // top of discard is ALSO Hearts — same suit as the enemy's own class
    const heartsCard = suited('H', '5');
    state = rig(state, [heartsCard]);

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [heartsCard.id] }),
    );

    const blockedMessages = res.state.log.map((e) => e.message).filter((m) => m.includes('blocked'));
    expect(blockedMessages.length).toBe(1);
    expect(blockedMessages[0]).toContain('is immune to its own class');
    expect(blockedMessages[0]).not.toContain('via the discard/banish piles');
  });
});

describe('legacy: mission 12 defeat cleanup (banish the mission zone, then the enemy, then the entire discard pile — order preserved)', () => {
  it('banishes all three groups in order and empties both the mission zone and the discard pile', () => {
    const boss: LegacyEnemySpec = { name: 'The Hierarch', suit: 'D', health: 10, attack: 0 };
    let state = startMission(1, [boss]);
    state.restoredCardMechanic = true;
    const zoneA = suited('H', '2');
    const zoneB = suited('C', '3');
    const discA = suited('S', '4');
    const discB = suited('H', '5');
    state.missionZone = [zoneA, zoneB];
    state.discardPile = [discA, discB];
    const killCard = suited('D', '10'); // Diamonds doesn't multiply — exact 10 damage on 10 health
    state = rig(state, [killCard], { suit: 'D', baseAttack: 0, maxHealth: 10, damageTaken: 0, spadesShield: 0 });

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );

    expect(res.state.missionZone).toEqual([]);
    expect(res.state.discardPile).toEqual([]);
    const orderedIds = res.state.banishPile.map((c) => c.id);
    // zone cards first (own order preserved), then the enemy's own table card (the killing play), then the
    // discard pile (own order preserved) — no other kill effects intervene since this mission has no other
    // per-kill mechanic active.
    expect(orderedIds).toEqual([zoneA.id, zoneB.id, killCard.id, discA.id, discB.id]);
    expect(res.state.skipNextBanishZoneFlip).toBe(true); // exact kill
  });

  it('applies the same three-step cleanup on an overkill (no exact-kill exception, unlike Mission 3/10)', () => {
    const boss: LegacyEnemySpec = { name: 'The Hierarch', suit: 'D', health: 5, attack: 0 };
    let state = startMission(1, [boss]);
    state.restoredCardMechanic = true;
    state.missionZone = [suited('H', '2')];
    state.discardPile = [suited('S', '4')];
    const killCard = suited('D', '10'); // overkill: 10 damage on 5 health
    state = rig(state, [killCard], { suit: 'D', baseAttack: 0, maxHealth: 5, damageTaken: 0, spadesShield: 0 });

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );

    expect(res.state.missionZone).toEqual([]);
    expect(res.state.discardPile).toEqual([]);
    expect(res.state.banishPile.length).toBe(3); // zone card + kill card + discard card, all banished
    expect(res.state.skipNextBanishZoneFlip).toBe(false); // not an exact kill
  });

  it('redirects a restored card caught up in the cleanup to the bottom of the reserve deck instead of the banish pile', () => {
    const boss: LegacyEnemySpec = { name: 'The Hierarch', suit: 'D', health: 10, attack: 0 };
    let state = startMission(1, [boss]);
    state.restoredCardMechanic = true;
    const restoredInZone = restoredCard('H', '2');
    state.missionZone = [restoredInZone];
    state.discardPile = [];
    const killCard = suited('D', '10');
    state = rig(state, [killCard], { suit: 'D', baseAttack: 0, maxHealth: 10, damageTaken: 0, spadesShield: 0 });

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );

    expect(res.state.banishPile.some((c) => c.id === restoredInZone.id)).toBe(false);
    expect(res.state.tavernDeck.some((c) => c.id === restoredInZone.id)).toBe(true);
    expect(res.state.banishPile.some((c) => c.id === killCard.id)).toBe(true); // the plain kill card banishes normally
  });
});

function startMissionWithRelics(n: number, enemies: LegacyEnemySpec[], relics: string[]): GameState {
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const names = Array.from({ length: n }, (_, i) => `Player ${i}`);
  const res = applyAction(createLobbyState(), {
    type: 'START_LEGACY_MISSION',
    playerIds: ids,
    playerNames: names,
    seed: 'mercenary-test',
    party: buildInitialParty(),
    enemies,
    jesterCount: 0,
    relics,
  });
  if (!res.ok) throw new Error(res.error);
  return res.state;
}

describe('legacy: Mercenary Camp catalog & coin formula', () => {
  it('the catalog totals the sourced 14 physical cards across its maxQty values', () => {
    const total = MERCENARY_CATALOG.reduce((sum, spec) => sum + spec.maxQty, 0);
    expect(total).toBe(14);
  });

  it('mercenaryCoinsForLosses grows linearly, one coin per loss, on top of John\'s +15 easy-mode bonus (sourced formula confirmed by a real session\'s numbers: 5 losses = 5 coins before the bonus)', () => {
    expect(mercenaryCoinsForLosses(0)).toBe(15); // the bonus alone, even before any loss
    expect(mercenaryCoinsForLosses(1)).toBe(16);
    expect(mercenaryCoinsForLosses(2)).toBe(17);
    expect(mercenaryCoinsForLosses(3)).toBe(18);
    expect(mercenaryCoinsForLosses(5)).toBe(20);
  });

  it('buildMercenaryLoadout returns the concrete cards for a selection that fits the budget', () => {
    const result = buildMercenaryLoadout({ TWELVE_H: 1, NINETEEN: 1 }, 4); // 1 + 3 = 4 coins
    expect(Array.isArray(result)).toBe(true);
    const cards = result as Card[];
    expect(cards.length).toBe(2);
    expect(cards.some((c) => c.kind === 'suited' && c.rank === '12')).toBe(true);
    expect(cards.some((c) => c.kind === 'suited' && c.rank === '19')).toBe(true);
  });

  it('rejects a selection past a type\'s maxQty', () => {
    const result = buildMercenaryLoadout({ NINETEEN: 3 }, 999);
    expect(result).toEqual({ error: '19: at most 2 available.' });
  });

  it('rejects a selection that costs more than the coin budget', () => {
    const result = buildMercenaryLoadout({ JESTER: 2 }, 5); // 2 * 5 = 10 coins, only 5 available
    expect(result).toEqual({ error: 'That loadout costs 10 coins — only 5 available.' });
  });
});

describe('legacy: Mercenary "2/5" flexible combo rank', () => {
  it('combos with a real 2 by resolving to rank 2, at half the printed "2/5" value', () => {
    const enemy: LegacyEnemySpec = { name: 'Target', suit: 'C', health: 100, attack: 0 };
    let state = startMission(1, [enemy]);
    const realTwo = suited('D', '2');
    const mercTwoFive = buildMercenaryCard('TWO_FIVE_S') as SuitedCard;
    state = rig(state, [realTwo, mercTwoFive]);
    const tavernBefore = state.tavernDeck.length;

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [realTwo.id, mercTwoFive.id] }),
    );

    // Total value 2+2=4 (the "2/5" contributes its flagged alternate, not its printed 5): Diamonds draws 4,
    // Spades shields 4, no Clubs present so no doubling.
    expect(res.state.currentEnemy?.damageTaken).toBe(4);
    expect(res.state.currentEnemy?.spadesShield).toBe(4);
    expect(res.state.tavernDeck.length).toBeLessThanOrEqual(tavernBefore - 4);
  });

  it('two "2/5"s alone with no anchoring card default to their shared printed rank (5), not the alternate', () => {
    const enemy: LegacyEnemySpec = { name: 'Target', suit: 'S', health: 100, attack: 0 };
    let state = startMission(1, [enemy]);
    const mercClubs = buildMercenaryCard('TWO_FIVE_C') as SuitedCard;
    const mercHearts = buildMercenaryCard('TWO_FIVE_H') as SuitedCard;
    state = rig(state, [mercClubs, mercHearts]);

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [mercClubs.id, mercHearts.id] }),
    );

    // Total value 5+5=10, doubled by Clubs to 20 — proves the combo resolved at rank 5 (its printed value),
    // not rank 2 (which would total 4, doubled to 8).
    expect(res.state.currentEnemy?.damageTaken).toBe(20);
  });

  it('played alone, a "2/5" contributes exactly its printed value (5), ignoring the flexible alternate entirely', () => {
    const enemy: LegacyEnemySpec = { name: 'Target', suit: 'C', health: 100, attack: 0 };
    let state = startMission(1, [enemy]);
    const mercHearts = buildMercenaryCard('TWO_FIVE_H') as SuitedCard;
    state = rig(state, [mercHearts]);

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [mercHearts.id] }));

    expect(res.state.currentEnemy?.damageTaken).toBe(5);
  });
});

describe('legacy: Mercenary "19" carries no suit power', () => {
  it('played alone, deals its raw value with no suit power firing at all (its placeholder suit is inert)', () => {
    const enemy: LegacyEnemySpec = { name: 'Target', suit: 'C', health: 100, attack: 0 };
    let state = startMission(1, [enemy]);
    const nineteen = buildMercenaryCard('NINETEEN') as SuitedCard; // placeholder suit 'H'
    state = rig(state, [nineteen]);
    state.discardPile = [suited('C', '3'), suited('C', '4')]; // would be healed back if Hearts fired

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [nineteen.id] }));

    expect(res.state.currentEnemy?.damageTaken).toBe(19);
    expect(res.state.discardPile.length).toBe(2); // untouched — no Hearts heal despite the card's Hearts placeholder suit
  });

  it('sitting on top of the discard pile, does not extend the current enemy\'s immunity (unlike a real suited card)', () => {
    let state = startMission11(1);
    const heartsCard: SuitedCard = suited('H', '5');
    state = rig(state, [heartsCard], { suit: 'C', baseAttack: 0, spadesShield: 0, maxHealth: 100, damageTaken: 0 }); // Warrior suit, not Hearts
    state.discardPile = [buildMercenaryCard('NINETEEN')]; // placeholder suit 'H', but noSuitPower excludes it

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [heartsCard.id] }),
    );

    expect(res.state.log.some((e) => e.message.includes('blocked'))).toBe(false);
    expect(res.state.discardPile.length).toBe(0); // the Hearts heal fired and healed the "19" straight back into the reserve deck
  });
});

describe('legacy: Mercenary any-suit Ace (wildSuit)', () => {
  it('PLAY_CARDS resolves the chosen suit and triggers that suit\'s power', () => {
    const enemy: LegacyEnemySpec = { name: 'Target', suit: 'C', health: 100, attack: 0 };
    let state = startMission(1, [enemy]);
    const wildAce = buildMercenaryCard('WILD_ACE') as SuitedCard; // placeholder suit 'H'
    state = rig(state, [wildAce]);
    const tavernBefore = state.tavernDeck.length;

    const res = ensureOk(
      applyAction(state, {
        type: 'PLAY_CARDS',
        playerId: state.players[0].id,
        cardIds: [wildAce.id],
        chosenSuits: { [wildAce.id]: 'D' },
      }),
    );

    expect(res.state.currentEnemy?.tableCards.some((c) => c.kind === 'suited' && c.suit === 'D')).toBe(true);
    expect(res.state.tavernDeck.length).toBe(tavernBefore - 1); // Diamonds drew its 1 card of value
  });

  it('rejects playing the any-suit Ace with no suit chosen', () => {
    const enemy: LegacyEnemySpec = { name: 'Target', suit: 'C', health: 100, attack: 0 };
    let state = startMission(1, [enemy]);
    const wildAce = buildMercenaryCard('WILD_ACE') as SuitedCard;
    state = rig(state, [wildAce]);

    const res = applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [wildAce.id] });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('Choose a suit for the any-suit Ace before playing it.');
  });

  it('rejects an invalid (non-base) suit choice', () => {
    const enemy: LegacyEnemySpec = { name: 'Target', suit: 'C', health: 100, attack: 0 };
    let state = startMission(1, [enemy]);
    const wildAce = buildMercenaryCard('WILD_ACE') as SuitedCard;
    state = rig(state, [wildAce]);

    const res = applyAction(state, {
      type: 'PLAY_CARDS',
      playerId: state.players[0].id,
      cardIds: [wildAce.id],
      chosenSuits: { [wildAce.id]: 'X' } as Record<string, SuitedCard['suit']>,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('Invalid suit choice for the any-suit Ace — must be Hearts, Diamonds, Clubs, or Spades.');
  });

  it('ASSIST_COMBO resolves a wildSuit assisting card via its own chosenSuit', () => {
    const target: LegacyEnemySpec = { name: 'Combo Target', suit: 'C', health: 100, attack: 1 };
    let state = startMissionWithRelics(2, [target], ['SCARLET_WHISTLE']);
    const lead = suited('H', 'A'); // a lone Animal Companion opens the Scarlet Whistle assist window
    state = rig(state, [lead]);
    const attackerId = state.players[0].id;
    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: attackerId, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;
    expect(state.turnPhase).toBe('AWAIT_COMBO_ASSIST');

    const wildAce = buildMercenaryCard('WILD_ACE') as SuitedCard;
    state = structuredClone(state);
    state.players[1].hand = [wildAce];
    res = ensureOk(
      applyAction(state, { type: 'ASSIST_COMBO', playerId: state.players[1].id, cardId: wildAce.id, chosenSuit: 'D' }),
    );
    state = res.state;
    expect(state.comboAssist?.cardIds.length).toBe(2);

    res = ensureOk(applyAction(state, { type: 'RESOLVE_COMBO', playerId: attackerId }));
    state = res.state;
    // Companion pairing (both cards count as Animal Companions, each contributing its own value): 1 + 1 = 2 damage.
    expect(state.currentEnemy?.damageTaken).toBe(2);
    expect(state.currentEnemy?.tableCards.some((c) => c.kind === 'suited' && c.suit === 'D')).toBe(true);
  });
});
