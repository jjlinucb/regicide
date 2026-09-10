import { buildInitialParty, CLASS_THEME, MISSIONS, type Card, type Rank, type Suit } from '@regicide/shared';
import { PlayingCard } from './components/PlayingCard';

type CardEntry = [string, Card];

const SUITS: Suit[] = ['C', 'D', 'H', 'S'];
const COURT_RANKS: Rank[] = ['J', 'Q', 'K'];

const STARTING_PARTY: CardEntry[] = buildInitialParty().map((card) => [
  card.kind === 'suited' ? card.name ?? `${card.rank} ${card.suit}` : 'Jester',
  card,
]);

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
  SUITS.map((suit): CardEntry => [`${rank} ${suit}`, { id: `${rank}-${suit}`, kind: 'suited', suit, rank }]),
);

const CAMP_AND_PILGRIMS: CardEntry[] = [
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
  ['Old Yarrow', { id: 'old-yarrow', kind: 'suited', suit: 'H', rank: '2', name: 'Old Yarrow', pilgrim: true, noSuitPower: true }],
  ['Little Mireille', { id: 'little-mireille', kind: 'suited', suit: 'D', rank: '3', name: 'Little Mireille', pilgrim: true, noSuitPower: true }],
  ['Bosk the Carter', { id: 'bosk', kind: 'suited', suit: 'C', rank: '4', name: 'Bosk the Carter', pilgrim: true, noSuitPower: true }],
  ['Sister Halvard', { id: 'halvard', kind: 'suited', suit: 'S', rank: '5', name: 'Sister Halvard', pilgrim: true, noSuitPower: true }],
  ['Corin Drizzlecoat', { id: 'corin', kind: 'suited', suit: 'H', rank: '6', name: 'Corin Drizzlecoat', pilgrim: true, noSuitPower: true }],
  ['Fenna Longrope', { id: 'fenna', kind: 'suited', suit: 'D', rank: '7', name: 'Fenna Longrope', pilgrim: true, noSuitPower: true }],
  ['Scrap', { id: 'scrap', kind: 'suited', suit: 'H', rank: 'A', name: 'Scrap', pilgrim: true, noSuitPower: true }],
  ['Pilgrim', { id: 'pilgrim', kind: 'suited', suit: 'C', rank: '4', name: 'Pilgrim', pilgrim: true, noSuitPower: true }],
];

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
  ]),
]);

/** Private art gallery at ?preview=cards. It uses the live PlayingCard component and does not change game state. */
export function CardPreview() {
  const groups: [string, CardEntry[]][] = [
    ['Starting Party', STARTING_PARTY],
    ['Campaign Heroes', CAMPAIGN_HEROES],
    ['Court Enemies', COURT],
    ...MISSION_BOSS_GALLERIES,
    ['Mercenary Camp and Pilgrims', CAMP_AND_PILGRIMS],
  ];

  return (
    <main style={{ maxWidth: 1120, margin: '0 auto', padding: '28px 24px 56px' }}>
      <h1 style={{ margin: '0 0 8px' }}>Regicide character gallery</h1>
      <p style={{ margin: '0 0 28px', color: '#5c5148' }}>Generated art shown through the same card component used in play.</p>
      {groups.map(([title, entries]) => (
        <section key={title} style={{ marginTop: 30 }}>
          <h2 style={{ margin: '0 0 14px' }}>{title}</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            {entries.map(([label, card]) => (
              <div key={card.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, width: 108 }}>
                <PlayingCard card={card} />
                <span style={{ fontSize: 11, textAlign: 'center', color: '#51463d', lineHeight: 1.25 }}>{label}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
