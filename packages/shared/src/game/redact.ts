import type { ClientGameState, GameState } from './types.js';

/** Produces the per-player view of state: every hand except the viewer's own is collapsed to a count. */
export function redactStateFor(state: GameState, viewerPlayerId: string): ClientGameState {
  return {
    phase: state.phase,
    ruleset: state.ruleset,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      handCount: p.hand.length,
      ...(p.id === viewerPlayerId ? { hand: p.hand } : {}),
    })),
    currentPlayerIndex: state.currentPlayerIndex,
    turnPhase: state.turnPhase,
    pendingDamage: state.pendingDamage,
    currentEnemy: state.currentEnemy,
    castleDeckCount: state.castleDeck.length,
    tavernDeckCount: state.tavernDeck.length,
    discardPile: state.discardPile,
    maxHandSize: state.maxHandSize,
    log: state.log,
    lossReason: state.lossReason,
    soloJestersUsed: state.soloJestersUsed,
    victoryMedal: state.victoryMedal,
    jesterClaim: state.jesterClaim,
    you: { playerId: viewerPlayerId },
  };
}
