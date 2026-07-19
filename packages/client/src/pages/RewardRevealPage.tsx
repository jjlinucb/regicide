import { CLASS_THEME, getMission } from '@regicide/shared';

export function RewardRevealPage({ missionId, onContinue }: { missionId: number; onContinue: () => void }) {
  const mission = getMission(missionId);
  if (!mission) return null;

  return (
    <div className="centered-page">
      <h1>Mission Complete!</h1>
      <p style={{ color: 'var(--ink-dim)' }}>{mission.title}</p>
      <div className="panel legacy-panel">
        <p>New recruits join the Golden Blade Syndicate:</p>
        <div className="legacy-recruit-list">
          {mission.reward.recruits.map((r) => {
            const cls = CLASS_THEME[r.class];
            return (
              <div key={r.name} className="legacy-recruit-chip" style={{ borderColor: cls.color }}>
                <span className="legacy-recruit-glyph" style={{ background: cls.color }}>
                  {cls.glyph}
                </span>
                <span>
                  <strong>{r.name}</strong>
                  <br />
                  {cls.name} · strength {r.rank}
                </span>
              </div>
            );
          })}
        </div>
        <button className="btn" onClick={onContinue}>
          Continue
        </button>
      </div>
    </div>
  );
}
