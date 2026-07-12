import type { EnemyState } from '@regicide/shared';

const SUIT_GLYPH: Record<string, string> = { H: '♥', D: '♦', C: '♣', S: '♠' };
const RANK_NAME: Record<string, string> = { J: 'Jack', Q: 'Queen', K: 'King' };

// Every suit+rank enemy gets its own boss look — 12 in total, each suit with its own
// flavor (holy/treasure/wild/shadow) escalating in menace from Jack to King.
const BOSS_EMOJI: Record<string, string> = {
  HJ: '⚔️',
  HQ: '👸',
  HK: '🦁',
  DJ: '🏹',
  DQ: '🧞‍♀️',
  DK: '🐉',
  CJ: '🪓',
  CQ: '🧟‍♀️',
  CK: '👹',
  SJ: '🥷',
  SQ: '🧛‍♀️',
  SK: '💀',
};
const SUIT_PORTRAIT_BG: Record<string, string> = { H: '#c9564a', D: '#c99a2c', C: '#4a6741', S: '#3d4a66' };

export function EnemyDisplay({ enemy }: { enemy: EnemyState }) {
  const healthRemaining = Math.max(0, enemy.maxHealth - enemy.damageTaken);
  const healthPct = Math.round((healthRemaining / enemy.maxHealth) * 100);
  const currentAttack = Math.max(0, enemy.baseAttack - enemy.spadesShield);

  return (
    <div className="enemy-card">
      <div className="boss-portrait" style={{ background: SUIT_PORTRAIT_BG[enemy.suit] }}>
        {BOSS_EMOJI[`${enemy.suit}${enemy.rank}`]}
      </div>
      <div className={`enemy-title suit-${enemy.suit}`}>
        {RANK_NAME[enemy.rank]} of {SUIT_GLYPH[enemy.suit]}
        {enemy.immunityBroken ? '' : ' 🛡️ immune to its suit'}
      </div>
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
