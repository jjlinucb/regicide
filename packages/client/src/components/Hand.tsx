import { isSuitBlockedByImmunity, type Card, type EnemyState } from '@regicide/shared';
import { PlayingCard } from './PlayingCard';

function isBlocked(card: Card, enemy?: EnemyState | null): boolean {
  // A Mage's arcane bolt and a Reaver's reserve-tear aren't suit powers, so enemy suit immunity never blocks
  // them (see engine.ts's resolveArcaneBolts / resolveCommittedPlay's reaverCards handling).
  if (card.kind !== 'suited' || card.arcane || card.reaver) return false;
  return Boolean(enemy) && isSuitBlockedByImmunity(card.suit, enemy!);
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
