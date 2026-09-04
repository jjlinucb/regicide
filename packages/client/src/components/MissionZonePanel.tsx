import type { Card, ClientGameState } from '@regicide/shared';
import { cardValue } from '@regicide/shared';
import { PlayingCard } from './PlayingCard';
import { CardPile } from './CardPile';

function ZoneCardRow({
  cards,
  placeableCardId,
  onPlaceInZone,
}: {
  cards: Card[];
  /** The one zoneCommittedPlay card (if any) that currently fills the ascending zone's next slot — see GamePage's placeableZoneCard. */
  placeableCardId?: string | null;
  onPlaceInZone?: (cardId: string) => void;
}) {
  if (cards.length === 0) return <span className="mission-zone-empty">empty</span>;
  return (
    <div className="mission-zone-cards">
      {cards.map((c) => (
        <PlayingCard
          key={c.id}
          card={c}
          small
          onClick={onPlaceInZone && c.id === placeableCardId ? () => onPlaceInZone(c.id) : undefined}
        />
      ))}
    </div>
  );
}

/**
 * One visual home for every mission's "shared pile of cards sitting on the table doing something to the
 * fight" mechanic — missionZone (rolling buff, vengeance tally, ascending chain, banish-pile-fed zone, etc.)
 * the separate pilgrimZone (Mission 7), and the beast deck (Mission 11) — replacing what used to be six
 * different mission-specific prose banners with one real, always-in-the-same-place card display, per the physical
 * game's own dedicated "MISSION ZONE" area on the playmat.
 */
export function MissionZonePanel({
  state,
  placeableCardId,
  onPlaceInZone,
}: {
  state: ClientGameState;
  /** See GamePage's placeableZoneCard/canPlaceInZone — null/undefined when no placement is currently legal. */
  placeableCardId?: string | null;
  onPlaceInZone?: (cardId: string) => void;
}) {
  // Mission 5's rolling zone (see GameState.rollingZoneCards) is a separate pile from the static missionZone every
  // other zone mode uses — render whichever one this mission actually feeds, so the card row matches the caption's
  // own total instead of always reading the (permanently empty, for this mission) missionZone.
  const displayedZoneCards = state.rollingZoneBonus ? state.rollingZoneCards : state.missionZone;
  const zoneTotal = displayedZoneCards.reduce((sum, c) => sum + cardValue(c), 0);
  const showMissionZone =
    displayedZoneCards.length > 0 ||
    state.rollingZoneBonus ||
    state.zoneVengeanceOnKill ||
    (state.ascendingZone && !state.zoneClosed);

  let caption: string | null = null;
  if (state.rollingZoneBonus) {
    const rollingTotal = state.rollingZoneCards.reduce((sum, c) => sum + cardValue(c), 0);
    caption =
      state.rollingZoneCards.length > 0
        ? `Recycled from the banish pile — feeds the enemy +${rollingTotal} attack until the next kill resets it.`
        : 'Rolling buff — empty for now.';
  } else if (state.zoneVengeanceOnKill) {
    caption = `Never cleared — strikes the whole party for ${zoneTotal} on the next kill (an exact hit spares the strongest card).`;
  } else if (state.ascendingZone) {
    if (state.zoneClosed) {
      caption = 'Purged and closed for good.';
    } else {
      // Required value is tracked by POSITION (length + 1), not the top card's own printed value — the
      // mission's "2/5" wildcard can fill an out-of-order slot (see rules.ts's matchesAscendingZoneSlot).
      const needs = state.missionZone.length + 1;
      caption = `Ascending run — needs a ${needs} next, free from the attack that just landed a kill. Non-Pilgrim cards here buff the enemy's attack.`;
    }
  } else if (state.missionZone.length > 0) {
    caption = `Feeds the enemy +${zoneTotal} attack and matching immunity.`;
  }

  return (
    <div className="mission-zone-panels">
      {!showMissionZone && !state.beastDeckMechanic && !state.pilgrimMechanic && (
        <div className="mission-zone-panel empty">
          <div className="mission-zone-header">
            <span className="mission-zone-title">Mission Zone</span>
            <span className="mission-zone-caption">Not active this mission.</span>
          </div>
        </div>
      )}
      {showMissionZone && (
        <div className="mission-zone-panel">
          <div className="mission-zone-header">
            <span className="mission-zone-title">🏔 Mission Zone</span>
            {caption && <span className="mission-zone-caption">{caption}</span>}
          </div>
          <ZoneCardRow cards={displayedZoneCards} />
          {state.ascendingZone && state.zoneCommittedPlay.length > 0 && (
            <div className="mission-zone-header">
              <span className="mission-zone-caption">
                Free from the kill just landed — place one below instead of attacking, at no extra cost:
              </span>
            </div>
          )}
          {state.ascendingZone && state.zoneCommittedPlay.length > 0 && (
            <ZoneCardRow cards={state.zoneCommittedPlay} placeableCardId={placeableCardId} onPlaceInZone={onPlaceInZone} />
          )}
        </div>
      )}
      {state.pilgrimMechanic && (state.pilgrimZone.length > 0 || state.pilgrimDeckCount > 0) && (
        <div className="mission-zone-panel">
          <div className="mission-zone-header">
            <span className="mission-zone-title">🌊 Pilgrims</span>
            <span className="mission-zone-caption">
              {state.pilgrimZone.length > 0
                ? `Combined strength ${state.pilgrimZone.reduce((sum, c) => sum + cardValue(c), 0)} — every card you play banishes a Pilgrim of the same value; the next kill burns whatever is left off the reserve deck, then clears the zone.`
                : `${state.pilgrimDeckCount} left in the pilgrim deck.`}
            </span>
          </div>
          <ZoneCardRow cards={state.pilgrimZone} />
        </div>
      )}
      {state.beastDeckMechanic && (
        <div className="mission-zone-panel">
          <div className="mission-zone-header">
            <span className="mission-zone-title">🦅 Beast Deck</span>
            <span className="mission-zone-caption">Flips one card at the start of each turn for a one-shot effect.</span>
          </div>
          <div className="mission-zone-beast-row">
            <CardPile label="Left" count={state.beastDeckCount} />
            <CardPile label="Flipped" cards={state.beastDeckDiscard} emptyLabel="none yet" />
          </div>
        </div>
      )}
    </div>
  );
}
