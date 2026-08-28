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
  /** Mission 8 only: shown as a third option alongside Yield/Play when the ascending mission zone is open. */
  placeInZone?: { canPlace: boolean; requiredValue: number; onPlace: () => void };
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
  placeInZone,
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
      {placeInZone && (
        <button
          className="btn btn-secondary"
          disabled={!placeInZone.canPlace}
          title={`Place a card from the attack that just landed a kill into the mission zone, free — needs a card worth exactly ${placeInZone.requiredValue}`}
          onClick={placeInZone.onPlace}
        >
          Place in Zone
        </button>
      )}
      <button className="btn" disabled={selectedCount === 0 || !!playError} onClick={onPlay}>
        Play
      </button>
    </div>
  );
}
