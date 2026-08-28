import type { Card, ClientGameState } from '@regicide/shared';
import { cardValue } from '@regicide/shared';
import { PlayingCard } from './PlayingCard';
import { CardPile } from './CardPile';

function ZoneCardRow({ cards }: { cards: Card[] }) {
  if (cards.length === 0) return <span className="mission-zone-empty">empty</span>;
  return (
    <div className="mission-zone-cards">
      {cards.map((c) => (
        <PlayingCard key={c.id} card={c} small />
      ))}
    </div>
  );
}

/**
 * One visual home for every mission's "shared pile of cards sitting on the table doing something to the
 * fight" mechanic — missionZone (rolling buff, vengeance tally, ascending chain, banish-pile-fed zone, etc.)
 * and the beast deck (Mission 11) — replacing what used to be six different mission-specific prose banners with
 * one real, always-in-the-same-place card display, per the physical game's own dedicated "MISSION ZONE" area on
 * the playmat. Mission 7's Pilgrims no longer get their own panel here — they're a hand-trap now (see
 * GameState.pilgrimMechanic), sitting in the owning player's own hand rather than any shared zone.
 */
export function MissionZonePanel({ state }: { state: ClientGameState }) {
  const zoneTotal = state.missionZone.reduce((sum, c) => sum + cardValue(c), 0);
  const showMissionZone =
    state.missionZone.length > 0 ||
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
      {showMissionZone && (
        <div className="mission-zone-panel">
          <div className="mission-zone-header">
            <span className="mission-zone-title">🏔 Mission Zone</span>
            {caption && <span className="mission-zone-caption">{caption}</span>}
          </div>
          <ZoneCardRow cards={state.missionZone} />
          {state.ascendingZone && state.zoneCommittedPlay.length > 0 && (
            <div className="mission-zone-header">
              <span className="mission-zone-caption">
                Free from the kill just landed — place one below instead of attacking, at no extra cost:
              </span>
            </div>
          )}
          {state.ascendingZone && state.zoneCommittedPlay.length > 0 && <ZoneCardRow cards={state.zoneCommittedPlay} />}
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
