import { CLASS_THEME, getMission, type ClassId, type MissionEnemySpec } from '@regicide/shared';
import { ClassIcon } from './ClassIcon';

type TrackerEnemy = Pick<MissionEnemySpec, 'class' | 'name' | 'health' | 'attack' | 'noClass' | 'rankLabel'>;

interface TrackerWave {
  label: string;
  health: number;
  attack: number;
  enemies: TrackerEnemy[];
}

const WAVE_NAMES: Partial<Record<number, string[]>> = {
  2: ['Hydra brood'],
  3: ['Lessons in Flames', 'Senior instructors', 'Grand Mage'],
  4: ['Specimens I', 'Specimens II', 'Specimens III'],
  5: ['Sporelings', 'Gloom sporelings'],
  6: ['Statues', 'Graven statues'],
  7: ['Schole', 'Deep', 'Abyssal'],
  8: ['Double-headed trolls', 'Double-headed wyverns'],
  9: ['Loreguards', 'Lorekeepers', 'Myla'],
  11: ['Wardens', 'Evil Goran'],
  12: ['Queens', 'Kings', 'The Hierarch'],
};

function courtWaves(): TrackerWave[] {
  const classes: ClassId[] = ['WARRIOR', 'BARD', 'CLERIC', 'PALADIN'];
  return [
    { label: 'Justicars', health: 20, attack: 10, enemies: classes.map((cls, i) => ({ name: `Justicar ${i + 1}`, class: cls, health: 20, attack: 10 })) },
    { label: 'Queens', health: 30, attack: 15, enemies: classes.map((cls, i) => ({ name: `Queen ${i + 1}`, class: cls, health: 30, attack: 15 })) },
    { label: 'Kings', health: 40, attack: 20, enemies: classes.map((cls, i) => ({ name: `King ${i + 1}`, class: cls, health: 40, attack: 20 })) },
  ];
}

/** Groups an ordered mission roster into the same tidy enemy waves printed on the physical tracker cards. */
export function trackerWaves(missionId: number): TrackerWave[] {
  const mission = getMission(missionId);
  if (!mission) return [];
  if (mission.standardCastle) return courtWaves();
  if (missionId === 10) {
    return [
      {
        label: 'Corrupted party',
        health: 0,
        attack: 0,
        enemies: Array.from({ length: 8 }, (_, i) => ({ name: `Fallen hero ${i + 1}`, class: 'MERCENARY' as ClassId, health: 0, attack: 0 })),
      },
    ];
  }

  const waves: TrackerWave[] = [];
  for (const enemy of mission.enemies) {
    const current = waves.at(-1);
    // A wave changes when its printed strength changes. The display letter alone cannot delimit a wave: the two
    // Mission 9 Lore tiers both carry L, for example, but are physically separate runs with different stats.
    if (current && current.health === enemy.health && current.attack === enemy.attack && current.enemies[0]?.rankLabel === enemy.rankLabel) {
      current.enemies.push(enemy);
    } else {
      waves.push({ label: '', health: enemy.health, attack: enemy.attack, enemies: [enemy] });
    }
  }
  const labels = WAVE_NAMES[missionId];
  return waves.map((wave, index) => ({ ...wave, label: labels?.[index] ?? `Enemy wave ${index + 1}` }));
}

/** Compact campaign tracker on the playmat. It reveals the fight's shape, not hidden cards or future card draws. */
export function EnemyTracker({ missionId, remaining, currentEnemyName }: { missionId: number; remaining: number; currentEnemyName?: string }) {
  const mission = getMission(missionId);
  const waves = trackerWaves(missionId);
  const total = waves.reduce((sum, wave) => sum + wave.enemies.length, 0);
  if (!mission || total === 0) return null;

  const safeRemaining = Math.max(0, Math.min(total, remaining));
  const defeated = total - safeRemaining;
  let markerIndex = 0;

  return (
    <section className="enemy-tracker" aria-label={`Mission ${missionId} enemy tracker`}>
      <div className="enemy-tracker-heading">
        <span>Enemy tracker</span>
        <span>{safeRemaining} / {total} left</span>
      </div>
      <div className="enemy-tracker-waves">
        {waves.map((wave) => (
          <div className="enemy-tracker-wave" key={wave.label}>
            <div className="enemy-tracker-wave-label">
              <strong>{wave.label}</strong>
              {wave.health > 0 && <span>{wave.health} / {wave.attack}</span>}
            </div>
            <div className="enemy-tracker-markers">
              {wave.enemies.map((enemy, index) => {
                const status = markerIndex < defeated ? 'defeated' : markerIndex === defeated && safeRemaining > 0 ? 'current' : 'upcoming';
                markerIndex += 1;
                const isGoran = missionId === 11 && enemy.name === 'Evil Goran';
                const currentLabel = status === 'current' && currentEnemyName ? ` — current: ${currentEnemyName}` : '';
                return (
                  <span
                    key={`${wave.label}-${index}`}
                    className={`enemy-tracker-marker ${status}${isGoran ? ' goran' : ''}`}
                    title={`${enemy.name}${currentLabel}`}
                    aria-label={`${enemy.name}, ${status}`}
                  >
                    {missionId === 10 ? (
                      <ClassIcon id="CORRUPTED" />
                    ) : enemy.noClass ? (
                      <span className="enemy-tracker-letter">{enemy.rankLabel ?? 'W'}</span>
                    ) : isGoran ? (
                      <span className="enemy-tracker-letter">G</span>
                    ) : (
                      <ClassIcon id={enemy.class} />
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
