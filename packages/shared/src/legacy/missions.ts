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
  /** See GameState.discardCleanupLowToHigh. */
  discardCleanupLowToHigh?: boolean;
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
  /** See GameState.corruptedPartyEnemies. */
  corruptedPartyEnemies?: boolean;
  /** See GameState.startOfTurnZoneFlip. */
  startOfTurnZoneFlip?: boolean;
  /** See GameState.beastDeckMechanic. */
  beastDeckMechanic?: boolean;
  /** See GameState.pileTopEnemyBonus. */
  pileTopEnemyBonus?: boolean;
  /** See GameState.restoredCardMechanic. */
  restoredCardMechanic?: boolean;
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
 * A named one-off card seeded straight into a mission's extraReserveCards: an ordinary, drawable, playable
 * reserve-deck card with no special zone mechanic of its own — contrast zoneCompanion above, which instead
 * anchors a card permanently in the mission zone. Introduced for Mission 5's Myla (see GameState.rollingZoneBonus
 * / this mission's own entry below): sourced research found she was wrongly modeled as a permanent
 * presetMissionZone immunity fixture in the shipped version — the real rule has her as just another card in the
 * fight's reserve deck.
 */
function reserveCompanion(name: string, suit: Suit, rank: Rank): Card {
  return { id: `reserve-companion-${name.replace(/\s+/g, '-').toLowerCase()}`, kind: 'suited', suit, rank, name };
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

/**
 * Mission 12's own flavor pair, seeded into its extraReserveCards: heroes the antagonist's corruption reached
 * along the campaign's road. `restoredHero` carries SuitedCard.restored — the relic upgrade's beneficiaries,
 * healing the banish pile back into the game whenever they're played (see engine.ts's applyRestoredHeal).
 * `corruptedHero` carries the plain SuitedCard.corrupted the rest of the campaign already uses (Mission 1's full
 * corrupted court, Mission 4's corruptedReturnQueue) — the relic didn't reach these few in time, so they still pay
 * the ordinary immunity-ignoring cost, redirected to the bottom of the banish pile instead of the reserve deck
 * this mission (see engine.ts's toReserveDeck). Named separately from zoneCompanion/pilgrim above since neither
 * fits: these aren't mission-zone fixtures or Pilgrim-style rescues, just ordinary reserve-deck cards carrying one
 * of the two flags this mission's whole mechanic is built around.
 */
function restoredHero(name: string, suit: Suit, rank: Rank): Card {
  return { id: `restored-${name.replace(/\s+/g, '-').toLowerCase()}`, kind: 'suited', suit, rank, name, restored: true };
}
function corruptedHero(name: string, suit: Suit, rank: Rank): Card {
  return { id: `corrupted-${name.replace(/\s+/g, '-').toLowerCase()}`, kind: 'suited', suit, rank, name, corrupted: true };
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
 * proprietary mission text. All twelve missions of the full arc: the party's early fights against a corrupted
 * syndicate, on through the Well of Tears' Druids, Heaven's Edge's Chanters, the Twin Seed Temple, the
 * mastermind's own corrupted-hero ambush at Mission 10, the underground pursuit into Mission 11, and the
 * campaign's finale in the mastermind's own throne room at Mission 12.
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
    // A 6-enemy gauntlet of academy instructors, escalating Jack/Queen/King-style in three stat tiers (30/10 x3,
    // 40/15 x2, 60/20 x1) — mirrors the base game's own J/Q/K stat table, tripled into a mission-specific lineup.
    // Names are a placeholder invention (no verified source for them); the stat tiers and gauntlet shape came from
    // the user's own research into the physical Regicide Legacy campaign, not the tutorial transcript, which only
    // ever refers to "the enemy" singular. A fan box-inventory (talkingshelfspace.com) actually lists 7 enemy
    // cards here (4/2/1 across the same three tiers, one more bottom-tier enemy than shipped) — left as-is rather
    // than made harder, since the reported problem is this mission playing too hard, not too easy.
    //
    // These enemies used to also carry a permanent secondClass immunity (e.g. The Grand Mage immune to Bard AND
    // Paladin from turn one) on top of endOfTurnZoneFlip's own escalating immunity below — removed per two BGG
    // strategy threads (boardgamegeek.com/thread/3590127, /thread/3569333) that describe immunity as something
    // the enemy "gains... midway" through the fight, language consistent only with the zone as the sole immunity
    // source, plus no source anywhere corroborating a fixed dual immunity. Stacking a permanent second immunity
    // on top of an unbounded, only-clears-on-a-kill zone (see engine.ts's dealDamageAndCheckDefeat) was the main
    // driver of this mission being disproportionately harder than its neighbors — Mission 12's final boss had the
    // identical bug (see that mission's comment).
    //
    // SECOND PASS: removing that baked-in secondClass wasn't enough on its own — a follow-up playtest still found
    // a ~0% simulated win rate, because endOfTurnZoneFlip's own escalation was still uncapped: it kept adding a
    // NEW class of immunity on nearly every non-kill turn, and with only 4 classes total that reliably walled off
    // Hearts and/or Diamonds (the only two hand-refill tools) within a handful of turns, after which a shrinking
    // hand had no way to ever grow back for the rest of that enemy's fight. Unsourced (no source covers this
    // specific interaction) — see engine.ts's flipMissionZoneCard for the fix (the zone now never pushes an
    // enemy's immunity past however many classes it already had on its own) and the simulated before/after numbers
    // that justified it.
    enemies: [
      enemy('Midnight the Cat', 'CLERIC', 30, 10),
      enemy('Japat', 'BARD', 30, 10),
      enemy('Blast', 'WARRIOR', 30, 10),
      enemy('Senior Instructor Vail', 'PALADIN', 40, 15),
      enemy('Senior Instructor Rowe', 'CLERIC', 40, 15),
      enemy('The Grand Mage', 'BARD', 60, 20),
    ],
    // Only an exact-damage kill actually removes an enemy from the gauntlet — an overkill just recycles it to the
    // back of the line, wounds healed (same mechanic Mission 2 already uses; see GameState.exactKillOnly).
    exactKillOnly: true,
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
    //
    // SOURCED FIX (playtest-confirmed unwinnable without it — see legacy-mission-playtest-findings): both a
    // normal DEFEND discard and any enemy kill (exact or overkill) dump cards straight onto this same discard
    // pile, so surviving a hit and finishing a kill are exactly what hand the NEXT experiment its own attack
    // bonus — self-reinforcing regardless of strategy or player count, confirmed unwinnable in simulated play.
    // An independent fan digital-reimplementation's rules doc documents a permanent rule introduced at this
    // mission ("M4+ Cleanup discard ordering: when discarding played cards during cleanup, place them
    // low-to-high, lowest value on top") that is exactly the missing piece — see discardCleanupLowToHigh below.
    discardTopBuffsAttack: true,
    // An exact kill seals the specimen's card atop the reserve deck instead of the discard pile; any other
    // kill still sends the played cards to the discard pile as normal — see discardCleanupLowToHigh for the
    // ordering fix that now governs exactly how "as normal" is defined.
    exactKillToReserveDeck: true,
    // The transcript's other named mechanic: a defeated specimen doesn't stay gone — it rejoins the back of the
    // fight queue corrupted, following the same rule an ordinary corrupted party card does (ignores immunity,
    // costs a reserve-deck banish — see EnemyState.corrupted / engine.ts's resolveCommittedPlay). The shipped
    // version never had this at all; a 12-enemy mission could in principle grow past 12 fights if every specimen
    // requeues once, which is exactly the transcript's intent.
    corruptedReturnQueue: true,
    // SOURCED FIX, cited above: an independent fan digital-reimplementation's rules doc's "M4+ Cleanup discard
    // ordering" rule — cards discarded during cleanup (both a covered DEFEND and an enemy kill's played cards)
    // are placed low-to-high, so the LOWEST-value card of that batch ends up on top of the discard pile (see
    // GameState.discardCleanupLowToHigh / engine.ts's pushToDiscardPile), instead of an arbitrary order that let
    // the highest card played land on top and hand discardTopBuffsAttack its own worst-case buff right back.
    discardCleanupLowToHigh: true,
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
    // Myla (value 7) rides along in the reserve deck for this fight as an ordinary, drawable, playable card —
    // NOT a permanent presetMissionZone immunity anchor the way the mission originally shipped. Sourced research
    // (regicidelegacy.com compendium / BGG threads / a fan digital reimplementation's rules doc — see this repo's
    // legacy-missions-transcript-mismatches memory note) found no basis for a static Hearts-immunity fixture
    // here; she's just another reserve-deck body this mission, same shape as Mission 9/12's own one-off flavor
    // cards (see reserveCompanion above). She only becomes a real permanent party member starting Mission 6,
    // via this mission's reward below.
    extraReserveCards: [reserveCompanion('Myla', 'H', '7')],
    // The grove's rolling zone, per the tutorial transcript ("a rolling mission zone/banish-pile cycle each turn
    // feeds bonus strength to the current enemy"): every turn, the top card of the BANISH pile recycles into the
    // rolling zone, accumulating there — never replaced, never cleared on its own — until the next kill banishes
    // the whole pile-up and resets it. Sourced research corrected this from the shipped "one fresh card per turn
    // off the reserve deck, single slot, no cap" reading, which let the buff climb forever without ever
    // shrinking (see GameState.rollingZoneBonus / engine.ts's rollMissionZoneBonusCard). The corrected version is
    // still uncapped in principle, but bounded in practice by the banish pile's own recycling rate and reset by
    // every kill, instead of guaranteed to grow every single turn all fight long.
    rollingZoneBonus: true,
    // An exact kill on a Sporeling bursts outward: the enemy's own base attack is dealt as splash damage
    // straight into whatever's newly revealed — occasionally strong enough to chain into a second kill. This is
    // the transcript's other named mechanic ("defeating an enemy with exact damage carries bonus damage into the
    // next fight, equal to the fallen enemy's base strength") — already covered by this existing flag, no
    // separate implementation needed.
    exactKillSplashDamage: true,
    // Reward: sourced research found the shipped version over-granted here — keeping all 4 new Reaver recruits
    // permanently, when the source (and this repo's own mission-5.md transcript note: "how to permanently retire
    // cards from the party roster, used here to trim the new Reavers back down after the mission") keeps only
    // rank 5 (Haror) for good. Implemented as a straight, permanent single-recruit grant rather than
    // modeling "recruit all 4, then retire 3" as two separate steps — this campaign's reward model elsewhere
    // (e.g. Mission 11's applyBeastCardChoice) only ever tracks the FINAL kept roster, never an intermediate
    // grant-then-retire history, so the net effect (only Haror ends up in the permanent party) is the same either
    // way. Also adds the sourced-but-missing "corrupt another card" effect (see party.ts's
    // applyCorruptAnotherCard) and a second round of Dual-class Stickers. Myla (value 7) — who spent this fight
    // as an ordinary reserve-deck card, not a mission-zone fixture (see extraReserveCards above) — now joins the
    // party for real: a normal, drawable, playable Cleric card from Mission 6 onward.
    reward: {
      recruits: [recruit('Haror', 'REAVER', '5', 'C'), recruit('Myla', 'CLERIC', '7')],
      dualClassStickers: 4,
      corruptAnotherCard: true,
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
    // Every kill lets a player choose one card from the play area just committed to the kill (the defeated
    // enemy's own table) to sacrifice permanently into the mission zone, then Myla strikes for the zone's full
    // value — exact kills spare the zone's single highest-value card from that one strike, and a winning attack
    // that includes a Guardian cancels the strike entirely (see GameState.zoneVengeanceOnKill; both the
    // player-choice shape and the Guardian cancellation are sourced fixes over the original shipped
    // auto-sacrifice-with-no-Guardian-interaction — see legacy-missions-transcript-mismatches.md).
    zoneVengeanceOnKill: true,
    // Reward, sourced fix (legacy-missions-transcript-mismatches.md): the Guardian faction, but only Ferro
    // (rank 3) is kept as a permanent new recruit — the shipped version over-granted all 4 (Kesh, Ambrey, and
    // Dorna's special Aegis are dropped). Playing a Guardian card raises an absolute shield, blocking the
    // enemy's very next attack entirely (spent instantly). Plus a bonus Guardian sticker on one random existing
    // rank-8 party card (see party.ts's applyGuardianSticker), and the Azure Emblem relic — sourced fix: whenever
    // a Mage joins an attack from here on, the Mage's OWN player gets one chance to bank one of that play's Mage
    // card(s) onto the reserve deck instead of losing it to the discard pile.
    reward: {
      recruits: [recruit('Ferro', 'GUARDIAN', '3', 'S')],
      relics: ['AZURE_EMBLEM'],
      guardianSticker: true,
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
  {
    id: 10,
    // Title carried over as-is from community research — the transcript never states a title outright, so this
    // is unconfirmed (best-transcribed-from-flavor, not a transcript quote) the same way some earlier missions'
    // flavor details are caveated. "Twinseed Temple Ruins" as the location is likewise community-sourced, not
    // repeated here as a separate field since this file has no location field for any mission.
    title: 'Pride to Fall',
    story:
      "The Twin Seed Temple hasn't finished smoldering before the campaign's mastermind steps out of the ashes " +
      "to meet the party in person — and she hasn't come alone. Eight of the Golden Blade Syndicate's own, " +
      'fallen across the missions behind them and twisted by the same corruption the party has been cutting ' +
      "down all along, now stand between them and her: friends' faces, wearing an enemy's immunity.",
    // The fixed 8-enemy queue isn't a static MissionEnemySpec list like every earlier mission — per the
    // transcript, it's built at mission start from 8 of the campaign's OWN party members (see
    // GameState.corruptedPartyEnemies / deck.ts's buildCorruptedPartyEnemies), corrupted and sorted
    // weakest-to-strongest by card value, each with health fixed at 5x its (base, pre-zone-bonus) strength. Which
    // 8 members get pulled isn't specified by the transcript beyond "eight" — this picks randomly (via the
    // mission's own seeded RNG, so still reproducible) rather than, say, the 8 lowest-value party cards; a
    // judgment call, not a transcript detail.
    enemies: [],
    corruptedPartyEnemies: true,
    // Start-of-turn (not end-of-turn) mission-zone flip, feeding bonus STRENGTH onto the current enemy's own
    // dealt attack for as long as those cards sit there — materially different from Mission 3's
    // endOfTurnZoneFlip (end-of-turn timing, grants suit immunity instead of an attack buff). The transcript is
    // explicit about the start-of-turn timing; a community-research claim that this flip happens at the END of
    // the turn instead contradicts the transcript and was NOT used.
    startOfTurnZoneFlip: true,
    // Reward: no reward was transcribed for this mission (no reward video/segment exists in the source
    // transcript) — everything below is best-effort from community research alone, flagged uncertain per this
    // file's usual convention for less-certain items.
    //  - Community research describes 3 late-campaign narrative/story cards unlocking campaign progression, and
    //    the next region ("Rootmarsh") being unlocked as Mission 11's setting. Both are pure flavor/story beats
    //    with no gameplay effect of their own (mirroring how Missions 6/9's narrative reward text — Myla's arc,
    //    the temple's fate — lives only in this comment and the `story` field, not as MissionReward data) — no
    //    fabricated card names or full quotes are recorded here, only that they exist thematically, since the
    //    source fragments ("The fight is tough...", "The high arcane...", "The Syndicate's...") are too partial
    //    to reconstruct honestly.
    //  - The one reward with a real gameplay payoff — community research's "deck rehabilitation": any of the 8
    //    corrupted heroes felled with an EXACT hit during this mission (saved to the discard pile per this
    //    mission's own exact-kill rule, not banished) get restored to the permanent party roster, cleansed, once
    //    the mission ends — is mechanical, not data-driven, so it isn't encoded as a MissionReward field at all.
    //    It's implemented instead as GameState.restoredPartyCards, populated by engine.ts's
    //    dealDamageAndCheckDefeat on every exact kill and folded into the campaign party by party.ts's
    //    applyRestoredPartyCards at mission end (see RoomManager.completeLegacyMission). Marked uncertain the
    //    same way the flavor beats above are — community research, not transcript-confirmed.
    reward: {
      recruits: [],
    },
  },
  {
    id: 11,
    title: 'Descent into Darkness',
    story:
      "The party's underground pursuit leads to a cavern where their old ally is found bound to a corrupting " +
      'machine, guarded by four elite enemies.',
    // Four elite guardians, one per base class — the transcript names no stats for this mission at all, so these
    // are an invented judgment call (like every other mission's raw numbers), pitched one tier past Mission 8's
    // Wyverns (50/25) to match how deep into the campaign this fight sits.
    enemies: [
      enemy('Warden of the Depths: Ashclad', 'WARRIOR', 60, 30),
      enemy('Warden of the Depths: Bellsong', 'BARD', 60, 30),
      enemy('Warden of the Depths: Hollowmourn', 'CLERIC', 60, 30),
      enemy('Warden of the Depths: Ironvow', 'PALADIN', 60, 30),
    ],
    // Mission 4's Beast Companion cards are pulled out of the campaign party and shuffled into a face-down deck
    // that sits in the mission zone for this fight only — no Beast card is available to draw or play this
    // mission (an unrelated Mage-aligned party member is still usable as normal; see deck.ts's buildBeastDeck).
    // At the start of every turn its top card flips for a one-shot effect keyed to its class (see engine.ts's
    // flipBeastDeckCard — Mission 10's flipStartOfTurnZoneCard is the closest precedent for this shape); once it
    // runs out it reshuffles from its own used-card pile and the cycle continues. An exact kill spares the very
    // next turn's flip (see GameState.skipNextBeastDeckFlip).
    beastDeckMechanic: true,
    // The current enemy draws bonus strength AND class-immunity from whatever cards currently sit on top of the
    // discard pile and the banish pile — both recomputed live, so a Cleric heal reshuffling the discard pile (or
    // a Druid's Regrowth pulling from the banish pile) mid-turn changes the enemy's toolkit before the next play
    // even resolves (see rules.ts's pileTopImmuneSuits/banishPileTopValue, engine.ts's resolvedEnemyAttack). This
    // also changes how a defeated enemy's played cards are cleared away: per the transcript ("defeating the enemy
    // always banishes it, never recycled or discarded"), they go to the banish pile instead of the discard pile —
    // which is exactly what keeps feeding this same mechanic forward through the rest of the fight.
    pileTopEnemyBonus: true,
    // Reward: the party picks ONE of the four Beast Companion cards that spent this whole fight locked in the
    // mission-zone beast deck to carry into Mission 12 — the other three don't return to the party. Modeled as a
    // genuine pending choice (AWAIT_BEAST_REWARD_CHOICE / CHOOSE_BEAST_REWARD) instead of resolving automatically,
    // the closest existing precedent being Mission 9's AWAIT_RESCUE_CHOICE window; the pick is folded into the
    // campaign roster via the same GameState.restoredPartyCards field Mission 10's "deck rehabilitation" reward
    // already threads through to RoomManager.completeLegacyMission, just with pruning logic of its own (see
    // party.ts's applyBeastCardChoice) since Mission 11's choice REPLACES the party's beast-card slate rather than
    // just adding to it.
    reward: {
      recruits: [],
    },
  },
  {
    id: 12,
    title: 'Decay to Growth',
    story:
      "The ally freed from the corrupting machine in the depths hands the party a gift before they press on: a " +
      "way to upgrade one of their own relics, turning its corruption-craft inside out. They carry it into the " +
      "mastermind's own underground throne room, where he unleashes his corrupted royalty — Queens, Kings, and " +
      "finally the Hierarch himself — as a last line of defense between the party and the campaign's end.",
    // Queen/King/Hierarch, reusing classic Regicide's own royalty stat table (Q: 30 health / 15 attack, K: 40/20 —
    // see deck.ts's ENEMY_STATS) for the first eight, one of each base class per tier, then a final boss standing
    // a clear step past Mission 11's 60/30 elites and dual-immune like Mission 9's Myla — a title above King
    // fitting the campaign's true mastermind, only unmasked at the very end.
    enemies: [
      enemy('Queen of Ash', 'WARRIOR', 30, 15),
      enemy('Queen of Silence', 'BARD', 30, 15),
      enemy('Queen of Ruin', 'CLERIC', 30, 15),
      enemy('Queen of Thorns', 'PALADIN', 30, 15),
      enemy('King of Ash', 'WARRIOR', 40, 20),
      enemy('King of Silence', 'BARD', 40, 20),
      enemy('King of Ruin', 'CLERIC', 40, 20),
      enemy('King of Thorns', 'PALADIN', 40, 20),
      enemy('The Hierarch', 'CLERIC', 120, 30, 'PALADIN'),
    ],
    // The mission's whole mechanic, gating the restored/corrupted-card bundle (see GameState.restoredCardMechanic):
    // a previous relic gets swapped for an upgraded version this mission — restored cards ignore enemy immunity
    // like a corrupted card does, but instead of banishing a reserve card when played, they HEAL the banish
    // pile's top card back into the game, returned under the reserve deck (see engine.ts's applyRestoredHeal); a
    // restored card can never itself end up in the banish pile — anywhere that would send one there redirects it
    // to the bottom of the reserve deck instead (see engine.ts's banishCards). Corrupted cards get a rule of their
    // own too: anywhere that would put one into the reserve deck instead sends it to the bottom of the banish
    // pile (see engine.ts's toReserveDeck). Every start of turn, the top card of the banish pile moves into the
    // mission zone, adding both strength AND immunity to the current enemy (see engine.ts's
    // flipBanishPileZoneCard); defeating an enemy triggers a three-step cleanup — banish the whole mission zone,
    // then the enemy, then the entire discard pile, order preserved (see dealDamageAndCheckDefeat) — and an exact
    // kill skips the very next turn's flip (see GameState.skipNextBanishZoneFlip), mirroring Mission 11's
    // skipNextBeastDeckFlip.
    restoredCardMechanic: true,
    // The relic's beneficiaries and the few it didn't reach in time — named heroes seeded straight into this
    // mission's reserve deck (not the persisted campaign party, same as Mission 8/9's own flavor extras), giving
    // the restored/corrupted-card mechanic real cards to exercise from turn one instead of waiting on a source
    // that doesn't otherwise exist yet in this digital campaign (see missions.ts's restoredHero/corruptedHero and
    // their doc comment for the full reasoning).
    extraReserveCards: [
      restoredHero('Aldric Rootbound', 'H', '6'),
      restoredHero('Senna Brightloom', 'D', '7'),
      restoredHero('Torvin Ashendale', 'C', '5'),
      restoredHero('Wren Hollowmere', 'S', '8'),
      corruptedHero('Maren the Fallen', 'C', '9'),
      corruptedHero('Dask Emberwane', 'S', '6'),
    ],
    // No reward: the campaign's final mission — completing it ends the story, nothing further to grant. Some
    // pasted community research describes an un-banishable restored-card "immunity shield" and a Paladin power
    // that bypasses enemy immunity outright; neither appears anywhere in the transcript, so neither was used —
    // same standard this file has held to reward-by-reward since Mission 1.
    reward: {
      recruits: [],
    },
  },
];

export function getMission(id: number): Mission | undefined {
  return MISSIONS.find((m) => m.id === id);
}
