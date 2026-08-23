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
    expect(MISSIONS.length).toBe(4);
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
