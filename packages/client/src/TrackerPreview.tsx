import { CLASS_THEME, getMission, MISSIONS, type DefeatedLegacyEnemy, type MissionEnemySpec } from '@regicide/shared';
import { EnemyTracker } from './components/EnemyTracker';

function trackerIdentity(enemy: MissionEnemySpec): DefeatedLegacyEnemy {
  return {
    suit: CLASS_THEME[enemy.class].suit ?? 'C',
    secondSuit: enemy.secondClass ? CLASS_THEME[enemy.secondClass].suit : undefined,
    noClass: enemy.noClass,
    rank: 'J',
    rankLabel: enemy.rankLabel,
    name: enemy.name,
    maxHealth: enemy.health,
    baseAttack: enemy.attack,
  };
}

function previewTrackerState(missionId: number): { defeatedEnemies: DefeatedLegacyEnemy[]; currentEnemy: DefeatedLegacyEnemy | null } {
  if (missionId === 1) {
    return {
      defeatedEnemies: [{ suit: 'C', rank: 'J', maxHealth: 20, baseAttack: 10 }],
      currentEnemy: { suit: 'H', rank: 'J', maxHealth: 20, baseAttack: 10 },
    };
  }
  if (missionId === 10) {
    const anonymousEnemy = { suit: 'C' as const, rank: 'J' as const, maxHealth: 30, baseAttack: 6 };
    return { defeatedEnemies: [anonymousEnemy, anonymousEnemy], currentEnemy: anonymousEnemy };
  }

  const mission = getMission(missionId);
  if (!mission) return { defeatedEnemies: [], currentEnemy: null };
  if (missionId === 2) {
    // Deliberately non-sequential: the brood is shuffled, so the visual proof needs to show specific heads
    // crossed off in their fixed tracker layout rather than the first two circles fading in order.
    return {
      defeatedEnemies: [trackerIdentity(mission.enemies[3]), trackerIdentity(mission.enemies[0])],
      currentEnemy: trackerIdentity(mission.enemies[5]),
    };
  }
  const currentIndex = missionId === 11 ? 4 : Math.min(2, mission.enemies.length - 1);
  return {
    defeatedEnemies: mission.enemies.slice(0, currentIndex).map(trackerIdentity),
    currentEnemy: mission.enemies[currentIndex] ? trackerIdentity(mission.enemies[currentIndex]) : null,
  };
}

/** Private visual checklist at ?preview=trackers — every live playmat tracker in one place, with Mission 11 on Goran. */
export function TrackerPreview() {
  return (
    <main className="card-preview tracker-preview">
      <h1 className="card-preview-title">Mission enemy trackers</h1>
      <p className="card-preview-intro">Each tracker is the same compact component used beneath the active enemy on the Legacy playmat.</p>
      <div className="playmat-shell legacy-playmat tracker-preview-playmat">
        <div className="tracker-preview-grid">
          {MISSIONS.map((mission) => {
            const { defeatedEnemies, currentEnemy } = previewTrackerState(mission.id);
            return (
              <section className="tracker-preview-item" key={mission.id}>
                <h2>Mission {mission.id}</h2>
                <p>{mission.title}</p>
                <EnemyTracker missionId={mission.id} defeatedEnemies={defeatedEnemies} currentEnemy={currentEnemy} />
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
