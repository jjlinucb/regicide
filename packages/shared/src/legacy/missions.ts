import type { LegacyEnemySpec } from '../game/types.js';
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

function recruit(name: string, cls: ClassId, rank: RecruitSpec['rank']): RecruitSpec {
  return { name, class: cls, rank };
}

/** Converts a mission's enemy specs into the engine's LegacyEnemySpec shape (suit-keyed). */
export function missionEnemiesToSpecs(enemies: MissionEnemySpec[]): LegacyEnemySpec[] {
  return enemies.map((e) => ({
    name: e.name,
    suit: CLASS_THEME[e.class].suit,
    health: e.health,
    attack: e.attack,
  }));
}

/**
 * Twelve original missions for the Golden Blade Syndicate — not the physical game's proprietary mission
 * content (which lives in sealed boxes with its own story/enemies/rewards), but a full original campaign
 * built on the same rules skeleton, escalating in difficulty and party size across all 12 missions.
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
    title: 'The Drowned Chapel',
    story:
      'A chapel sank into the marsh a generation ago and was forgotten. It should have stayed forgotten — ' +
      'something inside kept singing long after the roof went under.',
    enemies: [enemy('Vessel of Rot', 'PALADIN', 26, 13), enemy('The Choir Unclean', 'CLERIC', 30, 14)],
    reward: { recruits: [recruit('Ser Dunwall', 'PALADIN', '8')] },
  },
  {
    id: 4,
    title: 'Siege at Blackwater',
    story:
      'Blackwater keep has held the corruption at its gates for three months. The Syndicate arrives to find the ' +
      'defenders exhausted and the enemy dug in three ranks deep.',
    enemies: [enemy('Rennick Coalfist', 'WARRIOR', 22, 11), enemy('Dusk Fletcher', 'BARD', 24, 12), enemy('Old Marrow', 'PALADIN', 28, 14)],
    reward: { recruits: [recruit('Brother Talyn', 'CLERIC', '9'), recruit('Wisp', 'BARD', '4')] },
  },
  {
    id: 5,
    title: 'The Fractured Court',
    story:
      "A noble house has split in two, each half convinced the other is corrupted. Both are right, and both are wrong — the rot took root at the head of the table, in a duke and his sharp-tongued sister.",
    enemies: [enemy('Duke Ashen', 'WARRIOR', 34, 16), enemy('Lady Vire', 'BARD', 30, 15)],
    reward: { recruits: [recruit('Kharsa Doomstrike', 'WARRIOR', '10')] },
  },
  {
    id: 6,
    title: 'Beneath the Hollow Hill',
    story:
      'A hill outside town has always been hollow, the locals say, and always been empty. Now something small ' +
      'and quick moves through the tunnels in packs, testing the dark for a way out.',
    enemies: [enemy('Grik', 'PALADIN', 16, 8), enemy('Nix', 'PALADIN', 18, 9), enemy('Thorne', 'PALADIN', 20, 10)],
    reward: { recruits: [recruit('Ione Steady', 'PALADIN', '6'), recruit('Petra Small', 'CLERIC', '3')] },
  },
  {
    id: 7,
    title: 'The Hungering Bog',
    story:
      "The bog doesn't just hide the corruption anymore — it's begun to feed it. Something vast and patient " +
      'has been growing in the mud for longer than anyone alive can remember, and it cast its own shadow ahead of it.',
    enemies: [enemy('The Bloat', 'CLERIC', 38, 17), enemy('Its Shadow', 'WARRIOR', 34, 16)],
    reward: { recruits: [recruit('Old Sallow', 'BARD', '9')] },
  },
  {
    id: 8,
    title: 'Return of the Crimson Choir',
    story:
      'The Choir from the drowned chapel was never fully silenced — it scattered, and it has spent months ' +
      'finding new throats to sing through. Three of its strongest voices now stand together again.',
    enemies: [enemy('First Voice', 'CLERIC', 30, 14), enemy('Second Voice', 'BARD', 34, 16), enemy('Last Voice', 'WARRIOR', 38, 18)],
    reward: { recruits: [recruit('Ghent Bullneck', 'WARRIOR', '7'), recruit('Dame Averil', 'PALADIN', '9')] },
  },
  {
    id: 9,
    title: 'The Iron Inquisition',
    story:
      'A self-styled inquisition has been "purifying" villages along the eastern road — burning the corrupted ' +
      'and the merely unlucky in equal measure. Its leaders have started to believe their own cause is holy.',
    enemies: [enemy('Inquisitor Bale', 'PALADIN', 42, 20), enemy('Executioner Vray', 'WARRIOR', 40, 19)],
    reward: { recruits: [recruit('Matron Cyrene', 'CLERIC', '10')] },
  },
  {
    id: 10,
    title: 'The Shattered Sanctum',
    story:
      'The Syndicate finally traces the corruption to its source: a sanctum built to contain something far ' +
      'older than any of the fights that came before it, its wards cracked from the inside out.',
    enemies: [enemy('Sanctum Warden', 'PALADIN', 36, 17), enemy('Sanctum Cantor', 'BARD', 40, 19), enemy('Sanctum Reaver', 'WARRIOR', 44, 21)],
    reward: { recruits: [recruit('Maestro Voss', 'BARD', '10'), recruit('Kade Ironsong', 'WARRIOR', '9')] },
  },
  {
    id: 11,
    title: 'Vanguard of the Rot King',
    story:
      "It has a name now, whispered out of the sanctum's ruins: the Rot King. These three stand between the " +
      'Syndicate and its throne, and none of them plan to move.',
    enemies: [enemy('Herald of Rot', 'CLERIC', 40, 19), enemy('Rot-Touched Champion', 'WARRIOR', 44, 21), enemy('The Last Ward', 'PALADIN', 48, 23)],
    reward: { recruits: [recruit('Lord Bastian Vane', 'PALADIN', '10')] },
  },
  {
    id: 12,
    title: "The Rot King's Throne",
    story:
      'The throne room is quiet in the way a held breath is quiet. What sits on the throne was a king once, ' +
      'before the rot wore his crown as a mask — and the Golden Blade Syndicate came all this way to take it back off.',
    enemies: [enemy('Herald of Rot', 'CLERIC', 40, 20), enemy('Rot-Touched Champion', 'WARRIOR', 46, 22), enemy('The Rot King', 'PALADIN', 60, 28)],
    reward: { recruits: [recruit('Champion of the Golden Blade', 'WARRIOR', '10')] },
  },
];

export function getMission(id: number): Mission | undefined {
  return MISSIONS.find((m) => m.id === id);
}
