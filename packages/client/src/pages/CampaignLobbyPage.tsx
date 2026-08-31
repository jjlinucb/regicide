import { useState } from 'react';
import { MISSIONS, reaverStickerEligible } from '@regicide/shared';
import type { LegacySavePayload, LegacyStatePayload, MercenaryTypeId, RoomStatePayload } from '@regicide/shared';
import { MercenaryCamp } from '../components/MercenaryCamp';
import { BeastCompanionPicker } from '../components/BeastCompanionPicker';
import { ReaverStickerPicker } from '../components/ReaverStickerPicker';

/** Downloads the campaign's current progress as a JSON save file — a local backup independent of server persistence. */
function downloadSave(legacyState: LegacyStatePayload): void {
  const save: LegacySavePayload = {
    party: legacyState.party,
    missionsCompleted: legacyState.missionsCompleted,
    currentMission: legacyState.currentMission,
    permanentRules: legacyState.permanentRules,
    beastCompanionPool: legacyState.beastCompanionPool,
    selectedBeastCompanionId: legacyState.selectedBeastCompanionId,
  };
  const blob = new Blob([JSON.stringify(save, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `regicide-legacy-${legacyState.campaignCode}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function CampaignLobbyPage({
  roomState,
  legacyState,
  myPlayerId,
  onStartMission,
  onSetMercenaryLoadout,
  onSetBeastCompanionSelection,
  onChooseReaverSticker,
  onLeave,
}: {
  roomState: RoomStatePayload;
  legacyState: LegacyStatePayload;
  myPlayerId: string;
  onStartMission: (missionId: number, stopForPendingChoices?: boolean) => void;
  onSetMercenaryLoadout: (loadout: Partial<Record<MercenaryTypeId, number>>) => Promise<{ ok: true } | { ok: false; error: string }>;
  onSetBeastCompanionSelection: (cardId: string | null) => Promise<{ ok: true } | { ok: false; error: string }>;
  onChooseReaverSticker: (cardId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  onLeave: () => void;
}) {
  const isHost = roomState.players.find((p) => p.id === myPlayerId)?.isHost ?? false;
  // Mission 5's reward, sourced fix: a one-time player choice, unlike the Mage/Guardian stickers (auto-applied at
  // random). No dedicated "pending" field exists for it — derived the same way RoomManager's chooseReaverSticker
  // validates it server-side: has any completed mission granted it, and has nobody used it yet.
  const reaverStickerGranted = MISSIONS.some((m) => legacyState.missionsCompleted.includes(m.id) && m.reward.reaverStickerChoice);
  const reaverStickerUsed = legacyState.party.some((c) => c.kind === 'suited' && c.secondClassReaver);
  const reaverStickerEligibleCards = legacyState.party.filter(reaverStickerEligible);
  // MISSIONS.length is not the highest built mission id — the list currently has a gap (Mission 7 isn't in yet),
  // so "all missions complete" must compare against the actual max id, not the array's count.
  const maxMissionId = Math.max(...MISSIONS.map((m) => m.id));
  const currentMission = MISSIONS.find((m) => m.id === legacyState.currentMission);
  const [selectedMissionId, setSelectedMissionId] = useState(legacyState.currentMission);
  const selectedMission = MISSIONS.find((m) => m.id === selectedMissionId) ?? currentMission;
  // Mirrors RoomManager.startLegacyMission's own crossing check, purely to word the "Jumping ahead" note — the
  // server is the one that actually decides whether to stop (see its stopForPendingChoices handling).
  const jumpIntroducesPendingChoice =
    selectedMission != null &&
    selectedMission.id > legacyState.currentMission &&
    MISSIONS.some(
      (m) =>
        m.id >= legacyState.currentMission &&
        m.id < selectedMission.id &&
        (m.reward.recruits.some((r) => r.beast) || m.reward.reaverStickerChoice),
    );

  return (
    <div className="centered-page">
      <h1>Regicide Legacy</h1>
      <p>Share this code with up to 3 friends — it's permanent, so you can resume this campaign anytime:</p>
      <div className="room-code">{legacyState.campaignCode}</div>
      <div className="panel legacy-panel">
        <div className="player-chip-list">
          {roomState.players.map((p) => (
            <div key={p.id} className="player-chip">
              <span className={`dot${p.connected ? '' : ' offline'}`} />
              <span>
                {p.id === myPlayerId ? 'You' : p.name}
                {p.isHost ? ' (host)' : ''}
              </span>
            </div>
          ))}
        </div>

        <div className="legacy-party-summary">
          <strong>Golden Blade Syndicate:</strong> {legacyState.party.length} members
        </div>

        <div className="legacy-mission-list">
          {MISSIONS.map((m) => {
            const done = legacyState.missionsCompleted.includes(m.id);
            const isCurrent = m.id === legacyState.currentMission;
            const isSelected = m.id === selectedMissionId;
            return (
              <button
                key={m.id}
                type="button"
                className={`legacy-mission-row${done ? ' done' : ''}${isCurrent ? ' current' : ''}${isSelected ? ' selected' : ''}`}
                onClick={() => setSelectedMissionId(m.id)}
              >
                <span className="legacy-mission-num">{m.id}</span>
                <span className="legacy-mission-title">{m.title}</span>
                <span className="legacy-mission-status">{done ? '✓' : '▶'}</span>
              </button>
            );
          })}
          {legacyState.currentMission > maxMissionId && (
            <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', margin: 0 }}>
              🎉 All {MISSIONS.length} built missions are complete — more are on the way. Pick any of them below to replay.
            </p>
          )}
        </div>

        {legacyState.mercenaryProgress && legacyState.mercenaryProgress.missionId === legacyState.currentMission && (
          <MercenaryCamp progress={legacyState.mercenaryProgress} isHost={isHost} onSave={onSetMercenaryLoadout} />
        )}

        {legacyState.beastCompanionPool.length > 0 && !selectedMission?.beastDeckMechanic && (
          <BeastCompanionPicker
            pool={legacyState.beastCompanionPool}
            selectedId={legacyState.selectedBeastCompanionId}
            isHost={isHost}
            onSave={onSetBeastCompanionSelection}
          />
        )}

        {reaverStickerGranted && !reaverStickerUsed && reaverStickerEligibleCards.length > 0 && (
          <ReaverStickerPicker eligible={reaverStickerEligibleCards} isHost={isHost} onChoose={onChooseReaverSticker} />
        )}

        {selectedMission && (
          <div className="legacy-mission-brief">
            <h3>{selectedMission.title}</h3>
            <p>{selectedMission.story}</p>
            {selectedMission.id > legacyState.currentMission && (
              <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
                Jumping ahead — the rewards for mission{selectedMission.id - legacyState.currentMission > 1 ? 's' : ''}{' '}
                {legacyState.currentMission}–{selectedMission.id - 1} will be granted automatically first.
                {/* BUG FIX: a jump that crosses Mission 4 or 5's reward now stops right after granting instead of
                    launching straight into the target mission, so the Beast Companion / Reaver sticker picker
                    below actually gets a chance to render before gameplay begins — click again once you're ready
                    (see RoomManager.startLegacyMission's stopForPendingChoices). */}
                {jumpIntroducesPendingChoice &&
                  ' This jump also grants a Beast Companion or Reaver sticker pick — clicking below will stop here first so you can choose, then click again to actually begin.'}
              </p>
            )}
            {isHost ? (
              <button className="btn" onClick={() => onStartMission(selectedMission.id, true)}>
                {selectedMission.id > legacyState.currentMission ? 'Jump to' : 'Begin'} Mission {selectedMission.id}
              </button>
            ) : (
              <p style={{ color: 'var(--ink-dim)' }}>Waiting for the host to start the mission...</p>
            )}
          </div>
        )}

        <button className="btn btn-secondary" onClick={() => downloadSave(legacyState)}>
          Download Save
        </button>
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', margin: 0 }}>
          Grabs your party and mission progress as a JSON file — keep it as a backup, or use "Restore from a save"
          on the home screen to pick up your campaign anywhere.
        </p>

        <button className="btn btn-secondary" onClick={onLeave}>
          Leave
        </button>
      </div>
    </div>
  );
}
