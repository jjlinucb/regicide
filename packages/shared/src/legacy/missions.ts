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
  /** See GameState.corruptedReturnQueue. */
  corruptedReturnQueue?: boolean;
  /** See GameState.exactKillSplashDamage. */
  exactKillSplashDamage?: boolean;
  /** See GameState.START_LEGACY_MISSION action's presetMissionZone. */
  presetMissionZone?: Card[];
  /** See GameState.rollingZoneBonus. */
  rollingZoneBonus?: boolean;
  /** See GameState.zoneVengeanceOnKill. */
  zoneVengeanceOnKill?: boolean;
  /** See GameState.pilgrimMechanic. */
  pilgrimMechanic?: boolean;
  /** Unshuffled Pilgrim cards seeding GameState.pilgrimDeck (see GameState.pilgrimMechanic). */
  pilgrimCards?: Card[];
  /** See GameState.ascendingZone. */
  ascendingZone?: boolean;
  /** See GameState.capturedPilesActive. */
  capturedPilesActive?: boolean;
  /** See GameAction's START_LEGACY_MISSION.extraReserveCards. */
  extraReserveCards?: Card[];
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

/**
 * Mission 4's Beast Companion reward (x4): a recruit that plays by the Animal/Beast Companion pairing rule (see
 * rules.ts's isBeastCompanion) instead of the combo rule — paired with one other card, it copies that card's
 * strength instead of contributing its own printed value.
 */
function beastRecruit(name: string, cls: ClassId, rank: RecruitSpec['rank'], suit?: Suit): RecruitSpec {
  return { name, class: cls, rank, suit, beast: true };
}

/** A one-off companion card placed straight into a mission's static presetMissionZone (never part of the reserve deck or party). */
function zoneCompanion(name: string, suit: Suit, rank: Rank): Card {
  return { id: `zone-companion-${name.replace(/\s+/g, '-').toLowerCase()}`, kind: 'suited', suit, rank, name };
}

/**
 * A named survivor card, shared by Mission 7's pilgrimCards (see GameState.pilgrimMechanic) and Mission 8's
 * ascending mission zone (see GameState.ascendingZone) — both missions independently reused "Pilgrim" as flavor
 * for stranded survivors. The `pilgrim` flag only matters to Mission 8 (placing one in its zone never buffs the
 * current enemy's attack the way an ordinary card bridging a gap does); Mission 7 never reads the flag, since it
 * tracks its own Pilgrims through the separate pilgrimDeck/pilgrimZone state instead.
 */
function pilgrim(name: string, suit: Suit, rank: Rank): Card {
  return { id: `pilgrim-${name.replace(/\s+/g, '-').toLowerCase()}`, kind: 'suited', suit, rank, name, pilgrim: true };
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
 * proprietary mission text. Currently the first eight missions of a longer arc: the party's early fights against
 * a corrupted syndicate, on through the Well of Tears' Druids and Heaven's Edge's Chanters.
 */
export const MISSIONS: Mission[] = [
  {
    id: 1,
    title: 'Call to Arms',
    story:
      "A rot has crept into the capital itself, and the Golden Blade Syndicate is summoned before the ruling " +
      "council to answer for it: storm the old stronghold and put down its full corrupted court, twelve strong " +
      "— the same fight every recruit trains on, before the campaign starts bending the rules on them.",
    enemies: [],
    standardCastle: true,
    // This mission is the tutorial baseline the rest of the campaign builds on — per the transcript, every one
    // of its "special rules" turns out to already be the engine's own default behavior, not a mission-specific
    // flag: cards played toward the fight already sit in enemy.tableCards and only reach the discard pile on
    // defeat (see engine.ts's dealDamageAndCheckDefeat/playCards — nothing here sends them to discard mid-fight);
    // a Paladin's Spades reduction already accumulates on enemy.spadesShield across the whole fight instead of
    // being recalculated per play (see resolveSuitPowers); and landing the killing blow already skips that
    // enemy's retaliation and lets the same player act first against the next one (dealDamageAndCheckDefeat's
    // `if (defeated) return ok(state); // enemy was defeated, same player continues against the next one` —
    // no AWAIT_DEFEND is ever opened for a hit that kills). The one genuine deviation from the baseline Legacy
    // ruleset — exact-kill sends the felled enemy to the top of the reserve deck instead of the discard pile —
    // reuses the existing exactKillToReserveDeck flag Mission 4 also uses. The corrupting-a-card and
    // adding-a-recruit beats the transcript shows are likewise just the existing SuitedCard.corrupted mechanic
    // and an ordinary mission reward — nothing mission-1-specific to add.
    exactKillToReserveDeck: true,
    // Reward: the Kinfolk Flute relic only — once a player commits cards to an attack, any other player may
    // silently slip in a matching card from hand to help complete the combo, no discussion allowed. (The
    // transcript names no recruit reward for this mission — the two basic recruits the shipped version invented
    // here are dropped.)
    reward: {
      recruits: [],
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
    // Reward: the Mage class itself — per the transcript, a full 10 new party members (one per non-royal rank,
    // 2 through Ace), not the "Lucky 4" ranks (3/5/7/9) the shipped version originally granted here — that
    // smaller 4-recruit pattern belongs to the later faction rewards instead (e.g. Mission 6's Guardians).
    reward: {
      recruits: [
        recruit('Ilyra Sparkwrit', 'MAGE', '2', 'H'),
        recruit('Corvath the Kindled', 'MAGE', '3', 'D'),
        recruit('Dassin Coalglow', 'MAGE', '4', 'C'),
        recruit('Ophira Emberquill', 'MAGE', '5', 'S'),
        recruit('Wystan Pyrewick', 'MAGE', '6', 'H'),
        recruit('Marn Cindervoice', 'MAGE', '7', 'D'),
        recruit('Talis Ashborn', 'MAGE', '8', 'C'),
        recruit('Ruven Ashcaller', 'MAGE', '9', 'S'),
        recruit('Sorrel Brandwake', 'MAGE', '10', 'H'),
        recruit('Kael Emberdrake', 'MAGE', 'A', 'D'),
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
    // The transcript's other named mechanic: a defeated specimen doesn't stay gone — it rejoins the back of the
    // fight queue corrupted, following the same rule an ordinary corrupted party card does (ignores immunity,
    // costs a reserve-deck banish — see EnemyState.corrupted / engine.ts's resolveCommittedPlay). The shipped
    // version never had this at all; a 12-enemy mission could in principle grow past 12 fights if every specimen
    // requeues once, which is exactly the transcript's intent.
    corruptedReturnQueue: true,
    // Reward: two relics, not the Mage/Cleric recruits the shipped version originally granted here. Beast
    // Companions (x4) play by the same Animal Companion pairing rule but copy the paired card's strength instead
    // of contributing their own flat value (see rules.ts's validatePlayShape); the Scarlet Whistle then extends
    // Mission 1's Kinfolk Flute silent-assist window to a lone Animal/Beast Companion attack (see engine.ts's
    // playCards' scarletAssist).
    reward: {
      recruits: [
        beastRecruit('Fennow', 'WARRIOR', 'A', 'C'),
        beastRecruit('Cressida', 'BARD', 'A', 'D'),
        beastRecruit('Orwick', 'CLERIC', 'A', 'H'),
        beastRecruit('Sabrielle', 'PALADIN', 'A', 'S'),
      ],
      relics: ['SCARLET_WHISTLE'],
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
    // Myla (value 7) sits permanently in the mission zone for the whole fight, immune to her own class the same
    // way Mission 3's zone grants immunity — she's the zone's fixed anchor, never flipped or banished, which is
    // what lets her still plausibly be "in the mission zone" again come Mission 6.
    presetMissionZone: [zoneCompanion('Myla', 'H', '7')],
    // The grove's *other* zone slot is what actually rolls: per the tutorial transcript ("a rolling mission
    // zone/banish-pile cycle each turn feeds bonus strength to the current enemy"), a single card cycles through
    // a second, separate slot every turn — last turn's card banished for good, a fresh one flipped in off the
    // reserve deck to replace it, its value buffing whatever Sporeling is currently being fought (see
    // GameState.rollingZoneBonus / engine.ts's rollMissionZoneBonusCard). Keeping this as its own slot instead of
    // folding it into Myla's presetMissionZone is deliberate: it satisfies the transcript's "rolling... feeds
    // bonus strength" mechanic without disturbing Myla's static presence, which Mission 6's story leans on.
    rollingZoneBonus: true,
    // An exact kill on a Sporeling bursts outward: the enemy's own base attack is dealt as splash damage
    // straight into whatever's newly revealed — occasionally strong enough to chain into a second kill. This is
    // the transcript's other named mechanic ("defeating an enemy with exact damage carries bonus damage into the
    // next fight, equal to the fallen enemy's base strength") — already covered by this existing flag, no
    // separate implementation needed.
    exactKillSplashDamage: true,
    // Reward: the Reaver faction — 4 permanent new recruits (playing one tears the top card off the reserve
    // deck for bonus damage, banished either way, and doubles the whole attack, stacking to quadruple with a
    // Warrior card in the same play) — plus a second round of Dual-class Stickers, and Myla herself (value 7),
    // who spent this whole fight locked to the mission zone as a fixed immunity and now joins the party for
    // real: a normal, drawable, playable Cleric card from Mission 6 onward.
    reward: {
      recruits: [
        recruit('Oaken', 'REAVER', '3', 'D'),
        recruit('Haror', 'REAVER', '5', 'C'),
        recruit('Vena', 'REAVER', '7', 'S'),
        recruit('Kina', 'REAVER', '10', 'H'),
        recruit('Myla', 'CLERIC', '7'),
      ],
      dualClassStickers: 4,
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
    // stone cracks open around them. Playing one raises an absolute shield, blocking the enemy's very next
    // attack entirely (spent instantly) — Dorna's Aegis holds it permanently instead, same final effect as
    // Bulwark. Plus the Azure Emblem relic: whenever a Mage joins an attack from here on, every other player
    // gets one chance to silently place a card from hand atop the reserve deck, stocking it for later.
    reward: {
      recruits: [
        recruit('Ferro', 'GUARDIAN', '3', 'S'),
        recruit('Kesh', 'GUARDIAN', '5', 'H'),
        recruit('Ambrey', 'GUARDIAN', '7', 'D'),
        specialRecruit('Dorna', 'GUARDIAN', '9', 'C'),
      ],
      relics: ['AZURE_EMBLEM'],
    },
  },
  {
    id: 7,
    title: 'Tales of Rebirth',
    story:
      "Word reaches the Syndicate of a lake gone wrong: the Well of Tears, its waters curdled black around " +
      'something vast and mechanical that sank into the silt long before the corruption had a name. Twelve of ' +
      'its broken, drowned children still patrol the shallows, and the survivors it dragged under surface one ' +
      "by one as the fight drags on — waterlogged, terrified, and no help to anyone until they're pulled clear.",
    // 4-4-4 escalating lineup — Schole (10/20), Deep (15/30), Abyssal (20/40) — one of each base class per tier,
    // same structural pattern as Mission 4's Specimens.
    enemies: [
      enemy('Schole: Glimmerfin', 'WARRIOR', 20, 10),
      enemy('Schole: Murkgill', 'BARD', 20, 10),
      enemy('Schole: Tideclaw', 'CLERIC', 20, 10),
      enemy('Schole: Brackenshell', 'PALADIN', 20, 10),
      enemy('Deep: Waterlogged', 'WARRIOR', 30, 15),
      enemy('Deep: Silttongue', 'BARD', 30, 15),
      enemy('Deep: Chorus-Eel', 'CLERIC', 30, 15),
      enemy('Deep: Ironscale', 'PALADIN', 30, 15),
      enemy('Abyssal: Wormvein', 'WARRIOR', 40, 20),
      enemy('Abyssal: Drownsong', 'BARD', 40, 20),
      enemy('Abyssal: Hollowfang', 'CLERIC', 40, 20),
      enemy('Abyssal: Leadmaw', 'PALADIN', 40, 20),
    ],
    // The Pilgrim mechanic: a survivor flips face-up into the mission zone at the start of every turn. Playing
    // an attack whose total value exactly matches a waiting Pilgrim rescues them (banished for good); every
    // enemy kill instead burns cards off the top of the reserve deck equal to whatever's still left unrescued
    // (see GameState.pilgrimMechanic).
    pilgrimMechanic: true,
    pilgrimCards: [
      pilgrim('Old Fenwick', 'H', '2'),
      pilgrim('Little Sae', 'D', '3'),
      pilgrim('Bettina the Ferrywoman', 'C', '4'),
      pilgrim('Corq Mudfoot', 'S', '5'),
      pilgrim('Sister Yvaine', 'H', '6'),
      pilgrim('Harlan Reedy', 'D', '7'),
      pilgrim('Widow Corrin', 'C', '8'),
      pilgrim('Young Thistle', 'S', '9'),
    ],
    // Reward: the Druid faction — 4 permanent new recruits, survivors themselves once, who learned something
    // from the Well before the party pulled them out. Playing one activates Regrowth: salvage cards back out of
    // the banish pile and return them to the reserve deck — Zolgar's Wellspring salvages 2 instead of 1.
    reward: {
      recruits: [
        recruit('Tolman', 'DRUID', '3', 'H'),
        recruit('Maya', 'DRUID', '5', 'D'),
        recruit('Alanta', 'DRUID', '7', 'C'),
        specialRecruit('Zolgar', 'DRUID', '9', 'S'),
      ],
    },
  },
  {
    id: 8,
    title: 'Winds of Chaos',
    story:
      "The road out of the lowlands climbs to Heaven's Edge, a knife-ridge of cliffs and waterfalls where the " +
      "wind itself seems to be arguing with the mountain. Goran, the old guide who's kept these paths safe for " +
      "a generation, meets the party at the switchback with bad news: four veils of mist further up hide a nest " +
      "of trolls, and beyond them — riding the thin air over the falls — something with wings wide enough to " +
      "blot out the sun. Villagers scattered by the storm are stranded across the cliffside path below, too " +
      'panicked to move except in a very particular order.',
    // Wave 1: 6 uniform Trolls (buffer phase). Wave 2: 6 uniform Wyverns, a full tier above anything the
    // campaign has fought yet — community consensus is they "hit like a truck," so the party had better have
    // finished the chain (and its purge) before this wave drops.
    enemies: [
      enemy('Grael Stonejaw', 'WARRIOR', 20, 10),
      enemy('Mossen Foghide', 'BARD', 20, 10),
      enemy('Rimtusk the Wet', 'CLERIC', 20, 10),
      enemy('Cragfoot', 'PALADIN', 20, 10),
      enemy('Windbroken Skarn', 'WARRIOR', 20, 10),
      enemy('The Last Bridgekeeper', 'BARD', 20, 10),
      enemy('Wyvern of the First Veil', 'CLERIC', 50, 25),
      enemy('Wyvern of the Second Veil', 'PALADIN', 50, 25),
      enemy('Wyvern of the Third Veil', 'WARRIOR', 50, 25),
      enemy('Wyvern of the Fourth Veil', 'BARD', 50, 25),
      enemy('Stormrend, Elder Wyvern', 'CLERIC', 50, 25),
      enemy("Skytallon, Warden of Heaven's Edge", 'PALADIN', 50, 25),
    ],
    // The mission zone builds an ascending A-through-10 chain instead of any prior mission's zone mode. Pilgrim
    // cards are ordinary cards here — no hand-trap restriction, playable or discardable like any other — but
    // placing one into the next open slot of the chain (via PLACE_IN_ZONE) costs nothing extra; pressing an
    // ordinary party card into the same gap works too, but buffs the current enemy's attack for as long as it
    // sits there (see GameState.ascendingZone / rules.ts's ascendingZoneAttackBuff). Completing the chain at 10
    // purges the whole zone to the discard pile, opens the Ultimate Banishment (see GameState.zonePurge), and
    // closes the zone forever.
    ascendingZone: true,
    // "Scrap," the Pilgrim Puppy, is the chain's permanent anchor — seeded straight into the zone at value 1 (an
    // Ace), never re-placed. The other 9 Pilgrims (values 2-10, the last being Goran himself) are shuffled into
    // the reserve deck alongside the party, ordinary cards in every other respect.
    presetMissionZone: [pilgrim('Scrap', 'H', 'A')],
    extraReserveCards: [
      pilgrim('Old Yarrow', 'S', '2'),
      pilgrim('Little Mireille', 'D', '3'),
      pilgrim('Bosk the Carter', 'C', '4'),
      pilgrim('Sister Halvard', 'H', '5'),
      pilgrim('Corin Drizzlecoat', 'S', '6'),
      pilgrim('Fenna Longrope', 'D', '7'),
      pilgrim('Uncle Thom', 'C', '8'),
      pilgrim('Widow Aeliss', 'H', '9'),
      pilgrim('Goran', 'S', '10'),
    ],
    // Reward: the Chanter faction — 4 permanent new recruits, survivors of the climb who picked up the mountain's
    // own rhythm. Playing one has the whole table draw its value in cards at once, even past hand limit, then
    // trim back down — a shared surge the party can use to hunt for whatever rank the chain still wants. Bram's
    // Encore doubles how many cards everyone draws.
    reward: {
      recruits: [
        recruit('Sela Windchant', 'CHANTER', '3', 'D'),
        recruit('Orin Deepvoice', 'CHANTER', '5', 'H'),
        recruit('Ketta Skysong', 'CHANTER', '7', 'C'),
        specialRecruit('Bram the Refrainkeeper', 'CHANTER', '9', 'S'),
      ],
    },
  },
  {
    id: 9,
    title: 'Hope from Ashes',
    story:
      "The party arrives at the Twin Seed Temple, a mighty tree that's stood as a beacon of light in the heart " +
      "of a dark swamp for longer than the Syndicate has existed — now offering rather less light than usual, " +
      "on account of being on fire. Myla and her cronies are here to destroy whatever the temple was built to " +
      "protect, and half the party is already scattered and captured before the first blow lands.",
    // 4-5-boss escalating lineup: 4 Loreguards (15/30), 5 Lorekeepers (20/40, the 5th dual-immune as a preview
    // of the boss to come), then Myla herself — 80 health, 20 attack, and immune to both Bard and Paladin at
    // once, no Jester-breakable weak point to lean on.
    enemies: [
      enemy('Loreguard: Ember-Wrought', 'WARRIOR', 30, 15),
      enemy('Loreguard: Cinder-Tongue', 'BARD', 30, 15),
      enemy('Loreguard: Ashbound', 'CLERIC', 30, 15),
      enemy('Loreguard: Soot-Ward', 'PALADIN', 30, 15),
      enemy('Lorekeeper: Emberclaw', 'WARRIOR', 40, 20),
      enemy('Lorekeeper: Smoke-Herald', 'BARD', 40, 20),
      enemy('Lorekeeper: Pyre-Anointed', 'CLERIC', 40, 20),
      enemy('Lorekeeper: Blaze-Warden', 'PALADIN', 40, 20),
      enemy('Lorekeeper: Myla\'s Chosen', 'BARD', 40, 20, 'PALADIN'),
      enemy('Myla', 'BARD', 80, 20, 'PALADIN'),
    ],
    // The captured-piles deckbuilding mechanic: 30 party cards are split into 3 face-down piles of 10 (top card
    // revealed) instead of joining the reserve deck. At the end of every turn (skipped entirely after a kill),
    // banish a hand card to rescue one pile's face-up card into the discard pile and flip its next card — or
    // decline, and every pile cycles its face-up card to the bottom and reveals the next one instead. An exact
    // kill sends a chosen pile's face-up card straight to the top of the reserve deck (see
    // GameState.capturedPilesActive).
    capturedPilesActive: true,
    // A fresh pool of temple acolytes, shuffled directly into the ordinary reserve deck alongside whatever's
    // left of the party after the 30-card split — unlike Mission 7's Pilgrims, these carry no zone mechanic of
    // their own, just extra reserve-deck bodies (see GameState.START_LEGACY_MISSION action's extraReserveCards).
    extraReserveCards: [
      pilgrim('Acolyte Wren', 'H', '3'),
      pilgrim('Brother Ossian', 'D', '4'),
      pilgrim('Ember-Keeper Tam', 'C', '5'),
      pilgrim('Sister Ilva', 'S', '6'),
      pilgrim('Young Petra', 'H', '7'),
      pilgrim('Elder Rasha', 'D', '8'),
    ],
    // Reward: the Evergreen Mother relic (a corrupted card's cost becomes another player banishing from their
    // own hand instead of the reserve deck's top card, or your own hand solo), Gøran joins the party carrying
    // Evergreen (all four base class powers at once, always ignoring enemy immunity — exactly what breaks
    // Myla's dual immunity open), and a second Mage sticker for one more lucky party member.
    reward: {
      recruits: [specialRecruit('Gøran', 'EVERGREEN', '10', 'H')],
      relics: ['EVERGREEN_MOTHER'],
      mageSticker: true,
    },
  },
];

export function getMission(id: number): Mission | undefined {
  return MISSIONS.find((m) => m.id === id);
}
