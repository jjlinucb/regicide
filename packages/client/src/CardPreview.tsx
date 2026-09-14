import { buildInitialParty, CLASS_THEME, MISSIONS, type Card, type Rank, type Suit } from '@regicide/shared';
import { PlayingCard } from './components/PlayingCard';
import { ArtSkinTabs } from './components/ArtSkinTabs';

type CardEntry = [label: string, card: Card, rankLabelOverride?: string, cursed?: boolean];

const SUITS: Suit[] = ['C', 'D', 'H', 'S'];
const COURT_RANKS: Rank[] = ['J', 'Q', 'K'];

const STARTING_PARTY: CardEntry[] = buildInitialParty().map((card) => [
  card.kind === 'suited' ? card.name ?? `${card.rank} ${card.suit}` : 'Jester',
  card,
]);

// A stable visual reference for the three player-card story states. It uses the same Human portrait in every
// entry, so the gallery makes the corruption and recovery treatment easy to inspect in either art skin.
const STORY_STATES: CardEntry[] = [
  ['Unchanged', { id: 'state-unchanged', kind: 'suited', suit: 'C', rank: '6' }],
  ['Corrupted', { id: 'state-corrupted', kind: 'suited', suit: 'C', rank: '6', corrupted: true }],
  ['Restored', { id: 'state-restored', kind: 'suited', suit: 'C', rank: '6', restored: true }],
  ['Evergreen', { id: 'state-evergreen', kind: 'suited', suit: 'C', rank: '6', evergreen: true }],
];

// A compact visual proof for the one centered ability seal. It includes the story-state marks and stacked powers
// that players earn later in the campaign, using the same PlayingCard component as a real game.
const ABILITY_STACK_SHOWCASE: CardEntry[] = [
  ['Cleric', { id: 'stack-cleric', kind: 'suited', suit: 'H', rank: '6', name: 'Merrin' }],
  ['Dual class', { id: 'stack-dual', kind: 'suited', suit: 'H', rank: '6', name: 'Merrin the Valiant', secondSuit: 'C' }],
  ['Three powers', { id: 'stack-triple', kind: 'suited', suit: 'H', rank: '6', name: 'Merrin the Versatile', secondSuit: 'C', extraSuits: ['D'] }],
  ['Cursed boss', { id: 'stack-cursed', kind: 'suited', suit: 'S', rank: 'J', name: 'The Thorned Warden' }, undefined, true],
  ['Corrupted dual', { id: 'stack-corrupted', kind: 'suited', suit: 'H', rank: '6', name: 'Merrin, Corrupted', secondSuit: 'C', corrupted: true }],
  ['Restored triple', { id: 'stack-restored', kind: 'suited', suit: 'H', rank: '6', name: 'Merrin, Restored', secondSuit: 'C', extraSuits: ['D'], restored: true }],
  ['Signature power', { id: 'stack-special', kind: 'suited', suit: 'C', rank: '6', name: 'Esme', special: 'CLEAVE' }],
  ['Pilgrim', { id: 'stack-pilgrim', kind: 'suited', suit: 'H', rank: '4', name: 'A quiet pilgrim', pilgrim: true, noSuitPower: true }],
];

const CAMPAIGN_HEROES: CardEntry[] = [
  ['High Arcana', { id: 'high-arcana', kind: 'suited', suit: 'D', rank: '25', name: 'High Arcana', noSuitPower: true }],
  ['Ilyra Sparkwrit', { id: 'ilyra', kind: 'suited', suit: 'H', rank: '2', name: 'Ilyra Sparkwrit', arcane: true }],
  ['Corvath the Kindled', { id: 'corvath', kind: 'suited', suit: 'D', rank: '3', name: 'Corvath the Kindled', arcane: true }],
  ['Dassin Coalglow', { id: 'dassin', kind: 'suited', suit: 'C', rank: '4', name: 'Dassin Coalglow', arcane: true }],
  ['Ophira Emberquill', { id: 'ophira', kind: 'suited', suit: 'S', rank: '5', name: 'Ophira Emberquill', arcane: true }],
  ['Wystan Pyrewick', { id: 'wystan', kind: 'suited', suit: 'H', rank: '6', name: 'Wystan Pyrewick', arcane: true }],
  ['Marn Cindervoice', { id: 'marn', kind: 'suited', suit: 'D', rank: '7', name: 'Marn Cindervoice', arcane: true }],
  ['Talis Ashborn', { id: 'talis', kind: 'suited', suit: 'C', rank: '8', name: 'Talis Ashborn', arcane: true }],
  ['Ruven Ashcaller', { id: 'ruven', kind: 'suited', suit: 'S', rank: '9', name: 'Ruven Ashcaller', arcane: true }],
  ['Sorrel Brandwake', { id: 'sorrel', kind: 'suited', suit: 'H', rank: '10', name: 'Sorrel Brandwake', arcane: true }],
  ['Kael Emberdrake', { id: 'kael', kind: 'suited', suit: 'D', rank: 'A', name: 'Kael Emberdrake', arcane: true }],
  ['Haror', { id: 'haror', kind: 'suited', suit: 'S', rank: '5', name: 'Haror', reaver: true }],
  ['Ferro', { id: 'ferro', kind: 'suited', suit: 'S', rank: '3', name: 'Ferro', guardian: true }],
  ['Alanta', { id: 'alanta', kind: 'suited', suit: 'C', rank: '7', name: 'Alanta', druid: true }],
  ['Bram the Refrainkeeper', { id: 'bram-refrain', kind: 'suited', suit: 'S', rank: '9', name: 'Bram the Refrainkeeper', chanter: true }],
  ['Goran, Evergreen', { id: 'goran', kind: 'suited', suit: 'C', rank: '8', name: 'Goran', secondSuit: 'S', extraSuits: ['H', 'D'], evergreen: true }],
  ['Fennow', { id: 'fennow', kind: 'suited', suit: 'C', rank: 'B', name: 'Fennow', beast: true }],
  ['Cressida', { id: 'cressida', kind: 'suited', suit: 'D', rank: 'B', name: 'Cressida', beast: true }],
  ['Orwick', { id: 'orwick', kind: 'suited', suit: 'H', rank: 'B', name: 'Orwick', beast: true }],
  ['Sabrielle', { id: 'sabrielle', kind: 'suited', suit: 'S', rank: 'B', name: 'Sabrielle', beast: true }],
  ['Ash', { id: 'ash', kind: 'suited', suit: 'S', rank: 'B', name: 'Ash', beast: true, arcane: true }],
];

const COURT: CardEntry[] = COURT_RANKS.flatMap((rank) =>
  SUITS.map((suit): CardEntry => [`${rank} ${suit}`, { id: `${rank}-${suit}`, kind: 'suited', suit, rank }, undefined, true]),
);

const MERCENARY_CAMP: CardEntry[] = [
  ['Ghali', { id: 'ghali', kind: 'suited', suit: 'H', rank: '12', name: 'Ghali' }],
  ['Pàviõ', { id: 'pavio', kind: 'suited', suit: 'D', rank: '12', name: 'Pàviõ' }],
  ['Argo', { id: 'argo', kind: 'suited', suit: 'C', rank: '12', name: 'Argo' }],
  ['Hella', { id: 'hella', kind: 'suited', suit: 'S', rank: '12', name: 'Hella' }],
  ['Hearts 2/5', { id: 'two-five-h', kind: 'suited', suit: 'H', rank: '5', flexibleComboRank: '2' }],
  ['Diamonds 2/5', { id: 'two-five-d', kind: 'suited', suit: 'D', rank: '5', flexibleComboRank: '2' }],
  ['Clubs 2/5', { id: 'two-five-c', kind: 'suited', suit: 'C', rank: '5', flexibleComboRank: '2' }],
  ['Spades 2/5', { id: 'two-five-s', kind: 'suited', suit: 'S', rank: '5', flexibleComboRank: '2' }],
  ['Nineteen', { id: 'nineteen', kind: 'suited', suit: 'H', rank: '19', noSuitPower: true }],
  ['Any-Suit Ace', { id: 'wild-ace', kind: 'suited', suit: 'H', rank: 'A', wildSuit: true }],
  ['Jester', { id: 'jester', kind: 'jester' }],
];

// Use the live Mission 7 deck itself: six values, four identical Pilgrims at each value, 24 cards total. This
// keeps the gallery honest about the actual game pool and makes the four matching rank-4s unmistakable.
const PILGRIM_DECK: CardEntry[] = (MISSIONS.find((mission) => mission.id === 7)?.pilgrimCards ?? []).map((card, index) => [
  `Rank ${card.kind === 'suited' ? card.rank : '?'} · copy ${(index % 4) + 1}`,
  card,
]);

// All named bosses are generated straight from the live mission data, so this private gallery cannot drift from
// which portrait appears during a real Legacy campaign. Mission 1 uses the standard court above and Mission 10
// deliberately uses the player party itself, so neither has a fixed enemy roster to list here.
const MISSION_BOSS_GALLERIES: [string, CardEntry[]][] = MISSIONS.filter((mission) => mission.enemies.length > 0).map((mission) => [
  `Mission ${mission.id}: ${mission.title}`,
  mission.enemies.map((enemy, index): CardEntry => [
    enemy.name,
    {
      id: `mission-${mission.id}-boss-${index}`,
      kind: 'suited',
      suit: CLASS_THEME[enemy.class].suit!,
      rank: 'J',
      name: enemy.name,
    },
    enemy.rankLabel,
    true,
  ]),
]);

/** Private art gallery at ?preview=cards. It uses the live PlayingCard component and does not change game state. */
export function CardPreview() {
  const groups: [string, CardEntry[]][] = [
    ['Starting Party', STARTING_PARTY],
    ['Character States', STORY_STATES],
    ['Ability Seal Showcase', ABILITY_STACK_SHOWCASE],
    ['Campaign Heroes', CAMPAIGN_HEROES],
    ['Court Enemies', COURT],
    ...MISSION_BOSS_GALLERIES,
    ['Mercenary Camp', MERCENARY_CAMP],
    ['Pilgrim Deck — 24 cards', PILGRIM_DECK],
  ];

  return (
    <main className="card-preview">
      <h1 className="card-preview-title">Regicide character gallery</h1>
      <p className="card-preview-intro">Generated art shown through the same card component used in play.</p>
      <ArtSkinTabs />
      {groups.map(([title, entries]) => (
        <section key={title} className="card-preview-section">
          <h2 className="card-preview-heading">{title}</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            {entries.map(([label, card, rankLabelOverride, cursed]) => (
              <div key={card.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, width: 108 }}>
                <PlayingCard card={card} rankLabelOverride={rankLabelOverride} cursed={cursed} />
                <span className="card-preview-label">{label}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
