import { describe, expect, it } from 'vitest';
import { applyAction, createLobbyState, resolvedEnemyAttack } from '../game/engine.js';
import type { Card, EngineResult, GameState, LegacyEnemySpec, SuitedCard } from '../game/types.js';
import { CLASS_THEME } from './classes.js';
import { getMission, MISSIONS, missionEnemiesToSpecs } from './missions.js';
import {
  applyBeastCardChoice,
  applyCorruptAnotherCard,
  applyDualClassStickers,
  applyMageSticker,
  applyReward,
  applyRestoredPartyCards,
  buildInitialParty,
  buildRecruitCard,
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

  it('mission 1 ("Call to Arms") is the standard 12-enemy Castle deck, sends exact kills to the reserve deck, and rewards only the Kinfolk Flute relic', () => {
    const mission1 = getMission(1)!;
    expect(mission1.title).toBe('Call to Arms');
    expect(mission1.standardCastle).toBe(true);
    expect(mission1.exactKillToReserveDeck).toBe(true);
    expect(mission1.reward.relics).toEqual(['KINFOLK_FLUTE']);
    expect(mission1.reward.recruits.length).toBe(0);
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

  it('mission 2 uses the modified Jester rule (next player only)', () => {
    const mission2 = getMission(2)!;
    expect(mission2.jesterClaimNextPlayerOnly).toBe(true);
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

  it('mission 4 buffs enemy attack from the discard pile, seals exact kills to the reserve deck, requeues defeats corrupted, and rewards Beast Companions + the Scarlet Whistle relic', () => {
    const mission4 = getMission(4)!;
    expect(mission4.discardTopBuffsAttack).toBe(true);
    expect(mission4.exactKillToReserveDeck).toBe(true);
    expect(mission4.corruptedReturnQueue).toBe(true);
    expect(mission4.discardCleanupLowToHigh).toBe(true);
    expect(mission4.reward.relics).toEqual(['SCARLET_WHISTLE']);
    expect(mission4.reward.recruits.length).toBe(4);
    expect(mission4.reward.recruits.every((r) => r.beast)).toBe(true);
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
  it('lets any player claim an open jester and ignore immunity for that one attack only (not permanently)', () => {
    // Cleric-class enemy (suit H) — immune to Cleric (Hearts) powers until the claimed attack ignores it.
    const enemy: LegacyEnemySpec = { name: 'Warden', suit: 'H', health: 100, attack: 5 };
    let state = startMission(2, [enemy], 0);
    const [p1, p2] = state.players;

    const j = jester();
    state = rig(state, [j]);
    let res = ensureOk(applyAction(state, { type: 'PLAY_JESTER', playerId: p1.id, cardId: j.id }));
    state = res.state;
    expect(state.turnPhase).toBe('AWAIT_JESTER_CLAIM');
    expect(state.jesterClaim?.claimedBy).toBeNull();

    // Player 2 (not the jester's player) claims it.
    res = ensureOk(applyAction(state, { type: 'CLAIM_JESTER', playerId: p2.id }));
    state = res.state;
    expect(state.currentPlayerIndex).toBe(1);
    expect(state.turnPhase).toBe('AWAIT_PLAY');
    expect(state.jesterClaim?.claimedBy).toBe(p2.id);

    // Player 2 plays a Cleric (Hearts) card — normally blocked by this enemy's own-class immunity.
    const healCard = suited('H', '5');
    state.discardPile = [suited('C', '2'), suited('C', '3'), suited('C', '4')]; // something to heal back
    state = rig(state, [healCard]);
    res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: p2.id, cardIds: [healCard.id] }));
    state = res.state;

    expect(state.jesterClaim).toBeNull(); // consumed
    expect(state.discardPile.length).toBe(0); // Hearts healed (drained the 3-card discard pile) despite matching the enemy's class
    expect(state.currentEnemy?.immunityBroken).toBe(false); // one-shot only — NOT a permanent break like classic Regicide
  });

  it('discards an unused claimed jester if the claimant yields instead of attacking', () => {
    const enemy: LegacyEnemySpec = { name: 'Warden', suit: 'H', health: 100, attack: 1 };
    let state = startMission(1, [enemy], 0);
    const j = jester();
    state = rig(state, [j]);
    let res = ensureOk(applyAction(state, { type: 'PLAY_JESTER', playerId: state.players[0].id, cardId: j.id }));
    state = res.state;
    res = ensureOk(applyAction(state, { type: 'CLAIM_JESTER', playerId: state.players[0].id }));
    state = res.state;
    res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));
    state = res.state;
    expect(state.jesterClaim).toBeNull();
    expect(state.discardPile.some((c) => c.kind === 'jester')).toBe(true);
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

  it('a Mage bolt adds its own card value on top of the play\'s normal damage, and bypasses its suit\'s immunity', () => {
    // Enemy is immune to Hearts (its own suit) — the Mage card is Hearts-suited, so a base Cleric play would be
    // blocked, but its arcane bolt should land anyway since Mage powers aren't suit powers.
    const enemy: LegacyEnemySpec = { name: 'Warded Foe', suit: 'H', health: 20, attack: 1 };
    let state = startMission(1, [enemy]);
    const mage7: SuitedCard = { ...suited('H', '7'), arcane: true };
    state = rig(state, [mage7]);
    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [mage7.id] }));
    state = res.state;
    // 7 damage from the normal play (no Clubs doubling) + 7 from the arcane bolt = 14, no heal triggered.
    expect(state.currentEnemy?.damageTaken).toBe(14);
  });

  it('Arcane Surge doubles a Mage card\'s own bolt, and multiple Mages in one combo each resolve at their own value', () => {
    const enemy: LegacyEnemySpec = { name: 'Combo Target', suit: 'S', health: 100, attack: 1 };
    let state = startMission(1, [enemy]);
    const surged: SuitedCard = { ...suited('H', '4'), arcane: true, special: 'ARCANE_SURGE' };
    const plain: SuitedCard = { ...suited('D', '4'), arcane: true };
    state = rig(state, [surged, plain]);
    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [surged.id, plain.id] }),
    );
    state = res.state;
    // Normal combo damage: 4+4=8. Arcane bonus: surged card doubles to 8, plain card is 4. Total: 8+8+4=20.
    expect(state.currentEnemy?.damageTaken).toBe(20);
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

describe('legacy: Kinfolk Flute relic (mission 1) — combo-assist window', () => {
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

  it('opens an assist window instead of resolving immediately when there is room left in the combo', () => {
    let state = startMissionWithFlute(2, [target]);
    state = rig(state, [suited('H', '3')]);
    const attackerId = state.players[state.currentPlayerIndex].id;
    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: attackerId, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;
    expect(state.turnPhase).toBe('AWAIT_COMBO_ASSIST');
    expect(state.comboAssist?.attackerId).toBe(attackerId);
    expect(state.currentEnemy?.damageTaken).toBe(0); // not resolved yet
  });

  it('lets another player silently add a matching card, then the attacker resolves for the combined total', () => {
    let state = startMissionWithFlute(2, [target]);
    state = rig(state, [suited('H', '3')]);
    const attackerId = state.players[0].id;
    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: attackerId, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    state = structuredClone(state);
    state.players[1].hand = [suited('H', '3')];
    res = ensureOk(applyAction(state, { type: 'ASSIST_COMBO', playerId: state.players[1].id, cardId: state.players[1].hand[0].id }));
    state = res.state;
    expect(state.comboAssist?.cardIds.length).toBe(2);
    expect(state.turnPhase).toBe('AWAIT_COMBO_ASSIST'); // still open until the attacker resolves

    res = ensureOk(applyAction(state, { type: 'RESOLVE_COMBO', playerId: attackerId }));
    state = res.state;
    expect(state.comboAssist).toBeNull();
    expect(state.currentEnemy?.damageTaken).toBe(6); // 3+3 combo total
  });

  it('rejects an assist card that would break the combo (mismatched rank), and rejects the attacker assisting their own attack', () => {
    let state = startMissionWithFlute(2, [target]);
    state = rig(state, [suited('H', '3')]);
    const attackerId = state.players[0].id;
    let res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: attackerId, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    state = structuredClone(state);
    state.players[1].hand = [suited('H', '4')]; // wrong rank
    const badAssist = applyAction(state, { type: 'ASSIST_COMBO', playerId: state.players[1].id, cardId: state.players[1].hand[0].id });
    expect(badAssist.ok).toBe(false);

    const selfAssist = applyAction(state, { type: 'ASSIST_COMBO', playerId: attackerId, cardId: suited('H', '3').id });
    expect(selfAssist.ok).toBe(false);
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

describe('legacy: mission 2 modified Jester rule (next player only)', () => {
  it('rejects a claim from anyone but the next player in turn order, and allows the next player', () => {
    const enemy: LegacyEnemySpec = { name: 'Hydra Head', suit: 'H', secondSuit: 'D', health: 100, attack: 1 };
    const ids = ['p0', 'p1', 'p2'];
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ids,
      playerNames: ['P0', 'P1', 'P2'],
      seed: 'jester-next-test',
      party: buildInitialParty(),
      enemies: [enemy],
      jesterCount: 3,
      jesterClaimNextPlayerOnly: true,
    });
    let state = ensureOk(res).state;
    const j = jester();
    state = rig(state, [j]);

    const playRes = ensureOk(applyAction(state, { type: 'PLAY_JESTER', playerId: state.players[0].id, cardId: j.id }));
    state = playRes.state;

    const badClaim = applyAction(state, { type: 'CLAIM_JESTER', playerId: state.players[2].id });
    expect(badClaim.ok).toBe(false);

    const goodClaim = ensureOk(applyAction(state, { type: 'CLAIM_JESTER', playerId: state.players[1].id }));
    expect(goodClaim.state.jesterClaim?.claimedBy).toBe(state.players[1].id);
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

describe('legacy: mission 4 corrupted-return-queue (defeated enemies rejoin, corrupted)', () => {
  function startFusionMission(enemies: LegacyEnemySpec[]): GameState {
    const res = applyAction(createLobbyState(), {
      type: 'START_LEGACY_MISSION',
      playerIds: ['p0'],
      playerNames: ['Player 0'],
      seed: 'fusion-corrupt-test',
      party: buildInitialParty(),
      enemies,
      jesterCount: 0,
      corruptedReturnQueue: true,
    });
    if (!res.ok) throw new Error(res.error);
    return res.state;
  }

  it('requeues a defeated enemy to the back of the fight queue, corrupted, instead of removing it for good', () => {
    const first: LegacyEnemySpec = { name: 'Specimen A', suit: 'S', health: 10, attack: 1 };
    const second: LegacyEnemySpec = { name: 'Specimen B', suit: 'H', health: 10, attack: 1 };
    let state = startFusionMission([first, second]);
    state = rig(state, [suited('C', '9')]); // Clubs doubles: 18 damage, overkills the 10-health Specimen A

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.currentEnemy?.name).toBe('Specimen B'); // next enemy up front, as normal
    expect(state.castleDeck.some((e) => e.name === 'Specimen A' && e.corrupted)).toBe(true);
  });

  it("a corrupted enemy's immunity is ignored automatically and costs a reserve-deck banish, without needing a Jester", () => {
    let state = startFusionMission([{ name: 'Specimen A', suit: 'S', health: 10, attack: 1 }]);
    state = structuredClone(state);
    state.tavernDeck = [suited('C', '9'), ...state.tavernDeck]; // will be banished as the corrupted-enemy cost
    state = rig(state, [suited('S', '2')], { corrupted: true }); // Spades card vs a Spades-immune corrupted enemy

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.log.some((e) => e.message.includes('blocked'))).toBe(false);
    expect(state.banishPile.some((c) => c.kind === 'suited' && c.suit === 'C' && c.rank === '9')).toBe(true);
    expect(state.currentEnemy?.spadesShield).toBe(2); // Spades power actually resolved, immunity ignored
  });

  it('does not requeue a corrupted enemy a second time once it is defeated again', () => {
    let state = startFusionMission([{ name: 'Specimen A', suit: 'S', health: 10, attack: 1 }]);
    state = rig(state, [suited('C', '9')], { corrupted: true }); // overkill, already corrupted

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.phase).toBe('WON'); // no further enemies, and no re-requeue keeping the fight open
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
});

describe('legacy: mission 5 mechanics (Reaver reserve-tear, rolling banish-pile zone, exact-kill splash)', () => {
  function reaverCard(suit: SuitedCard['suit'], rank: SuitedCard['rank'], special?: boolean): SuitedCard {
    return { ...suited(suit, rank), reaver: true, ...(special ? { special: 'PLUNDER' } : {}) };
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

  it('tears the top reserve card for flat bonus damage and banishes it, without doubling anything on its own', () => {
    const boss: LegacyEnemySpec = { name: 'Sporeling', suit: 'S', health: 100, attack: 1 };
    let state = startCrimsonMission(1, [boss]);
    state = structuredClone(state);
    state.tavernDeck = [suited('C', '6'), ...state.tavernDeck];
    const reserveBefore = state.tavernDeck.length;
    state = rig(state, [reaverCard('D', '4')]);

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    // 4 + 6 = 10 damage, no multiplier; the revealed 6 is gone from the reserve deck and banished, not drawable again.
    expect(state.currentEnemy?.damageTaken).toBe(10);
    expect(state.tavernDeck.length).toBe(reserveBefore - 1);
    expect(state.banishPile.some((c) => c.kind === 'suited' && c.suit === 'C' && c.rank === '6')).toBe(true);
  });

  it('stacks with a Warrior (Clubs) card in the same play for double damage — Reaver itself never multiplies', () => {
    const boss: LegacyEnemySpec = { name: 'Sporeling', suit: 'H', health: 200, attack: 1 };
    let state = startCrimsonMission(1, [boss]);
    state = structuredClone(state);
    state.tavernDeck = [suited('S', '6'), ...state.tavernDeck];
    state = rig(state, [suited('C', '5'), reaverCard('D', '5')]); // same-rank combo: Clubs 5 + Reaver 5

    const res = ensureOk(
      applyAction(state, {
        type: 'PLAY_CARDS',
        playerId: state.players[0].id,
        cardIds: state.players[0].hand.map((c) => c.id),
      }),
    );
    state = res.state;

    // (5 + 5 + 6) * 2 (Clubs only) = 32.
    expect(state.currentEnemy?.damageTaken).toBe(32);
  });

  it("Plunder tears 2 reserve cards instead of 1 and keeps the higher value", () => {
    const boss: LegacyEnemySpec = { name: 'Sporeling', suit: 'S', health: 100, attack: 1 };
    let state = startCrimsonMission(1, [boss]);
    state = structuredClone(state);
    state.tavernDeck = [suited('C', '4'), suited('D', '9'), ...state.tavernDeck];
    state = rig(state, [reaverCard('H', '3', true)]);

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    // 3 + 9 = 12, no multiplier — the higher of the two torn cards (9) is kept, both banished.
    expect(state.currentEnemy?.damageTaken).toBe(12);
    expect(state.banishPile.some((c) => c.kind === 'suited' && c.rank === '4')).toBe(true);
    expect(state.banishPile.some((c) => c.kind === 'suited' && c.rank === '9')).toBe(true);
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

  it('sacrifices the lowest-value card left on the table into the mission zone on kill (never the discard pile)', () => {
    const boss: LegacyEnemySpec = { name: 'Statue', suit: 'S', health: 8, attack: 1 };
    let state = startGardenMission(1, [boss], [myla]);
    state = rig(state, [suited('D', '9')]);

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.missionZone.length).toBe(2); // Myla + the sacrificed 9
    expect(state.missionZone.some((c) => c.kind === 'suited' && c.suit === 'D' && c.rank === '9')).toBe(true);
    expect(state.discardPile.some((c) => c.kind === 'suited' && c.suit === 'D' && c.rank === '9')).toBe(false);
  });

  it("Myla strikes for the zone's live sum right after it grows, routed through AWAIT_DEFEND", () => {
    const boss: LegacyEnemySpec = { name: 'Statue', suit: 'S', health: 8, attack: 1 };
    const next: LegacyEnemySpec = { name: 'Next Statue', suit: 'D', health: 20, attack: 1 };
    let state = startGardenMission(1, [boss, next], [myla]);
    state = rig(state, [suited('D', '9')]);

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    // Overkill (8 health, 9 damage) — not an exact kill, so no card is spared: 7 (Myla) + 9 = 16.
    expect(state.turnPhase).toBe('AWAIT_DEFEND');
    expect(state.pendingDamage).toBe(16);
  });

  it('an exact-damage kill spares the mission zone\'s single highest-value card from that strike', () => {
    const boss: LegacyEnemySpec = { name: 'Statue', suit: 'S', health: 9, attack: 1 };
    const next: LegacyEnemySpec = { name: 'Next Statue', suit: 'D', health: 20, attack: 1 };
    let state = startGardenMission(1, [boss, next], [myla]);
    state = rig(state, [suited('D', '9')]);

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    // Exact kill: zone becomes [Myla(7), 9], but the 9 (highest) is spared from this strike — only 7 lands.
    expect(state.missionZone.length).toBe(2);
    expect(state.turnPhase).toBe('AWAIT_DEFEND');
    expect(state.pendingDamage).toBe(7);
  });

  it('leaves the mission zone permanently grown after a kill — nothing clears it', () => {
    const boss: LegacyEnemySpec = { name: 'Statue', suit: 'S', health: 5, attack: 1 };
    let state = startGardenMission(1, [boss], [myla]);
    state = rig(state, [suited('H', '5')]);

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.missionZone.length).toBe(2); // Myla + the sacrificed 5, permanently
  });
});

describe('legacy: mission 5 reward (only rank-5 Reaver kept, Myla joins the party, Dual-class Stickers, corrupt-another-card)', () => {
  it('keeps only the rank-5 Reaver recruit (Haror) permanently — not all 4 originally shipped', () => {
    // Sourced research (regicidelegacy.com compendium / BGG threads / a fan digital reimplementation's rules
    // doc) found the shipped version over-granted: this repo's own mission-5 transcript note ("how to
    // permanently retire cards from the party roster, used here to trim the new Reavers back down after the
    // mission") and the sourced material agree only rank 5 survives.
    const mission5 = getMission(5)!;
    const reavers = mission5.reward.recruits.filter((r) => r.class === 'REAVER');
    expect(reavers.length).toBe(1);
    expect(reavers[0]).toMatchObject({ name: 'Haror', rank: '5' });
  });

  it('rewards Myla as a real playable Cleric card, a second round of Dual-class Stickers, and a corrupt-another-card effect', () => {
    const mission5 = getMission(5)!;
    const myla = mission5.reward.recruits.find((r) => r.name === 'Myla');
    expect(myla?.class).toBe('CLERIC');
    expect(myla?.rank).toBe('7');
    expect(mission5.reward.dualClassStickers).toBe(4);
    expect(mission5.reward.corruptAnotherCard).toBe(true);

    const party = applyReward(buildInitialParty(), mission5.reward);
    const mylaCard = party.find((c) => c.kind === 'suited' && c.name === 'Myla');
    expect(mylaCard).toBeDefined();
    if (mylaCard?.kind === 'suited') {
      expect(mylaCard.guardian).toBeUndefined();
      expect(mylaCard.reaver).toBeUndefined();
    }
    // The corrupt-another-card effect landed on some existing party member, never on Myla or Haror themselves.
    const corrupted = party.filter((c) => c.kind === 'suited' && c.corrupted);
    expect(corrupted.length).toBe(1);
    expect(corrupted[0].name).not.toBe('Myla');
    expect(corrupted[0].name).not.toBe('Haror');
  });

  it("no longer anchors Myla as a permanent presetMissionZone immunity fixture — she's an ordinary reserve-deck card for the fight itself", () => {
    const mission5 = getMission(5)!;
    expect(mission5.presetMissionZone).toBeUndefined();
    expect(mission5.extraReserveCards?.some((c) => c.kind === 'suited' && c.name === 'Myla' && c.suit === 'H')).toBe(true);
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

describe('legacy: mission 6 reward (Guardian faction + Azure Emblem relic)', () => {
  it('rewards 4 Guardian recruits, one carrying the Aegis special ability', () => {
    const mission6 = getMission(6)!;
    const party = applyReward(buildInitialParty(), mission6.reward);
    const guardians = party.filter((c) => c.kind === 'suited' && c.guardian);
    expect(guardians.length).toBe(4);
    expect(guardians.filter((c) => c.kind === 'suited' && c.special === 'AEGIS').length).toBe(1);
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
});

describe('legacy: Azure Emblem relic (mission 6) — Mage-attack assist window', () => {
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

  it('opens a window for every other player once a Mage card joins the attack, deferring the enemy retaliation', () => {
    const boss: LegacyEnemySpec = { name: 'Wyvern', suit: 'S', health: 100, attack: 10 };
    let state = startEmblemMission(3, [boss]);
    state = structuredClone(state);
    const player0Id = state.players[0].id;
    state.players[0].hand = [mageCard('H', '4')];

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: player0Id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.turnPhase).toBe('AWAIT_AZURE_EMBLEM');
    expect(state.azureEmblemWindow).toEqual({ pendingPlayerIds: [state.players[1].id, state.players[2].id], blockNextAttack: false });
    expect(state.currentEnemy?.damageTaken).toBe(8); // 4 from the normal play + 4 from the arcane bolt, as usual
  });

  it('lets each player in the queue silently place a card atop the reserve deck, or decline, in order', () => {
    const boss: LegacyEnemySpec = { name: 'Wyvern', suit: 'S', health: 100, attack: 10 };
    let state = startEmblemMission(3, [boss]);
    state = structuredClone(state);
    const player0Id = state.players[0].id;
    state.players[0].hand = [mageCard('H', '4')];
    const stashedCard = suited('D', '9');
    state.players[1].hand = [stashedCard];

    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: player0Id, cardIds: [state.players[0].hand[0].id] })).state;
    const player1Id = state.players[1].id;
    const player2Id = state.players[2].id;

    // Player 1 stocks a card; player 2 declines.
    let res = ensureOk(applyAction(state, { type: 'RESOLVE_AZURE_EMBLEM', playerId: player1Id, cardId: stashedCard.id }));
    state = res.state;
    expect(state.tavernDeck[0]).toEqual(stashedCard);
    expect(state.players[1].hand.length).toBe(0);
    expect(state.azureEmblemWindow?.pendingPlayerIds).toEqual([player2Id]);

    res = ensureOk(applyAction(state, { type: 'RESOLVE_AZURE_EMBLEM', playerId: player2Id }));
    state = res.state;

    expect(state.azureEmblemWindow).toBeNull();
    expect(state.turnPhase).toBe('AWAIT_DEFEND'); // deferred attack now resolves for the Mage's player
    expect(state.pendingDamage).toBe(10);
  });

  it('rejects a response from anyone but the front of the queue, and is inert without the relic', () => {
    const boss: LegacyEnemySpec = { name: 'Wyvern', suit: 'S', health: 100, attack: 10 };
    let state = startEmblemMission(2, [boss]);
    state = structuredClone(state);
    const player0Id = state.players[0].id;
    state.players[0].hand = [mageCard('H', '4')];

    state = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: player0Id, cardIds: [state.players[0].hand[0].id] })).state;
    const bad = applyAction(state, { type: 'RESOLVE_AZURE_EMBLEM', playerId: player0Id });
    expect(bad.ok).toBe(false); // player 0 isn't in the queue — they're the attacker

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

describe('legacy: mission 7 mechanics (Pilgrim zone)', () => {
  function startWellMission(n: number, enemies: LegacyEnemySpec[], pilgrimCards: Card[]): GameState {
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

  const fenwick: Card = { id: 'fenwick', kind: 'suited', suit: 'H', rank: '2', name: 'Old Fenwick' };
  const sae: Card = { id: 'sae', kind: 'suited', suit: 'D', rank: '3', name: 'Little Sae' };

  it('flips the top Pilgrim into the zone right at mission start, before anyone has played', () => {
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 20, attack: 10 };
    const state = startWellMission(1, [boss], [fenwick, sae]);
    expect(state.pilgrimZone.length).toBe(1);
    expect(state.pilgrimZone[0].id).toBe('fenwick');
    expect(state.pilgrimDeck.length).toBe(1);
  });

  it('flips another Pilgrim at the start of the next turn', () => {
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 100, attack: 0 };
    let state = startWellMission(1, [boss], [fenwick, sae]);
    const res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));
    state = res.state;
    expect(state.pilgrimZone.length).toBe(2);
    expect(state.pilgrimZone[1].id).toBe('sae');
  });

  it("rescues (banishes) a Pilgrim when an attack's total value exactly matches theirs", () => {
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 100, attack: 10 };
    let state = startWellMission(1, [boss], [fenwick]); // fenwick is worth 2
    state = rig(state, [suited('D', '2')]);

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.pilgrimZone.length).toBe(0);
    expect(state.banishPile.some((c) => c.id === 'fenwick')).toBe(true);
    expect(state.discardPile.some((c) => c.id === 'fenwick')).toBe(false);
  });

  it('leaves a waiting Pilgrim alone when the played value does not match', () => {
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 100, attack: 10 };
    let state = startWellMission(1, [boss], [fenwick]); // worth 2
    state = rig(state, [suited('D', '5')]);

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.pilgrimZone.length).toBe(1);
  });

  it("burns reserve-deck cards on kill equal to the Pilgrim zone's combined unrescued value", () => {
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 8, attack: 0 };
    let state = startWellMission(1, [boss], [fenwick, sae]); // zone = [fenwick(2)] after the mission-start flip
    let res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));
    state = res.state; // zone = [fenwick(2), sae(3)] after the next turn's flip
    expect(state.pilgrimZone.length).toBe(2);

    const tavernBefore = state.tavernDeck.length;
    // Spades matches the boss's own immunity (blocked, no Diamonds-style draw side effect) — isolates the burn.
    state = rig(state, [suited('S', '8')]); // kills the boss outright, doesn't match either Pilgrim's value
    res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.pilgrimZone.length).toBe(2); // neither rescued
    expect(tavernBefore - state.tavernDeck.length).toBe(5); // burned 2 + 3 = 5 off the reserve deck's top
  });
});

describe('legacy: mission 7 reward (Druid faction)', () => {
  it('rewards 4 Druid recruits, one carrying the Wellspring special ability', () => {
    const mission7 = getMission(7)!;
    const party = applyReward(buildInitialParty(), mission7.reward);
    const druids = party.filter((c) => c.kind === 'suited' && c.druid);
    expect(druids.length).toBe(4);
    expect(druids.filter((c) => c.kind === 'suited' && c.special === 'WELLSPRING').length).toBe(1);
  });

  it('a Druid recruit takes its explicit suit (Druid has none of its own) and is flagged druid', () => {
    const card = buildRecruitCard({ name: 'Test Druid', class: 'DRUID', rank: '5', suit: 'D' });
    expect(card.kind === 'suited' && card.druid).toBe(true);
    expect(card.kind === 'suited' && card.suit).toBe('D');
  });
});

describe('legacy: Druid class power (Regrowth — salvage from the banish pile)', () => {
  function druidCard(suit: SuitedCard['suit'], rank: SuitedCard['rank'], special?: boolean): SuitedCard {
    return { ...suited(suit, rank), druid: true, ...(special ? { special: 'WELLSPRING' } : {}) };
  }

  it("salvages 1 card from the banish pile to the bottom of the reserve deck, ignoring its printed suit's power", () => {
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 100, attack: 10 };
    let state = startMission(1, [boss]);
    state.banishPile = [suited('H', '6')]; // Hearts (Cleric/heal) power never fires for a Druid card
    state = rig(state, [druidCard('H', '3')]);

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.banishPile.length).toBe(0);
    expect(state.tavernDeck[state.tavernDeck.length - 1]?.rank).toBe('6'); // returned to the bottom
    expect(state.discardPile.length).toBe(0); // no heal fired — Hearts isn't a Druid's power
  });

  it('Wellspring salvages 2 cards instead of 1', () => {
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 100, attack: 10 };
    let state = startMission(1, [boss]);
    state.banishPile = [suited('H', '6'), suited('C', '4')];
    state = rig(state, [druidCard('H', '3', true)]);

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    expect(state.banishPile.length).toBe(0);
  });

  it('does nothing (no crash) when the banish pile is empty', () => {
    const boss: LegacyEnemySpec = { name: 'Pondkin', suit: 'S', health: 100, attack: 10 };
    let state = startMission(1, [boss]);
    state = rig(state, [druidCard('H', '3')]);

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    expect(res.state.banishPile.length).toBe(0);
  });
});

describe('legacy: mission 8 setup (Winds of Chaos)', () => {
  it('is a 12-enemy 2-wave gauntlet (6 Trolls, 6 Wyverns), ascendingZone enabled, with 9 extra Pilgrim reserve cards and a preset Puppy anchor', () => {
    const mission8 = getMission(8)!;
    expect(mission8.enemies.length).toBe(12);
    expect(mission8.ascendingZone).toBe(true);
    expect(mission8.extraReserveCards?.length).toBe(9);
    expect(mission8.extraReserveCards?.every((c) => c.kind === 'suited' && c.pilgrim)).toBe(true);
    expect(mission8.presetMissionZone?.length).toBe(1);
    expect(mission8.presetMissionZone?.[0]).toMatchObject({ rank: 'A', pilgrim: true });
  });

  it('shuffles the extra Pilgrim cards into the reserve deck alongside the party at mission start', () => {
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
    // 40 party + 9 Pilgrims = 49 total in circulation (hands + reserve deck).
    expect(handCount + state.tavernDeck.length).toBe(49);
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

  it('grants no suit immunity from the preset Pilgrim Puppy (unlike Missions 3/5/6 zone modes)', () => {
    const boss: LegacyEnemySpec = { name: 'Troll', suit: 'H', health: 20, attack: 10 };
    const state = startEdgeMission(1, [boss], { presetMissionZone: [puppy] });
    expect(state.missionZone).toEqual([puppy]);
    expect(state.zoneImmuneSuits).toEqual([]);
  });

  it('places a card worth exactly one more than the zone top; a Pilgrim card never buffs the enemy', () => {
    const boss: LegacyEnemySpec = { name: 'Troll', suit: 'S', health: 20, attack: 10 };
    let state = startEdgeMission(1, [boss], { presetMissionZone: [puppy] });
    const two: Card = { id: 'p2', kind: 'suited', suit: 'D', rank: '2', name: 'Old Yarrow', pilgrim: true };
    state = rig(state, [two]);

    const res = ensureOk(applyAction(state, { type: 'PLACE_IN_ZONE', playerId: state.players[0].id, cardId: two.id }));
    state = res.state;

    expect(state.missionZone.map((c) => c.id)).toEqual(['puppy', 'p2']);
    // No attack buff from a Pilgrim card: base 10 attack unmodified.
    expect(state.pendingDamage).toBe(10);
    expect(state.turnPhase).toBe('AWAIT_DEFEND');
  });

  it("rejects a card that doesn't match the zone's required next value", () => {
    const boss: LegacyEnemySpec = { name: 'Troll', suit: 'S', health: 20, attack: 10 };
    let state = startEdgeMission(1, [boss], { presetMissionZone: [puppy] });
    state = rig(state, [suited('D', '5')]);
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
    const bridge = suited('D', '2'); // an ordinary party card, not a Pilgrim
    state = rig(state, [bridge]);

    const res = ensureOk(applyAction(state, { type: 'PLACE_IN_ZONE', playerId: state.players[0].id, cardId: bridge.id }));
    state = res.state;

    // 10 base attack + 2 (the bridging card's own value, still sitting in the zone) = 12.
    expect(state.pendingDamage).toBe(12);
  });

  it('completing the chain at 10 purges the zone to the discard pile, opens the Ultimate Banishment, and closes the zone', () => {
    const boss: LegacyEnemySpec = { name: 'Troll', suit: 'S', health: 100, attack: 1 };
    const nine: Card = { id: 'nine', kind: 'suited', suit: 'H', rank: '9', pilgrim: true };
    const ten: Card = { id: 'ten', kind: 'suited', suit: 'H', rank: '10', name: 'Goran', pilgrim: true };
    let state = startEdgeMission(1, [boss], { presetMissionZone: [puppy, nine] });
    state = rig(state, [ten]);

    const res = ensureOk(applyAction(state, { type: 'PLACE_IN_ZONE', playerId: state.players[0].id, cardId: ten.id }));
    state = res.state;

    expect(state.missionZone.length).toBe(0);
    expect(state.zoneClosed).toBe(true);
    expect(state.turnPhase).toBe('AWAIT_ZONE_PURGE');
    expect(state.zonePurge?.playerId).toBe(state.players[0].id);
    expect(state.discardPile.map((c) => c.id).sort()).toEqual(['nine', 'puppy', 'ten']);
  });

  it('rejects further placements once the zone has closed', () => {
    const boss: LegacyEnemySpec = { name: 'Troll', suit: 'S', health: 100, attack: 1 };
    const nine: Card = { id: 'nine', kind: 'suited', suit: 'H', rank: '9', pilgrim: true };
    const ten: Card = { id: 'ten', kind: 'suited', suit: 'H', rank: '10', pilgrim: true };
    let state = startEdgeMission(1, [boss], { presetMissionZone: [puppy, nine] });
    state = rig(state, [ten]);
    state = ensureOk(applyAction(state, { type: 'PLACE_IN_ZONE', playerId: state.players[0].id, cardId: ten.id })).state;

    state = rig(state, [suited('D', '2')]);
    const res = applyAction(state, { type: 'PLACE_IN_ZONE', playerId: state.players[0].id, cardId: state.players[0].hand[0].id });
    expect(res.ok).toBe(false);
  });

  it('RESOLVE_ZONE_PURGE banishes the chosen cards forever and shuffles the rest into the bottom of the reserve deck', () => {
    const boss: LegacyEnemySpec = { name: 'Troll', suit: 'S', health: 100, attack: 1 };
    const nine: Card = { id: 'nine', kind: 'suited', suit: 'H', rank: '9', pilgrim: true };
    const ten: Card = { id: 'ten', kind: 'suited', suit: 'H', rank: '10', pilgrim: true };
    let state = startEdgeMission(1, [boss], { presetMissionZone: [puppy, nine] });
    state = rig(state, [ten]);
    state = ensureOk(applyAction(state, { type: 'PLACE_IN_ZONE', playerId: state.players[0].id, cardId: ten.id })).state;
    const reserveBefore = state.tavernDeck.length;

    const res = ensureOk(
      applyAction(state, { type: 'RESOLVE_ZONE_PURGE', playerId: state.players[0].id, banishCardIds: ['nine'] }),
    );
    state = res.state;

    expect(state.banishPile.map((c) => c.id)).toEqual(['nine']);
    expect(state.discardPile.length).toBe(0);
    expect(state.tavernDeck.length).toBe(reserveBefore + 2); // puppy + ten shuffled to the bottom
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

  it('opens the window on the turn immediately after a kill, and closes it again once that turn ends', () => {
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
    const strike = suited('S', '2'); // a Spades card, no immunity here — kills the 1-health Weakling outright
    state = rig(state, [strike]);

    const killRes = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [strike.id] }));
    state = killRes.state;

    // The kill let the same player continue their turn against the Troll — the placement window is now open.
    expect(state.currentEnemy?.name).toBe('Troll');
    expect(state.turnPhase).toBe('AWAIT_PLAY');
    expect(state.zoneOpenForPlacement).toBe(true);

    const two: Card = { id: 'p2', kind: 'suited', suit: 'D', rank: '2', name: 'Old Yarrow', pilgrim: true };
    state = rig(state, [two]);
    const placeRes = ensureOk(applyAction(state, { type: 'PLACE_IN_ZONE', playerId: state.players[0].id, cardId: two.id }));
    state = placeRes.state;
    expect(state.missionZone.map((c) => c.id)).toEqual(['puppy', 'p2']);

    // Placing in the zone ends the turn — the Troll's 0 attack means it advances straight to the next player,
    // closing the placement window behind it.
    expect(state.turnPhase).toBe('AWAIT_PLAY');
    expect(state.zoneOpenForPlacement).toBe(false);

    // A later turn with no fresh kill can't place again.
    const three: Card = { id: 'p3', kind: 'suited', suit: 'D', rank: '3', pilgrim: true };
    state = rig(state, [three]);
    const secondPlaceRes = applyAction(state, { type: 'PLACE_IN_ZONE', playerId: state.players[0].id, cardId: three.id });
    expect(secondPlaceRes.ok).toBe(false);
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
    expect(state.chanterWindow).toEqual({ pendingPlayerIds: [player1Id], blockNextAttack: false });
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
});

describe('legacy: mission 8 reward (Chanter faction)', () => {
  it('rewards 4 Chanter recruits, one carrying the Encore special ability', () => {
    const mission8 = getMission(8)!;
    const party = applyReward(buildInitialParty(), mission8.reward);
    const chanters = party.filter((c) => c.kind === 'suited' && c.chanter);
    expect(chanters.length).toBe(4);
    expect(chanters.filter((c) => c.kind === 'suited' && c.special === 'ENCORE').length).toBe(1);
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

  it('splits 30 cards into 3 piles of 10 (face-down + 1 revealed each), leaving the rest for the reserve deck', () => {
    const boss: LegacyEnemySpec = { name: 'Loreguard', suit: 'S', health: 20, attack: 10 };
    const state = startTempleMission(1, [boss]);

    expect(state.capturedPiles.length).toBe(3);
    for (const pile of state.capturedPiles) {
      expect(pile.faceUp).not.toBeNull();
      expect(pile.faceDown.length).toBe(9);
    }
    const totalCaptured = state.capturedPiles.reduce((sum, p) => sum + p.faceDown.length + (p.faceUp ? 1 : 0), 0);
    expect(totalCaptured).toBe(30);
    // 40-card starting party minus 30 captured = 10 leftover, dealt to the hand and/or left in the reserve deck.
    const handCount = state.players.reduce((sum, p) => sum + p.hand.length, 0);
    expect(handCount + state.tavernDeck.length).toBe(10);
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

describe('legacy: bonus Mage sticker (secondClassArcane — keeps its own suit power AND fires an arcane bolt)', () => {
  it('resolves both its printed suit power and an arcane bolt when played', () => {
    const boss: LegacyEnemySpec = { name: 'Test', suit: 'S', health: 100, attack: 10 };
    let state = startMission(1, [boss]);
    const stickered: SuitedCard = { ...suited('C', '4'), secondClassArcane: true }; // Warrior + bonus Mage bolt
    state = rig(state, [stickered]);

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));

    // Clubs doubles the play's value (4*2=8) PLUS the arcane bolt (4) on top = 12.
    expect(res.state.currentEnemy?.damageTaken).toBe(12);
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

describe('legacy: mission 9 reward (Evergreen Mother relic, Gøran, Mage sticker)', () => {
  it('grants the Evergreen Mother relic, Gøran with the Evergreen special ability, and a bonus Mage sticker', () => {
    const mission9 = getMission(9)!;
    expect(mission9.reward.relics).toEqual(['EVERGREEN_MOTHER']);
    expect(mission9.reward.mageSticker).toBe(true);
    const goran = mission9.reward.recruits.find((r) => r.name === 'Gøran');
    expect(goran?.class).toBe('EVERGREEN');
    expect(goran?.special).toBe(true);

    const party = applyReward(buildInitialParty(), mission9.reward);
    const goranCard = party.find((c) => c.kind === 'suited' && c.evergreen);
    expect(goranCard).toBeDefined();
    if (goranCard?.kind === 'suited') expect(goranCard.special).toBe('EVERGREEN');
    expect(party.filter((c) => c.kind === 'suited' && c.secondClassArcane).length).toBe(1);
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

  it('an enemy Bard forces the ending player to move their lowest-value hand card into the mission zone', () => {
    let state = startMission10({ startOfTurnZoneFlip: false });
    const low = suited('C', '2');
    const mid = suited('H', '5');
    const high = suited('D', '8');
    state = rig(state, [mid, low, high], { suit: 'D', baseAttack: 0 }); // Bard suit, 0 attack

    const res = ensureOk(applyAction(state, { type: 'YIELD', playerId: state.players[0].id }));

    expect(res.state.players[0].hand.map((c) => c.id).sort()).toEqual([high.id, mid.id].sort());
    expect(res.state.missionZone.map((c) => c.id)).toEqual([low.id]);
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
  it('adds every restored card back into the campaign party, skipping any id already present', () => {
    const party = buildInitialParty();
    const alreadyThere = party[0];
    const brandNew: Card = { id: 'restored-hero-1', kind: 'suited', suit: 'H', rank: '5', name: 'Cleansed Hero' };

    const next = applyRestoredPartyCards(party, [alreadyThere, brandNew]);

    expect(next.length).toBe(party.length + 1); // the duplicate was skipped, only the new card was added
    expect(next.some((c) => c.id === 'restored-hero-1')).toBe(true);
  });

  it('is a no-op (same reference) for an empty restored list', () => {
    const party = buildInitialParty();
    expect(applyRestoredPartyCards(party, [])).toBe(party);
  });
});

/** Mission 4's Beast Companion reward pool, freshly built (mirrors how RoomManager grants it via applyReward). */
function mission4BeastCards(): SuitedCard[] {
  return getMission(4)!.reward.recruits.map((r) => buildRecruitCard(r) as SuitedCard);
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
  });
  if (!res.ok) throw new Error(res.error);
  return res.state;
}

describe('legacy: mission 11 setup (Descent into Darkness)', () => {
  it('the mission entry has 4 elite enemies (one per base class), the beast-deck and pile-top-bonus flags, and no separate recruit reward', () => {
    const mission11 = getMission(11)!;
    expect(mission11.title).toBe('Descent into Darkness');
    expect(mission11.enemies.length).toBe(4);
    expect(new Set(mission11.enemies.map((e) => e.class))).toEqual(new Set(['WARRIOR', 'BARD', 'CLERIC', 'PALADIN']));
    expect(mission11.beastDeckMechanic).toBe(true);
    expect(mission11.pileTopEnemyBonus).toBe(true);
    expect(mission11.reward.recruits).toEqual([]);
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
    return getMission(4)!.reward.recruits.find((r) => r.class === cls)!;
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

describe('legacy: mission 11 reward (pick one beast card to carry forward)', () => {
  it("opens AWAIT_BEAST_REWARD_CHOICE (not an immediate WON) when the mission's last enemy falls", () => {
    const beasts = mission4BeastCards();
    let state = startMission11(1, { party: [...buildInitialParty(), ...beasts] });
    state = structuredClone(state);
    state.castleDeck = []; // the current enemy is the last of the 4
    state = rig(state, [suited('D', '9')], { suit: 'S', baseAttack: 0, maxHealth: 9, damageTaken: 0, spadesShield: 0 });

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );

    expect(res.state.phase).toBe('IN_PROGRESS'); // not WON yet — the party still has to choose
    expect(res.state.turnPhase).toBe('AWAIT_BEAST_REWARD_CHOICE');
    const pool = [...res.state.beastDeck, ...res.state.beastDeckDiscard];
    expect(pool.length).toBe(4);
  });

  it('CHOOSE_BEAST_REWARD resolves the choice into restoredPartyCards and completes the mission', () => {
    const beasts = mission4BeastCards();
    let state = startMission11(1, { party: [...buildInitialParty(), ...beasts] });
    state = structuredClone(state);
    state.castleDeck = [];
    state = rig(state, [suited('D', '9')], { suit: 'S', baseAttack: 0, maxHealth: 9, damageTaken: 0, spadesShield: 0 });
    const killRes = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );
    const pool = [...killRes.state.beastDeck, ...killRes.state.beastDeckDiscard];
    const chosen = pool[0];

    const res = ensureOk(
      applyAction(killRes.state, { type: 'CHOOSE_BEAST_REWARD', playerId: killRes.state.players[0].id, cardId: chosen.id }),
    );

    expect(res.state.phase).toBe('WON');
    expect(res.state.restoredPartyCards.map((c) => c.id)).toEqual([chosen.id]);
    expect(res.state.beastDeck.length).toBe(0);
    expect(res.state.beastDeckDiscard.length).toBe(0);
  });

  it('rejects CHOOSE_BEAST_REWARD when no window is open, and rejects a card id outside the pool', () => {
    let state = startMission11(1);
    const notOpen = applyAction(state, { type: 'CHOOSE_BEAST_REWARD', playerId: state.players[0].id, cardId: 'whatever' });
    expect(notOpen.ok).toBe(false);

    state = structuredClone(state);
    state.castleDeck = [];
    state = rig(state, [suited('D', '9')], { suit: 'S', baseAttack: 0, maxHealth: 9, damageTaken: 0, spadesShield: 0 });
    const killRes = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
    );
    const badPick = applyAction(killRes.state, {
      type: 'CHOOSE_BEAST_REWARD',
      playerId: killRes.state.players[0].id,
      cardId: 'not-in-the-pool',
    });
    expect(badPick.ok).toBe(false);
  });

  it('applyBeastCardChoice replaces the whole beast-card slate with just the chosen card', () => {
    const beasts = mission4BeastCards();
    const party = [...buildInitialParty(), ...beasts];
    const chosen = beasts[0];

    const next = applyBeastCardChoice(party, [chosen]);

    const beastIdsInNext = next.filter((c) => c.kind === 'suited' && (c as SuitedCard).beast).map((c) => c.id);
    expect(beastIdsInNext).toEqual([chosen.id]);
    expect(next.length).toBe(party.length - 3); // the other 3 beast cards are pruned; the chosen one was already present
  });

  it('applyBeastCardChoice is a no-op (same reference) when nothing was restored', () => {
    const party = [...buildInitialParty(), ...mission4BeastCards()];
    expect(applyBeastCardChoice(party, [])).toBe(party);
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
    expect(mission12.enemies[8].secondClass).toBeDefined(); // the Hierarch is dual-immune
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

  it("a Reaver's tear revealing a restored card off the reserve deck redirects it to the bottom of the reserve deck instead of the banish pile", () => {
    const boss: LegacyEnemySpec = { name: 'The Hierarch', suit: 'S', health: 200, attack: 10 };
    let state = startMission(1, [boss]);
    state.restoredCardMechanic = true;
    const toReveal = restoredCard('D', '4');
    state.tavernDeck = [toReveal, ...state.tavernDeck];
    state = rig(state, [reaverRecruitCard()]);

    const res = ensureOk(
      applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }),
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
