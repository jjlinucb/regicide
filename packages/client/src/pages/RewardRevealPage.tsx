import { CLASS_THEME, getMission } from '@regicide/shared';

export function RewardRevealPage({ missionId, onContinue }: { missionId: number; onContinue: () => void }) {
  const mission = getMission(missionId);
  if (!mission) return null;

  return (
    <div className="centered-page">
      <h1>Mission Complete!</h1>
      <p style={{ color: 'var(--ink-dim)' }}>{mission.title}</p>
      <div className="panel legacy-panel">
        {/* Mission 10's reward is a DEPARTURE, not a recruit (see shared party.ts's MissionReward.removeCardByName):
            Goran leaves the party for good. Said out loud here — the panel used to promise "new recruits" and then
            show an empty list for any mission that grants none, which reads as a reward that didn't happen. */}
        {mission.reward.removeCardByName && (
          <p>
            <strong>{mission.reward.removeCardByName}</strong> leaves the Golden Blade Syndicate — permanently.
          </p>
        )}
        {mission.reward.recruits.length > 0 && <p>New recruits join the Golden Blade Syndicate:</p>}
        <div className="legacy-recruit-list">
          {mission.reward.recruits.map((r) => {
            const cls = CLASS_THEME[r.class];
            // Mission 5's Myla, sourced fix: a named recruit whose class power never resolves (SuitedCard.noSuitPower) —
            // shown plainly rather than under a class glyph/color it doesn't actually carry into play.
            return (
              <div key={r.name} className="legacy-recruit-chip" style={{ borderColor: r.noSuitPower ? 'var(--ink-dim)' : cls.color }}>
                <span className="legacy-recruit-glyph" style={{ background: r.noSuitPower ? 'var(--ink-dim)' : cls.color }}>
                  {r.noSuitPower ? '—' : cls.glyph}
                </span>
                <span>
                  <strong>{r.name}</strong>
                  <br />
                  {r.noSuitPower ? 'No ability' : cls.name} · strength {r.rank}
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
