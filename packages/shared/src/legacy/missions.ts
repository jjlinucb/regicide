import type { Card, LegacyEnemySpec, Rank, Suit } from '../game/types.js';
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
  /** See GameState.discardTopBuffsAttack. */
  discardTopBuffsAttack?: boolean;
  /** See GameState.exactKillToReserveDeck. */
  exactKillToReserveDeck?: boolean;
  /** See GameState.exactKillSplashDamage. */
  exactKillSplashDamage?: boolean;
  /** See GameState.START_LEGACY_MISSION action's presetMissionZone. */
  presetMissionZone?: Card[];
  /** See GameState.zoneVengeanceOnKill. */
  zoneVengeanceOnKill?: boolean;
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

/** A one-off companion card placed straight into a mission's static presetMissionZone (never part of the reserve deck or party). */
function zoneCompanion(name: string, suit: Suit, rank: Rank): Card {
  return { id: `zone-companion-${name.replace(/\s+/g, '-').toLowerCase()}`, kind: 'suited', suit, rank, name };
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
    // silently slip in a matching card from hand to help complete the combo, no discussion allowed — plus a
    // pair of basic recruits pulled from the liberated stronghold to bolster the party's opening roster.
    reward: {
      recruits: [recruit('Coren Ashvale', 'WARRIOR', '2'), recruit('Dessa Windrow', 'BARD', '2')],
      relics: ['KINFOLK_FLUTE'],
    },
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
    // Reward: the Mage class itself — 4 new party members, the "Lucky 4" ranks (3/5/7/9), like the other
    // faction rewards this campaign grants (see Mission 6's Guardian reward).
    reward: {
      recruits: [
        recruit('Corvath the Kindled', 'MAGE', '3', 'D'),
        recruit('Ophira Emberquill', 'MAGE', '5', 'S'),
        recruit('Marn Cindervoice', 'MAGE', '7', 'D'),
        recruit('Ruven Ashcaller', 'MAGE', '9', 'S'),
      ],
    },
  },
  {
    id: 4,
    title: 'Fusion of Darkness',
    story:
      "The Archive's fall points the Syndicate to a last address: a Biology Laboratory sealed since before the " +
      'corruption had a name. Whatever the staff were breeding down there got loose long ago, and every cage ' +
      'the party passes on the way in is already empty — mutated, fused, and waiting past the next door.',
    // Standard 4-4-4 escalating lineup (one of each class per tier), like the Castle deck's own J/Q/K structure,
    // but every enemy here is an "Experiment" first and a class-immunity second.
    enemies: [
      enemy('Specimen 10-C: The Clawmass', 'WARRIOR', 20, 10),
      enemy('Specimen 10-D: The Featherwrong', 'BARD', 20, 10),
      enemy('Specimen 10-H: The Bloodbloom', 'CLERIC', 20, 10),
      enemy('Specimen 10-S: The Chitinguard', 'PALADIN', 20, 10),
      enemy('Specimen 15-C: The Marrowhound', 'WARRIOR', 30, 15),
      enemy('Specimen 15-D: The Static Choir', 'BARD', 30, 15),
      enemy('Specimen 15-H: The Weeping Graft', 'CLERIC', 30, 15),
      enemy('Specimen 15-S: The Ironmoss Bear', 'PALADIN', 30, 15),
      enemy('Specimen 20-C: The Fusion Prime', 'WARRIOR', 40, 20),
      enemy('Specimen 20-D: The Discord Wing', 'BARD', 40, 20),
      enemy('Specimen 20-H: The Hollow Mercy', 'CLERIC', 40, 20),
      enemy('Specimen 20-S: The Cage-Breaker', 'PALADIN', 40, 20),
    ],
    // The mission's key mechanic: whatever card currently sits on top of the discard pile adds its value
    // straight onto the active experiment's attack, recalculated live all the way through the turn — a Cleric
    // heal reshuffling the pile mid-turn can change the number before it's even resolved.
    discardTopBuffsAttack: true,
    // An exact kill seals the specimen's card atop the reserve deck instead of the discard pile; any other
    // kill sends the played cards to the discard pile as normal, in the order the attacker chose to play them
    // — letting the party bury their high cards and leave a low one on top to blunt the next buff.
    exactKillToReserveDeck: true,
    reward: {
      recruits: [
        specialRecruit('Thessaly Brightbolt', 'MAGE', '8', 'H'),
        recruit('Brother Talyn', 'CLERIC', '9'),
      ],
    },
  },
  {
    id: 5,
    title: 'High and Mighty',
    story:
      'The Crimson Grove swallows the road south of Blackwater whole — every root and bough overtaken by the ' +
      "same bloom that broke loose from the lab. What's waiting in the canopy calls itself free now, and it's " +
      "not interested in negotiating: only in how much of the party's own deck it can make disappear.",
    // 4-4 escalating lineup (one of each of the 4 base classes per tier) — one tier lighter than Mission 4's,
    // since this mission's real difficulty is the Reaver deck-milling tradeoff, not raw enemy stats.
    enemies: [
      enemy('Sporeling Choker', 'WARRIOR', 20, 10),
      enemy('Sporeling Piper', 'BARD', 20, 10),
      enemy('Sporeling Wailer', 'CLERIC', 20, 10),
      enemy('Sporeling Bulwark', 'PALADIN', 20, 10),
      enemy('Elder Sporeling Choker', 'WARRIOR', 30, 15),
      enemy('Elder Sporeling Piper', 'BARD', 30, 15),
      enemy('Elder Sporeling Wailer', 'CLERIC', 30, 15),
      enemy('Elder Sporeling Bulwark', 'PALADIN', 30, 15),
    ],
    // Myla (value 7) sits permanently in the mission zone for the whole fight — every enemy here is immune to
    // her class the same way Mission 3's zone grants immunity, but nothing flips in or out after this (no
    // endOfTurnZoneFlip), so it's a single fixed immunity rather than a growing one.
    presetMissionZone: [zoneCompanion('Myla', 'H', '7')],
    // An exact kill on a Sporeling bursts outward: the enemy's own base attack is dealt as splash damage
    // straight into whatever's newly revealed — occasionally strong enough to chain into a second kill.
    exactKillSplashDamage: true,
    // Reward: the Reaver faction — 4 permanent new recruits. Playing one tears the top card off the reserve
    // deck for bonus damage (banished either way) and doubles the whole attack, stacking to quadruple with a
    // Warrior card in the same play.
    reward: {
      recruits: [
        recruit('Oaken', 'REAVER', '3', 'D'),
        recruit('Haror', 'REAVER', '5', 'C'),
        recruit('Vena', 'REAVER', '7', 'S'),
        recruit('Kina', 'REAVER', '10', 'H'),
      ],
    },
  },
  {
    id: 6,
    title: 'Shards of Memory',
    story:
      "The Garden of Remembrance was never meant to be walked by the living. Its statues stir as the party " +
      "crosses the threshold, and Myla — freed from the Crimson Grove but not from whatever took root in her " +
      "there — is pulled bodily from their side into the garden's center. Every foe struck down here seems to " +
      "feed something in her, and she does not forgive the debt quietly.",
    // 4-4 escalating lineup of animated statues, one tier heavier than Mission 5's — the mission's real danger
    // is Myla's ever-growing zone strike, not raw enemy stats.
    enemies: [
      enemy('Statue Warden', 'WARRIOR', 30, 15),
      enemy('Statue Cantor', 'BARD', 30, 15),
      enemy('Statue Penitent', 'CLERIC', 30, 15),
      enemy('Statue Sentinel', 'PALADIN', 30, 15),
      enemy('Graven Warden', 'WARRIOR', 40, 20),
      enemy('Graven Cantor', 'BARD', 40, 20),
      enemy('Graven Penitent', 'CLERIC', 40, 20),
      enemy('Graven Sentinel', 'PALADIN', 40, 20),
    ],
    // Myla (value 7) is stripped from the party and placed in the mission zone at the start — same static seed
    // as Mission 5's presetMissionZone, but this time nothing keeps the zone fixed: zoneVengeanceOnKill grows
    // it permanently with every kill and has her strike the party for the zone's live total each time.
    presetMissionZone: [zoneCompanion('Myla', 'H', '7')],
    // Every kill sacrifices the lowest-value card left on the enemy's table into the mission zone (never
    // cleared for the rest of the mission), then Myla strikes for the zone's full value — exact kills spare
    // the zone's single highest-value card from that one strike (see GameState.zoneVengeanceOnKill).
    zoneVengeanceOnKill: true,
    // Reward: the Guardian faction — 4 permanent new recruits, statues themselves once, freed as the garden's
    // stone cracks open around them. Playing one permanently reduces the enemy's attack by its own value —
    // the same shield a Paladin builds with Spades, off a suit-less card that stacks independently.
    reward: {
      recruits: [
        recruit('Ferro', 'GUARDIAN', '3', 'S'),
        recruit('Kesh', 'GUARDIAN', '5', 'H'),
        recruit('Ambrey', 'GUARDIAN', '7', 'D'),
        specialRecruit('Dorna', 'GUARDIAN', '9', 'C'),
      ],
    },
  },
];

export function getMission(id: number): Mission | undefined {
  return MISSIONS.find((m) => m.id === id);
}
