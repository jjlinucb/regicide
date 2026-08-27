import type { ClientGameState } from '@regicide/shared';
import { CardPile } from './CardPile';

export function DeckPiles({ state, myPlayerId }: { state: ClientGameState; myPlayerId: string }) {
  const hasKinfolkFlute = state.relics.includes('KINFOLK_FLUTE');
  const myKinfolkSlot = state.players.find((p) => p.id === myPlayerId)?.kinfolkSlot ?? null;

  return (
    <div className="table-mat">
      <div className="deck-row">
        <CardPile label="Reserve" count={state.tavernDeckCount} />
        <CardPile label="Discard" cards={state.discardPile} emptyLabel="empty" />
        <CardPile label="Banished" cards={state.banishPile} emptyLabel="empty" />
        <CardPile label="Enemies left" count={state.castleDeckCount + (state.currentEnemy ? 1 : 0)} />
        {hasKinfolkFlute && <CardPile label="Kinfolk (you)" cards={myKinfolkSlot ? [myKinfolkSlot] : []} emptyLabel="empty" />}
      </div>
    </div>
  );
}
