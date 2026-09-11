import type { ClientGameState } from '@regicide/shared';

export function PlayerList({ state, myPlayerId }: { state: ClientGameState; myPlayerId: string }) {
  return (
    <div className="player-strip">
      {state.players.map((p, i) => (
        <div key={p.id} className={`player-pill player-map player-map-${i % 4}${i === state.currentPlayerIndex ? ' active-turn' : ''}`}>
          <span className={`dot${p.connected ? '' : ' offline'}`} />
          <span>{p.id === myPlayerId ? 'You' : p.name}</span>
          <span>
            · {p.handCount}/{state.maxHandSize} 🂠
          </span>
        </div>
      ))}
    </div>
  );
}
