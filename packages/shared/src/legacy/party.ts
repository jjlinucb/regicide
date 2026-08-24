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
  /** Required for MAGE, REAVER, and GUARDIAN recruits only — none has a suit of its own, so the card's (immunity-only) suit must be chosen explicitly. Ignored for the 4 base classes, which always take their class's suit. */
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
    ...(spec.special ? { special: CLASS_THEME[spec.class].specialAbility } : {}),
  };
}

export interface MissionReward {
  recruits: RecruitSpec[];
  /** Relic ids granted by this mission (see game/types.ts's GameState.relics for how they're consumed in play). */
  relics?: string[];
  /** Dual-class Stickers reward: gives this many random, eligible existing party members a second class icon. */
  dualClassStickers?: number;
}

/**
 * Dual-class Stickers reward: randomly picks `count` eligible party members (suited, non-Mage, no existing
 * second class) and gives each a second class icon (a random suit other than their own) — from then on, that
 * single card triggers both class powers whenever it's played (see rules.ts's cardSuits).
 */
export function applyDualClassStickers(party: Card[], count: number): Card[] {
  const eligibleIds = party
    .filter((c) => c.kind === 'suited' && !c.arcane && !c.reaver && !c.guardian && !c.secondSuit)
    .map((c) => c.id);
  const chosenIds = new Set(shuffle(eligibleIds, Math.random).slice(0, count));
  return party.map((c) => {
    if (c.kind !== 'suited' || !chosenIds.has(c.id)) return c;
    const options = ALL_SUITS.filter((s) => s !== c.suit);
    const secondSuit = options[Math.floor(Math.random() * options.length)];
    return { ...c, secondSuit };
  });
}

/** Adds a mission's reward — recruits and any Dual-class Stickers — to the campaign's permanent party roster. Relics are tracked separately (see RoomManager's permanentRules). */
export function applyReward(party: Card[], reward: MissionReward): Card[] {
  let next = [...party, ...reward.recruits.map(buildRecruitCard)];
  if (reward.dualClassStickers) next = applyDualClassStickers(next, reward.dualClassStickers);
  return next;
}
