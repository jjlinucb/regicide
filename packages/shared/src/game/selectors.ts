import type { GameState, PlayerState } from './types.js';

export function currentPlayerOf(state: GameState): PlayerState | undefined {
  return state.players[state.currentPlayerIndex];
}

export function isGameOver(state: GameState): boolean {
  return state.phase === 'WON' || state.phase === 'LOST';
}

/**
 * THE single gate for "does this relic actually do anything right now?" — every relic power in the engine and
 * every relic-gated bit of client UI goes through here rather than testing `relics.includes(id)` directly.
 *
 * A relic is active when the campaign holds it AND it isn't currently corrupted (see GameState.corruptedRelics).
 *
 * DECISION, NOT A SOURCED RULE (see missions.ts's Mission 9 startingCorruptedRelics): "corrupted relic" is
 * modelled as fully INERT — the relic is present and visible, but none of its powers apply. John specified only
 * that Mission 9 starts with the Evergreen Mother corrupted; he did not say what a corrupted relic does. Inert is
 * the least destructive reading available, because it makes Mission 9 play EXACTLY as it did before this state
 * existed (the relic simply wasn't in play during Mission 9 at all, so the corrupted-card cost fell through to
 * its default) — no difficulty change is smuggled in on a guess. If a corrupted relic should instead be weakened,
 * or work at some extra price, this function is the one place to change it.
 *
 * Structurally typed so both GameState (server/engine) and ClientGameState (UI) can use it.
 */
export function relicActive(state: { relics: string[]; corruptedRelics: string[] }, relicId: string): boolean {
  return state.relics.includes(relicId) && !state.corruptedRelics.includes(relicId);
}
