import type { EnemyState, Suit } from '@regicide/shared';
import { SUIT_TO_CLASS } from '@regicide/shared';
import { PlayingCard } from './PlayingCard';

const SUIT_GLYPH: Record<string, string> = { H: '♥', D: '♦', C: '♣', S: '♠' };
const RANK_NAME: Record<string, string> = { J: 'Jack', Q: 'Queen', K: 'King' };
const RED_SUITS = new Set(['H', 'D']);

/** One immune-class chip: the same glyph a hand card of that class/suit would show, in its class color. */
function ImmunityChip({ suit, legacy }: { suit: Suit; legacy: boolean }) {
  const cls = SUIT_TO_CLASS[suit];
  return (
    <span className="immunity-chip" style={{ color: cls.color, borderColor: cls.color }} title={`Immune to ${cls.name}`}>
      {legacy ? cls.glyph : SUIT_GLYPH[suit]}
    </span>
  );
}

/** One line-item in the strength ledger: a signed delta with its source, or the flat base total. */
function StrengthTerm({ label, value }: { label: string; value: number }) {
  if (value === 0) return null;
  return (
    <span className={`strength-term${value < 0 ? ' negative' : ' positive'}`}>
      {value > 0 ? '+' : ''}
      {value} {label}
    </span>
  );
}

export function EnemyDisplay({
  enemy,
  liveAttack,
  zoneImmuneSuits,
}: {
  enemy: EnemyState;
  /** See ClientGameState.liveEnemyAttack — the engine's own resolved total, every mission's buff formula already folded in (Mission 10's multiply-before-shield included, which no flat ledger term could otherwise represent). */
  liveAttack: number;
  /** Extra classes stacked on from mission-zone flips (Mission 3 and others), on top of the enemy's own suit(s). */
  zoneImmuneSuits?: Suit[];
}) {
  const healthRemaining = Math.max(0, enemy.maxHealth - enemy.damageTaken);
  const healthPct = Math.round((healthRemaining / enemy.maxHealth) * 100);
  const displayAttack = Math.max(0, liveAttack);
  // The engine's total already accounts for every mission's buff/multiplier; what's left to explain is the gap
  // between that total and (base - shield) — always accurate regardless of which mission mechanic produced it.
  const missionBuff = liveAttack - (enemy.baseAttack - enemy.spadesShield);
  // Only Legacy enemies carry a `name` — use its presence as the display-mode signal (same trick as PlayingCard).
  const isLegacy = Boolean(enemy.name);
  const red = !isLegacy && RED_SUITS.has(enemy.suit);

  const immuneSuits: Suit[] = enemy.immunityBroken
    ? []
    : Array.from(new Set([enemy.suit, ...(enemy.secondSuit ? [enemy.secondSuit] : []), ...(zoneImmuneSuits ?? [])]));

  return (
    <div className="enemy-card">
      <div className="boss-playing-card">
        <PlayingCard card={{ id: 'boss', kind: 'suited', suit: enemy.suit, rank: enemy.rank, name: enemy.name }} />
      </div>
      <div className={`enemy-title${red ? ' red' : ''}`}>
        {isLegacy ? enemy.name : `${RANK_NAME[enemy.rank]} of ${SUIT_GLYPH[enemy.suit]}`}
      </div>
      {immuneSuits.length > 0 && (
        <div className="immunity-row">
          <span className="immunity-label">Immune:</span>
          {immuneSuits.map((s) => (
            <ImmunityChip key={s} suit={s} legacy={isLegacy} />
          ))}
        </div>
      )}
      <div className="health-bar-track">
        <div className="health-bar-fill" style={{ width: `${healthPct}%` }} />
      </div>
      <div className="enemy-stats">
        <span className="enemy-stat-block">
          <strong>Health</strong> {healthRemaining} / {enemy.maxHealth}
        </span>
        <span className="enemy-stat-block">
          <strong>Attack</strong> {displayAttack}
          {liveAttack < 0 && ' (negative!)'}
          {(enemy.spadesShield > 0 || missionBuff !== 0) && (
            <span className="strength-ledger">
              <span className="strength-term base">{enemy.baseAttack} base</span>
              <StrengthTerm label="shield" value={-enemy.spadesShield} />
              <StrengthTerm label="mission zone" value={missionBuff} />
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
