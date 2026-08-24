import { buildStandardPartyCards, shuffle } from '../game/deck.js';
import type { Card, Rank, Suit } from '../game/types.js';
import type { ClassId } from './classes.js';
import { CLASS_THEME } from './classes.js';

const ALL_SUITS: Suit[] = ['H', 'D', 'C', 'S'];

type NonRoyalRank = Exclude<Rank, 'J' | 'Q' | 'K'>;

/** Original names for the Golden Blade Syndicate's 40 starting members, by class and rank. Not the physical game's proprietary character names — invented for this digital campaign. */
const STARTING_NAMES: Record<Suit, Record<NonRoyalRank, string>> = {
  C: {
    '2': 'Bran Ashfist',
    '3': 'Doran Steelhide',
    '4': 'Kessa Ironjaw',
    '5': 'Grael Stormbreaker',
    '6': 'Ulra Bloodfang',
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
  rank: NonRoyalRank;
  /** True for a standout reward: grants the recruit's class's signature ability permanently, alongside their name. */
  special?: boolean;
  /** Required for MAGE, REAVER, GUARDIAN, DRUID, and EVERGREEN recruits only — none has a suit of its own, so the card's (immunity-only) suit must be chosen explicitly. Ignored for the 4 base classes, which always take their class's suit. */
  suit?: Suit;
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
}

/** The "Lucky 4" ranks Dual-class Stickers target — one sticker per rank, matching the physical game's 4-sticker sheets. */
const LUCKY_FOUR_RANKS: NonRoyalRank[] = ['3', '5', '7', '9'];

/**
 * Dual-class Stickers reward: one sticker per "Lucky 4" rank (3, 5, 7, 9) — for each rank, randomly picks one
 * eligible party member of that rank (suited, non-Mage/Reaver/Guardian, no existing second class) and gives it
 * a second class icon (a random suit other than their own) — from then on, that single card triggers both
 * class powers whenever it's played (see rules.ts's cardSuits). `count` caps how many of the 4 ranks get a
 * sticker, in case fewer than 4 are eligible.
 */
export function applyDualClassStickers(party: Card[], count: number): Card[] {
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
    const pick = eligible[Math.floor(Math.random() * eligible.length)];
    chosenIds.add(pick.id);
  }
  return party.map((c) => {
    if (c.kind !== 'suited' || !chosenIds.has(c.id)) return c;
    const options = ALL_SUITS.filter((s) => s !== c.suit);
    const secondSuit = options[Math.floor(Math.random() * options.length)];
    return { ...c, secondSuit };
  });
}

/**
 * Mission 9's "second Mage sticker" reward: picks one random eligible existing party member (suited, not
 * already Mage/Reaver/Guardian/Druid/Evergreen or already stickered) and gives it a bonus Mage sticker — unlike
 * a pure Mage recruit's `arcane` flag, the card keeps resolving its own suit power AND fires an arcane bolt (see
 * SuitedCard.secondClassArcane, engine.ts's resolveArcaneBolts). Unlike Dual-class Stickers' "Lucky 4" ranks,
 * the physical game picks uniformly across the whole party (by revealing shuffled cards until an eligible one
 * turns up) — we don't track the "race" it also filters by, so this just draws uniformly from every eligible
 * rank instead.
 */
export function applyMageSticker(party: Card[]): Card[] {
  const eligible = party.filter(
    (c) => c.kind === 'suited' && !c.arcane && !c.reaver && !c.guardian && !c.druid && !c.evergreen && !c.secondClassArcane,
  );
  if (eligible.length === 0) return party;
  const pick = eligible[Math.floor(Math.random() * eligible.length)];
  return party.map((c) => (c.id === pick.id ? { ...c, secondClassArcane: true } : c));
}

/** Adds a mission's reward — recruits, any Dual-class Stickers, and any Mage sticker — to the campaign's permanent party roster. Relics are tracked separately (see RoomManager's permanentRules). */
export function applyReward(party: Card[], reward: MissionReward): Card[] {
  let next = [...party, ...reward.recruits.map(buildRecruitCard)];
  if (reward.dualClassStickers) next = applyDualClassStickers(next, reward.dualClassStickers);
  if (reward.mageSticker) next = applyMageSticker(next);
  return next;
}
