import type { ClientGameState } from '@regicide/shared';
import { CardPile } from './CardPile';

export function DeckPiles({ state }: { state: ClientGameState }) {
  return (
    <div className="table-mat">
      <div className="deck-row">
        <CardPile label="Reserve" count={state.tavernDeckCount} />
        <CardPile label="Discard" cards={state.discardPile} emptyLabel="empty" />
        <CardPile label="Banished" cards={state.banishPile} emptyLabel="empty" />
        <CardPile label="Enemies left" count={state.castleDeckCount + (state.currentEnemy ? 1 : 0)} />
      </div>
    </div>
  );
}
