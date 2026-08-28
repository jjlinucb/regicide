import { buildStandardPartyCards, shuffle } from '../game/deck.js';
import type { Card, Rank, Suit } from '../game/types.js';
import type { ClassId } from './classes.js';
import { CLASS_THEME } from './classes.js';

const ALL_SUITS: Suit[] = ['H', 'D', 'C', 'S'];

// '12', '19', and '25' never appear on one of the 40 starting party members (12/19 are Mercenary-only, see
// legacy/mercenaries.ts; 25 is Mission 1's one-off "High Arcana" recruit, see missions.ts) — excluded here too so
// STARTING_NAMES doesn't need dummy entries for ranks it will never actually be looked up with.
type NonRoyalRank = Exclude<Rank, 'J' | 'Q' | 'K' | '12' | '19' | '25'>;

/** Like NonRoyalRank, but keeps '25' — a mission-reward recruit (unlike a starting member) can carry it. */
type RecruitRank = Exclude<Rank, 'J' | 'Q' | 'K' | '12' | '19'>;

/**
 * Original names for the Golden Blade Syndicate's 40 starting members, by class and rank. Not the physical game's
 * proprietary character names — invented for this digital campaign, EXCEPT Clubs-6 ("Esme"), renamed to match a
 * sourced identity: Mission 11 ("Descent into Darkness") names this specific card as the party member pulled out
 * for that mission (see legacy/missions.ts's Mission 11 sidelineIdentity/reward.upgradeSidelinedCard). The
 * placeholder name it replaces ("Ulra Bloodfang") was never referenced anywhere else.
 */
const STARTING_NAMES: Record<Suit, Record<NonRoyalRank, string>> = {
  C: {
    '2': 'Bran Ashfist',
    '3': 'Doran Steelhide',
    '4': 'Kessa Ironjaw',
    '5': 'Grael Stormbreaker',
    '6': 'Esme',
    '7': 'Torin Oakenshield',
    '8': 'Vessa Grimhammer',
    '9': 'Halric Bonecrusher',
    '10': 'Magda Warbrand',
    A: 'Fenrik the Boar',
  },
  D: {
    '2': 'Wren Lightfinger',
    '3': 'Sable Nightsong',
    '4': 'Pip Quickstring',
    '5': 'Iona Silvertongue',
    '6': 'Cass Windwhistle',
    '7': 'Bramwell Fife',
    '8': 'Odalys Harptongue',
    '9': 'Fennic Larkspur',
    '10': 'Corvina Balladeer',
    A: 'Tilly the Lark',
  },
  H: {
    '2': 'Sister Merrin',
    '3': 'Brother Alric',
    '4': 'Ysolde Dawnkeeper',
    '5': 'Pell Brightvow',
    '6': 'Sister Naeva',
    '7': 'Brother Coen',
    '8': 'Ealda Mercyhand',
    '9': 'Thessaly Lightward',
    '10': 'Mother Rosalind',
    A: 'Bram the Hound',
  },
  S: {
    '2': 'Squire Denna',
    '3': 'Roland Trueshield',
    '4': 'Ysabel Ironvow',
    '5': 'Cedric Dawnguard',
    '6': 'Lyria Steadfast',
    '7': 'Garrick Stonewall',
    '8': 'Adelina Firmament',
    '9': 'Bastian Wallbreaker',
    '10': 'Dame Osric',
    A: 'Juno the Wolfhound',
  },
};

/** The Golden Blade Syndicate's 40 starting members — the same 40-card set classic Regicide uses for its Tavern deck, given original names. */
export function buildInitialParty(): Card[] {
  return buildStandardPartyCards().map((card) => ({
    ...card,
    name: STARTING_NAMES[card.suit][card.rank as NonRoyalRank],
  }));
}

export interface RecruitSpec {
  name: string;
  class: ClassId;
  rank: RecruitRank;
  /** True for a standout reward: grants the recruit's class's signature ability permanently, alongside their name. */
  special?: boolean;
  /** Required for MAGE, REAVER, GUARDIAN, DRUID, and EVERGREEN recruits only — none has a suit of its own, so the card's (immunity-only) suit must be chosen explicitly. Ignored for the 4 base classes, which always take their class's suit. */
  suit?: Suit;
  /** Mission 4's Beast Companion reward (x4): marks the built card with SuitedCard.beast (see rules.ts's isBeastCompanion). Tied to one of the 4 base classes like any other recruit — just also plays by the Animal/Beast Companion pairing rule. */
  beast?: boolean;
}

/**
 * Builds a new party card for a mission reward. IDs use time+random rather than an incrementing counter,
 * since a campaign's party is persisted across server restarts — a reset-on-restart counter could mint an
 * id that collides with an already-persisted recruit from a prior process.
 */
export function buildRecruitCard(spec: RecruitSpec): Card {
  const id = `recruit-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const suit = CLASS_THEME[spec.class].suit ?? spec.suit;
  if (!suit) throw new Error(`Recruit "${spec.name}" (${spec.class}) needs an explicit suit.`);
  return {
    id,
    kind: 'suited',
    suit,
    rank: spec.rank,
    name: spec.name,
    ...(spec.class === 'MAGE' ? { arcane: true } : {}),
    ...(spec.class === 'REAVER' ? { reaver: true } : {}),
    ...(spec.class === 'GUARDIAN' ? { guardian: true } : {}),
    ...(spec.class === 'DRUID' ? { druid: true } : {}),
    ...(spec.class === 'CHANTER' ? { chanter: true } : {}),
    ...(spec.class === 'EVERGREEN' ? { evergreen: true } : {}),
    ...(spec.special ? { special: CLASS_THEME[spec.class].specialAbility } : {}),
    ...(spec.beast ? { beast: true } : {}),
  };
}

export interface MissionReward {
  recruits: RecruitSpec[];
  /** Relic ids granted by this mission (see game/types.ts's GameState.relics for how they're consumed in play). */
  relics?: string[];
  /** Dual-class Stickers reward: gives this many random, eligible existing party members a second class icon. */
  dualClassStickers?: number;
  /** Mission 9's "second Mage sticker" reward: gives one random eligible existing party member a bonus Mage sticker (see applyMageSticker). */
  mageSticker?: boolean;
  /**
   * A mixed-bag reward step several missions' sourced material calls for (first implemented for Mission 5, see
   * legacy/missions.ts): permanently corrupts one random EXISTING party member (never a card this same reward
   * just granted — see applyCorruptAnotherCard) with SuitedCard.corrupted. Not pure upside: the card's class
   * power(s) ignore enemy immunity from then on, but every play banishes the reserve deck's top card as a cost.
   */
  corruptAnotherCard?: boolean;
  /**
   * Mission 6's sourced bonus (see legacy-missions-transcript-mismatches.md): gives one random eligible existing
   * rank-8 party member a bonus Guardian sticker (see applyGuardianSticker) — replaces the shipped version's
   * over-grant of all 4 Guardian recruits kept permanently; sourced material keeps only the rank-3 Guardian
   * (`recruits` below carries just that one) and grants this bonus instead.
   */
  guardianSticker?: boolean;
  /**
   * Mission 11's reward ("Descent into Darkness"): the sidelined party member matching this identity (see
   * missions.ts's Mission 11 `sidelineIdentity` — the same identity, kept in sync) permanently gains
   * SuitedCard.evergreen (see applyEvergreenUpgrade). Not a new recruit — this card was never removed from the
   * persisted campaign roster, only excluded from this one mission's active fight.
   */
  upgradeSidelinedCard?: { suit: Suit; rank: Rank };
  /**
   * Mission 9's reward ("Hope from Ashes"), sourced correction over the shipped "brand-new Gøran recruit" — see
   * missions.ts's Mission 9 entry: upgrades the existing party member with this NAME (Goran, introduced as a
   * plain recruit by Mission 8's own reward) to SuitedCard.evergreen (see applyEvergreenUpgradeByName).
   * Deliberately NOT a suit+rank identity like Mission 11's upgradeSidelinedCard: Goran is a brand-new recruit
   * appended to the party, not a rename of one of the original 40 starting cards, so his suit+rank is always
   * already claimed by a pre-existing party member (every suit+rank combo across the 4 base suits is already in
   * use — see STARTING_NAMES) — a suit+rank lookup would silently upgrade that OTHER, unrelated card instead
   * (caught by this pass's own regression test). His name has no such collision, so matching by name is the
   * correct fix here specifically, not a general-purpose replacement for the identity-based lookup.
   */
  upgradeEvergreenCard?: string;
}

/** The "Lucky 4" ranks Dual-class Stickers target — one sticker per rank, matching the physical game's 4-sticker sheets. */
const LUCKY_FOUR_RANKS: NonRoyalRank[] = ['3', '5', '7', '9'];

/**
 * Dual-class Stickers reward: one sticker per "Lucky 4" rank (3, 5, 7, 9) — for each rank, randomly picks one
 * eligible party member of that rank (suited, non-Mage/Reaver/Guardian, no existing second class) and gives it
 * a second class icon (a random suit other than their own) — from then on, that single card triggers both
 * class powers whenever it's played (see rules.ts's cardSuits). `count` caps how many of the 4 ranks get a
 * sticker, in case fewer than 4 are eligible.
 *
 * `rng` defaults to Math.random (live play doesn't need this pick to be reproducible) but accepts any
 * `() => number` source, e.g. deck.ts's seeded `makeRng`, so a seeded campaign simulation/test can get a
 * deterministic pick instead. Every other rng-taking function below follows this same convention.
 */
export function applyDualClassStickers(party: Card[], count: number, rng: () => number = Math.random): Card[] {
  const chosenIds = new Set<string>();
  for (const rank of LUCKY_FOUR_RANKS) {
    if (chosenIds.size >= count) break;
    const eligible = party.filter(
      (c) =>
        c.kind === 'suited' &&
        c.rank === rank &&
        !c.arcane &&
        !c.reaver &&
        !c.guardian &&
        !c.druid &&
        !c.chanter &&
        !c.evergreen &&
        !c.secondSuit,
    );
    if (eligible.length === 0) continue;
    const pick = eligible[Math.floor(rng() * eligible.length)];
    chosenIds.add(pick.id);
  }
  return party.map((c) => {
    if (c.kind !== 'suited' || !chosenIds.has(c.id)) return c;
    const options = ALL_SUITS.filter((s) => s !== c.suit);
    const secondSuit = options[Math.floor(rng() * options.length)];
    return { ...c, secondSuit };
  });
}

/**
 * Mission 9's "second Mage sticker" reward: picks one random eligible existing party member (suited, not
 * already Mage/Reaver/Guardian/Druid/Evergreen or already stickered) and gives it a bonus Mage sticker — unlike
 * a pure Mage recruit's `arcane` flag, the card keeps resolving its own suit power AND triggers its own Mage
 * reveal (see SuitedCard.secondClassArcane, engine.ts's revealForMage). Unlike Dual-class Stickers' "Lucky 4" ranks,
 * the physical game picks uniformly across the whole party (by revealing shuffled cards until an eligible one
 * turns up) — we don't track the "race" it also filters by, so this just draws uniformly from every eligible
 * rank instead. `rng` defaults to Math.random; see applyDualClassStickers's doc for why/when to pass a seeded one.
 */
export function applyMageSticker(party: Card[], rng: () => number = Math.random): Card[] {
  const eligible = party.filter(
    (c) => c.kind === 'suited' && !c.arcane && !c.reaver && !c.guardian && !c.druid && !c.evergreen && !c.secondClassArcane,
  );
  if (eligible.length === 0) return party;
  const pick = eligible[Math.floor(rng() * eligible.length)];
  return party.map((c) => (c.id === pick.id ? { ...c, secondClassArcane: true } : c));
}

/**
 * A mixed-bag reward step (see MissionReward.corruptAnotherCard): permanently corrupts one random eligible
 * existing party member, excluding any card id in `excludeIds` (the recruits this same reward just granted —
 * "another" card, not the new arrival) and any card already `corrupted` or `restored` (mutually exclusive with
 * `corrupted` — see SuitedCard.restored). A no-op if nothing is eligible. `rng` defaults to Math.random; see
 * applyDualClassStickers's doc for why/when to pass a seeded one.
 */
export function applyCorruptAnotherCard(
  party: Card[],
  excludeIds: Set<string> = new Set(),
  rng: () => number = Math.random,
): Card[] {
  const eligible = party.filter(
    (c) => c.kind === 'suited' && !c.corrupted && !c.restored && !excludeIds.has(c.id),
  );
  if (eligible.length === 0) return party;
  const pick = eligible[Math.floor(rng() * eligible.length)];
  return party.map((c) => (c.id === pick.id ? { ...c, corrupted: true } : c));
}

/**
 * Mission 6's sourced bonus (see legacy-missions-transcript-mismatches.md, replacing the shipped over-grant of
 * all 4 Guardian recruits): picks one random eligible existing rank-8 party member and gives it a bonus Guardian
 * sticker — unlike a pure Guardian recruit's `guardian` flag (which replaces suit-power resolution entirely),
 * the card keeps resolving its own suit power AND raises the Guardian's absolute shield when played (see
 * SuitedCard.secondClassGuardian, engine.ts's resolveCommittedPlay's guardianCards handling). Mirrors
 * applyMageSticker's eligibility/selection shape, narrowed to rank 8 per the sourced reward. `rng` defaults to
 * Math.random; see applyDualClassStickers's doc for why/when to pass a seeded one.
 */
export function applyGuardianSticker(party: Card[], rng: () => number = Math.random): Card[] {
  const eligible = party.filter(
    (c) =>
      c.kind === 'suited' &&
      c.rank === '8' &&
      !c.arcane &&
      !c.reaver &&
      !c.guardian &&
      !c.druid &&
      !c.chanter &&
      !c.evergreen &&
      !c.secondClassGuardian,
  );
  if (eligible.length === 0) return party;
  const pick = eligible[Math.floor(rng() * eligible.length)];
  return party.map((c) => (c.id === pick.id ? { ...c, secondClassGuardian: true } : c));
}

/**
 * Finds the existing party member matching `identity` (suit + rank) and permanently gives it
 * SuitedCard.evergreen — the all-four-base-suits-at-once, immunity-ignoring power (see engine.ts's
 * resolveCommittedPlay's evergreenActive branch). Shared by two mission rewards that both upgrade an existing
 * card in place rather than adding a new one: Mission 11's upgradeSidelinedCard (the card sat out that one
 * mission's active fight — see missions.ts's Mission 11 sidelineIdentity/RoomManager's startLegacyMission — but
 * was never removed from the persisted roster) and Mission 9's upgradeEvergreenCard (Goran, an ordinary in-play
 * party member the whole time, never sidelined at all). A no-op (same reference) if `identity` is unset or no
 * matching card is found.
 */
export function applyEvergreenUpgrade(party: Card[], identity?: { suit: Suit; rank: Rank }): Card[] {
  if (!identity) return party;
  let upgraded = false;
  const next = party.map((c) => {
    if (upgraded || c.kind !== 'suited' || c.suit !== identity.suit || c.rank !== identity.rank) return c;
    upgraded = true;
    return { ...c, evergreen: true };
  });
  return upgraded ? next : party;
}

/**
 * Mission 9's own variant of applyEvergreenUpgrade (see MissionReward.upgradeEvergreenCard's doc for why a
 * suit+rank identity doesn't work for Goran specifically): matches by name instead. A no-op (same reference) if
 * `name` is unset or no matching card is found.
 */
export function applyEvergreenUpgradeByName(party: Card[], name?: string): Card[] {
  if (!name) return party;
  let upgraded = false;
  const next = party.map((c) => {
    if (upgraded || c.kind !== 'suited' || c.name !== name) return c;
    upgraded = true;
    return { ...c, evergreen: true };
  });
  return upgraded ? next : party;
}

/**
 * Adds a mission's reward — recruits, any Dual-class Stickers, any Mage sticker, any corrupt-another-card effect,
 * any Guardian sticker, and any sidelined-card or existing-card evergreen upgrade — to the campaign's permanent
 * party roster. Relics are tracked separately (see RoomManager's permanentRules).
 *
 * `rng` defaults to Math.random, matching every live call site (mission rewards don't need to be reproducible
 * in actual play) — pass a seeded source (e.g. deck.ts's `makeRng`) from a campaign simulation/test that needs
 * this call's random picks to be deterministic.
 */
export function applyReward(party: Card[], reward: MissionReward, rng: () => number = Math.random): Card[] {
  const newRecruits = reward.recruits.map(buildRecruitCard);
  let next = [...party, ...newRecruits];
  if (reward.dualClassStickers) next = applyDualClassStickers(next, reward.dualClassStickers, rng);
  if (reward.mageSticker) next = applyMageSticker(next, rng);
  if (reward.corruptAnotherCard) next = applyCorruptAnotherCard(next, new Set(newRecruits.map((c) => c.id)), rng);
  if (reward.guardianSticker) next = applyGuardianSticker(next, rng);
  if (reward.upgradeSidelinedCard) next = applyEvergreenUpgrade(next, reward.upgradeSidelinedCard);
  if (reward.upgradeEvergreenCard) next = applyEvergreenUpgradeByName(next, reward.upgradeEvergreenCard);
  return next;
}

/**
 * Mission 10's "deck rehabilitation" mechanic (community research, best-effort — see legacy/missions.ts's Mission
 * 10 entry): folds GameState.restoredPartyCards — the original cards of every corrupted hero exact-killed during
 * the mission — back into the campaign's permanent party roster at mission end, cleansed of `corrupted`. Unlike
 * applyReward's recruits (freshly minted via buildRecruitCard), these are the SAME cards the party already had —
 * conceptually pulled out of circulation for the fight (see deck.ts's buildCorruptedPartyEnemies) — but
 * RoomManager never actually removes the chosen cards from the persisted party when a Mission 10 fight starts
 * (deck.ts only carves them out of the ephemeral in-mission reserve deck), so `enemy.sourceCard` is literally the
 * same still-`corrupted` object this function's `party` argument already contains. A card whose id is already
 * present is therefore REPLACED in place with its cleansed form rather than skipped — skipping it (the previous
 * behavior) silently threw away every genuine restoration, since the "already present" case was actually the
 * normal path, not the rare one. Appending is kept as a fallback for an id genuinely missing from `party` (e.g.
 * if that removal is ever wired up later).
 */
export function applyRestoredPartyCards(party: Card[], restored: Card[]): Card[] {
  if (restored.length === 0) return party;
  const cleanse = (c: Card): Card => (c.kind === 'suited' && c.corrupted ? { ...c, corrupted: false } : c);
  const restoredById = new Map(restored.map((c) => [c.id, cleanse(c)]));
  const next = party.map((c) => restoredById.get(c.id) ?? c);
  const partyIds = new Set(party.map((c) => c.id));
  const additions = restored.filter((c) => !partyIds.has(c.id)).map(cleanse);
  return additions.length > 0 ? [...next, ...additions] : next;
}
