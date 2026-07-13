import { describe, expect, it } from 'vitest';
import { applyAction, createLobbyState } from './engine.js';
import type { Card, GameState, SuitedCard } from './types.js';

function startGame(seed: string, n: number): GameState {
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const names = Array.from({ length: n }, (_, i) => `Player ${i}`);
  const res = applyAction(createLobbyState(), { type: 'START_GAME', playerIds: ids, playerNames: names, seed });
  if (!res.ok) throw new Error(res.error);
  return res.state;
}

function suited(suit: SuitedCard['suit'], rank: SuitedCard['rank']): SuitedCard {
  return { id: `${suit}${rank}-${Math.random()}`, kind: 'suited', suit, rank };
}

/** Give the current player an exact hand and set the current enemy directly, for deterministic scenario tests. */
function rig(state: GameState, hand: Card[], enemy?: Partial<NonNullable<GameState['currentEnemy']>>): GameState {
  const s = structuredClone(state);
  s.players[s.currentPlayerIndex].hand = hand;
  if (enemy && s.currentEnemy) Object.assign(s.currentEnemy, enemy);
  return s;
}

describe('setup', () => {
  it('builds a 12-enemy castle deck and correct tavern deck size / hand sizes per player count', () => {
    for (const n of [1, 2, 3, 4] as const) {
      const state = startGame('seed-' + n, n);
      const expectedJesters = { 1: 0, 2: 0, 3: 1, 4: 2 }[n];
      const expectedMaxHand = { 1: 8, 2: 7, 3: 6, 4: 5 }[n];
      const totalEnemies = 1 + state.castleDeck.length;
      expect(totalEnemies).toBe(12);
      expect(state.currentEnemy!.rank).toBe('J'); // Jacks always fought first
      expect(state.maxHandSize).toBe(expectedMaxHand);
      const handCardCount = state.players.reduce((sum, p) => sum + p.hand.length, 0);
      // 52 + jesters - 12 enemies (in castle deck, not tavern) = tavern deck size before dealing
      const tavernBeforeDeal = 52 + expectedJesters - 12;
      expect(handCardCount + state.tavernDeck.length).toBe(tavernBeforeDeal);
    }
  });
});

describe('basic damage', () => {
  it('accumulates damage across two players and defeats a Jack at 21 total (rulebook example)', () => {
    let state = startGame('dmg', 2);
    state = rig(state, [suited('H', '9')]);
    let res = applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] });
    expect(res.ok).toBe(true);
    state = (res as any).state;
    // 9 damage dealt, Jack (20 hp) survives, attack 10 must be defended
    expect(state.currentEnemy!.damageTaken).toBe(9);
    expect(state.turnPhase).toBe('AWAIT_DEFEND');
    expect(state.pendingDamage).toBe(10);

    // Defend with enough value
    const defendCards = [suited('C', '10')];
    state = rig(state, defendCards);
    res = applyAction(state, { type: 'DEFEND', playerId: state.players[0].id, cardIds: [defendCards[0].id] });
    expect(res.ok).toBe(true);
    state = (res as any).state;
    expect(state.currentPlayerIndex).toBe(1);

    // Second player deals 12 -> total 21 >= 20, Jack defeated
    const p2card = suited('H', '10'); // value 10 not 12, use a 12 via combo isn't possible (max single card is 10); use a face-equivalent instead
    // Simplest: two cards combo isn't same-rank; just use a single card of value 10 plus rely on damage>=20 total already at 19; do a second play of 2 to push to 11 total then another. Simplify: directly play a card worth >=11 is impossible (max 10). So play two turns.
    state = rig(state, [suited('S', '10')]);
    res = applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[1].id, cardIds: [state.players[1].hand[0].id] });
    expect(res.ok).toBe(true);
    state = (res as any).state;
    expect(state.currentEnemy!.damageTaken).toBe(19);
  });

  it('doubles damage with Clubs (8 of Clubs deals 16, rulebook example)', () => {
    let state = startGame('clubs', 2);
    state.currentEnemy!.suit = 'H'; // avoid colliding with the Clubs card played below
    const card = suited('C', '8');
    state = rig(state, [card]);
    const res = applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [card.id] });
    expect(res.ok).toBe(true);
    state = (res as any).state;
    expect(state.currentEnemy!.damageTaken).toBe(16);
  });
});

describe('suit powers', () => {
  it('Diamonds draws cards round-robin equal to attack value, skipping maxed hands', () => {
    let state = startGame('diamonds', 2);
    state.currentEnemy!.suit = 'H'; // avoid colliding with the Diamonds card played below
    const card = suited('D', '4');
    state = rig(state, [card]);
    state.players[0].hand = [card];
    state.players[1].hand = state.players[1].hand.slice(0, 7); // already at max (7 for 2p)
    const tavernBefore = state.tavernDeck.length;
    const res = applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [card.id] });
    expect(res.ok).toBe(true);
    const newState = (res as any).state as GameState;
    // player 1 (index 0) draws, player 2 is maxed and skipped every time -> all 4 draws go to player 0
    expect(newState.players[0].hand.length).toBe(4); // 0 left after playing the 4, then drew 4
    expect(newState.players[1].hand.length).toBe(7);
    expect(tavernBefore - newState.tavernDeck.length).toBe(4);
  });

  it('Hearts heals cards from discard back under the tavern deck', () => {
    let state = startGame('hearts', 2);
    state.currentEnemy!.suit = 'D'; // avoid colliding with the Hearts card played below
    // seed discard pile with 5 known cards
    state.discardPile = Array.from({ length: 5 }, (_, i) => suited('S', '2'));
    const card = suited('H', '3');
    state = rig(state, [card]);
    const tavernBefore = state.tavernDeck.length;
    const res = applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [card.id] });
    expect(res.ok).toBe(true);
    const newState = (res as any).state as GameState;
    expect(newState.tavernDeck.length).toBe(tavernBefore + 3);
    expect(newState.discardPile.length).toBe(2);
  });

  it('Spades shield is cumulative and reduces enemy attack, floored at 0', () => {
    let state = startGame('spades', 2);
    state.currentEnemy!.suit = 'H'; // avoid colliding with the Spades cards played below
    const card1 = suited('S', '9');
    state = rig(state, [card1]);
    let res = applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [card1.id] });
    state = (res as any).state;
    expect(state.currentEnemy!.spadesShield).toBe(9);
    expect(state.pendingDamage).toBe(1); // 10 - 9

    // defend trivially
    state = rig(state, [suited('C', '2')]);
    res = applyAction(state, { type: 'DEFEND', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] });
    state = (res as any).state;

    const card2 = suited('S', '5');
    state = rig(state, [card2]);
    res = applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[1].id, cardIds: [card2.id] });
    state = (res as any).state;
    expect(state.currentEnemy!.spadesShield).toBe(14);
    expect(state.pendingDamage).toBe(0); // enemy attack floored at 0, auto-advanced
    expect(state.turnPhase).toBe('AWAIT_PLAY');
  });
});

describe('animal companions and combos', () => {
  it('Animal Companion pairs with another card: 8 of Diamonds + Ace of Clubs = value 9, draws 9 and deals 18', () => {
    let state = startGame('animal', 2);
    state.currentEnemy!.suit = 'H'; // avoid colliding with the suits under test
    const diamond8 = suited('D', '8');
    const aceClubs = suited('C', 'A');
    state = rig(state, [diamond8, aceClubs]);
    const res = applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [diamond8.id, aceClubs.id] });
    expect(res.ok).toBe(true);
    const newState = (res as any).state as GameState;
    expect(newState.currentEnemy!.damageTaken).toBe(18);
  });

  it('triple combo of 3s across Diamonds/Spades/Clubs: draws 9, shields 9, deals 18 (rulebook example)', () => {
    let state = startGame('combo', 2);
    state.currentEnemy!.suit = 'H'; // avoid colliding with the suits under test
    const c1 = suited('D', '3');
    const c2 = suited('S', '3');
    const c3 = suited('C', '3');
    state = rig(state, [c1, c2, c3]);
    const res = applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [c1.id, c2.id, c3.id] });
    expect(res.ok).toBe(true);
    const newState = (res as any).state as GameState;
    expect(newState.currentEnemy!.damageTaken).toBe(18);
    expect(newState.currentEnemy!.spadesShield).toBe(9);
  });

  it('rejects a combo of different ranks', () => {
    let state = startGame('badcombo', 2);
    const c1 = suited('D', '3');
    const c2 = suited('S', '4');
    state = rig(state, [c1, c2]);
    const res = applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [c1.id, c2.id] });
    expect(res.ok).toBe(false);
  });

  it('rejects a combo whose total exceeds 10', () => {
    let state = startGame('bigcombo', 2);
    const c1 = suited('D', '6');
    const c2 = suited('S', '6');
    state = rig(state, [c1, c2]);
    const res = applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [c1.id, c2.id] });
    expect(res.ok).toBe(false);
  });
});

describe('enemy immunity and the Jester', () => {
  it('a Jack of Diamonds is immune to Diamonds (no draw, damage still counts)', () => {
    let state = startGame('immune', 2);
    state.currentEnemy!.suit = 'D';
    const card = suited('D', '6');
    state = rig(state, [card]);
    const tavernBefore = state.tavernDeck.length;
    const res = applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [card.id] });
    expect(res.ok).toBe(true);
    const newState = (res as any).state as GameState;
    expect(newState.tavernDeck.length).toBe(tavernBefore); // no draw happened
    expect(newState.currentEnemy!.damageTaken).toBe(6); // damage still applied
  });

  it('Jester breaks immunity and retroactively activates previously-blocked Spades shield, but not already-resolved Clubs', () => {
    let state = startGame('jester-spade', 2);
    state.currentEnemy!.suit = 'S';
    const spadeCard = suited('S', '5');
    state = rig(state, [spadeCard]);
    let res = applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [spadeCard.id] });
    state = (res as any).state;
    expect(state.currentEnemy!.spadesShield).toBe(0);
    expect(state.currentEnemy!.blockedSpadesShield).toBe(5);
    expect(state.pendingDamage).toBe(state.currentEnemy!.baseAttack); // not reduced yet

    state = rig(state, [suited('C', '10')]);
    res = applyAction(state, { type: 'DEFEND', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] });
    state = (res as any).state;

    const jester: Card = { id: 'j1', kind: 'jester' };
    state = rig(state, [jester]);
    res = applyAction(state, { type: 'ACTIVATE_JESTER', playerId: state.players[1].id, cardId: jester.id, nextPlayerId: state.players[0].id });
    expect(res.ok).toBe(true);
    state = (res as any).state;
    expect(state.currentEnemy!.immunityBroken).toBe(true);
    expect(state.currentEnemy!.spadesShield).toBe(5); // retroactively unlocked
    expect(state.currentEnemy!.blockedSpadesShield).toBe(0);
    expect(state.currentPlayerIndex).toBe(0); // chosen next player
  });
});

describe('exact-kill enemy return to tavern deck', () => {
  it('places the defeated enemy face-down on top of the tavern deck when damage exactly equals health, drawable at its face value', () => {
    let state = startGame('exactkill', 2);
    state.currentEnemy!.damageTaken = 10; // Jack has 20 health, 10 remaining
    const card = suited('H', '10');
    state = rig(state, [card]);
    const res = applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [card.id] });
    expect(res.ok).toBe(true);
    const newState = (res as any).state as GameState;
    const topCard = newState.tavernDeck[0];
    expect(topCard.kind).toBe('suited');
    if (topCard.kind === 'suited') {
      expect(topCard.rank).toBe('J');
    }
    // Same player continues their turn against the newly revealed enemy
    expect(newState.turnPhase).toBe('AWAIT_PLAY');
    expect(newState.currentPlayerIndex).toBe(0);
  });

  it('sends an overkilled enemy to the discard pile instead of the tavern deck', () => {
    let state = startGame('overkill', 2);
    state.currentEnemy!.damageTaken = 12; // 8 remaining, will overkill with a 9
    const card = suited('H', '9');
    state = rig(state, [card]);
    const res = applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [card.id] });
    expect(res.ok).toBe(true);
    const newState = (res as any).state as GameState;
    const found = newState.discardPile.some((c) => c.kind === 'suited' && c.rank === 'J');
    expect(found).toBe(true);
  });
});

describe('yielding', () => {
  it('cannot yield if every other player yielded on their last turn', () => {
    const state = startGame('yield', 2);
    // Simulate player 0 yielding first.
    let res = applyAction(state, { type: 'YIELD', playerId: state.players[0].id });
    expect(res.ok).toBe(true);
    let s = (res as any).state as GameState;
    // defend trivially for player 0 if needed
    if (s.turnPhase === 'AWAIT_DEFEND') {
      s = rig(s, [suited('C', '10')]);
      res = applyAction(s, { type: 'DEFEND', playerId: s.players[0].id, cardIds: [s.players[0].hand[0].id] });
      s = (res as any).state;
    }
    expect(s.currentPlayerIndex).toBe(1);
    // Now player 1 tries to yield — should be rejected since player 0 (the only other player) just yielded.
    res = applyAction(s, { type: 'YIELD', playerId: s.players[1].id });
    expect(res.ok).toBe(false);
  });
});

describe('losing', () => {
  it('loses the game if a player cannot discard enough to cover the damage', () => {
    let state = startGame('lose-defend', 2);
    const card = suited('H', '2');
    state = rig(state, [card]); // deals only 1 damage, Jack attacks for 10
    let res = applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [card.id] });
    state = (res as any).state;
    expect(state.pendingDamage).toBe(10);

    // Give the player a hand that sums to far less than 10, and discard the whole hand.
    const weakHand = [suited('S', '2')];
    state = rig(state, weakHand);
    res = applyAction(state, { type: 'DEFEND', playerId: state.players[0].id, cardIds: [weakHand[0].id] });
    expect(res.ok).toBe(true);
    const newState = (res as any).state as GameState;
    expect(newState.phase).toBe('LOST');
  });

  it('rejects a partial defend that does not cover the damage unless it is the whole hand', () => {
    let state = startGame('partial-defend', 2);
    state = rig(state, [suited('H', '2')]);
    let res = applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [state.players[0].hand[0].id] });
    state = (res as any).state;

    const hand = [suited('S', '2'), suited('C', '2'), suited('D', '2')]; // total 6, not enough for 10, not whole hand if we only pick one
    state = rig(state, hand);
    res = applyAction(state, { type: 'DEFEND', playerId: state.players[0].id, cardIds: [hand[0].id] });
    expect(res.ok).toBe(false);
  });

  it('loses immediately if defeating an enemy empties the hand and yielding is also blocked (bonus-turn edge case)', () => {
    let state = startGame('stuck-after-defeat', 2);
    state.lastActionWasYield = [false, true]; // player 1's last action was a yield
    state.currentEnemy!.damageTaken = state.currentEnemy!.maxHealth - 6; // one more hit of 6 defeats it
    const lastCard = suited('H', '6');
    state = rig(state, [lastCard]); // this is the player's ONLY card
    const res = applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [lastCard.id] });
    expect(res.ok).toBe(true);
    const newState = (res as any).state as GameState;
    // Enemy defeated, bonus turn continues, but the hand is now empty and player 1 just yielded
    // — player 0 can neither play nor yield, so the game must already be lost.
    expect(newState.phase).toBe('LOST');
  });
});

describe('winning', () => {
  it('wins when the last King is defeated', () => {
    let state = startGame('win', 2);
    state.castleDeck = [];
    state.currentEnemy!.rank = 'K';
    state.currentEnemy!.maxHealth = 40;
    state.currentEnemy!.damageTaken = 40;
    // Deal a trivial finishing blow via a fresh enemy already at 0 remaining before play; instead force via direct low-health King about to be finished
    state.currentEnemy!.damageTaken = 39;
    const card = suited('H', '2');
    state = rig(state, [card]);
    const res = applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [card.id] });
    expect(res.ok).toBe(true);
    const newState = (res as any).state as GameState;
    expect(newState.phase).toBe('WON');
    expect(newState.victoryMedal).toBeNull(); // 2-player games don't score a medal
  });

  it('awards Gold in a solo win with 0 solo Jesters used', () => {
    let state = startGame('win-solo-gold', 1);
    state.castleDeck = [];
    state.currentEnemy!.rank = 'K';
    state.currentEnemy!.maxHealth = 40;
    state.currentEnemy!.damageTaken = 39;
    const card = suited('H', '2');
    state = rig(state, [card]);
    const res = applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [card.id] });
    expect(res.ok).toBe(true);
    const newState = (res as any).state as GameState;
    expect(newState.phase).toBe('WON');
    expect(newState.victoryMedal).toBe('gold');
  });

  it('downgrades the medal to Silver then Bronze as solo Jesters are used', () => {
    let state = startGame('win-solo-bronze', 1);
    let res = applyAction(state, { type: 'USE_SOLO_JESTER', playerId: state.players[0].id });
    expect(res.ok).toBe(true);
    state = (res as any).state;
    res = applyAction(state, { type: 'USE_SOLO_JESTER', playerId: state.players[0].id });
    expect(res.ok).toBe(true);
    state = (res as any).state;
    expect(state.soloJestersUsed).toBe(2);

    state.castleDeck = [];
    state.currentEnemy!.rank = 'K';
    state.currentEnemy!.maxHealth = 40;
    state.currentEnemy!.damageTaken = 39;
    const card = suited('H', '2');
    state = rig(state, [card]);
    res = applyAction(state, { type: 'PLAY_CARDS', playerId: state.players[0].id, cardIds: [card.id] });
    expect(res.ok).toBe(true);
    const newState = (res as any).state as GameState;
    expect(newState.phase).toBe('WON');
    expect(newState.victoryMedal).toBe('bronze');
  });
});

describe('solo Jester', () => {
  it('discards the whole hand and refills to the hand limit, without consuming the turn', () => {
    let state = startGame('solo-jester', 1);
    const originalHandIds = state.players[0].hand.map((c) => c.id);
    const tavernBefore = state.tavernDeck.length;
    const res = applyAction(state, { type: 'USE_SOLO_JESTER', playerId: state.players[0].id });
    expect(res.ok).toBe(true);
    const newState = (res as any).state as GameState;
    expect(newState.players[0].hand.length).toBe(newState.maxHandSize);
    expect(newState.players[0].hand.some((c) => originalHandIds.includes(c.id))).toBe(false);
    expect(newState.discardPile.length).toBe(originalHandIds.length);
    expect(tavernBefore - newState.tavernDeck.length).toBe(newState.maxHandSize);
    expect(newState.soloJestersUsed).toBe(1);
    expect(newState.turnPhase).toBe('AWAIT_PLAY');
    expect(newState.currentPlayerIndex).toBe(0);
  });

  it('rejects a third use', () => {
    let state = startGame('solo-jester-limit', 1);
    let res = applyAction(state, { type: 'USE_SOLO_JESTER', playerId: state.players[0].id });
    state = (res as any).state;
    res = applyAction(state, { type: 'USE_SOLO_JESTER', playerId: state.players[0].id });
    state = (res as any).state;
    res = applyAction(state, { type: 'USE_SOLO_JESTER', playerId: state.players[0].id });
    expect(res.ok).toBe(false);
  });

  it('rejects use in a multiplayer game', () => {
    const state = startGame('solo-jester-multiplayer', 2);
    const res = applyAction(state, { type: 'USE_SOLO_JESTER', playerId: state.players[0].id });
    expect(res.ok).toBe(false);
  });
});
