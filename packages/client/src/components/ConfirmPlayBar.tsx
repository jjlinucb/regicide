import type { ClientGameState } from '@regicide/shared';

interface Props {
  turnPhase: ClientGameState['turnPhase'];
  pendingDamage: number;
  selectedTotal: number;
  selectedCount: number;
  playError: string | null;
  canYield: boolean;
  onPlay: () => void;
  onYield: () => void;
  onDefend: () => void;
  onClear: () => void;
}

export function ConfirmPlayBar({
  turnPhase,
  pendingDamage,
  selectedTotal,
  selectedCount,
  playError,
  canYield,
  onPlay,
  onYield,
  onDefend,
  onClear,
}: Props) {
  if (turnPhase === 'AWAIT_DEFEND') {
    const covered = selectedTotal >= pendingDamage;
    return (
      <div className="confirm-bar">
        <span className="total">
          {selectedTotal} / {pendingDamage} discarded
        </span>
        <span className="spacer" />
        {selectedCount > 0 && (
          <button className="btn btn-secondary" onClick={onClear}>
            Clear
          </button>
        )}
        <button className="btn btn-danger" disabled={selectedCount === 0} onClick={onDefend}>
          {covered ? 'Discard' : 'Discard whole hand?'}
        </button>
      </div>
    );
  }

  return (
    <div className="confirm-bar">
      <span className="total">{selectedCount > 0 ? `Total: ${selectedTotal}${playError ? ` — ${playError}` : ''}` : 'Select cards to play'}</span>
      <span className="spacer" />
      {selectedCount > 0 && (
        <button className="btn btn-secondary" onClick={onClear}>
          Clear
        </button>
      )}
      <button className="btn btn-secondary" disabled={!canYield} onClick={onYield}>
        Yield
      </button>
      <button className="btn" disabled={selectedCount === 0 || !!playError} onClick={onPlay}>
        Play
      </button>
    </div>
  );
}
