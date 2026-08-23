import type { LegacyEnemySpec, Suit } from '../game/types.js';
import type { ClassId } from './classes.js';
import { CLASS_THEME } from './classes.js';
import type { RecruitSpec } from './party.js';

export interface MissionEnemySpec {
  name: string;
  class: ClassId;
  health: number;
  attack: number;
}

export interface Mission {
  id: number;
  title: string;
  story: string;
  enemies: MissionEnemySpec[];
  reward: { recruits: RecruitSpec[] };
}

function enemy(name: string, cls: ClassId, health: number, attack: number): MissionEnemySpec {
  return { name, class: cls, health, attack };
}

function recruit(name: string, cls: ClassId, rank: RecruitSpec['rank'], suit?: Suit): RecruitSpec {
  return { name, class: cls, rank, suit };
}

/** A standout reward: same as recruit(), but also grants the class's signature ability permanently. */
function specialRecruit(name: string, cls: ClassId, rank: RecruitSpec['rank'], suit?: Suit): RecruitSpec {
  return { name, class: cls, rank, special: true, suit };
}

/** Converts a mission's enemy specs into the engine's LegacyEnemySpec shape (suit-keyed). Mage enemies aren't used yet — the class only exists as a party reward so far. */
export function missionEnemiesToSpecs(enemies: MissionEnemySpec[]): LegacyEnemySpec[] {
  return enemies.map((e) => ({
    name: e.name,
    suit: CLASS_THEME[e.class].suit!,
    health: e.health,
    attack: e.attack,
  }));
}

/**
 * Regicide Legacy's campaign — original content built on the same rules skeleton as the physical game, not its
 * proprietary mission text. Currently the first four missions of a longer arc: the party's early fights against
 * a corrupted syndicate, culminating in Mission 3's discovery of the Ashen Archive and its captive Mages.
 */
export const MISSIONS: Mission[] = [
  {
    id: 1,
    title: 'The First Contract',
    story:
      'A rot has crept into the border town of Callow Ridge, and the Golden Blade Syndicate takes its first ' +
      'commission to root it out. The party finds the source hiding in the old grain hall: a warlord already ' +
      'half-consumed by the corruption he serves.',
    enemies: [enemy('Grommash the Cinder-Handed', 'WARRIOR', 20, 10)],
    reward: { recruits: [recruit('Sister Ilona', 'CLERIC', '6')] },
  },
  {
    id: 2,
    title: 'Whispers in the Vale',
    story:
      'Reports of a corrupted bard leading travelers astray lead the party into Nettlevale, where they find a ' +
      'second corruption already waiting: something that has learned to wear silence like armor.',
    enemies: [enemy('Sable Thorn', 'BARD', 18, 9), enemy('Korrath the Hollow', 'CLERIC', 24, 12)],
    reward: { recruits: [recruit('Finn Cutter', 'BARD', '7'), recruit('Bruno Halfhand', 'WARRIOR', '5')] },
  },
  {
    id: 3,
    title: 'The Ashen Archive',
    story:
      "Every road out of Nettlevale leads the party to the same place: a scholars' tower half-collapsed into " +
      'ash, where the corruption didn\'t creep in from outside — it was summoned on purpose. The wardens who ' +
      'raised the tower\'s wards against it have been trapped behind their own seals for a generation, and ' +
      'freeing them is the only way through.',
    enemies: [enemy('The Ash-Bound Warden', 'PALADIN', 28, 13), enemy('Cinderleaf, First Scholar', 'CLERIC', 32, 15)],
    reward: {
      recruits: [
        recruit('Wren Ashglass', 'MAGE', '4', 'H'),
        recruit('Corvath the Kindled', 'MAGE', '5', 'D'),
        recruit('Selwyn Duskbind', 'MAGE', '6', 'C'),
        recruit('Ophira Emberquill', 'MAGE', '7', 'S'),
      ],
    },
  },
  {
    id: 4,
    title: 'Siege at Blackwater',
    story:
      'Word of the Archive\'s fall reaches Blackwater keep before the party does — and so does the corruption, ' +
      'racing to bury the evidence. The Syndicate arrives to find the defenders exhausted, the gates buckling, ' +
      'and the newly freed Mages getting their first real test of fire.',
    enemies: [enemy('Rennick Coalfist', 'WARRIOR', 24, 12), enemy('Dusk Fletcher', 'BARD', 26, 13), enemy('Old Marrow', 'PALADIN', 30, 15)],
    reward: {
      recruits: [
        specialRecruit('Thessaly Brightbolt', 'MAGE', '8', 'H'),
        recruit('Brother Talyn', 'CLERIC', '9'),
      ],
    },
  },
];

export function getMission(id: number): Mission | undefined {
  return MISSIONS.find((m) => m.id === id);
}
