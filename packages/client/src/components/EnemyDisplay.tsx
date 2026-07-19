import type { EnemyState } from '@regicide/shared';
import { SUIT_TO_CLASS } from '@regicide/shared';
import { PlayingCard } from './PlayingCard';

const SUIT_GLYPH: Record<string, string> = { H: '♥', D: '♦', C: '♣', S: '♠' };
const RANK_NAME: Record<string, string> = { J: 'Jack', Q: 'Queen', K: 'King' };

export function EnemyDisplay({ enemy }: { enemy: EnemyState }) {
  const healthRemaining = Math.max(0, enemy.maxHealth - enemy.damageTaken);
  const healthPct = Math.round((healthRemaining / enemy.maxHealth) * 100);
  const currentAttack = Math.max(0, enemy.baseAttack - enemy.spadesShield);
  // Only Legacy enemies carry a `name` — use its presence as the display-mode signal (same trick as PlayingCard).
  const isLegacy = Boolean(enemy.name);
  const classInfo = SUIT_TO_CLASS[enemy.suit];

  return (
    <div className="enemy-card">
      <div className="boss-playing-card">
        <PlayingCard card={{ id: 'boss', kind: 'suited', suit: enemy.suit, rank: enemy.rank, name: enemy.name }} />
      </div>
      {isLegacy ? (
        <div className={`enemy-title suit-${enemy.suit}`}>
          {enemy.name}
          {enemy.immunityBroken ? '' : ` 🛡️ immune to ${classInfo.name} abilities`}
        </div>
      ) : (
        <div className={`enemy-title suit-${enemy.suit}`}>
          {RANK_NAME[enemy.rank]} of {SUIT_GLYPH[enemy.suit]}
          {enemy.immunityBroken ? '' : ' 🛡️ immune to its suit'}
        </div>
      )}
      <div className="health-bar-track">
        <div className="health-bar-fill" style={{ width: `${healthPct}%` }} />
      </div>
      <div className="enemy-stats">
        <span>Health: {healthRemaining} / {enemy.maxHealth}</span>
        <span>Attack: {currentAttack}{enemy.spadesShield > 0 ? ` (base ${enemy.baseAttack})` : ''}</span>
      </div>
    </div>
  );
}
