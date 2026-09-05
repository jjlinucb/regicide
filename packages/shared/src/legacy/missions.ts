import type { Card, LegacyEnemySpec, Rank, Suit } from '../game/types.js';
import type { ClassId } from './classes.js';
import { CLASS_THEME } from './classes.js';
import type { MissionReward, RecruitSpec } from './party.js';
import { canBeCorrupted } from './party.js';

export interface MissionEnemySpec {
  name: string;
  class: ClassId;
  /** A second class this enemy is also immune to at once (e.g. a two-headed hydra). */
  secondClass?: ClassId;
  health: number;
  attack: number;
  /** See EnemyState.rankLabel — the letter shown on this enemy's card face. Set via rankLabel() below. */
  rankLabel?: string;
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
  /**
   * When set, this exact card (by suit + rank, not a random pick) sits out this mission — excluded from the
   * reserve deck for the fight, unaffected in the persisted campaign roster (see RoomManager's
   * startLegacyMission), same "sits out, comes back automatically" shape as `sidelineCount` above. Currently
   * Mission 11 only, for Esme (6 of Clubs) — see this mission's own `reward.upgradeSidelinedCard`, which targets
   * the same identity at mission end.
   */
  sidelineIdentity?: { suit: Suit; rank: Rank };
  /**
   * UNSOURCED, per John directly: High Arcana (Mission 1's reward recruit, 25 of Diamonds) is actually Mission
   * 12's final boss and is never meant to be a playable party card at all — he sits out every mission between
   * his Mission 1 recruitment and Mission 12's own reveal (see this file's Mission 3 comment, which first flagged
   * this as a gap; RoomManager's startLegacyMission applies the same suit+rank filter sidelineIdentity uses,
   * just as its own separate flag since sidelineIdentity is already spoken for by Mission 11's Esme).
   */
  sidelineHighArcana?: boolean;
  /** See GameState.standingJesters. */
  standingJesters?: boolean;
  /**
   * Relic ids this mission puts on the table at SETUP, fully functional for the whole mission. Distinct from
   * `reward.relics`, which banks a relic permanently at mission END: these are in play for this mission only and
   * are never persisted to the campaign by themselves.
   *
   * Mission 9 only today: it starts holding 'CORRUPTED_EVERGREEN_MOTHER', which is why it needs this field at
   * all — the relic has to be on the table from that mission's SETUP, and its own reward can't grant it until
   * the mission is over. Mission 9's reward then banks the SAME relic permanently, so it also carries into
   * Missions 10-12 (John, 2026-09-04 — see that mission's entry). Nothing here marks a relic "corrupted" as a
   * state; 'CORRUPTED_EVERGREEN_MOTHER' is a relic's whole name.
   */
  startingRelics?: string[];
  /** See GameState.discardTopBuffsAttack. */
  discardTopBuffsAttack?: boolean;
  /** See GameState.exactKillToReserveDeck. */
  exactKillToReserveDeck?: boolean;
  /** See GameState.discardCleanupLowToHigh. */
  discardCleanupLowToHigh?: boolean;
  /** See GameState.exactKillSplashDamage. */
  exactKillSplashDamage?: boolean;
  /** See GameState.START_LEGACY_MISSION action's presetMissionZone. */
  presetMissionZone?: Card[];
  /** See GameState.rollingZoneBonus. */
  rollingZoneBonus?: boolean;
  /** See GameState.START_LEGACY_MISSION action's presetBanishPile. */
  presetBanishPile?: Card[];
  /** See GameState.zoneVengeanceOnKill. */
  zoneVengeanceOnKill?: boolean;
  /** See GameState.pilgrimMechanic. */
  pilgrimMechanic?: boolean;
  /** Mission 7's face-down Pilgrim deck — see GameState.pilgrimMechanic/pilgrimDeck. */
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
  /**
   * See GameAction's START_LEGACY_MISSION.randomizeEnemyOrder. UNSOURCED JUDGMENT CALL (per the user's own
   * knowledge of the physical game): every other mission's `enemies` order is fixed/sourced and must stay a fixed
   * fight order — this flag exists only for Mission 2's six hydra-kin heads, which should instead come out in a
   * fresh random order on every attempt, including retries after a loss.
   */
  randomizeEnemyOrder?: boolean;
  /**
   * See GameAction's START_LEGACY_MISSION.randomizeEnemyTierOrder. UNSOURCED JUDGMENT CALL (per the user's own
   * knowledge of the physical game): Mission 5's `enemies` list is two fixed 4-enemy tiers (weak, then strong),
   * one of each class per tier — the tier order itself (weak before strong) is sourced and stays fixed, but
   * nothing pins the four classes within a tier to always fight in the same Warrior/Bard/Cleric/Paladin order.
   * This flag reshuffles the class order within each 4-enemy tier independently on every attempt (including
   * retries after a loss), without ever letting a tier-2 enemy come up before tier 1 is cleared.
   */
  randomizeEnemyTierOrder?: boolean;
}

function enemy(name: string, cls: ClassId, health: number, attack: number, secondCls?: ClassId): MissionEnemySpec {
  return { name, class: cls, secondClass: secondCls, health, attack };
}

/**
 * Stamps the same card-face letter onto a whole group of enemies (see EnemyState.rankLabel) — a tier, or one
 * creature type. Applied to the group rather than passed into every enemy() call so the mission data reads as
 * "this block is the Jack tier", and so adding a letter never has to thread `undefined` past enemy()'s optional
 * secondClass argument.
 */
function rankLabel(label: string, enemies: MissionEnemySpec[]): MissionEnemySpec[] {
  return enemies.map((e) => ({ ...e, rankLabel: label }));
}

function recruit(name: string, cls: ClassId, rank: RecruitSpec['rank'], suit?: Suit): RecruitSpec {
  return { name, class: cls, rank, suit };
}

/** A standout reward: same as recruit(), but also grants the class's signature ability permanently. */
function specialRecruit(name: string, cls: ClassId, rank: RecruitSpec['rank'], suit?: Suit): RecruitSpec {
  return { name, class: cls, rank, special: true, suit };
}

/**
 * A Beast Companion reward recruit (Mission 4's four, and Mission 9's Ash): plays by the Animal/Beast Companion
 * pairing rule (see rules.ts's isBeastCompanion) instead of the combo rule — paired with one other card, it
 * copies that card's strength instead of contributing its own printed value. Always rank 'B', the beasts' own
 * rank (cardValue 1 when there's no partner to copy).
 *
 * `cls` is a full class, not a decoration: passed one of the 4 base classes it behaves like any other recruit of
 * that class, and passed 'MAGE' the card comes out `beast` AND `arcane` at once — party.ts's buildRecruitCard
 * already flags arcane off `spec.class`, so no separate builder is needed for a Mage beast (see Mission 9's Ash).
 * Beast-flagged recruits never join `legacy.party`: RoomManager's grantMissionReward routes every one of them to
 * the rotating `beastCompanionPool` instead, whichever mission granted it.
 */
function beastRecruit(name: string, cls: ClassId, rank: RecruitSpec['rank'], suit?: Suit): RecruitSpec {
  return { name, class: cls, rank, suit, beast: true };
}

/** A one-off companion card seeded straight into one of a mission's preset piles (presetMissionZone or presetBanishPile) — never part of the reserve deck or party. */
function zoneCompanion(name: string, suit: Suit, rank: Rank): Card {
  return { id: `zone-companion-${name.replace(/\s+/g, '-').toLowerCase()}`, kind: 'suited', suit, rank, name };
}

/**
 * Mission 5's own fight SETUP (not a reward — see this mission's reward comment below, and the mission-5
 * transcript note: "Four new Reaver party members join"): four Reaver-flagged cards added straight to the fight's
 * reserve deck via extraReserveCards, same non-persistent "mission-only" shape as chanterCompanion below (Mission
 * 8 reuses this identical pattern for its own Chanters). BUG FIX (playtest cross-check, 2026-08-28): the shipped
 * version had NO Reaver cards anywhere in Mission 5's own reserve deck — only reward.recruits granted one
 * (Haror) permanently, at mission END. That left this mission's signature deck-milling mechanic (a Reaver play
 * tears a card off the reserve deck and banishes it — see resolveCommittedPlay's reaverCards handling) with
 * nothing to ever trigger it during the actual fight, since the party held zero Reaver cards to play. That in
 * turn starved rollingZoneBonus (see GameState.rollingZoneCards / engine.ts's rollMissionZoneBonusCard), which
 * recycles the BANISH pile's top card each turn: with the banish pile never receiving anything, the rolling zone
 * buff could never grow, no matter how the fight was played. Only Haror (rank 3) is ever granted permanently via
 * reward.recruits — same "no separate grant-then-retire step needed" simplification Mission 8's Chanters use —
 * the other 3 exist only for this one fight. Ranks are 3/5/7/9 (John's ruling) rather than all rank 5 — each
 * Reaver's "Reveal and Add" reveals a number of reserve-deck cards equal to its own printed rank (see engine.ts's
 * startReaverPhase), so a higher-ranked Reaver digs deeper for the same choose-one-card-to-add bonus.
 */
function reaverCompanion(name: string, suit: Suit, rank: Rank): Card {
  return { id: `reaver-companion-${name.replace(/\s+/g, '-').toLowerCase()}`, kind: 'suited', suit, rank, name, reaver: true };
}

/**
 * A named survivor card for Mission 8's ascending mission zone (see GameState.ascendingZone). Mission 8 and
 * Mission 7 independently reused "Pilgrim" as flavor for stranded survivors and both read the `pilgrim` flag,
 * gated by their own separate mission flag so the two never collide — but only Mission 8's are individually
 * named, drawable, playable cards. Mission 7's are an anonymous 24-card deck built by pilgrimDeck() below.
 * Mission 8 only cares that a Pilgrim placed in its zone never buffs the current enemy's attack the way an
 * ordinary card bridging a gap does.
 *
 * CORRECTION (2026-09-03, John's live play — "for mission 8, the first card there is actually a pilgrim, so it
 * has no suit, right now it's marked as cleric"): these carry `noSuitPower` too, exactly like Mission 7's
 * pilgrimDeck() cards. This file used to state the opposite in so many words — that Mission 8's Pilgrims were
 * "real playable cards whose suits do resolve" — which rendered the seeded Ace as a Cleric and let a Pilgrim
 * played from hand fire a suit power. A Pilgrim is a stranded villager in both missions; being individually
 * named, drawable and playable here doesn't give it a class. The suit is now pure id/identity bookkeeping,
 * same as a Mercenary "19"'s placeholder — it still distinguishes the cards and keeps their ids unique, it just
 * never resolves. Note this also keeps them out of immunity-blocking (see continueResolveCommittedPlay's
 * nonArcaneCards filter), so a Pilgrim can always be spent into an attack regardless of what the enemy wards.
 */
function pilgrim(name: string, suit: Suit, rank: Rank): Card {
  return { id: `pilgrim-${name.replace(/\s+/g, '-').toLowerCase()}`, kind: 'suited', suit, rank, name, pilgrim: true, noSuitPower: true };
}

/**
 * Mission 7's face-down Pilgrim deck (see GameState.pilgrimMechanic): 24 interchangeable survivors — 4 copies
 * each of strength 2 through 7 — all carrying the same name, since nothing about the mechanic ever distinguishes
 * one from another (they only ever matter as a value sitting in the mission zone). SOURCED (2026-09-03, John's
 * live play, corroborated by a fan reimplementation's rules doc reading "4 copies each of values 2-7"), replacing
 * two earlier readings in turn: an 8-card run of individually named survivors at values 2-9, then a 6-card
 * 2/3/4/5/5/7 set.
 *
 * The 4 copies of each value are spread one per suit. Pilgrims have no suit power of their own (`noSuitPower`) —
 * the source describes them as suitless, and this deck never reaches a hand to be played anyway; the suit is
 * pure id/identity bookkeeping, exactly like a Mercenary "19"'s placeholder — and, since 2026-09-03, exactly
 * like pilgrim() above, whose Mission 8 cards are suitless for the same reason (see its own comment).
 */
function pilgrimDeck(): Card[] {
  const suits: Suit[] = ['H', 'D', 'C', 'S'];
  const ranks: Rank[] = ['2', '3', '4', '5', '6', '7'];
  return ranks.flatMap((rank) =>
    suits.map((suit) => ({
      id: `pilgrim-${rank}-${suit}`,
      kind: 'suited' as const,
      suit,
      rank,
      name: 'Pilgrim',
      pilgrim: true,
      noSuitPower: true,
    })),
  );
}

/**
 * Mission 8's actual Pilgrim cards (see extraReserveCards below): 24 of them — 4 copies each of values 2-7 —
 * drawn from the exact same physical "P-Box" component Mission 7's own pilgrimDeck() above already uses
 * correctly. SOURCED (2026-09-04, John's live play): the earlier single-card-per-value version only ever fixed
 * how HIGH the run went (see this mission's own "pilgrims are 1-7 only" comment, dated a day earlier) — it
 * missed this same quantity correction even though both missions draw from the identical box. Unlike Mission
 * 7's anonymous, never-drawn pilgrimDeck() cards, these are ordinary playable/discardable reserve-deck cards
 * (see pilgrim()'s own doc comment), so Mission 8 keeps its own established per-value character names — the 4
 * copies of a given value just share that value's one name, one per suit, the same way any other deck-builder
 * can hold several identical copies of one card.
 */
function mission8PilgrimCards(): Card[] {
  const suits: Suit[] = ['H', 'D', 'C', 'S'];
  const namesByRank: Record<'2' | '3' | '4' | '5' | '6' | '7', string> = {
    '2': 'Old Yarrow',
    '3': 'Little Mireille',
    '4': 'Bosk the Carter',
    '5': 'Sister Halvard',
    '6': 'Corin Drizzlecoat',
    '7': 'Fenna Longrope',
  };
  return (Object.keys(namesByRank) as (keyof typeof namesByRank)[]).flatMap((rank) =>
    suits.map((suit) => ({
      id: `pilgrim8-${rank}-${suit}`,
      kind: 'suited' as const,
      suit,
      rank,
      name: namesByRank[rank],
      pilgrim: true,
      noSuitPower: true,
    })),
  );
}

/**
 * Mission 8's own fight SETUP (not a reward — see this mission's own comment below): 4 Chanter cards, ranks
 * 3/5/7/9, added straight to the fight's reserve deck via extraReserveCards, same non-persistent "mission-only"
 * shape every other extraReserveCards helper here already has. Sourced fan-reimplementation rules doc ("Setup:
 * Add Drum 3/5/7/9 to the party") — "Drum" is that source's own name for this repo's Chanter class. Only rank 9
 * (Bram) is ever granted permanently, via reward.recruits below — these 4 aren't touched by applyReward at all,
 * so no separate "grant then retire 3" bookkeeping is needed (same simplification Mission 5's Haror reward
 * already relies on).
 */
function chanterCompanion(name: string, suit: Suit, rank: Rank): Card {
  return { id: `chanter-companion-${name.replace(/\s+/g, '-').toLowerCase()}`, kind: 'suited', suit, rank, name, chanter: true };
}


/**
 * Mission 6's own fight SETUP (not a reward — see this mission's own comment below): the 4 Guardian cards,
 * seeded straight into the fight's reserve deck via extraReserveCards, same non-persistent "mission-only" shape
 * chanterCompanion above already established for Mission 8's 4 Chanters. Sourced from this repo's own
 * tutorial_vids/summaries/mission-6.md transcript, under the mission's "How it plays / special rules" (not its
 * reward section): "Four new 'Guardian' party members join" this fight — i.e. all 4 are meant to be drawable
 * and playable DURING Mission 6 itself, not merely named in the eventual reward roster. This is what makes the
 * mission's own central Guardian-cancels-Myla mechanic (zoneVengeanceOnKill's attackIncludesGuardian check,
 * see engine.ts) actually reachable during the fight it's meant to counter — before this fix, no Guardian-class
 * card existed anywhere before Mission 6's reward granted one, at which point the fight was already won.
 * Ferro's rank ('3') and suit ('S') match the one Guardian this mission's reward keeps permanently (see
 * recruit('Ferro', ...) below) for narrative continuity — the fight-only card and the eventual permanent
 * recruit are still two separate Card instances (buildRecruitCard mints a fresh id), same as Mission 8's Bram.
 * Kesh/Ambrey/Dorna's specific ranks and suits have no source at all (the transcript names only "four Guardian
 * party members," not which one is which) — UNSOURCED JUDGMENT CALL: spread across the remaining 3 suits at
 * ranks 5/7/9, mirroring Mission 8's own 3/5/7/9 spread for its 4 Chanters. None of the 3 carry a `special`
 * ability card here (Dorna's AEGIS is a permanent-recruit-only upgrade this mission's reward explicitly drops —
 * see the reward comment below), matching how Mission 8's 3 non-kept Chanters are likewise plain companions
 * during the fight, with only the specialRecruit-granted survivor carrying its class's signature ability.
 */
function guardianCompanion(name: string, suit: Suit, rank: Rank): Card {
  return { id: `guardian-companion-${name.replace(/\s+/g, '-').toLowerCase()}`, kind: 'suited', suit, rank, name, guardian: true };
}

/**
 * Mission 7's own reward faction (Druids), seeded into its extraReserveCards so all 4 are drawable and playable
 * DURING the fight, same non-persistent "mission-only" shape every other class's companion helper above already
 * has (Reavers at Mission 5, Guardians at Mission 6, Chanters at Mission 8) — confirmed live 2026-09-03: the
 * Druids should be reachable in the fight itself, not just handed over cold as a post-mission reward. Ranks/suits
 * match the permanent recruits this mission's reward grants (see recruit('Tolman', ...) etc. below) for narrative
 * continuity — the fight-only card and the eventual permanent recruit are still two separate Card instances
 * (buildRecruitCard mints a fresh id), same as Mission 6's Ferro/Mission 8's Bram.
 */
function druidCompanion(name: string, suit: Suit, rank: Rank): Card {
  return { id: `druid-companion-${name.replace(/\s+/g, '-').toLowerCase()}`, kind: 'suited', suit, rank, name, druid: true };
}

/**
 * Mission 12's own flavor pair, seeded into its extraReserveCards: heroes the antagonist's corruption reached
 * along the campaign's road. `restoredHero` carries SuitedCard.restored — the relic upgrade's beneficiaries,
 * healing the banish pile back into the game whenever they're played (see engine.ts's applyRestoredHeal).
 * `corruptedHero` carries the plain SuitedCard.corrupted the rest of the campaign already uses (Mission 1's full
 * corrupted court) — the relic didn't reach these few in time, so they still pay
 * the ordinary immunity-ignoring cost, redirected to the bottom of the banish pile instead of the reserve deck
 * this mission (see engine.ts's toReserveDeck). Named separately from zoneCompanion/pilgrim above since neither
 * fits: these aren't mission-zone fixtures or Pilgrim-style rescues, just ordinary reserve-deck cards carrying one
 * of the two flags this mission's whole mechanic is built around.
 */
function restoredHero(name: string, suit: Suit, rank: Rank): Card {
  return { id: `restored-${name.replace(/\s+/g, '-').toLowerCase()}`, kind: 'suited', suit, rank, name, restored: true };
}
function corruptedHero(name: string, suit: Suit, rank: Rank): Card {
  const card: Card = { id: `corrupted-${name.replace(/\s+/g, '-').toLowerCase()}`, kind: 'suited', suit, rank, name };
  // Authored mission data is held to the same corruption eligibility rule as a reward's random pick (party.ts's
  // canBeCorrupted — rank 2-9, base class only, never a Mage). Thrown at module load rather than filtered
  // silently: MISSIONS is static, so this can only ever fire on a bad edit to the two entries below, and a loud
  // failure the first test run catches beats shipping a card the rules say cannot exist.
  if (!canBeCorrupted(card)) {
    throw new Error(`Mission data error: "${name}" (${suit}${rank}) is not an eligible corruption target — see party.ts's canBeCorrupted.`);
  }
  return { ...card, corrupted: true };
}

/** Converts a mission's enemy specs into the engine's LegacyEnemySpec shape (suit-keyed). Mage enemies aren't used yet — the class only exists as a party reward so far. */
export function missionEnemiesToSpecs(enemies: MissionEnemySpec[]): LegacyEnemySpec[] {
  return enemies.map((e) => ({
    name: e.name,
    suit: CLASS_THEME[e.class].suit!,
    secondSuit: e.secondClass ? CLASS_THEME[e.secondClass].suit : undefined,
    health: e.health,
    attack: e.attack,
    rankLabel: e.rankLabel,
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
    // reuses the existing exactKillToReserveDeck flag Mission 4 also uses. A fuller solo playthrough (Meet Me at
    // the Table, "Mission 2 & 3 Playthrough") than whatever this file's original note above was based on shows
    // the corrupting-a-card and adding-a-recruit beats ARE this mission's actual reward, not just narration —
    // see reward.corruptAnotherCard and the "High Arcana" recruit below.
    exactKillToReserveDeck: true,
    // Same standing-Jester house rule as Missions 2/3 (see GameState.standingJesters), now extended to every
    // mission per John's own call — no reason the earliest, tutorial-baseline mission should be the one place a
    // drawn-but-unused Jester can still go stale in the deck.
    standingJesters: true,
    // Reward: the Kinfolk Flute relic only — each player gets a personal storage slot on the flute, and may bank
    // one hand card worth 2-5 onto it (once per turn, a free side-action alongside their normal play). It sits
    // there for as long as needed until a matching-rank hand card lets them play the two together as a combo
    // (see engine.ts's BANK_KINFOLK_CARD / PLAY_CARDS's includeKinfolkSlot). Sourced correction: the shipped
    // version instead had another player silently slip in a matching card to help complete someone else's combo
    // — which did nothing at all in solo play (no one else at the table to help) and isn't what a fan digital
    // reimplementation's own rules doc describes ("store a card... once per turn. Cards on the flute can be
    // included in combos") — see the legacy-missions-transcript-mismatches memory doc.
    //
    // Reward also includes (sourced from the same solo playthrough above): the sourced-elsewhere
    // corruptAnotherCard step (permanently corrupts one random EXISTING party member — never this same reward's
    // own new recruit, see party.ts's applyCorruptAnotherCard), and a new one-off recruit, "High Arcana" — a flat
    // 25 value with no class ability shown at the point it's granted, so it's modeled as an ordinary base-class
    // recruit rather than folded into the (unbuilt in this codebase) Mage mechanic Mission 3 introduces later.
    // UNSOURCED JUDGMENT CALL: no footage shows this card's suit — picked Bard (Diamonds) arbitrarily.
    reward: {
      recruits: [{ name: 'High Arcana', class: 'BARD', rank: '25' }],
      relics: ['KINFOLK_FLUTE'],
      corruptAnotherCard: true,
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
      // Card faces: every head of the brood is lettered H for hydra (John's call — see EnemyState.rankLabel).
      ...rankLabel('H', [
        enemy('Coilfang Broodling', 'CLERIC', 20, 10, 'BARD'),
        enemy('Ashmaw Broodling', 'CLERIC', 20, 10, 'WARRIOR'),
        enemy('Duskscale Broodling', 'CLERIC', 20, 10, 'PALADIN'),
        enemy('Bramble-Throat Broodling', 'BARD', 20, 10, 'WARRIOR'),
        enemy('Grey Fen Broodling', 'BARD', 20, 10, 'PALADIN'),
        enemy('The Nine-Coiled Matriarch', 'WARRIOR', 20, 10, 'PALADIN'),
      ]),
    ],
    exactKillOnly: true,
    // UNSOURCED HOUSE RULE (John's own call from the physical game, not the tutorial videos): this mission's 2
    // Jesters are never shuffled into the reserve deck — with only 6 enemies and heavy dual-immunity gating, they
    // could sit undrawn for the whole fight. Instead they're a standing resource any player may use, anytime, as
    // their own turn's action (see GameState.standingJesters / GameAction.USE_STANDING_JESTER) — no player needs
    // to draw one into hand first. This replaces an earlier, narrower house rule that instead restricted a
    // hand-played Jester's claim to only the next player in turn order; that no longer applies now that any
    // player can use a standing Jester directly, for themselves.
    standingJesters: true,
    // UNSOURCED JUDGMENT CALL (per the user's own knowledge of the physical game): unlike every other mission's
    // fixed/sourced enemy order, this brood's six heads should come out shuffled, and reshuffled again on every
    // retry after a loss — not the same fixed sequence every attempt (see engine.ts's startLegacyMission).
    randomizeEnemyOrder: true,
    // High Arcana (Mission 1's own reward recruit) sits out here too — see MissionDef.sidelineHighArcana.
    sidelineHighArcana: true,
    // Reward: Dual-class Stickers — 4 random existing party members each gain a second class icon, so that
    // single card triggers both class powers whenever it's played.
    //
    // JOHN, 2026-09-04 (live play): this mission ALSO corrupts a card. Mission 10's eight enemies are the
    // campaign's own corrupted party members, one per rank 2 through 9 — so exactly eight missions have to carry
    // this step, and Missions 2 and 3 were the two that were missing it (see party.ts's
    // MissionReward.corruptAnotherCard, which lists all eight). A dual-class sticker doesn't protect a card from
    // it either: a second SUIT isn't a special class, so a card can hold both (party.ts's hasSpecialClass).
    reward: { recruits: [], dualClassStickers: 4, corruptAnotherCard: true },
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
    // Card faces: M for Mage across the whole academy (John's call) — the familiars, the Senior Instructors and
    // The Grand Mage are all mages, so they share one letter rather than splitting by tier (see
    // EnemyState.rankLabel). Note the boss keeps M too, unlike Missions 9/11/12's named bosses, which take
    // their own initial: his own name already ends in "Mage", so the tier letter IS his initial.
    enemies: rankLabel('M', [
      enemy('Midnight the Cat', 'CLERIC', 30, 10),
      enemy('Japat', 'BARD', 30, 10),
      enemy('Blast', 'WARRIOR', 30, 10),
      enemy('Senior Instructor Vail', 'PALADIN', 40, 15),
      enemy('Senior Instructor Rowe', 'CLERIC', 40, 15),
      enemy('The Grand Mage', 'BARD', 60, 20),
    ]),
    // Only an exact-damage kill actually removes an enemy from the gauntlet — an overkill just recycles it to the
    // back of the line, wounds healed (same mechanic Mission 2 already uses; see GameState.exactKillOnly).
    exactKillOnly: true,
    // One random party member sits this mission out, and every end of turn the reserve deck feeds the fire
    // another class of immunity (see GameState.endOfTurnZoneFlip / missionZone).
    sidelineCount: 1,
    // UNSOURCED, per John directly: High Arcana (Mission 1's reward recruit, 25 of Diamonds — see this file's
    // Mission 1 entry) is actually Mission 12's final boss and is never meant to be a playable party card at all.
    // He was only ever explicitly pulled out of the deck for Mission 3, so that's all this fixes for now — FLAGGED
    // GAP: the same exclusion likely belongs on every mission between his Mission 1 recruitment and Mission 12's
    // reveal, not just this one, but that's out of scope until confirmed.
    sidelineIdentity: { suit: 'D', rank: '25' },
    endOfTurnZoneFlip: true,
    // Same standing-Jester house rule as Mission 2 (see GameState.standingJesters) — this mission's own Jesters
    // are also easy to go a whole fight without ever drawing, especially once endOfTurnZoneFlip's escalating
    // immunity walls off Hearts/Diamonds (this engine's only two hand-refill classes).
    standingJesters: true,
    // Reward: the Mage class itself — per the transcript, a full 10 new party members (one per non-royal rank,
    // 2 through Ace), not the "Lucky 4" ranks (3/5/7/9) the shipped version originally granted here — that
    // smaller 4-recruit pattern belongs to the later faction rewards instead (e.g. Mission 6's Guardians).
    //
    // JOHN, 2026-09-04 (live play): this mission also corrupts a card — the second of the two that were missing
    // the step (see Mission 2's own reward comment, and party.ts's MissionReward.corruptAnotherCard for the full
    // eight-mission ladder). None of the ten Mages granted here can be the victim, on two counts: a Mage can
    // never be corrupted at all (party.ts's canBeCorrupted), and applyCorruptAnotherCard excludes this same
    // reward's own new recruits regardless.
    reward: {
      corruptAnotherCard: true,
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
    // Card faces: S for Specimen — every enemy here is one, across all three tiers (see EnemyState.rankLabel).
    // Deliberately NOT J/Q/K despite the same 4/4/4 tier shape as Mission 7: these are lab specimens, and the
    // tier is already spelled out in each one's own name (10-/15-/20-).
    enemies: rankLabel('S', [
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
    ]),
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
    // SOURCED FIX, cited above: an independent fan digital-reimplementation's rules doc's "M4+ Cleanup discard
    // ordering" rule — cards discarded during cleanup (both a covered DEFEND and an enemy kill's played cards)
    // are placed low-to-high, so the LOWEST-value card of that batch ends up on top of the discard pile (see
    // GameState.discardCleanupLowToHigh / engine.ts's pushToDiscardPile), instead of an arbitrary order that let
    // the highest card played land on top and hand discardTopBuffsAttack its own worst-case buff right back.
    discardCleanupLowToHigh: true,
    // Same standing-Jester house rule as Missions 1-3 (see GameState.standingJesters), extended to every mission.
    standingJesters: true,
    // High Arcana sits out here too — see MissionDef.sidelineHighArcana.
    sidelineHighArcana: true,
    // Reward: two relics, not the Mage/Cleric recruits the shipped version originally granted here. Beast
    // Companions (x4) play by the same Animal Companion pairing rule but copy the paired card's strength instead
    // of contributing their own flat value (see rules.ts's validatePlayShape); the Scarlet Whistle then opens the
    // same silent multiplayer combo-assist window (see GameState.comboAssist) to a lone Animal/Beast Companion
    // attack — the window Mission 1's Kinfolk Flute used to share before being reworked into each player's own
    // personal storage slot instead (see engine.ts's playCards' scarletAssist).
    //
    // SOURCED CORRECTION (a full solo playthrough — see tutorial_vids/summaries/mission-4.md): Gøran also joins
    // the party in this mission's own ending, as a basic rank-8 card (no suit/class revealed on-screen at this
    // point). An earlier, shorter source had already flagged this exact gap, but by the time it was found, this
    // mission had already shipped without him — he was deferred to Mission 8 instead as a stopgap (see that
    // mission's own reward comment, and party.ts's upgradeEvergreenCard doc for how Mission 9 later upgrades him
    // by name regardless of which mission actually recruits him). This playthrough is a direct, in-context
    // confirmation rather than a compendium paraphrase, so he now joins HERE instead, matching the source; Mission
    // 8 no longer recruits him.
    // SOURCED CORRECTION (2026-09-02 live-play confirmation): "no suit/class revealed on-screen" above is literal
    // — he's recruited fully inert (RecruitSpec.noSuitPower), a plain rank-8 that does nothing when played. His
    // placeholder suit (Spades) never resolves while inert, so its value is bookkeeping-only, same as Myla's
    // placeholder Hearts elsewhere. Mission 5's own reward switches his class power on for the first time (Clubs/
    // Warrior — see MissionReward.suitByName), and Mission 6's reward adds Spades/Paladin as a real second suit
    // on top of that (see MissionReward.secondSuitByName).
    // "Dr. Darkness" story card (a campaign-book pack-opening event, per John's photo): "some in the Syndicate
    // grow attached to their newfound power" — corrupts one random existing party member. Reuses the same
    // corruptAnotherCard reward step Missions 1/5/8 already use (see party.ts's applyCorruptAnotherCard):
    // SuitedCard.corrupted, so it ignores enemy immunity but banishes the reserve deck's top card as the cost.
    reward: {
      recruits: [
        beastRecruit('Fennow', 'WARRIOR', 'B', 'C'),
        beastRecruit('Cressida', 'BARD', 'B', 'D'),
        beastRecruit('Orwick', 'CLERIC', 'B', 'H'),
        beastRecruit('Sabrielle', 'PALADIN', 'B', 'S'),
        { name: 'Goran', class: 'PALADIN', rank: '8', suit: 'S', noSuitPower: true },
      ],
      relics: ['SCARLET_WHISTLE'],
      corruptAnotherCard: true,
    },
  },
  {
    id: 5,
    title: 'High and Mighty',
    story:
      'The Crimson Grove swallows the road south of Blackwater whole — every root and bough overtaken by the ' +
      "same bloom that broke loose from the lab. What's waiting in the canopy calls itself free now, and it's " +
      "not interested in negotiating: only in how much of the party's own deck it can make disappear.",
    // 4-4 escalating lineup (one of each of the 4 base classes per tier), per newer sourced material (Reddit/BGG
    // threads + a BGG campaign-playthrough video, see this repo's legacy-missions-transcript-mismatches memory
    // note): 4 Sporelings (weak tier) then 4 Gloom Spores (strong tier) — a real stat jump over the earlier,
    // lighter "Elder Sporeling" reading this replaces, matching the source's description of Gloom Spores boasting
    // some of the highest base health seen up to this point in the campaign. The order written below (Warrior,
    // Bard, Cleric, Paladin within each tier) is just this list's own fixed declaration order, not a sourced fight
    // order — randomizeEnemyTierOrder (below) reshuffles each tier's 4 classes independently every attempt, while
    // still guaranteeing all 4 weak-tier Sporelings fall before any strong-tier Gloom Spore (John's call).
    // Card faces: S for the Sporelings, G for the Gloom Spores (see EnemyState.rankLabel) — one letter per tier,
    // same shape as Mission 8's trolls-then-wyverns.
    enemies: [
      ...rankLabel('S', [
        enemy('Sporeling Choker', 'WARRIOR', 40, 10),
        enemy('Sporeling Piper', 'BARD', 40, 10),
        enemy('Sporeling Wailer', 'CLERIC', 40, 10),
        enemy('Sporeling Bulwark', 'PALADIN', 40, 10),
      ]),
      ...rankLabel('G', [
        enemy('Gloom Spore Choker', 'WARRIOR', 60, 15),
        enemy('Gloom Spore Piper', 'BARD', 60, 15),
        enemy('Gloom Spore Wailer', 'CLERIC', 60, 15),
        enemy('Gloom Spore Bulwark', 'PALADIN', 60, 15),
      ]),
    ],
    // Myla (value 7) starts this fight seeded into the BANISH pile, per the newer sourced transcript ("her 7
    // Strength card starts in the banish pile and immediately slides into the Mission Zone... a passive force
    // multiplier boosting the attack value of whichever Sporeling or Gloom Spore is currently active") — seeded
    // via presetBanishPile below, rather than as an ordinary reserve-deck card (an earlier session's reading,
    // since superseded by this newer source). Confirmed against actual gameplay footage: "immediately slides
    // into the Mission Zone" means via the mission's own normal end-of-turn banish-pile recycle (see
    // rollMissionZoneBonusCard), not an instant mission-start seed straight into the rolling zone — turn 1's
    // attack lands at the enemy's unbuffed base value, and only from turn 2 onward, once she's recycled in,
    // does the +7 apply. An earlier version of this seed skipped the banish pile and put her directly into
    // rollingZoneCards, which made the buff live one attack too early. She only becomes a real permanent party
    // member starting Mission 6, via this mission's reward below.
    //
    // The 4 Reavers named in the mission-5 transcript ("Four new Reaver party members join") ride along in the
    // reserve deck for real — see reaverCompanion's own doc comment for why this matters beyond flavor: without
    // them actually in the fight's reserve deck, nothing can ever trigger a Reaver's "Reveal and Add" mechanic —
    // the ONLY thing that ever adds to the banish pile during Mission 5 beyond Myla's own single preset card
    // above — and rollingZoneBonus below reads its buff from exactly that pile. Ranks 3/5/7/9 (John's ruling).
    // Confirmed live (2026-08-30): the rank-5 Reaver (Haror) is the one kept permanently by the reward below, NOT
    // rank 3 (an earlier reading had this backwards) — Skarn Hollowtooth now takes the rank-3/Clubs slot Haror
    // used to hold, and Haror takes the rank-5/Spades slot Skarn used to hold, so the identity reward.recruits
    // grants permanently still matches the card that actually fights at that rank in this mission. The other 2
    // names/suits are an unsourced judgment call (no source names them individually), one per remaining suit.
    extraReserveCards: [
      reaverCompanion('Skarn Hollowtooth', 'C', '3'),
      reaverCompanion('Haror', 'S', '5'),
      reaverCompanion('Petra Duskfang', 'H', '7'),
      reaverCompanion('Yorrin Grimtide', 'D', '9'),
    ],
    // The grove's rolling zone, per the tutorial transcript ("a rolling mission zone/banish-pile cycle each turn
    // feeds bonus strength to the current enemy"): every turn, the top card of the BANISH pile recycles into the
    // rolling zone, accumulating there — never replaced, never cleared on its own — until the next kill banishes
    // the whole pile-up and resets it. Sourced research corrected this from the shipped "one fresh card per turn
    // off the reserve deck, single slot, no cap" reading, which let the buff climb forever without ever
    // shrinking (see GameState.rollingZoneBonus / engine.ts's rollMissionZoneBonusCard). The corrected version is
    // still uncapped in principle, but bounded in practice by the banish pile's own recycling rate and reset by
    // every kill, instead of guaranteed to grow every single turn all fight long.
    rollingZoneBonus: true,
    presetBanishPile: [zoneCompanion('Myla', 'H', '7')],
    // An exact kill on a Sporeling bursts outward: the enemy's own base attack is dealt as splash damage
    // straight into whatever's newly revealed — occasionally strong enough to chain into a second kill. This is
    // the transcript's other named mechanic ("defeating an enemy with exact damage carries bonus damage into the
    // next fight, equal to the fallen enemy's base strength") — already covered by this existing flag, no
    // separate implementation needed.
    exactKillSplashDamage: true,
    // Reward: sourced research found the shipped version over-granted here — keeping all 4 new Reaver recruits
    // permanently, when the source (and this repo's own mission-5.md transcript note: "how to permanently retire
    // cards from the party roster, used here to trim the new Reavers back down after the mission") keeps only
    // rank 5 (Haror — see extraReserveCards above for the rank swap) for good. Implemented as a straight,
    // permanent single-recruit grant rather than modeling "recruit all 4, then retire 3" as two separate steps —
    // this campaign's reward model elsewhere (e.g. Mission 11's applyBeastCardChoice) only ever tracks the FINAL
    // kept roster, never an intermediate grant-then-retire history, so the net effect (only Haror ends up in the
    // permanent campaign PARTY roster) is the same either way. That equivalence is scoped to the permanent
    // roster only, though — it does NOT excuse the 4 Reavers from also needing to actually join THIS FIGHT'S
    // reserve deck (see extraReserveCards above and reaverCompanion's doc comment): a prior version of this
    // comment conflated the two and skipped seeding them into extraReserveCards entirely, which silently broke
    // rollingZoneBonus by starving it of anything to ever put in the banish pile. Also adds the sourced-but-
    // missing "corrupt another card" effect (see party.ts's applyCorruptAnotherCard) and a second round of
    // Dual-class Stickers.
    //
    // Myla (value 7) is NOT a reward here. She spends this fight seeded into the banish pile (presetBanishPile
    // above) and that's the whole of her time with the party — an interlude, not a recruit (John, 2026-09-03).
    // She never becomes a playable card at any point in the campaign: Mission 6 seeds her into its own mission
    // zone as the thing the party is fighting around, and Mission 9 brings her back as that mission's boss.
    // Earlier passes had this mission permanently recruit her (first as a working Cleric, then — after a live
    // 2026-08-30 correction — as a plain rank-7 card with `noSuitPower`); both readings are superseded, and the
    // card is gone from the roster entirely rather than being kept in a powerless form.
    //
    // Goran (recruited back at Mission 4 as an inert rank-8 card, no working suit — see that mission's reward
    // comment) has his class power switched on for the first time here, with Clubs (Warrior) as the suit that
    // resolves (`suitByName`), confirmed live — Mission 6's reward later adds Spades (Paladin) as a real second
    // suit on top of this, the same "second class" shape Dual-class Stickers grant randomly elsewhere, just
    // targeted: Goran is rank 8, outside the "Lucky 4" 3/5/7/9 ranks that generic mechanic targets, so he'd never
    // be reachable by it otherwise.
    //
    // `reaverStickerChoice`: confirmed live — after this mission, the player picks one of their existing
    // eligible rank-6 Bard/Cleric/or Paladin party members (never Warrior) to permanently gain a bonus Reaver
    // sticker (see party.ts's reaverStickerEligible/applyReaverStickerChoice, GameState's secondClassReaver doc).
    // A genuine player choice, unlike the Mage/Guardian stickers elsewhere in this file — resolved from the
    // campaign lobby (see CampaignLobbyPage's ReaverStickerPicker), not auto-applied by applyReward.
    standingJesters: true,
    sidelineHighArcana: true,
    randomizeEnemyTierOrder: true,
    reward: {
      recruits: [recruit('Haror', 'REAVER', '5', 'S')],
      dualClassStickers: 4,
      corruptAnotherCard: true,
      suitByName: { name: 'Goran', suit: 'C' },
      reaverStickerChoice: true,
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
    // Card faces: S for the Statues, G for the Graven (see EnemyState.rankLabel) — one letter per tier.
    enemies: [
      ...rankLabel('S', [
        enemy('Statue Warden', 'WARRIOR', 30, 15),
        enemy('Statue Cantor', 'BARD', 30, 15),
        enemy('Statue Penitent', 'CLERIC', 30, 15),
        enemy('Statue Sentinel', 'PALADIN', 30, 15),
      ]),
      ...rankLabel('G', [
        enemy('Graven Warden', 'WARRIOR', 40, 20),
        enemy('Graven Cantor', 'BARD', 40, 20),
        enemy('Graven Penitent', 'CLERIC', 40, 20),
        enemy('Graven Sentinel', 'PALADIN', 40, 20),
      ]),
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
    // Bug fix: the Guardian-cancels-Myla mechanic just above is this mission's one real counter to its own
    // central threat, but no Guardian-class card existed anywhere in the game before this same mission's reward
    // granted one (see the reward comment below) — by which point the fight that mechanic is meant to counter
    // is already over. Sourced from this repo's own tutorial_vids/summaries/mission-6.md transcript: "Four new
    // 'Guardian' party members join" is listed under the mission's "How it plays / special rules," not its
    // reward — i.e. all 4 Guardians (Ferro, Kesh, Ambrey, Dorna) are meant to be drawable and playable DURING
    // this fight, same shape as Mission 8's 4 Chanter cards entering THAT fight via extraReserveCards before
    // its own reward keeps only 1 of them permanently (see guardianCompanion's doc comment above for the
    // ranks/suits judgment call on the 3 that aren't sourced by name).
    extraReserveCards: [
      guardianCompanion('Ferro', 'S', '3'),
      guardianCompanion('Kesh', 'H', '5'),
      guardianCompanion('Ambrey', 'D', '7'),
      guardianCompanion('Dorna', 'C', '9'),
    ],
    // Reward, sourced fix (legacy-missions-transcript-mismatches.md): the Guardian faction, but only Ferro
    // (rank 3) is kept as a permanent new recruit — the shipped version over-granted all 4 (Kesh, Ambrey, and
    // Dorna's special Aegis are dropped). Playing a Guardian card raises an absolute shield, blocking the
    // enemy's very next attack entirely (spent instantly). Plus a bonus Guardian sticker the player picks for one
    // of their existing rank-8 party cards (confirmed live 2026-09-02 — see party.ts's
    // guardianStickerEligible/applyGuardianStickerChoice, CampaignLobbyPage's GuardianStickerPicker; a genuine
    // player choice, like Mission 5's Reaver sticker, not an automatic random pick), and the Azure Emblem relic —
    // sourced fix: whenever a Mage joins an attack from here on, the Mage's OWN player gets one chance to bank
    // one of that play's Mage card(s) onto the reserve deck instead of losing it to the discard pile.
    // SOURCED CORRECTION (2026-09-02 live-play confirmation): this mission's reward also grants Goran (Clubs/
    // Warrior switched on by Mission 5's own reward, see that mission's comment) Spades (Paladin) as a real
    // second suit (`secondSuitByName`) — an earlier reading had this granted a mission early, at Mission 5 —
    // plus another round of the sourced-but-previously-missing "corrupt another card" effect (see party.ts's
    // applyCorruptAnotherCard), same as Missions 1/5/8.
    standingJesters: true,
    sidelineHighArcana: true,
    reward: {
      recruits: [recruit('Ferro', 'GUARDIAN', '3', 'S')],
      relics: ['AZURE_EMBLEM'],
      guardianStickerChoice: true,
      secondSuitByName: { name: 'Goran', suit: 'S' },
      corruptAnotherCard: true,
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
    // Card faces: this mission's three escalating tiers ARE the campaign's Jack/Queen/King equivalents (John's
    // call), so they're lettered J, Q, K rather than all sharing the placeholder (see EnemyState.rankLabel).
    enemies: [
      ...rankLabel('J', [
        enemy('Schole: Glimmerfin', 'WARRIOR', 20, 10),
        enemy('Schole: Murkgill', 'BARD', 20, 10),
        enemy('Schole: Tideclaw', 'CLERIC', 20, 10),
        enemy('Schole: Brackenshell', 'PALADIN', 20, 10),
      ]),
      ...rankLabel('Q', [
        enemy('Deep: Waterlogged', 'WARRIOR', 30, 15),
        enemy('Deep: Silttongue', 'BARD', 30, 15),
        enemy('Deep: Chorus-Eel', 'CLERIC', 30, 15),
        enemy('Deep: Ironscale', 'PALADIN', 30, 15),
      ]),
      ...rankLabel('K', [
        enemy('Abyssal: Wormvein', 'WARRIOR', 40, 20),
        enemy('Abyssal: Drownsong', 'BARD', 40, 20),
        enemy('Abyssal: Hollowfang', 'CLERIC', 40, 20),
        enemy('Abyssal: Leadmaw', 'PALADIN', 40, 20),
      ]),
    ],
    // The Pilgrim mechanic (see GameState.pilgrimMechanic for the full rule and the revision history behind it):
    // a separate face-down 24-card deck (see pilgrimDeck above) that never touches the reserve deck. One flips
    // face-up into the mission zone at the start of every turn and piles up there; every kill burns their
    // combined value off the top of the reserve deck and then sweeps the zone to the discard pile. Playing a card
    // whose value exactly matches a waiting Pilgrim banishes them out of that tally for good, and an exact kill
    // carries the zone's highest-value Pilgrim clear before the burn is counted.
    //
    // SOURCED CORRECTION (2026-09-03 live play) over the compendium FAQ's hand-trap reading this mission shipped
    // with — see GameState.pilgrimMechanic for why that reading was replaced.
    pilgrimMechanic: true,
    pilgrimCards: pilgrimDeck(),
    // Confirmed live 2026-09-03: the 4 Druids are drawable and playable during this fight too, not just handed
    // over cold as the post-mission reward below — see druidCompanion's own doc comment.
    extraReserveCards: [
      druidCompanion('Tolman', 'H', '3'),
      druidCompanion('Maya', 'D', '5'),
      druidCompanion('Alanta', 'C', '7'),
      druidCompanion('Zolgar', 'S', '9'),
    ],
    // Reward, SOURCED CORRECTION (a fan reimplementation's rules doc — "Remove Druid 3/5/9 from the party (keep
    // Druid 7)... add the Druid suit to the 4♦, 4♠, or 4♣... Corrupt another card" — confirmed by John
    // 2026-09-03): the Druid faction arrives as survivors who learned something from the Well, but only the
    // rank-7 Druid (Alanta) stays for good. The shipped version over-granted all 4 permanently, Zolgar's
    // Wellspring special included; 3/5/9 are dropped, exactly the same "all 4 join the fight via
    // extraReserveCards, 1 is kept by the reward" shape Missions 6 and 8 already use for their own factions.
    //
    // Playing a Druid activates Regrowth: the whole discard pile is dealt out across the table and every player
    // assigns up to 4 of the cards dealt to them — one to hand, one banished, one to the top of the reserve deck,
    // one to the bottom — with the rest returning to the discard pile (see GameState.druidWindow). Plus a bonus
    // Druid sticker the player picks for one of the 4♦/4♣/4♠ (see MissionReward.druidStickerChoice), and another
    // corrupt-another-card step.
    //
    // Gøran also picks up Hearts (Cleric) here as a THIRD suit (confirmed by John 2026-09-03) — on top of Clubs
    // from Mission 5 and Spades from Mission 6, leaving him resolving three class powers on every play. Uses
    // `extraSuitByName` rather than `secondSuitByName`, which would overwrite Mission 6's Spades instead of
    // adding to it (see MissionReward.extraSuitByName / SuitedCard.extraSuits). Mission 8's own Diamonds step
    // would complete the set — still unimplemented, see that mission's reward comment.
    standingJesters: true,
    sidelineHighArcana: true,
    reward: {
      recruits: [recruit('Alanta', 'DRUID', '7', 'C')],
      druidStickerChoice: true,
      corruptAnotherCard: true,
      extraSuitByName: { name: 'Goran', suit: 'H' },
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
    // Wave 1: 6 Trolls. Wave 2: 6 Wyverns (50/25 — a full tier above anything the campaign has fought yet;
    // community consensus is they "hit like a truck").
    //
    // COMMENT CORRECTION (22-agent playtest cross-check, 2026-08-28 — see mission-playtest-cross-check-2026-08-28
    // memory): an earlier version of this very comment framed "finish the chain, and its purge, before this wave
    // drops" as the mission's real goal, with nothing sourcing the deadline. The chain needs 9 placements after
    // the preseeded Ace (see presetMissionZone/extraReserveCards below) — six coverable by a Pilgrim, the last
    // three only by ordinary party cards, see the Pilgrim-range correction below — and a placement window opens
    // only right after a kill (see engine.ts's zoneOpenForPlacement), so Wave 1's 6 Trolls open just 6 windows.
    // A SECOND CORRECTION (2026-09-03): this comment used to call a Wave-1 finish "mathematically impossible" on
    // that basis, which is wrong — windows aren't 1:1 with placements. A window stays open until the turn moves
    // on, and its pool is the defeated enemy's whole table pile, so several cards can go in per kill (confirmed
    // correct by John; see legacy.test.ts's "several placements can share one window"). 6 windows can therefore
    // host all 9 placements given the right values. A Wave-1 finish is merely unlikely, not impossible — what
    // actually rules out the deadline is the source below stating no deadline at all, not an arithmetic bound.
    // Re-checked against the same CAMPAIGN_RULES.md fan-reimplementation doc already cited throughout
    // this mission's other corrections: its actual text is "during cleanup, the player may optionally move
    // cards from the play area to the mission zone... at no extra cost" — "optionally," no deadline, no mention
    // of Wave 2 at all. Wave 2's own 6 Wyvern kills open the identical placement window (ascendingZone /
    // zoneOpenForPlacement is not wave-scoped), so the whole mission's 12 kills open up to 11 usable placement
    // windows (the very last kill's window never opens — the mission ends in that same engine call, see
    // finishEnemyDefeatTail's castleDeck.length === 0 branch), each able to host more than one placement, for
    // the 9 the chain actually needs — comfortably achievable as a whole-mission project, just never a hard
    // Wave-1-only cutoff. No mechanical change was
    // needed here, only removing this comment's own unsourced deadline framing (nothing player-facing — story
    // text, UI copy — ever stated the deadline either; it only lived in this comment). See legacy.test.ts's
    // "mission 8 chain-vs-wave math" tests for the regression coverage locking in these numbers.
    //
    // SOURCED CORRECTION (fan-reimplementation rules doc: "6 Trolls (10 atk / 20 hp, dual-suited, each with a
    // distinct pair of basic suits), then 6 Wyverns (25 atk / 50 hp, dual-suited, distinct pairs)"): both tiers
    // are shipped single-class immune; the source has EVERY enemy in EVERY tier dual-suited, one of the 6 distinct
    // pairs of the 4 base classes per enemy — the exact same "one hydra-kin head per pair" shape Mission 2's
    // Coilfang brood already uses (see this file's Mission 2 entry), reused stat-for-stat here since the enemies'
    // own health/attack numbers were already correct and only the immunity was missing.
    //
    // DIFFICULTY NOTE (see legacy-mission-playtest-findings's Mission 8 section): the earlier playtest sweep never
    // got past Wave 1 even with single immunity, so this pass can't claim a fresh before/after simulated number —
    // adding it here is the sourced correction regardless. Unlike Missions 3/10/12, this mission's dual immunity
    // is a FIXED per-enemy trait baked into MissionEnemySpec, not a runtime-growing zone effect — Mission 8's own
    // zone (ascendingZone) only ever buffs attack (see ascendingZoneAttackBuff), it never grants immunity
    // (zoneImmuneSuits is forced empty for this mission — see engine.ts's startLegacyMission). There is no
    // escalating-immunity mechanism here for Mission 3's zone-immunity cap to bound in the first place, so that
    // pattern doesn't apply and wasn't added — the caution about not copy-pasting it blind (Mission 12 tried and
    // reverted exactly that) is moot here because the two missions' immunity sources aren't the same shape at all.
    enemies: [
      // Card faces: T for the trolls, D for the wyverns — dragon-kin, so D rather than W (John's call — see
      // EnemyState.rankLabel).
      ...rankLabel('T', [
        enemy('Grael Stonejaw', 'CLERIC', 20, 10, 'BARD'),
        enemy('Mossen Foghide', 'CLERIC', 20, 10, 'WARRIOR'),
        enemy('Rimtusk the Wet', 'CLERIC', 20, 10, 'PALADIN'),
        enemy('Cragfoot', 'BARD', 20, 10, 'WARRIOR'),
        enemy('Windbroken Skarn', 'BARD', 20, 10, 'PALADIN'),
        enemy('The Last Bridgekeeper', 'WARRIOR', 20, 10, 'PALADIN'),
      ]),
      ...rankLabel('D', [
        enemy('Wyvern of the First Veil', 'CLERIC', 50, 25, 'BARD'),
        enemy('Wyvern of the Second Veil', 'CLERIC', 50, 25, 'WARRIOR'),
        enemy('Wyvern of the Third Veil', 'CLERIC', 50, 25, 'PALADIN'),
        enemy('Wyvern of the Fourth Veil', 'BARD', 50, 25, 'WARRIOR'),
        enemy('Stormrend, Elder Wyvern', 'BARD', 50, 25, 'PALADIN'),
        enemy("Skytallon, Warden of Heaven's Edge", 'WARRIOR', 50, 25, 'PALADIN'),
      ]),
    ],
    // The mission zone builds an ascending 1-through-10 chain instead of any prior mission's zone mode. Pilgrim
    // cards are ordinary cards here — no hand-trap restriction, playable or discardable like any other — but
    // placing one into the next open slot of the chain (via PLACE_IN_ZONE) costs nothing extra; pressing an
    // ordinary party card into the same gap works too, but buffs the current enemy's attack for as long as it
    // sits there (see GameState.ascendingZone / rules.ts's ascendingZoneAttackBuff). Completing the chain at 10
    // purges the whole zone to the discard pile, opens the Ultimate Banishment (see GameState.zonePurge), and
    // closes the zone forever.
    //
    // SOURCED CORRECTION (fan-reimplementation rules doc): the shipped placeInZone had the player pay for a
    // placement with an extra card pulled fresh from hand — not sourced anywhere. The real rule ("during cleanup,
    // the player may optionally move cards from the play area to the mission zone... at no extra cost") reuses a
    // card already committed to the kill's own winning attack instead — see GameState.zoneCommittedPlay /
    // engine.ts's placeInZone/finishEnemyDefeatTail. The same source also documents a "2/5"
    // wildcard: "2/5 cards can be placed as a 2 during 2-selection or as a 5 during 5-selection. Once placed,
    // they count as 2 for enemy attack calculation."
    //
    // CORRECTION (2026-09-03, John: "there is no wandering coin, get rid of it"): this mission ships no wildcard
    // card of its own — "The Wandering Coin" was an invented card that had no business being in the deck, and
    // it's gone, along with the zoneWildcard() helper that built it. The RULE above stays wired up, because the
    // Mercenary Camp still sells 2/5 cards (see legacy/mercenaries.ts) and one bought there can be placed in
    // this zone: SuitedCard.flexibleComboRank plus rules.ts's matchesAscendingZoneSlot/ascendingZoneAttackBuff
    // accept the alternate value on placement and score it as a 2 for the attack buff.
    ascendingZone: true,
    // "Scrap," the Pilgrim Puppy, is the chain's permanent anchor — seeded straight into the zone at value 1 (an
    // Ace), never re-placed. The other Pilgrims are shuffled into the reserve deck alongside the party, ordinary
    // cards in every other respect, plus the 4 Chanter cards this mission's reward now enters the fight WITH
    // instead of granting after it (see the reward comment below).
    //
    // CORRECTION (2026-09-03, John's live play — "pilgrims are 1-7 only"): the Pilgrims run 1 through 7, i.e. the
    // seeded Ace plus six in the deck, NOT the 2-through-10 run of nine this shipped with. That's the whole
    // difficulty point of the chain and it was being given away: slots 8, 9 and 10 have no Pilgrim to fill them,
    // so the last three placements can only ever be ordinary party cards, each of which buffs the current enemy's
    // attack for as long as it sits in the zone (see ascendingZoneAttackBuff). The chain still needs the same 9
    // placements after the anchor — six of them are now free and three are not, where before all nine were free.
    // This also retires a card that should never have existed: a "Goran" Pilgrim printed at rank 10, contradicting
    // his rank 8 everywhere else in the campaign, invented purely to cap the old 2-10 run.
    //
    // FOLLOW-UP CORRECTION (2026-09-04, John's live play): the range fix above only addressed how HIGH the
    // Pilgrims run, not how MANY of each — this mission draws from the exact same physical "P-Box" component
    // Mission 7's own pilgrimDeck() already uses correctly (4 copies each of values 2-7, 24 cards total; see
    // that function's own doc comment), which this mission had missed despite landing the very same day. Fixed
    // via mission8PilgrimCards() below — same 4-copies-per-value shape, just keeping Mission 8's own established
    // per-value character names (unlike Mission 7's anonymous pilgrimDeck(), these are ordinary playable/
    // discardable reserve-deck cards, so the individual naming still matters for this mission's own flavor).
    presetMissionZone: [pilgrim('Scrap', 'H', 'A')],
    extraReserveCards: [
      ...mission8PilgrimCards(),
      chanterCompanion('Sela Windchant', 'D', '3'),
      chanterCompanion('Orin Deepvoice', 'H', '5'),
      chanterCompanion('Ketta Skysong', 'C', '7'),
      chanterCompanion('Bram the Refrainkeeper', 'S', '9'),
    ],
    // SOURCED CORRECTION (fan-reimplementation rules doc): the shipped reward was pure upside — 4 free permanent
    // Chanter recruits, no downside. The source instead adds those same 4 cards as fight SETUP (see
    // extraReserveCards above — "Setup: Add Drum 3/5/7/9 to the party"), and the real reward is a mixed bag:
    //  - Keep only rank 9 (Bram) permanently — the other 3 (Sela/Orin/Ketta) existed only for this one fight and
    //    are never added to the persisted roster at all. Bram carries no special ability of his own: Chanter's
    //    ENCORE was removed once the chant's draw count stopped being tied to any card's printed value (John's
    //    house rule, 2026-09-04 — see game/types.ts's GameState.chanterCountChoice)
    //    (same "no separate grant-then-retire step needed" simplification Mission 5's Haror reward already uses).
    //  - "Permanently remove the Pilgrim Ace from the pilgrim deck" — a no-op by construction in this codebase:
    //    every mission's Pilgrim cards (including "Scrap," this mission's own Ace) are mission-local
    //    extraReserveCards/presetMissionZone entries that never persist into the campaign party or any later
    //    mission's data to begin with (missions.ts has no cross-mission "pilgrim deck" state at all) — there's
    //    nothing left to remove that wasn't already gone by construction, so no code change was needed here.
    //  - "Add the Diamonds suit to Goran" — confirmed live (2026-09-04): the source's chain is Mission 4 recruits
    //    Goran (rank 8, no suit revealed yet), then a suit per mission — Clubs at 5, Spades at 6, and Diamonds
    //    HERE (via MissionReward.extraSuitByName), completing all 4 base classes right before Mission 9 makes him
    //    Evergreen. Diamonds is the Bard suit (see classes.ts's CLASS_THEME) — this mission's own reward is what
    //    makes Goran a Bard, on top of the Warrior/Paladin/Cleric he already carries. Mission 7's own Hearts/
    //    Cleric step (the third suit the source's chain calls for) is still not implemented — see that mission's
    //    own reward comment for why — so Goran arrives at this mission with only 2 of his eventual 4 suits live,
    //    not 3; this reward still only ever adds Diamonds on top of whatever he already has, so that gap doesn't
    //    block this one. Mission 9's reward still upgrades Goran (by name, not identity — see party.ts's
    //    applyEvergreenUpgradeByName's doc comment) to Evergreen regardless of which mission actually recruited
    //    him, so that step is unaffected by any of this.
    //  - "Corrupt another card" — reuses the existing corruptAnotherCard reward step (see party.ts). John's house
    //    rule (2026-09-04) restricts its target pool to an ordinary rank 2-9 base-class card — see
    //    applyCorruptAnotherCard's own doc.
    //  - "Chanter sticker" (John, live play 2026-09-04): after the mission, the player picks one eligible rank-2
    //    card (any base class except Bard — see chanterStickerEligible) to permanently gain a bonus Chanter
    //    sticker (SuitedCard.secondClassChanter), the same "keeps its own suit power AND gets the bonus mechanic"
    //    player-choice shape Missions 5/6/7's Reaver/Guardian/Druid stickers already use.
    standingJesters: true,
    sidelineHighArcana: true,
    reward: {
      recruits: [specialRecruit('Bram the Refrainkeeper', 'CHANTER', '9', 'S')],
      corruptAnotherCard: true,
      extraSuitByName: { name: 'Goran', suit: 'D' },
      chanterStickerChoice: true,
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
    // 4-4-boss escalating lineup: 4 Loreguards (15/30), 4 Lorekeepers (20/40), then Myla herself — 80 health, 20
    // attack, and immune to both Bard and Paladin (Diamonds + Spades) at once, no Jester-breakable weak point to
    // lean on.
    //
    // SOURCED CORRECTION (fan-reimplementation rules doc: "4x 15 atk / 30 hp + 4x 20 atk / 40 hp... then Myla (20
    // atk / 80 hp, Spades + Diamonds)"; independently corroborated by a search-engine summary of the official
    // compendium giving the same 4+4+Myla, 20/80, Spades+Diamonds figures): the shipped roster had a 10th, 5th
    // "Lorekeeper: Myla's Chosen" enemy the code's own prior comment admitted was invented as "a preview of the
    // boss to come" — removed. The other 9 enemies' names/stats (including Myla's own Bard+Paladin = Diamonds+
    // Spades immunity) were already correct and are unchanged.
    // Card faces: L for both Lore tiers — Loreguard and Lorekeeper are the same order, so they share a letter
    // rather than splitting onto two (see EnemyState.rankLabel). Myla, the named boss, takes M.
    enemies: [
      ...rankLabel('L', [
        enemy('Loreguard: Ember-Wrought', 'WARRIOR', 30, 15),
        enemy('Loreguard: Cinder-Tongue', 'BARD', 30, 15),
        enemy('Loreguard: Ashbound', 'CLERIC', 30, 15),
        enemy('Loreguard: Soot-Ward', 'PALADIN', 30, 15),
        enemy('Lorekeeper: Emberclaw', 'WARRIOR', 40, 20),
        enemy('Lorekeeper: Smoke-Herald', 'BARD', 40, 20),
        enemy('Lorekeeper: Pyre-Anointed', 'CLERIC', 40, 20),
        enemy('Lorekeeper: Blaze-Warden', 'PALADIN', 40, 20),
      ]),
      ...rankLabel('M', [enemy('Myla', 'BARD', 80, 20, 'PALADIN')]),
    ],
    // The captured-piles deckbuilding mechanic: party cards are split into 3 face-down piles (top card revealed)
    // instead of joining the reserve deck. At the end of every turn (skipped entirely after a kill), banish a
    // hand card to rescue one pile's face-up card into the discard pile and flip its next card — or decline, and
    // every pile cycles its face-up card to the bottom and reveals the next one instead. An exact kill sends a
    // chosen pile's face-up card straight to the top of the reserve deck (see GameState.capturedPilesActive).
    //
    // The split is the sourced flat 30 (10 per pile) at every player count — see deck.ts's buildCapturedPiles.
    // Two earlier passes scaled it down by player count because the tavern deck ran dry after the opening deal;
    // both were compensating for the 16 Pilgrims this mission was failing to fold in (see extraReserveCards
    // below, now the full 24-card pilgrimDeck()). With those restored the scaling is gone (John, 2026-09-04).
    capturedPilesActive: true,
    // SOURCED CORRECTION (fan-reimplementation rules doc setup step: "Shuffle the pilgrim deck + remaining party
    // cards + holding pile together to form the tavern deck"; post-mission step: "The pilgrim deck is dissolved —
    // pilgrims are no longer used"): the shipped 6 "Acolyte" cards were an invented pool with no basis anywhere;
    // the source instead folds Mission 7's OWN pilgrim survivors back in here, one final time, before they
    // dissolve for good. Mission 7's pilgrim identities aren't exported as a reusable list (they're inline in
    // that mission's own extraReserveCards above), so rather than refactor Mission 7's already-merged, already-
    // tested entry, an earlier pass hand-wrote 8 stand-in survivors here instead. CORRECTION (2026-09-04, John):
    // "the pilgrim deck" in that setup step means the WHOLE deck — all 24 of Mission 7's pilgrims (4 copies each
    // of values 2-7, see pilgrimDeck above), not a sampled 8. The 8-card version was an under-implementation of
    // the same source line already quoted above, and it left this mission's reserve deck 16 cards short — which
    // is exactly what the pile-size scaling below was invented to paper over (see engine.ts's startLegacyMission).
    //
    // This calls pilgrimDeck() a SECOND time rather than reusing Mission 7's array: this codebase never clones a
    // mission's static card objects per game (see RoomManager's startLegacyMission), so two missions sharing
    // literal array/object references would risk one game's in-place card mutation (e.g. a suit-changing combo)
    // leaking into the other's template. A fresh call gives Mission 9 its own objects while keeping the cards
    // identical — "the same people," recognizably, without the shared reference. The two decks reuse the same
    // ids, which is safe because they never coexist: Mission 9 sets no pilgrimMechanic/pilgrimCards of its own,
    // so these are the only Pilgrims in its game.
    //
    // Unlike Mission 7, none of these carry any zone mechanic here (no pilgrimMechanic flag on this mission) —
    // ordinary reserve-deck bodies only, same as the Acolytes they replaced.
    extraReserveCards: pilgrimDeck(),
    // Reward: the Evergreen Mother relic (a corrupted card's cost becomes another player banishing from their
    // own hand instead of the reserve deck's top card, or your own hand solo) and a second Mage sticker for one
    // more lucky party member.
    //
    // JOHN, 2026-09-04 (live play): the Mage sticker is RANK-RESTRICTED and only half a player choice. "Either a
    // rank 4 or a rank 8 gets the Mage ability at the end of Mission 9. The player chooses which rank, 4 or 8.
    // Within that rank the recipient is random — you do not get to pick which specific 4, or which specific 8."
    // So this is now `mageStickerRankChoice`, not the old `mageSticker` (which drew uniformly from the WHOLE
    // party at any rank, auto-applied inside applyReward). Two steps: the player picks the rank on
    // CampaignLobbyPage, then the server draws a random eligible card of that rank — see party.ts's
    // mageStickerEligible/mageStickerRankOptions/applyMageStickerRankChoice and RoomManager's
    // chooseMageStickerRank, which re-validates the rank rather than trusting the client. NOT a card picker,
    // unlike Missions 5-8's Reaver/Guardian/Druid/Chanter stickers.
    //
    // SOURCED CORRECTION (fan-reimplementation rules doc: "Goran now ignores all immunities... but NOT considered
    // restored" — i.e. gains the same all-four-suits, immunity-ignoring behavior this codebase already models as
    // SuitedCard.evergreen): the shipped version granted "Gøran" as a brand-new rank-10 recruit here. The source
    // treats Goran as an ALREADY-recruited party member simply gaining this upgrade, not a fresh join — matching
    // an earlier research pass's separate finding that Goran should have been recruited back at Mission 4 (rank
    // 8, no suit — see legacy-missions-transcript-mismatches's Mission 4 entry) and upgraded here, not created
    // here. Mission 4 itself was already merged without him (out of scope for this pass), so this campaign's
    // actual first Goran recruit now happens one mission later than sourced material expects — see Mission 8's
    // own reward comment above, which introduces him there (Spades, rank 8) as the earliest point in this file's
    // real code he can exist at all. This reward now upgrades THAT card in place via the new upgradeEvergreenCard
    // field (party.ts's applyEvergreenUpgradeByName) — matched by NAME rather than suit+rank like Mission 11's
    // upgradeSidelinedCard: Goran is a freshly-appended recruit, not a rename of one of the original 40 starting
    // cards, so his suit+rank (Spades/8) is already claimed by a pre-existing party member — a suit+rank lookup
    // would silently upgrade THAT unrelated card instead (see party.ts's own doc comment for the full reasoning,
    // caught by this pass's own regression test).
    standingJesters: true,
    sidelineHighArcana: true,
    // JOHN, 2026-09-04, correcting an earlier misreading of his own words: "CORRUPTED EVERGREEN MOTHER" IS THE
    // NAME OF A WEAKER TIER OF RELIC, NOT A CONDITION APPLIED TO ONE. There are two relics, and Mission 9 is
    // where both of them happen:
    //   • Corrupted Evergreen Mother — handed over at SETUP, below, and fully functional all mission. Its power,
    //     in his words: when you play a corrupted CARD, instead of banishing the reserve deck's top card,
    //     another player must banish a card from their own hand; solo, the rule doesn't change, so you banish
    //     from your own. That is exactly what engine.ts's applyCorruptedCost already did, so no engine mechanic
    //     was invented for it.
    //   • Evergreen Mother — the healed relic. NOT this mission's reward, and NOT granted anywhere: see below.
    //
    // The earlier reading treated "corrupted" as a state that switched the relic OFF for the mission. It didn't;
    // that whole GameState.corruptedRelics / relicActive apparatus is gone.
    //
    // JOHN, 2026-09-04, correcting PR #92 in turn: THE RELIC IS NOT HEALED HERE. It stays corrupted through
    // Mission 10, and possibly Mission 11 — he does not yet know where it heals. So this mission's reward banks
    // the CORRUPTED tier permanently (reward.relics below), and the healed EVERGREEN_MOTHER is granted by NO
    // MISSION AT ALL. The corrupted relic being both a startingRelic and a reward relic is deliberate, not a
    // duplicate: startingRelics puts it on the table for THIS mission (rewards are only granted at mission end),
    // reward.relics is what makes it permanent from here on (RoomManager's grantMissionReward → permanentRules).
    // Both grants dedupe, so replaying a won Mission 9 still holds it exactly once.
    //
    // >>> OPEN QUESTION FOR JOHN, the only thing blocking EVERGREEN_MOTHER from being reachable: WHICH MISSION
    // >>> HEALS IT — after Mission 10, or after Mission 11? Until he says, 'EVERGREEN_MOTHER' is defined
    // >>> (engine.ts's applyCorruptedCost, RelicsTray's glyph) and dead: grep the repo and no mission's
    // >>> startingRelics or reward.relics names it. Deliberately NOT deleted — the moment he answers, this is a
    // >>> one-line data change on Mission 10 or 11's reward.
    //
    // AWAITING HIS SPEC, separately: what the HEALED relic does differently. He hasn't said, so EVERGREEN_MOTHER
    // keeps the behavior it already had — identical to the corrupted tier's. That is a PLACEHOLDER, flagged as
    // such at applyCorruptedCost, not a ruling that the two tiers are the same. Two unanswered questions, then:
    // where it heals, and what healing changes.
    //
    // BEWARE THE WORD: "corrupted" now names two unrelated things in this codebase. Corrupted CARDS
    // (SuitedCard.corrupted) are a real mechanic with real rules — immunity-ignoring, a banish cost, and a strict
    // rank-2-9-base-class eligibility rule (party.ts's canBeCorrupted). Corrupted RELICS are just a tier name.
    startingRelics: ['CORRUPTED_EVERGREEN_MOTHER'],
    reward: {
      // JOHN, 2026-09-04 (live play): this mission also hands over "Ash", the Mage Beast — "a beast like Goran's
      // beasts", but carrying the Mage class instead of one of the four base ones. So: rank 'B' like every other
      // Beast Companion (see beastRecruit above), and `class: 'MAGE'`, which buildRecruitCard turns into `arcane`
      // on top of `beast`. Both rules then fire when he's played, on different axes — the beast rule sets the
      // play's VALUE (paired with one card, he copies that card's strength instead of his own 1), and the Mage
      // rule opens his reveal off the reserve deck at that resulting value (see engine.ts's resolveCommittedPlay,
      // which computes validatePlayShape first and feeds its total into mageRevealCount).
      //
      // His SPADES is bookkeeping only, and deliberately not a fifth base class: a Mage card's suit never joins
      // the combined suit-power resolution and never blocks on enemy immunity either (see
      // continueResolveCommittedPlay's resolvesOwnSuitPower), so unlike Mission 4's four — who are Warrior/Bard/
      // Cleric/Paladin for real, one per suit — Ash has no base class at all. The one place his suit is actually
      // read is Mission 11's beast-deck flip (engine.ts's flipBeastDeckCard, keyed on the printed suit), where a
      // 5th beast necessarily doubles up some suit in the cycle; Spades is the mildest of the four to double
      // (the reserve deck's top card falls to the discard pile, recoverable by a Hearts heal) rather than Clubs'
      // permanent banish or the two that take a card out of a player's hand.
      //
      // Like Mission 4's beasts, he does NOT join legacy.party — RoomManager's grantMissionReward routes every
      // beast-flagged recruit to the rotating beastCompanionPool (one rides along per attempt; Mission 11 takes
      // the whole pool at once). Nothing about Mission 3 changes: its ten Mage recruits, one per non-royal rank,
      // are correct and untouched.
      recruits: [beastRecruit('Ash', 'MAGE', 'B', 'S')],
      // The CORRUPTED tier, banked permanently — not the healed one. See this mission's own comment above.
      relics: ['CORRUPTED_EVERGREEN_MOTHER'],
      mageStickerRankChoice: true,
      upgradeEvergreenCard: 'Goran',
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
    // weakest-to-strongest by card value, each with health fixed at 5x its (base, pre-zone-bonus) strength.
    // SOURCED CORRECTION (regicidelegacy.com's compendium, corroborated by BGG threads and an independent fan
    // digital reimplementation — see the legacy-missions-transcript-mismatches memory doc's Mission 10 section):
    // these 8 should be drawn from party members ALREADY marked corrupted earlier in the campaign, not sampled
    // fresh at random — this shipped ignoring SuitedCard.corrupted entirely at first. deck.ts's
    // buildCorruptedPartyEnemies takes already-corrupted members first and random-samples only to fill slots
    // they don't cover.
    //
    // COMMENT CORRECTED 2026-09-04. It used to say no earlier mission's reward path set the corrupted flag, so
    // the random fallback did essentially all the work here. That was stale well before this pass — Missions 1
    // and 4-8 have corrupted a card for several passes now — and it is flatly wrong as of John's ruling that
    // Missions 2 and 3 corrupt one too. The campaign now runs a real EIGHT-mission corruption ladder (Missions
    // 1-8, one card each) under a one-per-rank rule (party.ts's corruptedRanks), which is exactly
    // CORRUPTED_PARTY_ENEMY_COUNT cards spanning exactly ranks 2 through 9. A party that played the campaign
    // straight through therefore fills all 8 slots from genuinely corrupted members and the fallback never runs.
    //
    // The fallback is still load-bearing, for the JUMP PATH: John routinely jumps ahead to a mission, and while
    // RoomManager back-grants every skipped mission's reward first (so a jump to 10 does still walk the ladder),
    // a party can reach here without a full corruption history — a campaign loaded from a save written before
    // this rule, or any future path that seeds a party directly. Eight enemies must appear either way.
    //
    // Which members get pulled beyond "prefer corrupted" isn't specified by the transcript beyond "eight" — the
    // random tie-break remains a judgment call, not a transcript detail.
    enemies: [],
    corruptedPartyEnemies: true,
    // Start-of-turn (not end-of-turn) mission-zone flip, feeding bonus STRENGTH onto the current enemy's own
    // dealt attack for as long as those cards sit there — materially different from Mission 3's
    // endOfTurnZoneFlip (end-of-turn timing, grants suit immunity instead of an attack buff). The transcript is
    // explicit about the start-of-turn timing; a community-research claim that this flip happens at the END of
    // the turn instead contradicts the transcript and was NOT used.
    //
    // UNSOURCED BALANCE JUDGMENT CALL, added after real simulated play (see the legacy-mission-playtest-findings
    // memory doc's Mission 10 section): as shipped, this zone's combined value had no decay and no ceiling, so a
    // boss fight that ran long fed an ever-growing buff onto that enemy's live attack — doubled again on top of
    // that for a Warrior-suited enemy — and collapsed every one of 13 simulated games across 1p/2p/4p. Neither
    // sourced correction on this mission (the enemy-selection fix above; the Bard-choice fix on
    // resolveCorruptedEnemyEndOfTurnEffect in engine.ts) touches this mechanism, and re-simulating after both
    // still produced 0 wins across 24 fresh seeded games. See engine.ts's MISSION_10_ZONE_BONUS_CAP for the
    // resulting fix (a flat ceiling on the zone's contribution) — it has no source backing it at all, unlike
    // everything else in this file's comments, and simulated play confirms it measurably improves how far a run
    // gets (deeper into the 8-enemy queue on average) without on its own making the mission reliably winnable
    // against a simple heuristic bot; this mission's own sourced baseline (8 sequential 5x-health fights, with
    // Warrior-doubling) is independently very hard, likely by intentional design this late in the campaign.
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
    //    same way the flavor beats above are — community research, not transcript-confirmed. NOTE: the same
    //    research pass that produced the two sourced corrections above (enemy selection; the Bard choice) also
    //    flagged this exact-kill gate itself as a possible mismatch — unconditional restoration, not gated on an
    //    exact hit — but at a lower confidence than those two (this shipped implementation was already an
    //    explicit community-research guess, not a transcript detail, before that research pass). Left unchanged
    //    by this pass rather than folded in silently; a candidate for a future, separately-scoped correction.
    standingJesters: true,
    sidelineHighArcana: true,
    reward: {
      recruits: [],
    },
  },
  {
    id: 11,
    title: 'Descent into Darkness',
    story:
      "The party's underground pursuit leads to a cavern where Esme — the ally who's fought at their side since " +
      'the very first mission — is found bound to a corrupting machine, guarded by four exhausted watchers and ' +
      "the corrupted overseer running the whole operation: Evil Goran. Esme can't stand with the party this " +
      'time; freeing her is the whole point of the fight.',
    // Sourced correction (see the user's own research memo, legacy-missions-transcript-mismatches.md's Mission 11
    // section, cross-checked against regicidelegacy.com's compendium, BGG threads, a fan box-repacking inventory,
    // and a fan digital reimplementation's rules doc): the previously-shipped 4 uniform 60/30 "elite" enemies were
    // wrong — simulated playtesting independently confirmed they collapse almost every game within 1-3 turns. The
    // real roster is 5 enemies: 4 weak mooks plus one much bigger final boss, "Evil Goran" — the 10/30 (mooks) and
    // 20/90 (boss) stats below are exactly the sourced figures. Which base class each mook carries, and which
    // single class the boss carries, is NOT specified by the source (only the two stat tiers and the boss's name
    // are) — one mook per base class (matching every other mission's own convention) and a single, non-dual-immune
    // class on the boss are both unsourced judgment calls, deliberately kept simple so the roster fix isn't
    // quietly undone by an invented immunity stack.
    // Card faces: W for the Wardens, and G for Evil Goran — the same letter his own party card shows (see
    // PlayingCard's tieredRankLabel), which reads as the point of the fight.
    enemies: [
      ...rankLabel('W', [
        enemy('Warden of the Depths: Ashclad', 'WARRIOR', 30, 10),
        enemy('Warden of the Depths: Bellsong', 'BARD', 30, 10),
        enemy('Warden of the Depths: Hollowmourn', 'CLERIC', 30, 10),
        enemy('Warden of the Depths: Ironvow', 'PALADIN', 30, 10),
      ]),
      ...rankLabel('G', [enemy('Evil Goran', 'PALADIN', 90, 20)]),
    ],
    // Sourced correction: the source names a specific card pulled from the party for this mission entirely — Esme,
    // the 6 of Clubs (see party.ts's STARTING_NAMES, renamed from the placeholder "Ulra Bloodfang" — a name never
    // referenced by any other mission — to match). Unlike sidelineCount's random pick (Mission 3), this needs a
    // specific identity: RoomManager's startLegacyMission excludes exactly this card from the mission's active
    // party, same "sits out, comes back automatically" shape sidelineCount already uses (the persisted campaign
    // roster itself is never touched) — she simply isn't available to draw, hold, or play this mission. See
    // `reward.upgradeSidelinedCard` below, which targets this same identity once the mission is won.
    sidelineIdentity: { suit: 'C', rank: '6' },
    // Every Beast Companion card the campaign has collected (Mission 4's four, plus Mission 9's Ash) is pulled
    // out and shuffled into a face-down deck that sits in the mission zone for this fight only — no Beast card is
    // available to draw or play this mission, Ash included, while an ordinary Mage party member (not beast-
    // flagged) is still usable as normal, since this only ever filters on `beast` (see deck.ts's buildBeastDeck).
    // At the start of every turn its top card flips for a one-shot effect keyed to its SUIT (sourced correction —
    // the previously-shipped version keyed this off the card's derived CLASS instead; see engine.ts's
    // flipBeastDeckCard). Once it runs out it reshuffles from its own used-card pile and the cycle continues —
    // one full cycle flips every beast in the pool exactly once before clearing and restarting (the four suits,
    // one each, plus Ash's own printed Spades doubling that one suit up). An exact kill spares the very next
    // turn's flip (see GameState.skipNextBeastDeckFlip).
    beastDeckMechanic: true,
    // The current enemy draws bonus strength AND class-immunity from whatever cards currently sit on top of the
    // discard pile and the banish pile — both recomputed live, so a Cleric heal reshuffling the discard pile (or
    // a Druid's Regrowth pulling from the banish pile) mid-turn changes the enemy's toolkit before the next play
    // even resolves (see rules.ts's pileTopImmuneSuits/banishPileTopValue, engine.ts's resolvedEnemyAttack). This
    // also changes how a defeated enemy's played cards are cleared away: per the transcript ("defeating the enemy
    // always banishes it, never recycled or discarded"), they go to the banish pile instead of the discard pile —
    // which is exactly what keeps feeding this same mechanic forward through the rest of the fight.
    pileTopEnemyBonus: true,
    // SOURCED FIX (playtest-confirmed, see legacy-mission-playtest-findings): a normal covered DEFEND dumps the
    // defending player's chosen cards onto the discard pile in whatever order they were selected, and
    // pileTopEnemyBonus (above) routes every defeated enemy's accumulated table cards to the BANISH pile the same
    // unordered way. Either one left arbitrary is exactly what hands the next attack an unpredictable, potentially
    // large pile-top bonus — the same self-reinforcing shape independently found and fixed for Mission 4's
    // discardTopBuffsAttack, just against two piles instead of one here. The same independent fan
    // digital-reimplementation's rules doc documents this as a permanent rule introduced at Mission 4 ("M4+
    // Cleanup discard ordering: place them low-to-high, lowest value on top") that stays in effect for every later
    // mission — including this one, which this flag now applies to BOTH the discard-pile push (a covered DEFEND)
    // and the banish-pile push (a defeated enemy's table cards), since pileTopEnemyBonus reads both piles' top
    // values identically (see GameState.discardCleanupLowToHigh / engine.ts's pushToDiscardPile and banishCards).
    // This also restores the player agency an independent player-review blog explicitly describes using in this
    // exact mission ("banish a low card... reducing the strength of the enemy") — the low-to-high sort on the
    // banish-pile side is what guarantees a low card played into an overkill actually lands on top instead of
    // being overwritten by whichever card in that batch happened to be collected last.
    discardCleanupLowToHigh: true,
    // Sourced correction: the reward is NOT a beast-card pick — the previously-shipped AWAIT_BEAST_REWARD_CHOICE
    // window and CHOOSE_BEAST_REWARD action (and party.ts's applyBeastCardChoice) have been removed entirely, no
    // longer reachable from anywhere. The real reward is Esme herself: freed and returned to the party permanently
    // upgraded to carry all four base suits — reusing the same SuitedCard.evergreen mechanic Mission 9's Gøran
    // reward already grants (all four class powers resolve at once, ignoring immunity, whenever she's played — see
    // party.ts's applyEvergreenUpgrade). The 4 Beast Companion cards were never removed from the persisted roster
    // to begin with (same as Esme, they only sat out this one mission's active fight), so they simply return
    // unchanged — the source describes no further pruning or pick for them at this mission.
    standingJesters: true,
    sidelineHighArcana: true,
    reward: {
      recruits: [],
      upgradeSidelinedCard: { suit: 'C', rank: '6' },
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
    // a clear step past Mission 11's 60/30 elites — a title above King fitting the campaign's true mastermind,
    // only unmasked at the very end.
    //
    // Sourced correction: the Hierarch used to also carry a permanent CLERIC+PALADIN secondClass immunity — the
    // identical bug already found and fixed on Mission 3 (see that mission's comment above), stacked on top of
    // this mission's own escalating immunity grant (flipBanishPileZoneCard below). No source corroborates a
    // baked-in immunity on the final boss; the real design intent is that immunity comes solely from the zone,
    // same as Mission 3. Removed the secondClass argument.
    //
    // Deliberately NOT also applying Mission 3's second-pass zone-immunity cap here — that cap was only added
    // after playtest data showed the uncapped zone alone was still driving a ~0% win rate there, and it would
    // silently neutralize this mission's own documented "grants immunity to every class sitting there" mechanic
    // (see flipBanishPileZoneCard's own doc comment and test coverage) rather than just remove an unsourced
    // invention. If a future playtest pass finds Mission 12 needs the same treatment, add it then with real
    // numbers behind it, the same way Mission 3's second pass was justified.
    // Card faces: the clearest case in the campaign — these enemies are literally named Queens and Kings, so
    // they take Q and K, and the final boss takes H for Hierarch (see EnemyState.rankLabel).
    enemies: [
      ...rankLabel('Q', [
        enemy('Queen of Ash', 'WARRIOR', 30, 15),
        enemy('Queen of Silence', 'BARD', 30, 15),
        enemy('Queen of Ruin', 'CLERIC', 30, 15),
        enemy('Queen of Thorns', 'PALADIN', 30, 15),
      ]),
      ...rankLabel('K', [
        enemy('King of Ash', 'WARRIOR', 40, 20),
        enemy('King of Silence', 'BARD', 40, 20),
        enemy('King of Ruin', 'CLERIC', 40, 20),
        enemy('King of Thorns', 'PALADIN', 40, 20),
      ]),
      ...rankLabel('H', [enemy('The Hierarch', 'CLERIC', 120, 30)]),
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
    // Same standing-Jester house rule as every other mission — see GameState.standingJesters. No
    // sidelineHighArcana here: this is the mission where High Arcana himself is unmasked as The Hierarch, not a
    // playable party card to exclude.
    standingJesters: true,
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
