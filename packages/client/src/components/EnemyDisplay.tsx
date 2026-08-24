import type { Card, EnemyState } from '@regicide/shared';
import { discardPileTopValue, SUIT_TO_CLASS } from '@regicide/shared';
import { PlayingCard } from './PlayingCard';

const SUIT_GLYPH: Record<string, string> = { H: '♥', D: '♦', C: '♣', S: '♠' };
const RANK_NAME: Record<string, string> = { J: 'Jack', Q: 'Queen', K: 'King' };

export function EnemyDisplay({
  enemy,
  discardPile,
  discardTopBuffsAttack,
}: {
  enemy: EnemyState;
  /** Only needed when discardTopBuffsAttack is set (Mission 4). */
  discardPile?: Card[];
  discardTopBuffsAttack?: boolean;
}) {
  const healthRemaining = Math.max(0, enemy.maxHealth - enemy.damageTaken);
  const healthPct = Math.round((healthRemaining / enemy.maxHealth) * 100);
  const discardBuff = discardTopBuffsAttack ? discardPileTopValue(discardPile ?? []) : 0;
  const currentAttack = enemy.baseAttack - enemy.spadesShield + discardBuff;
  const displayAttack = Math.max(0, currentAttack);
  // Only Legacy enemies carry a `name` — use its presence as the display-mode signal (same trick as PlayingCard).
  const isLegacy = Boolean(enemy.name);
  const classInfo = SUIT_TO_CLASS[enemy.suit];
  const secondClassInfo = enemy.secondSuit ? SUIT_TO_CLASS[enemy.secondSuit] : null;

  return (
    <div className="enemy-card">
      <div className="boss-playing-card">
        <PlayingCard card={{ id: 'boss', kind: 'suited', suit: enemy.suit, rank: enemy.rank, name: enemy.name }} />
        <svg className="corruption-overlay" viewBox="0 0 130 182" aria-hidden="true">
          <path
            className="crack-line"
            d="M 10 8 L 42 55 L 30 70 L 58 100 L 46 118 L 70 150 L 60 174"
            fill="none"
          />
          <path className="crack-line crack-thin" d="M 42 55 L 66 62 L 78 40" fill="none" />
          <path className="crack-line crack-thin" d="M 58 100 L 84 108 L 100 92" fill="none" />
          <path
            className="vine-line"
            d="M 122 176 C 108 150 118 128 100 108 C 86 92 96 70 82 52"
            fill="none"
          />
          <path
            className="vine-line"
            d="M 8 176 C 24 158 16 138 30 122"
            fill="none"
          />
          <g className="thorns">
            <path d="M 100 108 l 10 -4 l -3 10 z" />
            <path d="M 90 80 l 9 3 l -8 7 z" />
            <path d="M 30 122 l -9 4 l 2 -10 z" />
          </g>
        </svg>
      </div>
      {isLegacy ? (
        <div className={`enemy-title suit-${enemy.suit}`}>
          {enemy.name}
          {enemy.immunityBroken
            ? ''
            : ` 🛡️ immune to ${classInfo.name}${secondClassInfo ? ` & ${secondClassInfo.name}` : ''} abilities`}
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
        <span>
          Attack: {displayAttack}
          {currentAttack < 0 ? ' (negative!)' : ''}
          {enemy.spadesShield > 0 || discardBuff !== 0 ? ` (base ${enemy.baseAttack})` : ''}
          {discardBuff !== 0 ? ` 🗑️ ${discardBuff > 0 ? '+' : ''}${discardBuff} from top of discard` : ''}
        </span>
      </div>
    </div>
  );
}
