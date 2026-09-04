import { buildStandardPartyCards, shuffle } from '../game/deck.js';
import { cardSuits } from '../game/rules.js';
import type { Card, Rank, Suit } from '../game/types.js';
import type { ClassId } from './classes.js';
import { CLASS_THEME, SUIT_TO_CLASS } from './classes.js';

const ALL_SUITS: Suit[] = ['H', 'D', 'C', 'S'];

// '12', '19', and '25' never appear on one of the 40 starting party members (12/19 are Mercenary-only, see
// legacy/mercenaries.ts; 25 is Mission 1's one-off "High Arcana" recruit, see missions.ts) — excluded here too so
// STARTING_NAMES doesn't need dummy entries for ranks it will never actually be looked up with.
type NonRoyalRank = Exclude<Rank, 'J' | 'Q' | 'K' | '12' | '19' | '25' | 'B'>;

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
  /** A Beast Companion reward recruit (Mission 4's four, Mission 9's Ash): marks the built card with SuitedCard.beast (see rules.ts's isBeastCompanion), so it plays by the Animal/Beast Companion pairing rule. Orthogonal to `class` — Mission 4's four are each one of the 4 base classes, while Ash is a MAGE, and so comes out `arcane` as well as `beast` (see the `spec.class === 'MAGE'` line below). */
  beast?: boolean;
  /** A named recruit that carries a real suit (for immunity bookkeeping/identity) but whose class power never resolves — same SuitedCard.noSuitPower flag a Mercenary "19" uses, just on an otherwise-ordinary named recruit instead. Used by Mission 4's Gøran, who joins inert and has his suit switched on later (see MissionReward.suitByName). Mission 5's Myla used to be the other case, before she stopped being a recruit at all. */
  noSuitPower?: boolean;
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
    ...(spec.noSuitPower ? { noSuitPower: true } : {}),
  };
}

export interface MissionReward {
  recruits: RecruitSpec[];
  /** Relic ids granted by this mission (see game/types.ts's GameState.relics for how they're consumed in play). */
  relics?: string[];
  /** Dual-class Stickers reward: gives this many random, eligible existing party members a second class icon. */
  dualClassStickers?: number;
  /**
   * Mission 9's "second Mage sticker" reward, John's ruling (live play 2026-09-04): after the mission, the
   * player picks a RANK — 4 or 8 — and one random eligible party member OF THAT RANK permanently gains a bonus
   * Mage sticker (SuitedCard.secondClassArcane — see mageStickerEligible/mageStickerRankOptions/
   * applyMageStickerRankChoice below). A two-step reward, and deliberately only half a choice: the player picks
   * the rank, the rng picks the card within it. That makes it unlike Missions 5-8's
   * reaverStickerChoice/guardianStickerChoice/druidStickerChoice/chanterStickerChoice, which all let the player
   * pick the exact CARD — do not model this one as a card picker. It replaces the previous `mageSticker`
   * behavior (a random pick across the WHOLE party, at any rank, auto-applied inside applyReward).
   *
   * Like the other four sticker choices, deliberately NOT auto-applied by applyReward below: there is no rank to
   * roll against until the player says which one.
   */
  mageStickerRankChoice?: boolean;
  /**
   * A mixed-bag reward step several missions' sourced material calls for (first implemented for Mission 5, see
   * legacy/missions.ts): permanently corrupts one random EXISTING party member (never a card this same reward
   * just granted — see applyCorruptAnotherCard) with SuitedCard.corrupted. Not pure upside: the card's class
   * power(s) ignore enemy immunity from then on, but every play banishes the reserve deck's top card as a cost.
   * John's house rule (2026-09-04): only an ordinary rank 2-9 card from one of the 4 base classes is eligible —
   * never a 10/Ace, and never one of Legacy's special faction classes (Mage included) — see
   * applyCorruptAnotherCard's own doc for the full eligibility rule.
   */
  corruptAnotherCard?: boolean;
  /**
   * Mission 6's reward, confirmed live (2026-09-02): after the mission, the player picks ONE of their existing
   * eligible rank-8 party members to permanently gain a bonus Guardian sticker (SuitedCard.secondClassGuardian —
   * see guardianStickerEligible/applyGuardianStickerChoice below) on top of its own class power, the same "keeps
   * its own suit power AND gets the bonus mechanic" shape as applyMageStickerRankChoice. Like Mission 5's
   * reaverStickerChoice, this is a PLAYER CHOICE, not an automatic random pick (an earlier reading had this
   * auto-applied at random — see RoomManager's chooseGuardianSticker/CampaignLobbyPage's picker for the corrected
   * version). Deliberately NOT auto-applied by applyReward below (there is no card to target yet without the
   * player's own input) — replaces the shipped version's over-grant of all 4 Guardian recruits kept permanently;
   * sourced material keeps only the rank-3 Guardian (`recruits` below carries just that one) and grants this
   * bonus instead.
   */
  guardianStickerChoice?: boolean;
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
   * plain recruit by Mission 4's own reward) to SuitedCard.evergreen (see applyEvergreenUpgradeByName).
   * Deliberately NOT a suit+rank identity like Mission 11's upgradeSidelinedCard: Goran is a brand-new recruit
   * appended to the party, not a rename of one of the original 40 starting cards, so his suit+rank is always
   * already claimed by a pre-existing party member (every suit+rank combo across the 4 base suits is already in
   * use — see STARTING_NAMES) — a suit+rank lookup would silently upgrade that OTHER, unrelated card instead
   * (caught by this pass's own regression test). His name has no such collision, so matching by name is the
   * correct fix here specifically, not a general-purpose replacement for the identity-based lookup. (Which
   * mission actually recruits him has moved once already — see Mission 4's own reward comment — but this
   * name-based lookup was unaffected by that move, since it never depended on a specific mission's placement.)
   */
  upgradeEvergreenCard?: string;
  /**
   * Mission 6's reward, sourced fix: gives the existing party member matching this NAME a specific second suit
   * (see applySecondSuitByName) — the same SuitedCard.secondSuit Dual-class Stickers grant randomly, but targeted
   * and deterministic. Used for Goran (recruited inert by Mission 4, switched on with Clubs/Warrior by Mission
   * 5's own reward — see MissionReward.suitByName — since he's rank 8, outside the "Lucky 4" 3/5/7/9 ranks Dual-
   * class Stickers target, so he'd otherwise never be reachable by that generic mechanic): this mission adds
   * Spades (Paladin) on top of his now-live Clubs (Warrior), matching live gameplay footage.
   */
  secondSuitByName?: { name: string; suit: Suit };
  /**
   * Mission 7's reward (confirmed by John 2026-09-03, and matching the chain the Mission 8 entry already
   * documents): appends a further class icon to the existing party member matching this NAME, on top of whatever
   * it already carries (see applyExtraSuitByName / SuitedCard.extraSuits). Used for Gøran's third suit — Hearts
   * (Cleric), after Clubs at Mission 5 and Spades at Mission 6. Distinct from `secondSuitByName` above, which
   * SETS the single `secondSuit` slot and would overwrite Mission 6's grant rather than adding to it.
   */
  extraSuitByName?: { name: string; suit: Suit };
  /**
   * Mission 5's reward, sourced correction (live playthrough, 2026-09-02): Goran (recruited by Mission 4's own
   * reward as an inert rank-8 card — see RecruitSpec.noSuitPower and this mission's own recruit entry) has his
   * class power switched ON here for the first time, with Clubs (Warrior) as the suit that resolves — NOT granted
   * as a `secondSuit` on top of an already-working Spades/Paladin power, since Spades never actually worked before
   * this point. Sets SuitedCard.suit to `target.suit` and clears `noSuitPower` on the named card (see
   * applySuitByName). Mission 6's reward then adds Paladin (Spades) as his real `secondSuit` via
   * `secondSuitByName` once this base suit is already live.
   */
  suitByName?: { name: string; suit: Suit };
  /**
   * Mission 5's reward, sourced fix (confirmed live 2026-08-30): after the mission, the player picks ONE of
   * their existing eligible rank-6 Bard/Cleric/or Paladin party members (never Warrior) to permanently gain a
   * bonus Reaver sticker (SuitedCard.secondClassReaver — see engine.ts's isReaverCard/reaverStickerEligible
   * below) on top of its own class power, the same "keeps its own suit power AND gets the bonus mechanic" shape
   * as applyMageStickerRankChoice/applyGuardianSticker. Unlike the shipped Mage sticker this was first written
   * against (a fully automatic random pick, since replaced by mageStickerRankChoice), this one is a PLAYER
   * CHOICE — see RoomManager's chooseReaverSticker/CampaignLobbyPage's picker. Deliberately NOT auto-applied
   * by applyReward below (there is no card to target yet without the player's own input).
   */
  reaverStickerChoice?: boolean;
  /**
   * Mission 7's reward, sourced (a fan reimplementation's rules doc, confirmed by John 2026-09-03): after the
   * mission, the player picks ONE of the three eligible rank-4 cards — the 4 of Diamonds, Clubs, or Spades — to
   * permanently gain a bonus Druid sticker (SuitedCard.secondClassDruid — see druidStickerEligible/
   * applyDruidStickerChoice above). Like Mission 5's reaverStickerChoice and Mission 6's guardianStickerChoice,
   * a PLAYER CHOICE, so deliberately NOT auto-applied by applyReward below (there is no card to target yet
   * without the player's own input). Replaces the shipped version's over-grant of all 4 Druid recruits kept
   * permanently — the source keeps only the rank-7 Druid (`recruits` carries just that one) and grants this
   * bonus plus a corrupt-another-card step instead.
   */
  druidStickerChoice?: boolean;
  /**
   * Mission 8's reward, John's ruling (live play 2026-09-04): after the mission, the player picks ONE of the
   * eligible rank-2 cards — any base class except Bard (see chanterStickerEligible for why) — to permanently
   * gain a bonus Chanter sticker (SuitedCard.secondClassChanter — see applyChanterStickerChoice above). Like
   * Missions 5/6/7's reaverStickerChoice/guardianStickerChoice/druidStickerChoice, a PLAYER CHOICE, so
   * deliberately NOT auto-applied by applyReward below (there is no card to target yet without the player's own
   * input).
   */
  chanterStickerChoice?: boolean;
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

/** The only two ranks Mission 9's Mage sticker can ever land on — the player picks ONE of these (see MissionReward.mageStickerRankChoice). */
export const MAGE_STICKER_RANKS: Rank[] = ['4', '8'];

/**
 * Whether `card` is a legal recipient of Mission 9's bonus Mage sticker AT `rank` (see
 * MissionReward.mageStickerRankChoice): the card must be at that rank, and `rank` itself must be one of
 * MAGE_STICKER_RANKS — passing any other rank returns false rather than quietly widening the reward. Exported so
 * RoomManager's server-side validation, the client's rank picker, and applyMageStickerRankChoice's own draw all
 * filter on the exact same rule.
 *
 * The class/state half of this predicate is the filter applyMageSticker already used before John's 2026-09-04
 * rank ruling, carried over unchanged: suited, not `corrupted` (canGainSpecialClass — see its doc for the bug
 * that put it here), not already a Mage/Reaver/Guardian/Druid/Evergreen of its own, and not already stickered
 * with this same bonus. `chanter` is the one addition — every sibling predicate
 * (guardianStickerEligible/druidStickerEligible/chanterStickerEligible) already excluded the Chanter class and
 * this one simply predated it, which matters now that Mission 8 (one mission earlier) recruits one.
 *
 * NOT excluded by name, unlike guardianStickerEligible's Goran clause: Goran is rank 8, but Mission 9's own
 * reward upgrades him to `evergreen` in the same grantMissionReward call that grants this sticker, so the
 * `evergreen` check below has already ruled him out by the time the player is asked to pick a rank.
 *
 * No colour-family class exclusion either (the rule that keeps the Reaver off Warriors, the Guardian off
 * Paladins, the Druid off Clerics and the Chanter off Bards): John's ruling named a rank restriction and nothing
 * else, and the pre-existing Mage sticker never had one. Inventing one here would be unsourced.
 */
export function mageStickerEligible(card: Card, rank: Rank): card is Extract<Card, { kind: 'suited' }> {
  return (
    MAGE_STICKER_RANKS.includes(rank) &&
    card.kind === 'suited' &&
    card.rank === rank &&
    canGainSpecialClass(card) &&
    !card.arcane &&
    !card.reaver &&
    !card.guardian &&
    !card.druid &&
    !card.chanter &&
    !card.evergreen &&
    !card.secondClassArcane
  );
}

/**
 * Which of MAGE_STICKER_RANKS can actually produce a recipient from `party`, in MAGE_STICKER_RANKS order. The
 * single source of truth for "what may the player pick", shared by the client's picker and RoomManager's
 * validation, so a rank that cannot yield a card is never offered and never accepted.
 *
 * An EMPTY result is the reward's genuine dead end (no eligible 4s and no eligible 8s left) — callers must
 * surface that, not swallow it: the client renders the picker's "cannot be granted" state instead of hiding the
 * panel, and RoomManager rejects with an explicit error. See MissionReward.mageStickerRankChoice.
 */
export function mageStickerRankOptions(party: Card[]): Rank[] {
  return MAGE_STICKER_RANKS.filter((rank) => party.some((c) => mageStickerEligible(c, rank)));
}

/**
 * Applies Mission 9's Mage-sticker reward once the player has chosen a rank (see
 * MissionReward.mageStickerRankChoice): draws one RANDOM eligible card of that rank and permanently gives it
 * SuitedCard.secondClassArcane — unlike a pure Mage recruit's `arcane` flag, the card keeps resolving its own
 * suit power AND triggers its own Mage reveal (see engine.ts's revealForMage).
 *
 * Half player choice, half rng: the rank is the player's, the card inside it is not. A no-op (same reference) if
 * `rank` has no eligible card — callers should check mageStickerRankOptions first and surface an error rather
 * than rely on this silently doing nothing, exactly as the four card-picking stickers' apply* functions ask.
 *
 * `rng` defaults to Math.random; see applyDualClassStickers's doc for why/when to pass a seeded one.
 */
export function applyMageStickerRankChoice(party: Card[], rank: Rank, rng: () => number = Math.random): Card[] {
  const eligible = party.filter((c) => mageStickerEligible(c, rank));
  if (eligible.length === 0) return party;
  const pick = eligible[Math.floor(rng() * eligible.length)];
  return party.map((c) => (c.id === pick.id ? { ...c, secondClassArcane: true } : c));
}

/** The only ranks a card can ever be corrupted at — see canBeCorrupted. */
const CORRUPTIBLE_RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * Whether `card` carries a special faction class — as a full class of its own OR as a bonus sticker. These are
 * Legacy's rarer recruits and upgrades; ordinary party members carry none of them.
 *
 * (Terminology: a second *suit* — Dual-class Stickers, secondSuitByName, extraSuits — is NOT special. Those all
 * grant another of the four ORIGINAL base classes, so a card carrying one is still rank-and-file.)
 */
export function hasSpecialClass(card: Extract<Card, { kind: 'suited' }>): boolean {
  return Boolean(
    card.arcane ||
      card.secondClassArcane ||
      card.reaver ||
      card.secondClassReaver ||
      card.guardian ||
      card.secondClassGuardian ||
      card.druid ||
      card.secondClassDruid ||
      card.chanter ||
      card.secondClassChanter ||
      card.evergreen,
  );
}

/**
 * THE single eligibility rule for corrupting a party card (SuitedCard.corrupted). Every path that can turn a
 * card corrupted routes through this rather than re-listing the filter.
 *
 * JOHN'S RULE (live play 2026-09-04, restated and widened 2026-09-04): the only cards that can EVER be corrupted
 * are ranks 2-9 of the four original base classes — Warrior, Bard, Cleric, Paladin. Never a 10, never an Ace,
 * never any special faction class, and SPECIFICALLY NEVER A MAGE, which was his own headline example. Corruption
 * targets an ordinary rank-and-file party member, not one of Legacy's rarer, already-special recruits. Also
 * excluded: an already-inert `noSuitPower` card (nothing to corrupt), and anything already `corrupted` or
 * `restored` (mutually exclusive — see SuitedCard.restored).
 *
 * Goran is excluded BY NAME, an unsourced judgment call following the precedent guardianStickerEligible already
 * set for the same reason: his class identity is handed to him on a scripted timeline by mission rewards
 * (recruited inert, granted suits at Missions 5/6/7, upgraded to `evergreen` at Mission 9), so he is not
 * rank-and-file, and `evergreen` doesn't exclude him until three missions after he first becomes corruptible.
 * Without this, corrupting him at Missions 5-8 and then running Mission 9's scripted upgrade would manufacture a
 * corrupted Evergreen — precisely the "corrupted special class" state this rule exists to forbid.
 *
 * NAMING WARNING: "corrupted" means two unrelated things in this codebase. THIS is corrupted CARDS, a real
 * mechanic. The other is the relic TIER named 'CORRUPTED_EVERGREEN_MOTHER' (see missions.ts's Mission 9) — a
 * relic's name, carrying none of these rules.
 */
export function canBeCorrupted(card: Card): card is Extract<Card, { kind: 'suited' }> {
  return (
    card.kind === 'suited' &&
    !card.corrupted &&
    !card.restored &&
    CORRUPTIBLE_RANKS.includes(card.rank) &&
    !hasSpecialClass(card) &&
    !card.noSuitPower &&
    card.name !== 'Goran'
  );
}

/**
 * canBeCorrupted's mirror, enforcing the same invariant from the other direction: an ALREADY-corrupted card can
 * never gain a special faction class. Every "give one card a bonus Mage/Reaver/Guardian/Druid/Chanter sticker"
 * reward filters on this, alongside its own rank/class rules.
 *
 * WHY THIS EXISTS (bug found 2026-09-04): blocking only the corrupt-a-card direction is not enough to make
 * John's "a Mage can never be corrupted" rule true. Missions 1/5/6/7/8 each corrupt a random party member;
 * Mission 9 then hands a random eligible member a bonus Mage sticker. That draw (applyMageSticker at the time,
 * now mageStickerEligible's rank-restricted successor) excluded every special
 * class but NOT `corrupted` — so it could land on a card corrupted three missions earlier and manufacture a
 * corrupted Mage, exactly the state John says is impossible. The other four stickers had the same hole.
 *
 * JUDGMENT CALL: John said the state can't exist; he didn't say which side gives way. Skipping the card is the
 * least destructive option — these rewards pick from ~40 party members, so another target is always available,
 * and nothing is lost. The alternative (a sticker CLEANSING the corruption) would invent a mechanic he never
 * described.
 */
export function canGainSpecialClass(card: Extract<Card, { kind: 'suited' }>): boolean {
  return !card.corrupted;
}

/**
 * A mixed-bag reward step (see MissionReward.corruptAnotherCard): permanently corrupts one random eligible
 * existing party member, excluding any card id in `excludeIds` (the recruits this same reward just granted —
 * "another" card, not the new arrival) and any card already `corrupted` or `restored` (mutually exclusive with
 * `corrupted` — see SuitedCard.restored). A no-op if nothing is eligible. `rng` defaults to Math.random; see
 * applyDualClassStickers's doc for why/when to pass a seeded one.
 *
 * Eligibility is canBeCorrupted's, shared with every other path that can mark a card corrupted — see its doc for
 * John's rule itself and why it is enforced in one place.
 */
export function applyCorruptAnotherCard(
  party: Card[],
  excludeIds: Set<string> = new Set(),
  rng: () => number = Math.random,
): Card[] {
  const eligible = party.filter((c) => canBeCorrupted(c) && !excludeIds.has(c.id));
  if (eligible.length === 0) return party;
  const pick = eligible[Math.floor(rng() * eligible.length)];
  return party.map((c) => (c.id === pick.id ? { ...c, corrupted: true } : c));
}

/**
 * Mission 6's reward, confirmed live (see MissionReward.guardianStickerChoice's doc): whether `card` is a legal
 * target for the player's post-mission Guardian-sticker pick — rank 8, not a Paladin, not already carrying a
 * special class of its own, and not already stickered with this same bonus. Exported so both RoomManager's
 * server-side validation and the client's picker UI (CampaignLobbyPage) filter on the exact same rule.
 *
 * SOURCED CORRECTION (John, from live play 2026-09-03, after the picker offered him a Paladin): Paladins are
 * excluded, which puts this in line with the rule the other two stickers already followed — each bonus class
 * can't be stickered onto the base class it shares a colour family with (see CLASS_THEME's family note):
 *   Reaver  is black → excludes Warrior  (reaverStickerEligible)
 *   Guardian is grey → excludes Paladin  (here — the one that was missing it)
 *   Druid   is red  → excludes Cleric    (druidStickerEligible, via its D/C/S allowlist)
 * The old comment here explicitly claimed no such exclusion was sourced for the Guardian; that reading is what
 * this corrects.
 *
 * Goran is excluded by name (confirmed by John 2026-09-03, after the picker offered him): he's the campaign's one
 * rank-8 story recruit, and his class identity is handed to him on a scripted timeline by mission rewards rather
 * than being his own — recruited inert at Mission 4, granted Clubs/Warrior at Mission 5, Spades/Paladin at
 * Mission 6, then upgraded to Evergreen at Mission 9 (see missions.ts's Missions 4-6/9). `evergreen` below would
 * exclude him on its own from Mission 9 onward, but this sticker is picked at Mission 6, three missions before
 * that flag is ever set. Matched by name for the same reason MissionReward.upgradeEvergreenCard and
 * secondSuitByName do: his suit+rank is always already claimed by one of the original 40 starting cards.
 */
export function guardianStickerEligible(card: Card): card is Extract<Card, { kind: 'suited' }> {
  return (
    card.kind === 'suited' &&
    card.rank === '8' &&
    canGainSpecialClass(card) &&
    ['WARRIOR', 'BARD', 'CLERIC'].includes(SUIT_TO_CLASS[card.suit].id) && // never a Paladin — see the doc above
    card.name !== 'Goran' &&
    !card.arcane &&
    !card.reaver &&
    !card.guardian &&
    !card.druid &&
    !card.chanter &&
    !card.evergreen &&
    !card.secondClassGuardian
  );
}

/**
 * Applies the player's chosen target (see guardianStickerEligible) for Mission 6's Guardian-sticker reward —
 * permanently gives that one card SuitedCard.secondClassGuardian, mirroring applyReaverStickerChoice's "keeps its
 * own suit power AND gets the bonus mechanic" shape, but for a player-picked `cardId` instead of an `rng` pick —
 * unlike a pure Guardian recruit's `guardian` flag (which replaces suit-power resolution entirely), the card
 * keeps resolving its own suit power AND raises the Guardian's absolute shield when played (see engine.ts's
 * resolveCommittedPlay's guardianCards handling). A no-op (same reference) if `cardId` doesn't match an eligible
 * card — callers should validate with guardianStickerEligible first and surface an error rather than rely on
 * this silently doing nothing.
 */
export function applyGuardianStickerChoice(party: Card[], cardId: string): Card[] {
  let applied = false;
  const next = party.map((c) => {
    if (applied || c.id !== cardId || !guardianStickerEligible(c)) return c;
    applied = true;
    return { ...c, secondClassGuardian: true };
  });
  return applied ? next : party;
}

/**
 * Mission 7's reward (see MissionReward.extraSuitByName's doc): finds the existing party member matching
 * `target.name` and appends `target.suit` to SuitedCard.extraSuits, keeping every icon it already carries. A
 * no-op (same reference) if `target` is unset, no matching card is found, or that card already resolves this
 * suit — so re-running a reward can't stack a duplicate.
 */
export function applyExtraSuitByName(party: Card[], target?: { name: string; suit: Suit }): Card[] {
  if (!target) return party;
  let applied = false;
  const next = party.map((c) => {
    if (applied || c.kind !== 'suited' || c.name !== target.name) return c;
    if (cardSuits(c).includes(target.suit)) return c;
    applied = true;
    return { ...c, extraSuits: [...(c.extraSuits ?? []), target.suit] };
  });
  return applied ? next : party;
}

/**
 * Whether `card` is a legal target for Mission 7's post-mission Druid-sticker pick (see
 * MissionReward.druidStickerChoice): one of the three rank-4 cards the source names — the 4 of Diamonds, Clubs,
 * or Spades (the 4 of HEARTS is deliberately excluded, per the source) — not already carrying a special class of
 * its own, and not already stickered with this same bonus. Exported so both RoomManager's server-side validation
 * and the client's picker UI filter on the exact same rule.
 */
export function druidStickerEligible(card: Card): card is Extract<Card, { kind: 'suited' }> {
  return (
    card.kind === 'suited' &&
    card.rank === '4' &&
    canGainSpecialClass(card) &&
    ['D', 'C', 'S'].includes(card.suit) &&
    !card.arcane &&
    !card.reaver &&
    !card.guardian &&
    !card.druid &&
    !card.chanter &&
    !card.evergreen &&
    !card.secondClassDruid
  );
}

/**
 * Applies the player's chosen target (see druidStickerEligible) for Mission 7's Druid-sticker reward —
 * permanently gives that one card SuitedCard.secondClassDruid, the same "keeps its own suit power AND gets the
 * bonus mechanic" shape as applyGuardianStickerChoice: the card keeps resolving its own suit power AND opens a
 * Regrowth window when played (see engine.ts's resolveCommittedPlay's druidCards handling). A no-op (same
 * reference) if `cardId` doesn't match an eligible card — callers should validate with druidStickerEligible
 * first and surface an error rather than rely on this silently doing nothing.
 */
export function applyDruidStickerChoice(party: Card[], cardId: string): Card[] {
  let applied = false;
  const next = party.map((c) => {
    if (applied || c.id !== cardId || !druidStickerEligible(c)) return c;
    applied = true;
    return { ...c, secondClassDruid: true };
  });
  return applied ? next : party;
}

/**
 * Whether `card` is a legal target for Mission 8's post-mission Chanter-sticker pick (see
 * MissionReward.chanterStickerChoice): rank 2, not a Bard (John's ruling, live play 2026-09-04 — "but not
 * bard"), not already carrying a special class of its own, and not already stickered with this same bonus.
 * Exported so both RoomManager's server-side validation and the client's picker UI filter on the exact same
 * rule.
 */
export function chanterStickerEligible(card: Card): card is Extract<Card, { kind: 'suited' }> {
  return (
    card.kind === 'suited' &&
    card.rank === '2' &&
    canGainSpecialClass(card) &&
    SUIT_TO_CLASS[card.suit].id !== 'BARD' &&
    !card.arcane &&
    !card.reaver &&
    !card.guardian &&
    !card.druid &&
    !card.chanter &&
    !card.evergreen &&
    !card.secondClassChanter
  );
}

/**
 * Applies the player's chosen target (see chanterStickerEligible) for Mission 8's Chanter-sticker reward —
 * permanently gives that one card SuitedCard.secondClassChanter, the same "keeps its own suit power AND gets the
 * bonus mechanic" shape as applyDruidStickerChoice/applyGuardianStickerChoice/applyReaverStickerChoice. A no-op
 * (same reference) if `cardId` doesn't match an eligible card — callers should validate with
 * chanterStickerEligible first and surface an error rather than rely on this silently doing nothing.
 */
export function applyChanterStickerChoice(party: Card[], cardId: string): Card[] {
  let applied = false;
  const next = party.map((c) => {
    if (applied || c.id !== cardId || !chanterStickerEligible(c)) return c;
    applied = true;
    return { ...c, secondClassChanter: true };
  });
  return applied ? next : party;
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
 * Mission 5's Goran bonus (see MissionReward.secondSuitByName's doc): finds the existing party member matching
 * `target.name` and permanently gives it `target.suit` as SuitedCard.secondSuit — the same field Dual-class
 * Stickers set randomly, just targeted at a specific card and suit instead. A no-op (same reference) if
 * `target` is unset or no matching card is found.
 */
export function applySecondSuitByName(party: Card[], target?: { name: string; suit: Suit }): Card[] {
  if (!target) return party;
  let upgraded = false;
  const next = party.map((c) => {
    if (upgraded || c.kind !== 'suited' || c.name !== target.name) return c;
    upgraded = true;
    return { ...c, secondSuit: target.suit };
  });
  return upgraded ? next : party;
}

/**
 * Mission 5's reward (see MissionReward.suitByName's doc): finds the existing party member matching `target.name`
 * and switches its class power ON for the first time — sets SuitedCard.suit to `target.suit` and clears
 * `noSuitPower`. Used for Goran, recruited inert by Mission 4. Unlike applySecondSuitByName, this replaces the
 * card's PRIMARY suit rather than adding a second one, since `noSuitPower` gates cardSuits() entirely regardless
 * of any `secondSuit` already present — an inert card's placeholder suit never resolves either way. A no-op
 * (same reference) if `target` is unset or no matching card is found.
 */
export function applySuitByName(party: Card[], target?: { name: string; suit: Suit }): Card[] {
  if (!target) return party;
  let upgraded = false;
  const next = party.map((c) => {
    if (upgraded || c.kind !== 'suited' || c.name !== target.name) return c;
    upgraded = true;
    const { noSuitPower: _drop, ...rest } = c;
    return { ...rest, suit: target.suit };
  });
  return upgraded ? next : party;
}

/**
 * Mission 5's reward, sourced fix (see MissionReward.reaverStickerChoice's doc): whether `card` is a legal
 * target for the player's post-mission Reaver-sticker pick — rank 6, one of the Bard/Cleric/Paladin classes
 * (Warrior is explicitly excluded, per the source), not already carrying a special class of its own, and not
 * already stickered with this same bonus. Exported so both RoomManager's server-side validation and the
 * client's picker UI (CampaignLobbyPage) filter on the exact same rule.
 */
export function reaverStickerEligible(card: Card): card is Extract<Card, { kind: 'suited' }> {
  return (
    card.kind === 'suited' &&
    card.rank === '6' &&
    canGainSpecialClass(card) &&
    ['BARD', 'CLERIC', 'PALADIN'].includes(SUIT_TO_CLASS[card.suit].id) &&
    !card.arcane &&
    !card.reaver &&
    !card.guardian &&
    !card.druid &&
    !card.chanter &&
    !card.evergreen &&
    !card.secondClassReaver
  );
}

/**
 * Applies the player's chosen target (see reaverStickerEligible) for Mission 5's Reaver-sticker reward —
 * permanently gives that one card SuitedCard.secondClassReaver, mirroring applyMageStickerRankChoice/applyGuardianSticker's
 * "keeps its own suit power AND gets the bonus mechanic" shape, but for a player-picked `cardId` instead of an
 * `rng` pick. A no-op (same reference) if `cardId` doesn't match an eligible card — callers should validate with
 * reaverStickerEligible first and surface an error rather than rely on this silently doing nothing.
 */
export function applyReaverStickerChoice(party: Card[], cardId: string): Card[] {
  let applied = false;
  const next = party.map((c) => {
    if (applied || c.id !== cardId || !reaverStickerEligible(c)) return c;
    applied = true;
    return { ...c, secondClassReaver: true };
  });
  return applied ? next : party;
}

/**
 * Adds a mission's reward — recruits, any Dual-class Stickers, any corrupt-another-card effect, any
 * sidelined-card or existing-card evergreen upgrade, and any targeted second suit — to the campaign's
 * permanent party roster. Relics are tracked separately (see RoomManager's permanentRules). Every player-driven
 * sticker reward (`reaverStickerChoice`/`guardianStickerChoice`/`druidStickerChoice`/`chanterStickerChoice`/
 * `mageStickerRankChoice` — the Mage one only since John's 2026-09-04 rank ruling) is deliberately NOT applied
 * here: see their own doc comments.
 *
 * `rng` defaults to Math.random, matching every live call site (mission rewards don't need to be reproducible
 * in actual play) — pass a seeded source (e.g. deck.ts's `makeRng`) from a campaign simulation/test that needs
 * this call's random picks to be deterministic.
 */
export function applyReward(party: Card[], reward: MissionReward, rng: () => number = Math.random): Card[] {
  const newRecruits = reward.recruits.map(buildRecruitCard);
  let next = [...party, ...newRecruits];
  if (reward.dualClassStickers) next = applyDualClassStickers(next, reward.dualClassStickers, rng);
  if (reward.corruptAnotherCard) next = applyCorruptAnotherCard(next, new Set(newRecruits.map((c) => c.id)), rng);
  if (reward.upgradeSidelinedCard) next = applyEvergreenUpgrade(next, reward.upgradeSidelinedCard);
  if (reward.upgradeEvergreenCard) next = applyEvergreenUpgradeByName(next, reward.upgradeEvergreenCard);
  if (reward.secondSuitByName) next = applySecondSuitByName(next, reward.secondSuitByName);
  if (reward.extraSuitByName) next = applyExtraSuitByName(next, reward.extraSuitByName);
  if (reward.suitByName) next = applySuitByName(next, reward.suitByName);
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
