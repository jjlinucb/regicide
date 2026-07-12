import type { ClientGameState } from '@regicide/shared';

interface Props {
  turnPhase: ClientGameState['turnPhase'];
  pendingDamage: number;
  selectedTotal: number;
  selectedCount: number;
  handSize: number;
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
  handSize,
  playError,
  canYield,
  onPlay,
  onYield,
  onDefend,
  onClear,
}: Props) {
  if (turnPhase === 'AWAIT_DEFEND') {
    const covered = selectedTotal >= pendingDamage;
    const wholeHandSelected = selectedCount === handSize;
    // A player with an empty hand has nothing to select, but still needs to be able to
    // submit "discard nothing" so the engine can register that they can't cover the damage.
    const canSubmit = covered || wholeHandSelected;
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
        <button className="btn btn-danger" disabled={!canSubmit} onClick={onDefend}>
          {covered ? 'Discard' : handSize === 0 ? 'Discard (empty hand)' : 'Discard whole hand?'}
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
