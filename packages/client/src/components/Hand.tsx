import { isSuitBlockedByImmunity, type Card, type EnemyState } from '@regicide/shared';
import { PlayingCard } from './PlayingCard';

function isBlocked(card: Card, enemy?: EnemyState | null): boolean {
  // A Mage's arcane bolt, a Reaver's reserve-tear, a Guardian's permanent shield, and a Chanter's chant window
  // aren't suit powers, so enemy suit immunity never blocks them (see engine.ts's resolveArcaneBolts /
  // resolveCommittedPlay's reaverCards/guardianCards/chanterCards handling).
  if (card.kind !== 'suited' || card.arcane || card.reaver || card.guardian || card.chanter) return false;
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
