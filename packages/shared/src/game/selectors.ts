import type { GameState, PlayerState } from './types.js';

export function currentPlayerOf(state: GameState): PlayerState | undefined {
  return state.players[state.currentPlayerIndex];
}

export function isGameOver(state: GameState): boolean {
  return state.phase === 'WON' || state.phase === 'LOST';
}
