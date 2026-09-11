import type { ClientGameState } from '@regicide/shared';
import { CardPile } from './CardPile';

export function DeckPiles({ state, myPlayerId }: { state: ClientGameState; myPlayerId: string }) {
  const hasKinfolkFlute = state.relics.includes('KINFOLK_FLUTE');
  const myKinfolkSlot = state.players.find((p) => p.id === myPlayerId)?.kinfolkSlot ?? null;

  return (
    <div className="table-mat expedition-map">
      <p className="deck-inspector-hint">Face-up piles can be opened to inspect every card. Reserve and enemy decks stay hidden until an effect reveals them.</p>
      <div className="deck-row">
        <div className="map-pile reserve-pile"><CardPile label="Reserve" count={state.tavernDeckCount} /></div>
        <div className="map-pile discard-pile"><CardPile label="Discard" cards={state.discardPile} emptyLabel="empty" /></div>
        <div className="map-pile banished-pile"><CardPile label="Banished" cards={state.banishPile} emptyLabel="empty" /></div>
        <div className="map-pile enemy-pile"><CardPile label="Enemies left" count={state.castleDeckCount + (state.currentEnemy ? 1 : 0)} /></div>
        {hasKinfolkFlute && <div className="map-pile kinfolk-pile"><CardPile label="Kinfolk (you)" cards={myKinfolkSlot ? [myKinfolkSlot] : []} emptyLabel="empty" /></div>}
      </div>
    </div>
  );
}
