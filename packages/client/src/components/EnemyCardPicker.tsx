import type { Card } from '@regicide/shared';
import { PlayingCard } from './PlayingCard';

/**
 * A row of cards from the current enemy's table (not the player's hand) — clicking one immediately chooses it.
 * Used by Mission 6's zone-vengeance sacrifice and Azure Emblem banking, both of which pick from cards already
 * committed to the kill/attack rather than from hand.
 */
export function EnemyCardPicker({ cards, onChoose }: { cards: Card[]; onChoose: (cardId: string) => void }) {
  return (
    <div className="hand-scroll">
      {cards.map((card) => (
        <PlayingCard key={card.id} card={card} small onClick={() => onChoose(card.id)} />
      ))}
    </div>
  );
}
