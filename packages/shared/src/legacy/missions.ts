import type { LegacyEnemySpec, Suit } from '../game/types.js';
import type { ClassId } from './classes.js';
import { CLASS_THEME } from './classes.js';
import type { MissionReward, RecruitSpec } from './party.js';

export interface MissionEnemySpec {
  name: string;
  class: ClassId;
  /** A second class this enemy is also immune to at once (e.g. a two-headed hydra). */
  secondClass?: ClassId;
  health: number;
  attack: number;
}

export interface Mission {
  id: number;
  title: string;
  story: string;
  enemies: MissionEnemySpec[];
  reward: MissionReward;
  /** When true, ignores `enemies` and fights the standard 12-enemy Castle deck (classic Regicide's own rules, no Legacy quirks). */
  standardCastle?: boolean;
  /** When true, only an exact-damage hit defeats an enemy — overkilling recycles it, wounds healed, to the back of the line. */
  exactKillOnly?: boolean;
  /** See GameState.endOfTurnZoneFlip. */
  endOfTurnZoneFlip?: boolean;
  /** When set, this many random current party members sit out this mission (excluded from the reserve deck; unaffected in the campaign roster). */
  sidelineCount?: number;
  /** See GameState.jesterClaimNextPlayerOnly. */
  jesterClaimNextPlayerOnly?: boolean;
}

function enemy(name: string, cls: ClassId, health: number, attack: number, secondCls?: ClassId): MissionEnemySpec {
  return { name, class: cls, secondClass: secondCls, health, attack };
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
    secondSuit: e.secondClass ? CLASS_THEME[e.secondClass].suit : undefined,
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
      "A rot has crept into the capital itself, and the Golden Blade Syndicate takes its first commission to " +
      "root it out: storm the old stronghold and put down its full corrupted court, twelve strong — the same " +
      "fight every recruit trains on, before the campaign starts bending the rules on them.",
    enemies: [],
    standardCastle: true,
    // Reward: the Kinfolk Flute relic — once a player commits cards to an attack, any other player may
    // silently slip in a matching card from hand to help complete the combo, no discussion allowed.
    reward: { recruits: [], relics: ['KINFOLK_FLUTE'] },
  },
  {
    id: 2,
    title: 'Coils of the Fen',
    story:
      "The road out of the capital drops into the Grey Fen, where a brood of six hydra-kin has laired for a " +
      "generation. Each head answers to two disciplines at once, shrugging off anything but a killing blow " +
      "measured to the hair — anything less, and the beast just knits itself back together for another round.",
    // All six heads share the same stat line (20 health / 10 attack) — the challenge is entirely the dual
    // immunity + exact-kill combination, not a difficulty ramp across the brood.
    enemies: [
      enemy('Coilfang Broodling', 'CLERIC', 20, 10, 'BARD'),
      enemy('Ashmaw Broodling', 'CLERIC', 20, 10, 'WARRIOR'),
      enemy('Duskscale Broodling', 'CLERIC', 20, 10, 'PALADIN'),
      enemy('Bramble-Throat Broodling', 'BARD', 20, 10, 'WARRIOR'),
      enemy('Grey Fen Broodling', 'BARD', 20, 10, 'PALADIN'),
      enemy('The Nine-Coiled Matriarch', 'WARRIOR', 20, 10, 'PALADIN'),
    ],
    exactKillOnly: true,
    // Modified Jester rule for this mission only: the oppressive dual immunities mean only the very next
    // player in turn order may claim a played Jester and ignore them — not any player at the table.
    jesterClaimNextPlayerOnly: true,
    // Reward: Dual-class Stickers — 4 random existing party members each gain a second class icon, so that
    // single card triggers both class powers whenever it's played.
    reward: { recruits: [], dualClassStickers: 4 },
  },
  {
    id: 3,
    title: 'Lessons in Flames',
    story:
      "Every road out of the Fen leads the party to the same place: a scholars' tower half-collapsed into " +
      'ash, where the corruption didn\'t creep in from outside — it was summoned on purpose, by the academy\'s ' +
      'own staff. One of the Syndicate\'s own is pulled aside before the fight even starts, leaving the rest to ' +
      'work the blaze as it spreads and catches on everything it touches.',
    enemies: [enemy('The Ash-Bound Warden', 'PALADIN', 28, 13), enemy('Cinderleaf, First Scholar', 'CLERIC', 32, 15)],
    // One random party member sits this mission out, and every end of turn the reserve deck feeds the fire
    // another class of immunity (see GameState.endOfTurnZoneFlip / missionZone).
    sidelineCount: 1,
    endOfTurnZoneFlip: true,
    // Reward: the Mage class itself — 10 new party members, all Mages.
    reward: {
      recruits: [
        recruit('Wren Ashglass', 'MAGE', '2', 'H'),
        recruit('Corvath the Kindled', 'MAGE', '3', 'D'),
        recruit('Selwyn Duskbind', 'MAGE', '4', 'C'),
        recruit('Ophira Emberquill', 'MAGE', '5', 'S'),
        recruit('Talon Grayveil', 'MAGE', '6', 'H'),
        recruit('Marn Cindervoice', 'MAGE', '7', 'D'),
        recruit('Ysabet Hollowflame', 'MAGE', '8', 'C'),
        recruit('Ruven Ashcaller', 'MAGE', '9', 'S'),
        recruit('Delphine Nightember', 'MAGE', '10', 'H'),
        recruit('Corin Pale-Ash', 'MAGE', 'A', 'D'),
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
