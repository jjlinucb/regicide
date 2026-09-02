import { isSuitBlockedByImmunity, type Card, type EnemyState, type Suit } from '@regicide/shared';
import { PlayingCard } from './PlayingCard';

function isBlocked(card: Card, enemy: EnemyState | null | undefined, zoneImmuneSuits: Suit[]): boolean {
  // A Mage's arcane bolt, a Reaver's reserve-tear, a Guardian's permanent shield, a Druid's Regrowth, a
  // Chanter's chant window, Gøran's Evergreen, and a Mercenary "19" (see SuitedCard.noSuitPower) either aren't
  // suit powers, always ignore immunity outright, or never resolve a suit power at all — so enemy suit immunity
  // never blocks them (see engine.ts's resolveArcaneBolts / resolveCommittedPlay's
  // reaverCards/guardianCards/druidCards/chanterCards/evergreenActive/nonArcaneCards handling). A corrupted or
  // restored card's own suit power ignores immunity too, at its usual banish/heal cost (see SuitedCard.corrupted/
  // .restored, engine.ts's immunityIgnoringSuits) — so it's never actually a "No effect" play either.
  if (
    card.kind !== 'suited' ||
    card.arcane ||
    card.reaver ||
    card.guardian ||
    card.druid ||
    card.chanter ||
    card.evergreen ||
    card.noSuitPower ||
    card.corrupted ||
    card.restored
  )
    return false;
  if (!enemy || enemy.immunityBroken) return false;
  // Enemy immunity also comes from the mission zone (e.g. Mission 6's Myla flip), not just the enemy's own
  // suit(s) — see engine.ts's resolveSuitPowers, whose blocked() check ORs in state.zoneImmuneSuits the same way.
  return isSuitBlockedByImmunity(card.suit, enemy) || zoneImmuneSuits.includes(card.suit);
}

export function Hand({
  cards,
  selectedIds,
  onToggle,
  interactive,
  enemy,
  zoneImmuneSuits,
}: {
  cards: Card[];
  selectedIds: Set<string>;
  onToggle: (cardId: string) => void;
  interactive: boolean;
  enemy?: EnemyState | null;
  zoneImmuneSuits?: Suit[];
}) {
  return (
    <div className="hand-scroll">
      {cards.map((card) => (
        <PlayingCard
          key={card.id}
          card={card}
          selected={selectedIds.has(card.id)}
          onClick={interactive ? () => onToggle(card.id) : undefined}
          blocked={isBlocked(card, enemy, zoneImmuneSuits ?? [])}
        />
      ))}
    </div>
  );
}
