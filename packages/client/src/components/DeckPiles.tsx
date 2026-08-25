import type { ClientGameState } from '@regicide/shared';
import { CardPile } from './CardPile';

export function DeckPiles({ state }: { state: ClientGameState }) {
  return (
    <div className="deck-row">
      <CardPile label="Reserve" icon="🂠" count={state.tavernDeckCount} />
      <CardPile label="Discard" icon="🗑️" cards={state.discardPile} emptyLabel="empty" />
      <CardPile label="Banished" icon="🚫" cards={state.banishPile} emptyLabel="empty" />
      <CardPile label="Enemies left" icon="🏰" count={state.castleDeckCount + (state.currentEnemy ? 1 : 0)} />
    </div>
  );
}
