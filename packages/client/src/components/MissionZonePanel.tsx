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
 * fight" mechanic — missionZone (rolling buff, vengeance tally, ascending chain, banish-pile-fed zone, etc.),
 * the separate pilgrimZone, and the beast deck (Mission 11) — replacing what used to be six different
 * mission-specific prose banners with one real, always-in-the-same-place card display, per the physical game's
 * own dedicated "MISSION ZONE" area on the playmat.
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
    caption = state.rollingZoneCard
      ? `Rolling buff — feeds the enemy +${cardValue(state.rollingZoneCard)} attack until it cycles out next turn.`
      : 'Rolling buff — empty for now.';
  } else if (state.zoneVengeanceOnKill) {
    caption = `Never cleared — strikes the whole party for ${zoneTotal} on the next kill (an exact hit spares the strongest card).`;
  } else if (state.ascendingZone) {
    if (state.zoneClosed) {
      caption = 'Purged and closed for good.';
    } else {
      const top = state.missionZone[state.missionZone.length - 1];
      const needs = top ? cardValue(top) + 1 : 1;
      caption = `Ascending run — needs a ${needs} next. Non-Pilgrim cards here buff the enemy's attack.`;
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
        </div>
      )}
      {state.pilgrimMechanic && (state.pilgrimZone.length > 0 || state.pilgrimDeckCount > 0) && (
        <div className="mission-zone-panel">
          <div className="mission-zone-header">
            <span className="mission-zone-title">🌊 Pilgrims</span>
            <span className="mission-zone-caption">
              {state.pilgrimZone.length > 0
                ? `Combined strength ${state.pilgrimZone.reduce((sum, c) => sum + cardValue(c), 0)} — matching an exact play banishes one; every kill burns that much off the reserve deck.`
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
            <CardPile label="Left" icon="🂠" count={state.beastDeckCount} />
            <CardPile label="Flipped" icon="🦅" cards={state.beastDeckDiscard} emptyLabel="none yet" />
          </div>
        </div>
      )}
    </div>
  );
}
