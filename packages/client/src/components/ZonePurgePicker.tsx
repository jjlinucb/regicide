import { useState } from 'react';
import type { Card } from '@regicide/shared';
import { PlayingCard } from './PlayingCard';

/** Mission 8 only: the Ultimate Banishment window opened by the ascending mission zone's 10-card purge. */
export function ZonePurgePicker({
  discardPile,
  onResolve,
}: {
  discardPile: Card[];
  onResolve: (banishCardIds: string[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function toggle(cardId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  return (
    <div className="jester-picker">
      <span>
        🕊 Ultimate Banishment: the mission zone purged! Pick any cards below to banish forever — the rest shuffles into
        the reserve deck.
      </span>
      <div className="hand-scroll">
        {discardPile.map((card) => (
          <PlayingCard key={card.id} card={card} small selected={selectedIds.has(card.id)} onClick={() => toggle(card.id)} />
        ))}
      </div>
      <div className="jester-picker-choices">
        <button className="btn" onClick={() => onResolve(Array.from(selectedIds))}>
          {selectedIds.size > 0 ? `Banish ${selectedIds.size} card(s) & continue` : 'Banish nothing & continue'}
        </button>
      </div>
    </div>
  );
}
