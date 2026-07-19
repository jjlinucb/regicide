import { MISSIONS } from '@regicide/shared';
import type { LegacyStatePayload, RoomStatePayload } from '@regicide/shared';

export function CampaignLobbyPage({
  roomState,
  legacyState,
  myPlayerId,
  onStartMission,
  onLeave,
}: {
  roomState: RoomStatePayload;
  legacyState: LegacyStatePayload;
  myPlayerId: string;
  onStartMission: (missionId: number) => void;
  onLeave: () => void;
}) {
  const isHost = roomState.players.find((p) => p.id === myPlayerId)?.isHost ?? false;
  const currentMission = MISSIONS.find((m) => m.id === legacyState.currentMission);
  const campaignComplete = !currentMission;

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
            const locked = m.id > legacyState.currentMission;
            return (
              <div key={m.id} className={`legacy-mission-row${done ? ' done' : ''}${isCurrent ? ' current' : ''}${locked ? ' locked' : ''}`}>
                <span className="legacy-mission-num">{m.id}</span>
                <span className="legacy-mission-title">{m.title}</span>
                <span className="legacy-mission-status">{done ? '✓' : locked ? '🔒' : '▶'}</span>
              </div>
            );
          })}
        </div>

        {campaignComplete ? (
          <p>🎉 Campaign complete — every mission has been won!</p>
        ) : (
          <div className="legacy-mission-brief">
            <h3>{currentMission.title}</h3>
            <p>{currentMission.story}</p>
            {isHost ? (
              <button className="btn" onClick={() => onStartMission(currentMission.id)}>
                Begin Mission {currentMission.id}
              </button>
            ) : (
              <p style={{ color: 'var(--ink-dim)' }}>Waiting for the host to start the mission...</p>
            )}
          </div>
        )}

        <button className="btn btn-secondary" onClick={onLeave}>
          Leave
        </button>
      </div>
    </div>
  );
}
