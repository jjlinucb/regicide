import type { ClientGameState } from '@regicide/shared';

// The Kinfolk Flute took the feather glyph before the Druid class existed; the Druid's own card is a feather in
// the physical game (see legacy/classes.ts's DRUID), so the flute gets an actual flute and the feather is the
// Druid's alone.
const RELIC_INFO: Record<string, { glyph: string; name: string }> = {
  KINFOLK_FLUTE: { glyph: '🪈', name: 'Kinfolk Flute' },
  SCARLET_WHISTLE: { glyph: '🎗️', name: 'Scarlet Whistle' },
  AZURE_EMBLEM: { glyph: '🔷', name: 'Azure Emblem' },
  EVERGREEN_MOTHER: { glyph: '🌲', name: 'Evergreen Mother' },
};

const ALL_RELIC_IDS = Object.keys(RELIC_INFO);

/** Legacy-only: a persistent tray of every relic the campaign can earn, filled in once GameState.relics has it. */
export function RelicsTray({ state, myPlayerId }: { state: ClientGameState; myPlayerId: string }) {
  const myKinfolkSlot = state.players.find((p) => p.id === myPlayerId)?.kinfolkSlot ?? null;

  return (
    <div className="relic-row">
      {ALL_RELIC_IDS.map((id) => {
        const earned = state.relics.includes(id);
        const sub = id === 'KINFOLK_FLUTE' && earned ? (myKinfolkSlot ? '1 card banked' : 'slot empty') : earned ? 'earned' : 'not yet earned';
        return (
          <span key={id} className={`relic-chip${earned ? ' filled' : ' empty'}`} title={`${RELIC_INFO[id].name} — ${sub}`}>
            <span className="relic-glyph">{RELIC_INFO[id].glyph}</span>
            {RELIC_INFO[id].name}
          </span>
        );
      })}
    </div>
  );
}
