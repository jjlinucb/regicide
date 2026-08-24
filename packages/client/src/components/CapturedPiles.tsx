import type { ClientCapturedPile } from '@regicide/shared';
import { PlayingCard } from './PlayingCard';

/**
 * Mission 9's 3 captured piles — each shows its face-up card (or "empty") plus a count of what's still
 * face-down underneath. When `onChoosePile` is given, every pile with a face-up card becomes a clickable choice
 * (used for both the end-of-turn rescue and the exact-kill bonus); otherwise it's a passive status display.
 */
export function CapturedPiles({
  piles,
  onChoosePile,
  chooseLabel,
}: {
  piles: ClientCapturedPile[];
  onChoosePile?: (pileIndex: number) => void;
  chooseLabel?: string;
}) {
  return (
    <div className="captured-piles-row">
      {piles.map((pile, i) => (
        <div className="captured-pile" key={i}>
          {pile.faceUp ? (
            <PlayingCard card={pile.faceUp} small onClick={onChoosePile ? () => onChoosePile(i) : undefined} />
          ) : (
            <div className="captured-pile-empty">empty</div>
          )}
          <span className="captured-pile-count">
            {pile.faceDownCount} card{pile.faceDownCount === 1 ? '' : 's'} face-down
          </span>
          {onChoosePile && pile.faceUp && (
            <button type="button" className="btn btn-secondary" onClick={() => onChoosePile(i)}>
              {chooseLabel ?? 'Choose'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
