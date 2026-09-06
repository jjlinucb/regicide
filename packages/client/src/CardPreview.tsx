import { PlayingCard } from './components/PlayingCard';
import type { Card } from '@regicide/shared';

/** Scratch preview route (?preview=cards) for eyeballing card faces without playing to them. Not linked from the app. */
const CARDS: [string, Card][] = [
  ['Gøran, Mission 9 (all four)', { id: 'g9', kind: 'suited', suit: 'C', rank: '8', name: 'Goran', secondSuit: 'S', extraSuits: ['H', 'D'] } as Card],
  ['Gøran, Mission 10 (Evergreen)', { id: 'g10', kind: 'suited', suit: 'C', rank: '8', name: 'Goran', secondSuit: 'S', extraSuits: ['H', 'D'], evergreen: true } as Card],
  ['Esme, after Mission 11', { id: 'es', kind: 'suited', suit: 'C', rank: '6', name: 'Esme', evergreen: true } as Card],
  ['Mage (new glyph)', { id: 'm', kind: 'suited', suit: 'S', rank: '4', name: 'Ilyra Sparkwrit', arcane: true } as Card],
  ['Mage + signature ability', { id: 'm2', kind: 'suited', suit: 'S', rank: '4', name: 'Ilyra Sparkwrit', arcane: true, special: 'ARCANE_SURGE' } as Card],
  ['Dual-class sticker', { id: 'd', kind: 'suited', suit: 'H', rank: '7', name: 'Brother Coen', secondSuit: 'D' } as Card],
  ['Druid sticker', { id: 'dr', kind: 'suited', suit: 'H', rank: '4', name: 'Wren Fallow', secondClassDruid: true } as Card],
  ['Guardian sticker', { id: 'gd', kind: 'suited', suit: 'D', rank: '8', name: 'Ferro', secondClassGuardian: true } as Card],
  ['Dual + Chanter sticker', { id: 'x', kind: 'suited', suit: 'C', rank: '2', name: 'Talis Ashborn', secondSuit: 'H', secondClassChanter: true } as Card],
];

export function CardPreview() {
  return (
    <div style={{ padding: 24, display: 'flex', flexWrap: 'wrap', gap: 20 }}>
      {CARDS.map(([label, card]) => (
        <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: 150 }}>
          <PlayingCard card={card} />
          <span style={{ fontSize: 12, textAlign: 'center', color: '#444' }}>{label}</span>
        </div>
      ))}
    </div>
  );
}
