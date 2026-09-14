import type { ClientGameState } from '@regicide/shared';
import { ClassIcon, type GameIconId } from './ClassIcon';

// The Kinfolk Flute took the feather glyph before the Druid class existed; the Druid's own card is a feather in
// the physical game (see legacy/classes.ts's DRUID), so the flute gets an actual flute and the feather is the
// Druid's alone.
//
// The two Evergreen Mothers are SEPARATE RELICS, not one relic in two states: the Corrupted Evergreen Mother is
// the weaker tier Mission 9 hands over and keeps for the rest of the campaign. The healed Evergreen Mother is
// listed here but NO MISSION GRANTS IT — John hasn't said where the relic heals (see legacy/missions.ts's
// Mission 9), so its chip stays permanently "not in play" for now. Kept visible on purpose: the tray shows every
// relic the campaign can hold, held or not. Nothing here is ever "switched off" — a relic is in play or it isn't.
const RELIC_INFO: Record<string, { icon: GameIconId; name: string }> = {
  KINFOLK_FLUTE: { icon: 'FLUTE', name: 'Kinfolk Flute' },
  SCARLET_WHISTLE: { icon: 'WHISTLE', name: 'Scarlet Whistle' },
  AZURE_EMBLEM: { icon: 'EMBLEM', name: 'Azure Emblem' },
  CORRUPTED_EVERGREEN_MOTHER: { icon: 'CORRUPTED', name: 'Corrupted Evergreen Mother' },
  EVERGREEN_MOTHER: { icon: 'EVERGREEN', name: 'Evergreen Mother' },
};

const ALL_RELIC_IDS = Object.keys(RELIC_INFO);

/** Legacy-only: a persistent tray of every relic the campaign can hold, filled in once GameState.relics has it. */
export function RelicsTray({ state, myPlayerId }: { state: ClientGameState; myPlayerId: string }) {
  const myKinfolkSlot = state.players.find((p) => p.id === myPlayerId)?.kinfolkSlot ?? null;

  return (
    <div className="relic-row">
      {ALL_RELIC_IDS.map((id) => {
        const held = state.relics.includes(id);
        const sub =
          id === 'KINFOLK_FLUTE' && held
            ? myKinfolkSlot
              ? '1 card banked'
              : 'slot empty'
            : held
              ? 'in play'
              : 'not in play';
        return (
          <span key={id} className={`relic-chip${held ? ' filled' : ' empty'}`} title={`${RELIC_INFO[id].name} — ${sub}`}>
            <span className="relic-glyph"><ClassIcon id={RELIC_INFO[id].icon} /></span>
            {RELIC_INFO[id].name}
          </span>
        );
      })}
    </div>
  );
}
