import { MISSIONS } from '@regicide/shared';
import { EnemyTracker, trackerWaves } from './components/EnemyTracker';

/** Private visual checklist at ?preview=trackers — every live playmat tracker in one place, with Mission 11 on Goran. */
export function TrackerPreview() {
  return (
    <main className="card-preview tracker-preview">
      <h1 className="card-preview-title">Mission enemy trackers</h1>
      <p className="card-preview-intro">Each tracker is the same compact component used beneath the active enemy on the Legacy playmat.</p>
      <div className="playmat-shell legacy-playmat tracker-preview-playmat">
        <div className="tracker-preview-grid">
          {MISSIONS.map((mission) => {
            const total = trackerWaves(mission.id).reduce((sum, wave) => sum + wave.enemies.length, 0);
            const remaining = mission.id === 11 ? 1 : Math.max(1, total - 2);
            return (
              <section className="tracker-preview-item" key={mission.id}>
                <h2>Mission {mission.id}</h2>
                <p>{mission.title}</p>
                <EnemyTracker missionId={mission.id} remaining={remaining} currentEnemyName={mission.id === 11 ? 'Evil Goran' : undefined} />
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
