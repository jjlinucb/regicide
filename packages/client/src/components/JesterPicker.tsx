import type { ClientGameState } from '@regicide/shared';

export function JesterPicker({
  state,
  myPlayerId,
  onChoose,
  onCancel,
}: {
  state: ClientGameState;
  myPlayerId: string;
  onChoose: (playerId: string) => void;
  onCancel: () => void;
}) {
  const others = state.players.filter((p) => p.connected || p.id === myPlayerId);
  return (
    <div className="jester-picker">
      <span>The Jester breaks enemy immunity — who goes next?</span>
      <div className="jester-picker-choices">
        {others.map((p) => (
          <button key={p.id} className="btn btn-secondary" onClick={() => onChoose(p.id)}>
            {p.id === myPlayerId ? 'You' : p.name}
          </button>
        ))}
      </div>
      <button className="btn-secondary btn" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
