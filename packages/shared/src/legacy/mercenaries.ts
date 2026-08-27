import type { Card, Suit } from '../game/types.js';
import { classForSuit } from './classes.js';

const ALL_SUITS: Suit[] = ['H', 'D', 'C', 'S'];

/** The four value-12 mercenaries' printed names, one per suit (see MERCENARY_CATALOG's doc for the photo source). */
const TWELVE_NAME: Record<Suit, string> = { H: 'Ghali', D: 'Pàviõ', C: 'Argo', S: 'Hella' };

/**
 * Legacy-only sourced mechanic ("Box M — Mercenaries"): losing a mission grants coins toward hiring one of 14
 * fixed cards into the deck for the NEXT attempt at that same mission (see RoomManager's mercenary handling).
 * Sourced from a physical box-inventory reset guide (talkingshelfspace.com: "Mercenary 4x12, 4x 2/5, 2x 19, 2x A,
 * 2x jester"), a BGG designer/moderator confirmation of the exact 14-card count (thread 3617520), and a fan
 * digital reimplementation's own shop data (github.com/DorkDad141/regicide-js's initShop) independently agreeing
 * on the same 5 types/costs. The four "12" cards DO carry flavor names — confirmed by a photo of the physical
 * cards in a session report (hiewandboardgames.blogspot.com, "Regicide Legacy review and photo book", 2026-08-08):
 * Argo (Warrior), Hella (Paladin), Ghali (Cleric), Pàviõ (Bard), each captioned "[suit] Mercenary". The other
 * three types (2/5, 19, any-suit Ace, Jester) were not shown close enough to confirm printed names one way or
 * the other, so they stay unnamed rather than guessing.
 */
export type MercenaryTypeId =
  | 'TWELVE_H'
  | 'TWELVE_D'
  | 'TWELVE_C'
  | 'TWELVE_S'
  | 'TWO_FIVE_H'
  | 'TWO_FIVE_D'
  | 'TWO_FIVE_C'
  | 'TWO_FIVE_S'
  | 'NINETEEN'
  | 'WILD_ACE'
  | 'JESTER';

export interface MercenaryTypeSpec {
  id: MercenaryTypeId;
  cost: number;
  /** How many identical copies of this type exist in Box M — the most this type can ever be purchased at once. */
  maxQty: number;
  label: string;
}

/**
 * The Mercenary Camp catalog: 11 purchasable types totaling the sourced 14 physical cards (4x "12" + 4x "2/5",
 * one of each per base suit — the two 1-coin types are BOTH suit-specific = 8 separate maxQty-1 entries; plus
 * 2x "19", 2x any-suit Ace, and 2x Jester, each a single maxQty-2 entry for its 2 identical copies).
 */
export const MERCENARY_CATALOG: MercenaryTypeSpec[] = [
  ...ALL_SUITS.map((suit) => ({ id: `TWELVE_${suit}` as MercenaryTypeId, cost: 1, maxQty: 1, label: `${TWELVE_NAME[suit]} — 12 (${classForSuit(suit).name})` })),
  ...ALL_SUITS.map((suit) => ({ id: `TWO_FIVE_${suit}` as MercenaryTypeId, cost: 1, maxQty: 1, label: `2/5 (${classForSuit(suit).name})` })),
  { id: 'NINETEEN', cost: 3, maxQty: 2, label: '19' },
  { id: 'WILD_ACE', cost: 3, maxQty: 2, label: 'Any-Suit Ace' },
  { id: 'JESTER', cost: 5, maxQty: 2, label: 'Jester' },
];

const MERCENARY_BY_ID: Record<MercenaryTypeId, MercenaryTypeSpec> = Object.fromEntries(
  MERCENARY_CATALOG.map((spec) => [spec.id, spec]),
) as Record<MercenaryTypeId, MercenaryTypeSpec>;

/**
 * Sourced coin formula — linear, one coin per loss (corrected from an earlier, wrong triangular guess): a real
 * session report's numbers confirm this exactly (hiewandboardgames.blogspot.com, "Regicide Legacy review and
 * photo book", 2026-08-08) — "It took us 6 attempts to beat [Mission 9] ... by that game we managed to win, we
 * had 5 coins to employ mercenaries," i.e. 5 losses before the winning 6th attempt = 5 coins, not the 15 a
 * triangular formula would give. This is a growing BUDGET CEILING re-spendable as a whole on every retry, not a
 * wallet that depletes — see RoomManager's mercenary-loadout handling, which lets the party freely re-pick any
 * combination up to this total each time.
 */
export function mercenaryCoinsForLosses(losses: number): number {
  return losses;
}

/**
 * Tracks a lost mission's retry progress — `missionId` it applies to, the mission's cumulative loss count (coins
 * = mercenaryCoinsForLosses(lossCount)), and the currently-selected loadout for its next attempt. Reset (cleared
 * to null) whenever a DIFFERENT mission is about to start — a win, a skip-ahead, or simply picking a different
 * mission — since coins never carry across missions (see RoomManager's completeLegacyMission/startLegacyMission).
 */
export interface MercenaryProgress {
  missionId: number;
  lossCount: number;
  loadout: Partial<Record<MercenaryTypeId, number>>;
}

/** IDs use time+random rather than an incrementing counter, same as party.ts's buildRecruitCard — a campaign's mercenary loadout is persisted across server restarts, so a reset-on-restart counter could collide with an already-persisted card. */
function newMercenaryCardId(typeId: MercenaryTypeId): string {
  return `merc-${typeId}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** Builds one physical instance of a mercenary type as an actual Card, ready to ride into a mission's reserve deck via Mission.extraReserveCards (see RoomManager's startLegacyMission). */
export function buildMercenaryCard(typeId: MercenaryTypeId): Card {
  const id = newMercenaryCardId(typeId);
  switch (typeId) {
    case 'TWELVE_H':
    case 'TWELVE_D':
    case 'TWELVE_C':
    case 'TWELVE_S': {
      const suit = typeId.slice(-1) as Suit;
      return { id, kind: 'suited', suit, rank: '12', name: TWELVE_NAME[suit] };
    }
    case 'TWO_FIVE_H':
    case 'TWO_FIVE_D':
    case 'TWO_FIVE_C':
    case 'TWO_FIVE_S':
      // Printed rank '5' (see SuitedCard.flexibleComboRank's doc) — always worth 5 alone/discarded/defended with;
      // '2' is the flagged alternate rules.ts's validatePlayShape can also resolve a combo as.
      return { id, kind: 'suited', suit: typeId.slice(-1) as Suit, rank: '5', flexibleComboRank: '2' };
    case 'NINETEEN':
      // Suit is an inert placeholder (see SuitedCard.noSuitPower's doc) — 'H' chosen arbitrarily, never rendered
      // as a real suit (see legacy/classes.ts's classForCard) and excluded from every immunity-bookkeeping site.
      return { id, kind: 'suited', suit: 'H', rank: '19', noSuitPower: true };
    case 'WILD_ACE':
      // Suit is a placeholder until played (see SuitedCard.wildSuit's doc) — the player chooses one of the 4
      // base suits at play time (see engine.ts's playCards/assistCombo's applyChosenSuits).
      return { id, kind: 'suited', suit: 'H', rank: 'A', wildSuit: true };
    case 'JESTER':
      return { id, kind: 'jester' };
  }
}

/**
 * Validates a proposed mercenary loadout (typeId -> quantity) against the catalog's per-type maxQty and a total
 * coin budget, returning an error string or the concrete Card[] to add to the mission's reserve deck (see
 * Mission.extraReserveCards). Used both when a player submits a new loadout and when re-validating a
 * previously-saved one still fits (e.g. after a maxQty change, which never actually happens today, but keeps
 * this the single source of truth rather than trusting a stored selection blindly).
 */
export function buildMercenaryLoadout(selection: Partial<Record<MercenaryTypeId, number>>, coinBudget: number): Card[] | { error: string } {
  let totalCost = 0;
  const cards: Card[] = [];
  for (const [typeId, qty] of Object.entries(selection) as [MercenaryTypeId, number | undefined][]) {
    if (!qty) continue;
    const spec = MERCENARY_BY_ID[typeId];
    if (!spec) return { error: `Unknown mercenary type "${typeId}".` };
    if (qty < 0 || qty > spec.maxQty) return { error: `${spec.label}: at most ${spec.maxQty} available.` };
    totalCost += spec.cost * qty;
    for (let i = 0; i < qty; i++) cards.push(buildMercenaryCard(typeId));
  }
  if (totalCost > coinBudget) return { error: `That loadout costs ${totalCost} coins — only ${coinBudget} available.` };
  return cards;
}
