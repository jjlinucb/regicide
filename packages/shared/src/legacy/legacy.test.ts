import { describe, expect, it } from 'vitest';
import { applyAction, createLobbyState } from '../game/engine.js';
import type { Card, EngineResult, GameState, LegacyEnemySpec, SuitedCard } from '../game/types.js';
import { CLASS_THEME } from './classes.js';
import { getMission, MISSIONS, missionEnemiesToSpecs } from './missions.js';
import { applyDualClassStickers, applyReward, buildInitialParty, buildRecruitCard } from './party.js';

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

  it('every non-standard-castle mission has at least one enemy and converts cleanly to engine specs', () => {
    expect(MISSIONS.length).toBe(6);
    for (const mission of MISSIONS) {
      if (mission.standardCastle) continue;
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

  it('mission 1 is the standard 12-enemy Castle deck and rewards the Kinfolk Flute relic', () => {
    const mission1 = getMission(1)!;
    expect(mission1.standardCastle).toBe(true);
    expect(mission1.reward.relics).toEqual(['KINFOLK_FLUTE']);
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
  it('gives exactly `count` eligible cards a second, different class icon, leaving everything else untouched', () => {
    const party = buildInitialParty();
    const stickered = applyDualClassStickers(party, 4);
    const withSecondSuit = stickered.filter((c) => c.kind === 'suited' && c.secondSuit);
    expect(withSecondSuit.length).toBe(4);
    for (const c of withSecondSuit) {
      if (c.kind === 'suited') expect(c.secondSuit).not.toBe(c.suit);
    }
    // Original party is untouched (pure function).
    expect(party.every((c) => c.kind === 'suited' && !c.secondSuit)).toBe(true);
  });

  it('skips Mage (arcane) cards and cards that already have a second class', () => {
    const party = buildInitialParty().slice(0, 2);
    const arcaneCard: Card = { ...suited('H', '4'), arcane: true };
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

  it('flips the top reserve card into the mission zone at end of turn, adding its class to the enemy\'s immunity', () => {
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

    expect(state.missionZone.length).toBe(1);
    expect(state.zoneImmuneSuits).toContain('H');
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

describe('legacy: mission 5 mechanics (Reaver reserve-tear, preset mission zone, exact-kill splash)', () => {
  function reaverCard(suit: SuitedCard['suit'], rank: SuitedCard['rank'], special?: boolean): SuitedCard {
    return { ...suited(suit, rank), reaver: true, ...(special ? { special: 'PLUNDER' } : {}) };
  }

  function startCrimsonMission(
    n: number,
    enemies: LegacyEnemySpec[],
    opts: { presetMissionZone?: Card[]; exactKillSplashDamage?: boolean } = {},
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

  it('tears the top reserve card for bonus damage, banishes it, and doubles the attack', () => {
    const boss: LegacyEnemySpec = { name: 'Sporeling', suit: 'S', health: 100, attack: 1 };
    let state = startCrimsonMission(1, [boss]);
    state = structuredClone(state);
    state.tavernDeck = [suited('C', '6'), ...state.tavernDeck];
    const reserveBefore = state.tavernDeck.length;
    state = rig(state, [reaverCard('D', '4')]);

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    // (4 + 6) * 2 = 20 damage; the revealed 6 is gone from the reserve deck and banished, not drawable again.
    expect(state.currentEnemy?.damageTaken).toBe(20);
    expect(state.tavernDeck.length).toBe(reserveBefore - 1);
    expect(state.banishPile.some((c) => c.kind === 'suited' && c.suit === 'C' && c.rank === '6')).toBe(true);
  });

  it('stacks with a Warrior (Clubs) card in the same play for quadruple damage', () => {
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

    // (5 + 5 + 6) * (2 clubs * 2 reaver) = 64.
    expect(state.currentEnemy?.damageTaken).toBe(64);
  });

  it("Plunder tears 2 reserve cards instead of 1 and keeps the higher value", () => {
    const boss: LegacyEnemySpec = { name: 'Sporeling', suit: 'S', health: 100, attack: 1 };
    let state = startCrimsonMission(1, [boss]);
    state = structuredClone(state);
    state.tavernDeck = [suited('C', '4'), suited('D', '9'), ...state.tavernDeck];
    state = rig(state, [reaverCard('H', '3', true)]);

    const res = ensureOk(applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] }));
    state = res.state;

    // (3 + 9) * 2 = 24 — the higher of the two torn cards (9) is kept, both banished.
    expect(state.currentEnemy?.damageTaken).toBe(24);
    expect(state.banishPile.some((c) => c.kind === 'suited' && c.rank === '4')).toBe(true);
    expect(state.banishPile.some((c) => c.kind === 'suited' && c.rank === '9')).toBe(true);
  });

  it('seeds the mission zone with a fixed, static set of cards at mission start', () => {
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
