import { CLASS_THEME, getMission, type ClassId, type DefeatedLegacyEnemy, type MissionEnemySpec } from '@regicide/shared';
import { ClassIcon } from './ClassIcon';

type TrackerEnemy = Pick<MissionEnemySpec, 'class' | 'secondClass' | 'name' | 'health' | 'attack' | 'noClass' | 'rankLabel'> & {
  rank?: 'J' | 'Q' | 'K';
};

interface TrackerWave {
  label: string;
  health: number;
  attack: number;
  enemies: TrackerEnemy[];
}

type MarkerStatus = 'defeated' | 'current' | 'upcoming';

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
  const court: Array<{ label: string; rank: 'J' | 'Q' | 'K'; health: number; attack: number }> = [
    { label: 'Justicars', rank: 'J', health: 20, attack: 10 },
    { label: 'Queens', rank: 'Q', health: 30, attack: 15 },
    { label: 'Kings', rank: 'K', health: 40, attack: 20 },
  ];
  return court.map(({ label, rank, health, attack }) => ({
    label,
    health,
    attack,
    enemies: classes.map((cls, index) => ({ name: `${label} ${index + 1}`, class: cls, rank, health, attack })),
  }));
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
        enemies: Array.from({ length: 8 }, (_, index) => ({ name: `Fallen hero ${index + 1}`, class: 'MERCENARY' as ClassId, health: 0, attack: 0 })),
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

function markerKey(waveIndex: number, enemyIndex: number): string {
  return `${waveIndex}:${enemyIndex}`;
}

function markerMatchesEnemy(marker: TrackerEnemy, enemy: DefeatedLegacyEnemy): boolean {
  const classSuit = CLASS_THEME[marker.class].suit;
  const secondClassSuit = marker.secondClass ? CLASS_THEME[marker.secondClass].suit : undefined;
  if (classSuit !== enemy.suit || secondClassSuit !== enemy.secondSuit) return false;
  if (Boolean(marker.noClass) !== Boolean(enemy.noClass)) return false;
  if (marker.rank && marker.rank !== enemy.rank) return false;
  if (marker.rankLabel && marker.rankLabel !== enemy.rankLabel) return false;
  if (marker.health !== enemy.maxHealth || marker.attack !== enemy.baseAttack) return false;
  // Court enemies have generic marker labels, while Legacy bosses have exact names. Match the name only when the
  // revealed or defeated enemy has one, leaving the classic four-suit court rows intact.
  return !enemy.name || marker.name === enemy.name;
}

function markerStatuses(
  missionId: number,
  waves: TrackerWave[],
  defeatedEnemies: DefeatedLegacyEnemy[],
  currentEnemy: DefeatedLegacyEnemy | null | undefined,
): Map<string, MarkerStatus> {
  const markers = waves.flatMap((wave, waveIndex) => wave.enemies.map((enemy, enemyIndex) => ({ enemy, key: markerKey(waveIndex, enemyIndex) })));
  const statuses = new Map<string, MarkerStatus>();

  // Mission 10's bosses are drawn from the campaign party, so its physical tracker is deliberately eight
  // anonymous silhouettes. There is no class-specific marker to select, only a truthful count of fallen heroes.
  if (missionId === 10) {
    for (let index = 0; index < Math.min(markers.length, defeatedEnemies.length); index += 1) {
      statuses.set(markers[index].key, 'defeated');
    }
    if (currentEnemy && defeatedEnemies.length < markers.length) {
      statuses.set(markers[defeatedEnemies.length].key, 'current');
    }
    return statuses;
  }

  for (const defeatedEnemy of defeatedEnemies) {
    const marker = markers.find(({ enemy, key }) => !statuses.has(key) && markerMatchesEnemy(enemy, defeatedEnemy));
    if (marker) statuses.set(marker.key, 'defeated');
  }
  if (currentEnemy) {
    const marker = markers.find(({ enemy, key }) => !statuses.has(key) && markerMatchesEnemy(enemy, currentEnemy));
    if (marker) statuses.set(marker.key, 'current');
  }
  return statuses;
}

/** Compact campaign tracker on the playmat. It marks the actual enemies that fell, never their shuffled draw order. */
export function EnemyTracker({
  missionId,
  defeatedEnemies = [],
  currentEnemy = null,
}: {
  missionId: number;
  defeatedEnemies?: DefeatedLegacyEnemy[];
  currentEnemy?: DefeatedLegacyEnemy | null;
}) {
  const mission = getMission(missionId);
  const waves = trackerWaves(missionId);
  const total = waves.reduce((sum, wave) => sum + wave.enemies.length, 0);
  if (!mission || total === 0) return null;

  const statuses = markerStatuses(missionId, waves, defeatedEnemies, currentEnemy);
  const defeatedCount = Math.min(total, defeatedEnemies.length);
  const remaining = total - defeatedCount;

  return (
    <section className="enemy-tracker" aria-label={`Mission ${missionId} enemy tracker`}>
      <div className="enemy-tracker-heading">
        <span>Enemy tracker</span>
        <span>{remaining} / {total} left</span>
      </div>
      <div className="enemy-tracker-waves">
        {waves.map((wave, waveIndex) => (
          <div className="enemy-tracker-wave" key={wave.label}>
            <div className="enemy-tracker-wave-label">
              <strong>{wave.label}</strong>
              {wave.health > 0 && <span>{wave.health} / {wave.attack}</span>}
            </div>
            <div className="enemy-tracker-markers">
              {wave.enemies.map((enemy, enemyIndex) => {
                const status = statuses.get(markerKey(waveIndex, enemyIndex)) ?? 'upcoming';
                const isGoran = missionId === 11 && enemy.name === 'Evil Goran';
                const activeName = status === 'current' ? currentEnemy?.name ?? enemy.name : enemy.name;
                const currentLabel = status === 'current' && activeName ? ` — current: ${activeName}` : '';
                return (
                  <span
                    key={markerKey(waveIndex, enemyIndex)}
                    className={`enemy-tracker-marker ${status}${isGoran ? ' goran' : ''}`}
                    title={`${enemy.name}${currentLabel}`}
                    aria-label={`${activeName ?? enemy.name}, ${status}`}
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
