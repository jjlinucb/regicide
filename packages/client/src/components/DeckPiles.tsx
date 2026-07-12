import type { ClientGameState } from '@regicide/shared';

export function DeckPiles({ state }: { state: ClientGameState }) {
  return (
    <div className="deck-row">
      <span className="deck-pill">🂠 Tavern: {state.tavernDeckCount}</span>
      <span className="deck-pill">🗑️ Discard: {state.discardPile.length}</span>
      <span className="deck-pill">🏰 Enemies left: {state.castleDeckCount + (state.currentEnemy ? 1 : 0)}</span>
    </div>
  );
}
