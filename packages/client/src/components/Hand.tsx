import type { Card } from '@regicide/shared';
import { PlayingCard } from './PlayingCard';

export function Hand({
  cards,
  selectedIds,
  onToggle,
  interactive,
}: {
  cards: Card[];
  selectedIds: Set<string>;
  onToggle: (cardId: string) => void;
  interactive: boolean;
}) {
  return (
    <div className="hand-scroll">
      {cards.map((card) => (
        <PlayingCard
          key={card.id}
          card={card}
          selected={selectedIds.has(card.id)}
          onClick={interactive ? () => onToggle(card.id) : undefined}
        />
      ))}
    </div>
  );
}
