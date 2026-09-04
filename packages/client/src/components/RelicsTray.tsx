import { relicActive, type ClientGameState } from '@regicide/shared';

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
        const held = state.relics.includes(id);
        // Held but inert — Mission 9 starts with the Evergreen Mother like this (see missions.ts). Shown with
        // the same 🥀 badge and black thorny border a corrupted CARD gets, so the two read as the same idea.
        const corrupted = held && !relicActive(state, id);
        const sub = corrupted
          ? 'corrupted — no effect until cleansed'
          : id === 'KINFOLK_FLUTE' && held
            ? myKinfolkSlot
              ? '1 card banked'
              : 'slot empty'
            : held
              ? 'earned'
              : 'not yet earned';
        return (
          <span
            key={id}
            className={`relic-chip${held ? ' filled' : ' empty'}${corrupted ? ' corrupted' : ''}`}
            title={`${RELIC_INFO[id].name} — ${sub}`}
          >
            <span className="relic-glyph">{RELIC_INFO[id].glyph}</span>
            {RELIC_INFO[id].name}
            {corrupted && <span className="relic-corrupted-badge" aria-label="corrupted">🥀</span>}
          </span>
        );
      })}
    </div>
  );
}
