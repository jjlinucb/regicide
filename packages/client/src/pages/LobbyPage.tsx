import type { EndlessStatePayload, RoomStatePayload } from '@regicide/shared';

export function LobbyPage({
  roomState,
  myPlayerId,
  endlessState,
  onStart,
  onLeave,
}: {
  roomState: RoomStatePayload;
  myPlayerId: string;
  endlessState?: EndlessStatePayload | null;
  onStart: () => void;
  onLeave: () => void;
}) {
  const isHost = roomState.players.find((p) => p.id === myPlayerId)?.isHost ?? false;
  // A room just loaded from an Endless save shares the just-loaded save's own code as its room code (see
  // RoomManager.loadEndlessSave) — that equality is what tells us to show the "resuming" message below instead
  // of the plain fresh-game lobby.
  const isResumingEndless = endlessState?.saveCode === roomState.code;

  return (
    <div className="centered-page">
      <h1>Regicide</h1>
      {isResumingEndless ? (
        <p>
          Resuming Endless save <strong>{roomState.code}</strong> — starting will deal into Round {endlessState!.endlessLoop + 1}.
        </p>
      ) : (
        <p>Share this code with up to 3 friends:</p>
      )}
      <div className="room-code">{roomState.code}</div>
      <div className="panel">
        <div className="player-chip-list">
          {roomState.players.map((p) => (
            <div key={p.id} className="player-chip">
              <span className={`dot${p.connected ? '' : ' offline'}`} />
              <span>
                {p.id === myPlayerId ? 'You' : p.name}
                {p.isHost ? ' (host)' : ''}
              </span>
            </div>
          ))}
        </div>
        {isHost ? (
          <button className="btn" onClick={onStart}>
            Start game
          </button>
        ) : (
          <p style={{ color: 'var(--ink-dim)' }}>Waiting for the host to start...</p>
        )}
        <button className="btn btn-secondary" onClick={onLeave}>
          Leave
        </button>
      </div>
    </div>
  );
}
