import { isSuitBlockedByImmunity, type Card, type EnemyState } from '@regicide/shared';
import { PlayingCard } from './PlayingCard';

function isBlocked(card: Card, enemy?: EnemyState | null): boolean {
  return card.kind === 'suited' && Boolean(enemy) && isSuitBlockedByImmunity(card.suit, enemy!);
}

export function Hand({
  cards,
  selectedIds,
  onToggle,
  interactive,
  enemy,
}: {
  cards: Card[];
  selectedIds: Set<string>;
  onToggle: (cardId: string) => void;
  interactive: boolean;
  enemy?: EnemyState | null;
}) {
  return (
    <div className="hand-scroll">
      {cards.map((card) => (
        <PlayingCard
          key={card.id}
          card={card}
          selected={selectedIds.has(card.id)}
          onClick={interactive ? () => onToggle(card.id) : undefined}
          blocked={isBlocked(card, enemy)}
        />
      ))}
    </div>
  );
}
