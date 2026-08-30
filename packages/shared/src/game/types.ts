export type Suit = 'H' | 'D' | 'C' | 'S';
/**
 * '12' and '19' only ever appear on Mercenary cards (see legacy/mercenaries.ts) — no base party/enemy card uses
 * them. '25' is Mission 1's "High Arcana" recruit only (see legacy/missions.ts's Mission 1 reward) — sourced
 * from a solo playthrough (Meet Me at the Table), an unusually high flat value with no class ability shown at
 * the point it was granted. `cardValue()`'s `Number(card.rank)` fallback (rules.ts) already handles all of
 * these correctly with no dedicated case needed.
 */
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '12' | '19' | '25' | 'A' | 'B' | 'J' | 'Q' | 'K';

/**
 * A signature ability a Legacy card can carry on top of its base suit power, one per class
 * (see legacy/classes.ts). Boosts the normal suit effect when the card is played: CLEAVE triples
 * (instead of doubles) Clubs damage, INSPIRE draws 2 extra on Diamonds, REVIVE heals 2 extra on
 * Hearts, BULWARK reduces the enemy's attack to 0 for the fight instead of by the play's value,
 * ARCANE_SURGE doubles a Mage card's own arcane bolt, AEGIS makes a Guardian's shield hold permanently — reducing
 * the enemy's attack to 0 for the rest of the fight instead of blocking just its next attack, WELLSPRING salvages
 * 2 cards from the banish pile instead of 1 for a Druid's Regrowth, ENCORE doubles how many cards everyone
 * draws in a Chanter's chant, and EVERGREEN is Gøran's own signature (see SuitedCard.evergreen) carried here
 * only for type-shape consistency with the other classes. Reaver has no signature ability of its own — its base
 * "Reveal and Add" (see engine.ts's startReaverPhase) already always doubles the play's damage, unconditionally.
 */
export type SpecialAbilityId =
  | 'CLEAVE'
  | 'INSPIRE'
  | 'REVIVE'
  | 'BULWARK'
  | 'ARCANE_SURGE'
  | 'AEGIS'
  | 'WELLSPRING'
  | 'ENCORE'
  | 'EVERGREEN';

export interface SuitedCard {
  id: string;
  kind: 'suited';
  suit: Suit;
  rank: Rank;
  /** Legacy-only: a party member's name (e.g. "Herbod"), shown instead of rank-of-suit. */
  name?: string;
  /** Legacy-only: a signature class ability this card carries permanently, on top of its suit power. */
  special?: SpecialAbilityId;
  /**
   * Legacy-only: marks a Mage card. A Mage still carries a suit (for immunity bookkeeping) but its class powers
   * don't resolve as part of the combined suit powers — instead it triggers a reveal off the top of the reserve
   * deck, before the play's other class powers resolve (see engine.ts's revealForMage / GameState.mageReveal).
   */
  arcane?: boolean;
  /**
   * Legacy-only: a second class icon this card carries, from the Dual-class Stickers reward. Both this suit's
   * and secondSuit's class powers trigger whenever the card is played (see rules.ts's cardSuits).
   */
  secondSuit?: Suit;
  /**
   * Legacy-only: a corrupted card. Its class power(s) always ignore enemy immunity (including mission-zone
   * immunity), but the instant it's played, the top card of the reserve deck is banished as the cost (see
   * engine.ts's resolveCommittedPlay) — permanently shrinking the party's deck for the rest of the mission.
   */
  corrupted?: boolean;
  /**
   * Legacy-only: marks a Reaver card (Mission 5's new faction). Like a Mage, it still carries a suit for
   * immunity bookkeeping, but its class power isn't the combined suit-power resolution — instead, playing it
   * tears the top card off the reserve deck, adds that card's raw value to the attack, and permanently
   * banishes it. Unlike a Warrior, a Reaver never doubles damage on its own — the bonus is a flat addition
   * that still benefits from a Warrior's own doubling if one's played alongside it (see engine.ts's
   * resolveCommittedPlay).
   */
  reaver?: boolean;
  /**
   * Legacy-only: marks a Guardian card (Mission 6's new faction). Like a Mage or Reaver, it still carries a
   * suit for immunity bookkeeping, but its class power isn't the combined suit-power resolution — instead,
   * playing it raises an absolute shield that blocks the enemy's very next attack entirely, spent the instant
   * it's used (see engine.ts's resolveCommittedPlay's guardianBlocksNextAttack).
   */
  guardian?: boolean;
  /**
   * Legacy-only: marks a Druid card (Mission 7's new faction). Like a Mage, Reaver, or Guardian, it still
   * carries a suit for immunity bookkeeping, but its class power isn't the combined suit-power resolution —
   * instead, playing it activates Regrowth: salvage cards back out of the banish pile and return them to the
   * bottom of the reserve deck (see engine.ts's resolveCommittedPlay's druidCards handling).
   */
  druid?: boolean;
  /**
   * Legacy-only: marks a Chanter card (Mission 8's new faction). Like a Mage, Reaver, or Guardian, it still
   * carries a suit for immunity bookkeeping, but its class power isn't the combined suit-power resolution —
   * instead, playing it has every player at the table draw its own value in cards all at once, even past their
   * hand limit, then each over-limit player individually discards back down (see engine.ts's
   * resolveCommittedPlay's chanterCards handling and GameState.chanterWindow).
   */
  chanter?: boolean;
  /**
   * Legacy-only: marks a Pilgrim survivor card. Two missions independently reused "Pilgrim" as flavor for
   * stranded survivors and share this one flag, each gated by its own separate GameState switch so the two never
   * collide (no mission sets both):
   * - Mission 7 ("Tales of Rebirth"), gated by GameState.pilgrimMechanic: shuffled into the reserve deck as an
   *   ordinary card (see Mission.extraReserveCards) and drawn normally, but the instant one lands in a hand it
   *   becomes a permanent hand-trap for the rest of the mission — dead weight that can never be played or
   *   discarded for any purpose, including covering defend damage or Feign Death (see engine.ts's PLAY_CARDS /
   *   ASSIST_COMBO / DEFEND rejection checks) — until an exact-damage kill frees one for free (see
   *   dealDamageAndCheckDefeat's exact-kill Pilgrim release).
   * - Mission 8 ("Winds of Chaos"), gated by GameState.ascendingZone: an entirely ordinary card — playable and
   *   discardable like any other — except when placed into the ascending mission zone, where it never buffs the
   *   current enemy's attack the way a non-Pilgrim card bridging a gap does (see rules.ts's ascendingZoneAttackBuff).
   */
  pilgrim?: boolean;
  /**
   * Legacy-only: marks Gøran's card (Mission 9's reward). Its class power isn't the combined suit-power
   * resolution restricted to its own printed suit — instead, playing it resolves all four base class powers at
   * once (heal, draw, double damage, reduce enemy strength) and always ignores enemy immunity, no matter which
   * suits are actually in the play (see engine.ts's resolveCommittedPlay's evergreenCards handling).
   */
  evergreen?: boolean;
  /**
   * Legacy-only: marks a card that's picked up a bonus Mage sticker (Mission 9's "second Mage sticker" reward)
   * on top of an existing class. Unlike a pure Mage recruit's `arcane` flag (which replaces suit-power
   * resolution entirely), this card keeps resolving its normal suit power AND triggers its own Mage reveal (see
   * engine.ts's revealForMage / GameState.mageReveal).
   */
  secondClassArcane?: boolean;
  /**
   * Legacy-only: marks a card that's picked up a bonus Guardian sticker (Mission 6's sourced reward — see
   * legacy/party.ts's applyGuardianSticker / legacy/missions.ts's Mission 6 entry) on top of an existing class.
   * Unlike a pure Guardian recruit's `guardian` flag (which replaces suit-power resolution entirely), this card
   * keeps resolving its normal suit power AND raises the Guardian's absolute shield when played (see engine.ts's
   * resolveCommittedPlay's guardianCards handling) — the same "second class" shape as secondClassArcane above.
   */
  secondClassGuardian?: boolean;
  /**
   * Legacy-only: marks a Beast Companion (Mission 4's reward, x4, each tied to a specific character). Works like
   * an Animal Companion (see rules.ts's isAnimalCompanion) — playable alone, or paired with exactly one other
   * card — but instead of contributing its own printed value (an Ace's flat 1) to the pair's total, it copies
   * the strength of whatever card it's paired with (see rules.ts's validatePlayShape).
   */
  beast?: boolean;
  /**
   * Legacy-only (Mission 12, "Decay to Growth"): a restored card — the campaign's final-mission upgrade of a
   * corrupted card (see `corrupted` above), from the same relic swapping to a new form. Its class power(s) always
   * ignore enemy immunity, exactly like a corrupted card's — but instead of banishing the reserve deck's top card
   * as the cost, playing it *heals* the banish pile's top card back into the game, returned to the bottom of the
   * reserve deck (see engine.ts's applyRestoredHeal). A restored card can never itself end up in the banish pile —
   * anywhere the engine would send one there redirects it to the bottom of the reserve deck instead (see
   * engine.ts's banishCards). Mutually exclusive with `corrupted`: a card is either one or the other, never both.
   */
  restored?: boolean;
  /**
   * Classic Regicide Endless Mode only: how many steps past King this card has been upgraded, from being the
   * card of an enemy defeated during an endless round (see engine.ts's upgradeDefeatedRank). A Jack or Queen
   * defeated during endless rounds has its `rank` itself promoted up the J→Q→K chain instead (no tier needed);
   * `tier` only kicks in once a card is already King and gets pushed past that ceiling. Each tier is worth +5
   * card value on top of King's 20, mirroring the same +5/loop step the enemies themselves scale by.
   */
  tier?: number;
  /**
   * Legacy-only: marks the Mercenary "2/5" card (see legacy/mercenaries.ts). Its printed `rank` is always '5'
   * (so playing it alone, discarding it, or defending with it is worth 5, matching the sourced "always worth 5
   * when discarded"), but for COMBO-matching purposes only it can also satisfy this flagged alternate rank,
   * contributing that alternate's value instead within a combo resolved as that rank (see rules.ts's
   * validatePlayShape / comboMatchRanks). Always '2' today — kept as a Rank rather than hardcoding '2' in case a
   * future mercenary needs a different pair.
   */
  flexibleComboRank?: Rank;
  /**
   * Legacy-only: marks the Mercenary "19" card (see legacy/mercenaries.ts) — genuinely colorless, unlike Mage/
   * Reaver/Guardian/Druid/Chanter (which opt out of the combined suit-power resolution but substitute their OWN
   * effect instead). This card does nothing at all beyond contributing its raw value. Carries an arbitrary,
   * functionally-inert `suit` (never rendered as a real suit — see legacy/classes.ts's classForCard) that must
   * stay excluded from every suit-immunity-bookkeeping site a suited card would otherwise feed: the combined
   * suit-power resolution/immunity-blocking (engine.ts's resolveCommittedPlay's nonArcaneCards filter),
   * Mission 11's pile-top immunity bonus (rules.ts's pileTopImmuneSuits), Mission 3/12's zone-flip immunity
   * (engine.ts's flipMissionZoneCard/flipBanishPileZoneCard), Mission 6's zone-vengeance sacrifice
   * (engine.ts's chooseZoneVengeanceSacrifice), and the client's own hand-blocked-by-immunity check (Hand.tsx).
   */
  noSuitPower?: boolean;
  /**
   * Legacy-only: marks the Mercenary any-suit Ace (see legacy/mercenaries.ts). Carries a placeholder `suit` until
   * played — the player chooses one of the 4 base suits at the moment it's actually played (never a class/
   * campaign suit), submitted via PLAY_CARDS's `chosenSuits` or ASSIST_COMBO's `chosenSuit` (see engine.ts's
   * playCards/assistCombo, which mutate this card's `suit` in place, before validatePlayShape ever reads it, the
   * only point old enough in the resolution flow this can land). The choice is permanent once played, the same
   * "locks in" semantics as any other card's suit. Its rank stays 'A', so it's still an ordinary Animal Companion
   * (see rules.ts's isAnimalCompanion) alongside this.
   */
  wildSuit?: boolean;
}

export interface JesterCard {
  id: string;
  kind: 'jester';
}

export type Card = SuitedCard | JesterCard;

export interface PlayerState {
  id: string;
  name: string;
  hand: Card[];
  connected: boolean;
  /**
   * Legacy-only, gated by the 'KINFOLK_FLUTE' relic: one card (value 2-5) this player has banked out of hand
   * onto their personal Kinfolk slot, held for as long as they like until a matching-rank hand card lets them
   * play the two together as a combo (see engine.ts's PLAY_CARDS's includeKinfolkSlot). Null when empty.
   */
  kinfolkSlot: Card | null;
}

export interface EnemyState {
  suit: Suit;
  /** Legacy-only: a second class this enemy is also immune to (e.g. a two-headed hydra). Absent for single-class enemies. */
  secondSuit?: Suit;
  rank: 'J' | 'Q' | 'K';
  /** Legacy-only: a named mission enemy (e.g. "Letholdus the Justicar") shown instead of rank-of-suit. */
  name?: string;
  maxHealth: number;
  baseAttack: number;
  damageTaken: number;
  /** Active cumulative spade-shield reduction to this enemy's attack. */
  spadesShield: number;
  /**
   * Spade values played while this enemy was immune to spades; folded into spadesShield if immunity is later
   * broken. That redemption only happens in classic Regicide (engine.ts's activateJester) — Legacy's own Jester
   * claim (claimJester) never sets immunityBroken (deliberate, one-shot-only, see legacy.test.ts), so this value
   * accumulates but can never be redeemed in a Legacy game; see resolveSuitPowers's Spades branch, which keeps
   * its blocked-play log message ruleset-aware so it doesn't promise a payoff Legacy can't deliver.
   */
  blockedSpadesShield: number;
  /** True once a Jester has cancelled this enemy's suit immunity. */
  immunityBroken: boolean;
  /** All cards played against this enemy so far this fight (go to discard together on defeat). */
  tableCards: Card[];
  /**
   * Legacy-only (Mission 10), set only for enemies built by GameState.corruptedPartyEnemies: the original,
   * pristine party card this enemy was twisted from (see deck.ts's buildCorruptedPartyEnemies). Unrelated to
   * `corrupted` above — a Mission 10 enemy is immune to its own class exactly like any other enemy (per the
   * transcript), it doesn't ignore immunity the way a Mission 4 corrupted-return enemy does. Tracked so an
   * exact-damage kill can restore the underlying hero, cleansed, to the campaign party at mission end (see
   * GameState.restoredPartyCards).
   */
  sourceCard?: Card;
}

/** A mission-specific enemy spec used to build a Legacy mission's enemy deck (see legacy/missions.ts). */
export interface LegacyEnemySpec {
  name: string;
  /** The class the enemy is immune to, modeled internally as a suit (see legacy/classes.ts). */
  suit: Suit;
  /** A second class this enemy is also immune to (e.g. a two-headed hydra). Absent for single-class enemies. */
  secondSuit?: Suit;
  health: number;
  attack: number;
}

export type GamePhase = 'LOBBY' | 'IN_PROGRESS' | 'WON' | 'LOST';

/**
 * What the current player must do next. AWAIT_JESTER_CLAIM, AWAIT_COMBO_ASSIST, and AWAIT_AZURE_EMBLEM are
 * Legacy-only. AWAIT_ZONE_PURGE and AWAIT_CHANT_TRIM are Mission 8-only (see GameState.zonePurge / chanterWindow).
 * AWAIT_END_OF_TURN and AWAIT_RESCUE_CHOICE are Mission 9's captured-piles mechanic only (see
 * GameState.capturedPilesActive). AWAIT_ZONE_VENGEANCE_CHOICE is Mission 6 only (see
 * GameState.zoneVengeanceChoice) — opened by a kill under zoneVengeanceOnKill, resolved via
 * CHOOSE_ZONE_VENGEANCE_SACRIFICE. AWAIT_ZONE_RELIEF_CHOICE is also Mission 6 only (see GameState.zoneReliefChoice)
 * — opened by an exact-damage kill, resolved via CHOOSE_ZONE_RELIEF_CARD. AWAIT_BARD_SURRENDER is Mission 10 only
 * (see GameState.corruptedPartyEnemies) — opened by an enemy Bard's end-of-turn power when the ending player's hand
 * is non-empty, resolved via SURRENDER_CARD_TO_ZONE; engine.ts's advanceToNextPlayer pauses mid-advance right here
 * until it resolves, same shape as AWAIT_END_OF_TURN pausing there for Mission 9. AWAIT_MAGE_REVEAL is Mission 3+
 * only (see GameState.mageReveal) — opened by a Mage card in a play, resolved via CHOOSE_MAGE_REVEAL_CARD.
 * AWAIT_REAVER_REVEAL is Mission 5+ only (see GameState.reaverReveal) — opened by a Reaver card in a play,
 * resolved via CHOOSE_REAVER_REVEAL_CARD.
 */
export type TurnPhase =
  | 'AWAIT_PLAY'
  | 'AWAIT_DEFEND'
  | 'AWAIT_JESTER_CLAIM'
  | 'AWAIT_COMBO_ASSIST'
  | 'AWAIT_AZURE_EMBLEM'
  | 'AWAIT_ZONE_VENGEANCE_CHOICE'
  | 'AWAIT_ZONE_RELIEF_CHOICE'
  | 'AWAIT_ZONE_PURGE'
  | 'AWAIT_CHANT_TRIM'
  | 'AWAIT_END_OF_TURN'
  | 'AWAIT_RESCUE_CHOICE'
  | 'AWAIT_BARD_SURRENDER'
  | 'AWAIT_MAGE_REVEAL'
  | 'AWAIT_REAVER_REVEAL';

/**
 * Legacy-only (Mission 8): what engine.ts's resolveChant does once the last pending player finishes trimming
 * their hand back down from an open chant window (see GameState.chanterWindow):
 * - `deferredAttack` — the play that opened the chant did NOT defeat the enemy, so the play's own deferred
 *   enemy-attack-back tail (mirroring an ordinary play's resolution) still needs to run once trimming is done,
 *   honoring a Guardian shield (`blockNextAttack`) raised in the same play.
 * - `resumeResolved` — the play ALSO defeated the enemy: dealDamageAndCheckDefeat already fully resolved what
 *   happens next (continue against the newly-revealed enemy, Mission 9's exact-kill rescue choice, etc.) before
 *   the chant's forced draw ever ran. Restores that already-decided `turnPhase`/`pendingDamage` once trimming is
 *   done, instead of resolving a deferred attack against an enemy that's already dead.
 */
export type ChanterResolution =
  | { kind: 'deferredAttack'; blockNextAttack: boolean }
  | { kind: 'resumeResolved'; turnPhase: TurnPhase; pendingDamage: number };

/**
 * Legacy-only (Mission 9): one of the 3 captured piles seeding GameState.capturedPiles. `faceDown[0]` is the
 * next card to flip when `faceUp` is claimed or cycled away — see engine.ts's buildCapturedPiles/banishForRescue/
 * declineRescue.
 */
export interface CapturedPile {
  faceDown: Card[];
  faceUp: Card | null;
}

/** Which rules variant this game is running — gates every Legacy-only mechanic below. */
export type Ruleset = 'regicide' | 'legacy';

/** Official solo-variant scoring: winning having flipped 0/1/2 solo Jesters. Only set for 1-player games. */
export type VictoryMedal = 'gold' | 'silver' | 'bronze';

export interface GameState {
  phase: GamePhase;
  /** Defaults to 'regicide' everywhere existing code constructs a GameState — every Legacy-only field/branch below is inert unless this is 'legacy'. */
  ruleset: Ruleset;
  players: PlayerState[];
  currentPlayerIndex: number;
  turnPhase: TurnPhase;
  /** Damage the current player must discard cards to cover (only meaningful in AWAIT_DEFEND). */
  pendingDamage: number;
  castleDeck: EnemyState[];
  currentEnemy: EnemyState | null;
  tavernDeck: Card[];
  discardPile: Card[];
  maxHandSize: number;
  /** Tracks, per player index, whether their most recently completed turn was a yield (for the "can't all yield" rule, and Legacy's Feign Death). */
  lastActionWasYield: boolean[];
  log: GameEvent[];
  lossReason: string | null;
  /** Internal PRNG state (uint32) for in-game randomness like Hearts reshuffles. */
  rngState: number;
  /** Solo-variant only: how many of the 2 set-aside Jesters have been flipped (discard hand, refill to max) this game. */
  soloJestersUsed: number;
  /** Set once on WON, only for 1-player games, based on soloJestersUsed at that moment. */
  victoryMedal: VictoryMedal | null;
  /**
   * Legacy-only: the open Jester-claim window. Non-null from PLAY_JESTER until CLAIM_JESTER resolves it.
   * `claimedBy` is null while the window is open to any player.
   */
  jesterClaim: { card: Card; claimedBy: string | null } | null;
  /** Classic Regicide only: 0 until the first WON, then increments each time Endless Mode is continued into a new round (Kings join the deck, enemies scale up). */
  endlessLoop: number;
  /**
   * Legacy-only: when true, only an exact-damage hit defeats (and permanently banishes) the current enemy —
   * overkilling it instead resets its wounds and sends it to the back of the mission's enemy line to be fought
   * again later (see engine.ts's dealDamageAndCheckDefeat).
   */
  exactKillOnly: boolean;
  /** Legacy-only: relic ids the campaign has earned and carries into every mission (e.g. 'KINFOLK_FLUTE'). */
  relics: string[];
  /**
   * Legacy-only, gated by the 'SCARLET_WHISTLE' relic: the open combo-assist window. Non-null from the moment a
   * player attacks alone with a lone Animal/Beast Companion until it's resolved — any other player may silently
   * add one card via ASSIST_COMBO before the attacker calls RESOLVE_COMBO. The 'KINFOLK_FLUTE' relic used to
   * share this window too, but was reworked into each player's own persistent kinfolkSlot instead (sourced fix —
   * see PlayerState.kinfolkSlot / BANK_KINFOLK_CARD), so it no longer opens this window at all.
   */
  comboAssist: { attackerId: string; cardIds: string[] } | null;
  /**
   * Legacy-only, gated by the 'KINFOLK_FLUTE' relic: true once the current player has already banked a card
   * onto their kinfolkSlot this turn (see BANK_KINFOLK_CARD) — at most one bank per turn, even if the slot was
   * emptied again by playing it into a combo. Reset to false every time a new turn begins.
   */
  kinfolkBankedThisTurn: boolean;
  /**
   * Legacy-only (Mission 6), gated by the 'AZURE_EMBLEM' relic, sourced fix (see legacy-missions-transcript-
   * mismatches.md): the open Azure Emblem window — opened whenever a play includes a Mage card. The Mage's OWN
   * player (`pendingPlayerIds` holds just that one attacker id, kept as an array for shape-compatibility with
   * every other pending-player-queue field) may bank one of `eligibleCardIds` (this play's own Mage card(s),
   * still sitting on the enemy's table) onto the reserve deck via RESOLVE_AZURE_EMBLEM instead of losing it to
   * the discard pile later, or decline by omitting a card. `blockNextAttack` mirrors a Guardian shield raised in
   * the same play.
   */
  azureEmblemWindow: { pendingPlayerIds: string[]; eligibleCardIds: string[]; blockNextAttack: boolean } | null;
  /**
   * Legacy-only (Mission 3+), sourced from a full solo playthrough (see tutorial_vids/summaries/mission-3.md —
   * "Meet Me at the Table"): the open Mage reveal window. Playing a Mage card (or a card carrying a bonus Mage
   * sticker) secretly reveals cards off the top of the reserve deck — one per point of the play's own attack
   * strength — sets aside any Jesters/corrupted found there to the discard pile, and lets `playerId` choose one of
   * the rest via CHOOSE_MAGE_REVEAL_CARD to tuck under the attack (adding its value to the play's own total, which
   * every other class power then resolves against too — not a separate flat damage bonus like the old, simpler
   * arcane-bolt mechanic this replaced). If the chosen card is itself a Mage, the reveal chains again at that
   * card's own strength; `queue` holds this same play's other Mage card(s), each triggering their own independent
   * reveal (at the ORIGINAL play's strength) once the current chain resolves. Non-null only while a choice is
   * pending — an empty reveal (nothing left after discarding Jesters/corrupted) resolves immediately without
   * ever opening this window. `cards`/`claimedJester`/`forcedPlay`/`totalValue` carry everything
   * continueResolveCommittedPlay needs to resume once every queued Mage card's reveal (and any chains) is done.
   * `trigger` is whichever card actually opened THIS round — the original Mage card from `cards`/`queue`, or, for
   * a chained reveal, the previously-chosen candidate that turned out to itself be a Mage — so the UI can say
   * whose reveal is on screen instead of one generic "The Mage reveals..." banner for every round of a multi-Mage
   * or chained play (a real point of confusion once more than one reveal stacks up in the same combo).
   */
  mageReveal: {
    playerId: string;
    candidates: SuitedCard[];
    queue: Card[];
    cards: Card[];
    claimedJester: Card | null;
    forcedPlay: boolean;
    totalValue: number;
    arcaneBonus: number;
    /** Suits of every reveal card tucked under the attack so far — merged into the play's own suit-power resolution, see continueResolveCommittedPlay. */
    arcaneSuits: Suit[];
    trigger: Card;
  } | null;
  /**
   * Legacy-only (Mission 5+), John's ruling on the Reaver class ("Reveal and Add"): the open Reaver reveal window.
   * Playing a Reaver card reveals cards off the top of the reserve deck — one per point of the WHOLE PLAY's own
   * combined total value, not just the Reaver card's own printed rank (confirmed live 2026-08-30: a Reaver
   * combo'd into a bigger same-rank play, including via the Kinfolk Flute, reveals proportionally more) — and
   * lets `playerId` choose one of them via CHOOSE_REAVER_REVEAL_CARD to add its raw numeric strength (its class
   * power, if any, is ignored) to the play's attack total. EVERY card revealed this way —
   * chosen or not — is banished for good, not discarded (see resolveReaverRevealChoice's use of `allRevealed`,
   * which includes candidates never offered as a choice, like Jesters/corrupted cards). A Reaver's own class power
   * always doubles the play's total damage on top of this — see continueResolveCommittedPlay's reaverMultiplier —
   * so combining a Reaver with a Warrior (Clubs) card in the same play compounds into quadruple damage.
   * `trigger` is the Reaver card that opened this reveal, so the UI can name it instead of a generic banner.
   */
  reaverReveal: {
    playerId: string;
    candidates: SuitedCard[];
    allRevealed: Card[];
    cards: Card[];
    claimedJester: Card | null;
    forcedPlay: boolean;
    totalValue: number;
    arcaneBonus: number;
    arcaneSuits: Suit[];
    trigger: SuitedCard;
  } | null;
  /**
   * Legacy-only: when true (Mission 3), the top of the reserve deck flips face-up into `missionZone` at the end
   * of every turn, and the current enemy becomes immune to that card's class(es) too (see zoneImmuneSuits).
   */
  endOfTurnZoneFlip: boolean;
  /** Legacy-only: cards flipped into the shared mission zone (see endOfTurnZoneFlip). Cleared when the enemy is defeated. */
  missionZone: Card[];
  /** Legacy-only: extra classes the current enemy is immune to, stacked up from missionZone flips. Cleared with the zone. */
  zoneImmuneSuits: Suit[];
  /** Legacy-only: cards permanently removed from the game (mission-zone cleanup, etc.) — never reshuffled back in. */
  banishPile: Card[];
  /**
   * Legacy-only (Mission 2, unsourced house rule — John's own call from the physical game, not the tutorial
   * videos): when this mission's own `standingJesters` flag is set, its 2 Jesters are never shuffled into the
   * reserve deck at all — they sit here instead, usable by any player as their own turn's action via
   * USE_STANDING_JESTER (see engine.ts's useStandingJester), without ever needing to be drawn into a hand first.
   * Superseded the older jesterClaimNextPlayerOnly restriction, which only made sense for the old hand-played-then-
   * claimed-by-someone-else flow — a standing Jester is used by whoever invokes it, for themselves.
   */
  standingJesters: Card[];
  /**
   * Legacy-only (Mission 4): when true, the current enemy's attack is buffed by the value of whatever card
   * currently sits on top of the discard pile, recomputed live at the moment attack is dealt (see
   * rules.ts's discardPileTopValue). Can drive the buffed total below the enemy's own floor of 0 if spade
   * shielding has already knocked its base attack down — tracked as a negative total rather than clamped.
   */
  discardTopBuffsAttack: boolean;
  /**
   * Legacy-only (Mission 4): when true, an exact-damage kill seals a card representing the fallen specimen
   * onto the top of the reserve deck instead of the discard pile (see engine.ts's dealDamageAndCheckDefeat).
   * The cards played against it still go to the discard pile as normal either way.
   */
  exactKillToReserveDeck: boolean;
  /**
   * Legacy-only (Missions 4 and 11): when true, any batch of 2+ cards pushed onto the discard pile during
   * cleanup (a covered DEFEND, or an enemy's played table cards on defeat — exact or overkill) is sorted so the
   * LOWEST-value card of that batch ends up on top (the array's last element, per rules.ts's
   * discardPileTopValue), instead of whatever order the caller happened to collect them in. Sourced from an
   * independent fan digital-reimplementation's rules doc: "M4+ Cleanup discard ordering: when discarding played
   * cards during cleanup, place them low-to-high, lowest value on top" — a permanent rule introduced at Mission
   * 4 that stays in effect for every later mission, including Mission 11, whose own pileTopEnemyBonus reads this
   * same pile's top value. Without this, a mission that buffs enemy attack off the discard pile's top card
   * spirals toward whatever the highest card played that turn happened to leave on top — surviving a hit (a
   * covered DEFEND) is exactly what hands the next attack its own worst-case bonus (see engine.ts's
   * pushToDiscardPile).
   *
   * The same flag also governs engine.ts's banishCards, for the identical reason one pile over: Mission 11
   * routes a defeated enemy's played table cards to the BANISH pile instead of the discard pile (see
   * finishEnemyDefeatTail), and pileTopEnemyBonus reads that pile's top value too (rules.ts's
   * banishPileTopValue/pileTopImmuneSuits) — an unsorted batch there would reopen the same spiral one pile over.
   */
  discardCleanupLowToHigh: boolean;
  /**
   * Legacy-only (Mission 5): when true, an exact-damage kill bursts outward — the defeated enemy's own base
   * attack is dealt as splash damage straight into whatever's newly revealed at the top of the enemy deck
   * (which can itself chain into a further kill; see engine.ts's dealDamageAndCheckDefeat).
   */
  exactKillSplashDamage: boolean;
  /**
   * Legacy-only (Mission 5): when true, every turn recycles the top card of the BANISH pile (not the reserve
   * deck) into `rollingZoneCards`, where it accumulates — never replaced or re-banished on its own — until the
   * next enemy kill (see engine.ts's rollMissionZoneBonusCard). The accumulator's combined value buffs the
   * current enemy's attack for as long as it sits there (see resolvedEnemyAttack / rules.ts's missionZoneValueSum),
   * and a kill banishes the whole accumulator back to the banish pile and resets it to empty (see
   * dealDamageAndCheckDefeat) — sourced research's "accumulates ALL cards recycled from the banish pile since
   * the last kill and sums their total value," correcting the earlier shipped "one fresh card per turn, off the
   * reserve deck" reading. Separate from `missionZone`, which this mission no longer preset-seeds at all (Myla
   * is an ordinary reserve-deck card here, not a zone fixture — see missions.ts's Mission 5 entry).
   */
  rollingZoneBonus: boolean;
  /** Legacy-only (Mission 5): the cards currently accumulated in the rolling zone slot, if any (see rollingZoneBonus). */
  rollingZoneCards: Card[];
  /**
   * Legacy-only (Mission 6), sourced fix (see legacy-missions-transcript-mismatches.md — the official rules card
   * and a fan digital-reimplementation's rules doc agree on this): when true, every enemy kill permanently grows
   * `missionZone` — a PLAYER chooses one card from the play area just committed to the kill (the defeated
   * enemy's own table, see GameState.zoneVengeanceChoice / engine.ts's chooseZoneVengeanceSacrifice) to move into
   * the zone instead of the discard pile. The shipped version instead auto-picked the lowest-value card for the
   * player, routinely dragging a second or third suit into Myla's permanent immunity on the very first kill.
   * SOURCED CORRECTION (2nd-edition rules update, tutorial_vids/"Regicide Legacy - Mission 6 - QA.png" — an
   * official publisher errata page): an exact-damage kill additionally lets the player choose ANY one non-Myla
   * card already in the zone to discard permanently, BEFORE Myla's strike total is computed (see
   * GameState.zoneReliefChoice / engine.ts's chooseZoneReliefCard) — this happens even under a Guardian, since
   * the errata is explicit that a Guardian only cancels the strike below, not this discard. The 1st-edition
   * reading this replaced instead just excluded that strike's single highest-value card from the total for ONE
   * hit, with the card staying in the zone forever after — a temporary reprieve, not the permanent shrink the
   * errata actually describes.
   *
   * Once the zone grows (and any exact-kill relief resolves), Myla (its permanent occupant, see
   * presetMissionZone) strikes: pendingDamage is set to the live sum of every remaining card's value in
   * missionZone and turnPhase becomes AWAIT_DEFEND, reusing the normal defend/loss flow so an uncovered hit ends
   * the mission exactly like any other undefended attack (see engine.ts's finishEnemyDefeatTail) — UNLESS the
   * winning attack included a Guardian, which cancels this strike entirely (also sourced, previously
   * unimplemented — see dealDamageAndCheckDefeat's attackIncludesGuardian). The zone itself is never cleared for
   * the rest of the mission (aside from the errata's own permanent relief discard above).
   */
  zoneVengeanceOnKill: boolean;
  /**
   * Legacy-only (Mission 6): the open AWAIT_ZONE_VENGEANCE_CHOICE window opened by a kill under
   * zoneVengeanceOnKill above — non-null until CHOOSE_ZONE_VENGEANCE_SACRIFICE resolves it. `remaining` and
   * `attackIncludesGuardian`/`attackIncludesMage` are carried through from the kill so finishEnemyDefeatTail can
   * resume the rest of the defeat resolution exactly as if zoneVengeanceOnKill's sacrifice had resolved inline.
   */
  zoneVengeanceChoice: { remaining: number; attackIncludesGuardian: boolean; attackIncludesMage: boolean } | null;
  /**
   * Legacy-only (Mission 6), sourced fix (see zoneVengeanceOnKill's own doc comment): the open
   * AWAIT_ZONE_RELIEF_CHOICE window opened by an exact-damage kill, once the zone has at least one non-Myla
   * card — non-null until CHOOSE_ZONE_RELIEF_CARD resolves it. `attackIncludesGuardian` and `remaining` are
   * carried through so finishEnemyDefeatTail's Myla-strike step (and whatever comes after it) can resume exactly
   * as if the relief discard had resolved inline.
   */
  zoneReliefChoice: { attackIncludesGuardian: boolean; remaining: number } | null;
  /**
   * Legacy-only (Mission 7): when true, gates the whole Pilgrim hand-trap rule — Pilgrim cards (see
   * SuitedCard.pilgrim), shuffled into the reserve deck via Mission.extraReserveCards like any other card, can
   * never be played (PLAY_CARDS, ASSIST_COMBO) or discarded (DEFEND, including Feign Death) once drawn into a
   * hand — dead weight sitting there for the rest of the mission — and an exact-damage kill frees one for free
   * (see dealDamageAndCheckDefeat).
   *
   * Sourced from the official compendium FAQ, replacing an earlier, unsourced shared-zone rescue/burn-on-kill
   * economy that drained the same reserve-deck pool both hand-refill (Diamonds) and defense depend on — confirmed
   * unwinnable in simulated play (see legacy-mission-playtest-findings). `pilgrimDeck`/`pilgrimZone` below are
   * inert leftovers from that old economy, kept only for type/client compatibility — no mission populates them
   * anymore, so both are always empty.
   */
  pilgrimMechanic: boolean;
  /** Vestigial (see GameState.pilgrimMechanic) — no mission populates this anymore; always empty. Kept only so GameAction's pilgrimCards / ClientGameState's pilgrimDeckCount stay type-compatible for any future mission. */
  pilgrimDeck: Card[];
  /** Vestigial (see GameState.pilgrimMechanic) — no mission populates this anymore; always empty. Kept only so ClientGameState's pilgrimZone stays type-compatible for any future mission. */
  pilgrimZone: Card[];
  /**
   * Legacy-only (Mission 8): when true, the mission zone builds an ascending 1-through-10 chain instead of any
   * of the other missionZone modes above. A player may place a card into the zone via PLACE_IN_ZONE only if its
   * value is exactly one higher than the zone's required next slot (tracked as `missionZone.length + 1`, NOT the
   * top card's own printed value — the mission's one "2/5" wildcard can fill an out-of-order slot, see
   * matchesAscendingZoneSlot, so the chain's position can't be derived from the top card alone) — starting from
   * the "Pilgrim Puppy" (value 1) seeded via presetMissionZone. Non-Pilgrim cards used to bridge a gap buff the
   * current enemy's attack for as long as they sit there (see rules.ts's ascendingZoneAttackBuff); Pilgrim cards
   * never do. Completing the chain at 10 triggers the purge (see zonePurge) and permanently closes the zone
   * (zoneClosed). Unrelated to Mission 7's pilgrimZone above — see SuitedCard.pilgrim.
   *
   * PLACE_IN_ZONE is further gated by `zoneOpenForPlacement` below — building the run only opens up right after
   * an enemy kill, per the transcript ("Defeating an enemy lets the party build an ascending 'run' of cards").
   * SOURCED CORRECTION (fan-reimplementation rules doc, see GameAction's PLACE_IN_ZONE): the shipped version had
   * the player pay for a placement with an extra card pulled fresh from hand; the real rule reuses a card already
   * committed to the kill's own winning attack instead, at no extra cost (see zoneCommittedPlay below) — and
   * doesn't force the turn to end the way the shipped "ends the turn like a Yield" framing did. The sourced text
   * ("during cleanup, the player may...") reads as available on ANY turn's cleanup, not gated to right after a
   * kill specifically — narrower than that broader reading is a deliberate, flagged scope limit for this pass
   * (only the placement's COST was a confirmed mismatch on this session's punch list; widening WHEN it's offered
   * is left for a future pass), not a claim the kill-only gate itself is sourced-correct.
   */
  ascendingZone: boolean;
  /**
   * Legacy-only (Mission 8): true only in the placement window right after an enemy kill — set whenever a kill
   * lets the same player continue their turn (see engine.ts's dealDamageAndCheckDefeat), cleared at the end of
   * that turn (see engine.ts's finishAdvanceToNextPlayer, which also flushes any unclaimed zoneCommittedPlay to
   * the discard pile at that point). PLACE_IN_ZONE checks this before allowing a placement, so a later turn with
   * no fresh kill can't build the run further.
   */
  zoneOpenForPlacement: boolean;
  /**
   * Legacy-only (Mission 8): the pool PLACE_IN_ZONE draws from while zoneOpenForPlacement is open — the cards
   * that were just played to land the kill(s) that opened this window (see engine.ts's finishEnemyDefeatTail),
   * held here instead of falling straight to the discard pile the way a kill's table cards ordinarily do. A
   * placement removes its card from this pool, not from any hand — this is the "at no extra cost" half of the
   * sourced fix (see GameAction's PLACE_IN_ZONE). Multiple kills in the same open window all add to this same
   * pool rather than replacing it. Whatever's left unclaimed once the window closes (finishAdvanceToNextPlayer)
   * or the zone purges at 10 (placeInZone) falls to the discard pile like an ordinary kill's cards always do.
   */
  zoneCommittedPlay: Card[];
  /** Legacy-only (Mission 8): true once the ascending zone has purged at 10 — PLACE_IN_ZONE is rejected for the rest of the mission. */
  zoneClosed: boolean;
  /**
   * Legacy-only (Mission 8): the open "Ultimate Banishment" window, opened the instant the ascending zone's
   * 10-card purge fires (its cards already moved to discardPile). The triggering player may banish any subset
   * of the discard pile permanently via RESOLVE_ZONE_PURGE; whatever's left shuffles into the bottom of the
   * reserve deck.
   */
  zonePurge: { playerId: string } | null;
  /**
   * Legacy-only (Mission 8): the open chant window, opened when a Chanter card is played (see SuitedCard.chanter).
   * Every player has already drawn the chant's card count at once, even past their hand limit; `pendingPlayerIds`
   * queues whoever is now over their hand limit and still needs to trim back down via RESOLVE_CHANT, front of
   * the queue first. `onResolved` — see ChanterResolution — carries what to do once the last trim resolves.
   */
  chanterWindow: { pendingPlayerIds: string[]; onResolved: ChanterResolution } | null;
  /**
   * Legacy-only (Mission 9): when true, gates the whole captured-piles deckbuilding mechanic — the 3
   * `capturedPiles`, the AWAIT_END_OF_TURN banish-to-rescue/decline choice at the end of every turn (skipped
   * entirely right after defeating an enemy), and the AWAIT_RESCUE_CHOICE bonus on an exact-damage kill (see
   * engine.ts's endTurnOrAwaitRescue / banishForRescue / declineRescue / chooseExactKillRescue).
   */
  capturedPilesActive: boolean;
  /** Legacy-only (Mission 9): the 3 captured piles seeded at mission start (see deck.ts's buildCapturedPiles). */
  capturedPiles: CapturedPile[];
  /**
   * Legacy-only (Mission 10, "Pride to Fall"): when true, the mission's 8-enemy fight queue is built at mission
   * start from the campaign's own party instead of a static MissionEnemySpec list — 8 cards are pulled from
   * `party` (see START_LEGACY_MISSION, preferring already-`corrupted` party members per sourced research before
   * falling back to a random sample — see deck.ts's buildCorruptedPartyEnemies for the full reasoning), corrupted,
   * sorted weakest-to-strongest by card value, and each becomes an enemy with health fixed at 5x its (base,
   * pre-zone-bonus) strength.
   * Also gates this mission's 2 always-on class powers, resolved via resolvedEnemyAttack /
   * applyEnemyPaladinDamageReduction: an enemy Warrior doubles its total strength (base + mission-zone bonus,
   * see startOfTurnZoneFlip) before any Spades shield is subtracted; an enemy Paladin reduces damage it takes by
   * its own base strength. The other 2 classes' powers are end-of-turn effects (see engine.ts's
   * resolveCorruptedEnemyEndOfTurnEffect) rather than always-on math, so they don't need a flag check here.
   */
  corruptedPartyEnemies: boolean;
  /**
   * Legacy-only (Mission 10): when true, the top of the reserve deck flips face-up into the shared `missionZone`
   * at the START of every turn (not the end, unlike Mission 3's endOfTurnZoneFlip — the transcript is explicit
   * about the timing, contradicting a community-research claim of an end-of-turn flip; that claim was NOT used).
   * Unlike Mission 3, the flipped cards never grant suit immunity — their combined value instead buffs the
   * current enemy's own dealt attack for as long as they sit there (see resolvedEnemyAttack), climbing the
   * longer the fight drags on. Reuses `missionZone` itself (no separate array) since Mission 10 doesn't use any
   * of the other missionZone modes above.
   */
  startOfTurnZoneFlip: boolean;
  /**
   * Legacy-only (Mission 10), best-effort from community research (the transcript documents no reward at all —
   * see legacy/missions.ts's Mission 10 entry): every corrupted-hero enemy felled with an exact-damage hit during
   * the mission (see dealDamageAndCheckDefeat) has its original, pristine party card pushed here — "cleansed" of
   * the corruption just by virtue of being the untouched original, never mutated. Applied to the campaign's
   * permanent party roster at mission end (see party.ts's applyRestoredPartyCards), on top of the mission's own
   * static `reward`. An enemy defeated by overkill (not exact) contributes nothing here — per the transcript,
   * its own card still goes to the discard pile like any other Legacy enemy, just with no restoration bonus.
   */
  restoredPartyCards: Card[];
  /**
   * Legacy-only (Mission 11, "Descent into Darkness"): when true, gates the mission's whole beast-deck mechanic —
   * the start-of-turn suit-keyed flip (see engine.ts's flipBeastDeckCard) and the exact-kill-skips-next-flip rule
   * (see skipNextBeastDeckFlip). The mission's reward (Esme's permanent upgrade) doesn't touch this deck at all —
   * see party.ts's applyEvergreenUpgrade / missions.ts's Mission 11 entry.
   */
  beastDeckMechanic: boolean;
  /**
   * Legacy-only (Mission 11): the face-down deck built from every Beast Companion card in the campaign party
   * (Mission 4's reward pool, see SuitedCard.beast / deck.ts's buildBeastDeck) — pulled out of circulation and
   * seeded here at mission start instead of joining the reserve deck, so no Beast card is available to draw or
   * play this mission. Its top card flips for a one-shot effect at the start of every turn (see
   * flipBeastDeckCard), moving to `beastDeckDiscard`; once empty, it reshuffles from there and the cycle
   * continues. Every Beast Companion card was never removed from the persisted campaign roster to begin with (same
   * "sits out, comes back automatically" shape as this mission's sidelined Esme) — this `beastDeck` is only the
   * mission's temporary in-fight copy, so all 4 simply return to the party unchanged at mission end.
   */
  beastDeck: Card[];
  /** Legacy-only (Mission 11): beast-deck cards already flipped this mission — reshuffled back into `beastDeck` once it runs dry (see flipBeastDeckCard). */
  beastDeckDiscard: Card[];
  /** Legacy-only (Mission 11): true for the one turn right after an exact-damage kill — consumed by flipBeastDeckCard to skip that turn's flip, per the mission's own rule. */
  skipNextBeastDeckFlip: boolean;
  /**
   * Legacy-only (Mission 11): when true, the current enemy draws bonus strength AND class-immunity from whatever
   * cards currently sit on top of the discard pile and the banish pile — both piles recomputed live every check
   * (see rules.ts's pileTopImmuneSuits / resolvedEnemyAttack), not stored once and frozen like missionZone's
   * suit-immunity modes. Also changes how a defeated enemy's played cards are cleared away: they go to the
   * banish pile instead of the discard pile ("defeating the enemy always banishes it" — see
   * dealDamageAndCheckDefeat), which is what keeps feeding this same mechanic forward through the fight.
   */
  pileTopEnemyBonus: boolean;
  /**
   * Legacy-only (Mission 12, "Decay to Growth", the campaign's final mission): the master gate for the mission's
   * whole restored/corrupted-card bundle — unlike Mission 11's live pile-top peek above, this ACTUALLY MOVES the
   * banish pile's top card into `missionZone` at the start of every turn (see engine.ts's flipBanishPileZoneCard),
   * where it accumulates (never cleared except by a kill) buffing the current enemy's attack by the zone's
   * combined value (see rules.ts's missionZoneValueSum / resolvedEnemyAttack) and — reusing the existing
   * `zoneImmuneSuits` accumulation every earlier zone-immunity mission already populates — granting immunity to
   * every class sitting there. Also gates: a restored card's heal-instead-of-banish cost (see SuitedCard.restored
   * / applyRestoredHeal), a corrupted card's redirect away from the reserve deck to the bottom of the banish pile
   * (see SuitedCard.corrupted / engine.ts's toReserveDeck), and the three-step cleanup on defeat — banish the
   * whole mission zone, then the enemy's own table cards, then the ENTIRE discard pile, order preserved (see
   * dealDamageAndCheckDefeat) — a much bigger sweep than any earlier mission's zone-only cleanup, deliberately
   * feeding fresh material to next turn's flip.
   */
  restoredCardMechanic: boolean;
  /**
   * Legacy-only (Mission 12): true for the one turn right after an exact-damage kill — consumed by
   * flipBanishPileZoneCard to skip that turn's flip, mirroring Mission 11's skipNextBeastDeckFlip.
   */
  skipNextBanishZoneFlip: boolean;
  /**
   * Legacy-only: set by claimJester when its synthetic 8-strength attack didn't kill the enemy and left the
   * claimant owing a defend (turnPhase AWAIT_DEFEND) — non-null until that specific attack's damage is fully
   * resolved. Defers the base game's own printed "discard hand, redraw to max" Jester power past that defend, so
   * the claimant sees and chooses from their PRE-refill hand when deciding how to cover the jester's own dealt
   * damage, rather than a hand that's already been silently replaced out from under them (see engine.ts's
   * resolveJesterAttack/defend). Never set (and thus a no-op) when the attack killed outright or dealt no damage
   * back — those cases still refill immediately, same as before. `mode` is always 'discard' in practice: a
   * standing Jester's own house-rule "topUp" refill (Mission 2+, see GameState.standingJesters) only ever ADDS
   * cards, never discards what's already held, so it has no "hand swapped out from under them" risk to defer
   * against — it always refills immediately instead, even mid-Defend, so those cards are actually available to
   * cover the damage (a live-play bug fix: a standing Jester used with an already-empty hand, against an enemy
   * that survived and countered, used to leave the claimant facing a Defend with nothing to discard and no
   * refill until after a Defend they had no way to pay).
   */
  pendingJesterRefill: { playerId: string; mode: 'discard' | 'topUp' } | null;
}

export interface GameEvent {
  message: string;
}

export type GameAction =
  | { type: 'START_GAME'; playerIds: string[]; playerNames: string[]; seed: string }
  | {
      type: 'START_LEGACY_MISSION';
      playerIds: string[];
      playerNames: string[];
      seed: string;
      /** The campaign's current party roster (not a fresh standard deck). */
      party: Card[];
      /** This mission's enemies, in the fixed order they'll be faced. Ignored when `standardCastle` is true. */
      enemies: LegacyEnemySpec[];
      /** How many Jesters to shuffle into this mission's reserve deck (by player count, per the rulebook). */
      jesterCount: number;
      /** When true, ignores `enemies` and builds the standard 12-enemy Castle deck (classic Regicide's own rules). */
      standardCastle?: boolean;
      /** See GameState.exactKillOnly. */
      exactKillOnly?: boolean;
      /** See GameState.relics. */
      relics?: string[];
      /** See GameState.endOfTurnZoneFlip. */
      endOfTurnZoneFlip?: boolean;
      /** See GameState.standingJesters. */
      standingJesters?: boolean;
      /** See GameState.discardTopBuffsAttack. */
      discardTopBuffsAttack?: boolean;
      /** See GameState.exactKillToReserveDeck. */
      exactKillToReserveDeck?: boolean;
      /** See GameState.discardCleanupLowToHigh. */
      discardCleanupLowToHigh?: boolean;
      /** See GameState.exactKillSplashDamage. */
      exactKillSplashDamage?: boolean;
      /**
       * Legacy-only (Mission 6, also seeded by Mission 8 for its ascending chain's anchor): seeds
       * GameState.missionZone/zoneImmuneSuits with a fixed set of cards at mission start — unlike Mission 3's
       * endOfTurnZoneFlip, this zone is static for the whole mission (never flipped into, never banished on
       * defeat) since endOfTurnZoneFlip is left unset. Mission 5 does not use this field — Myla instead starts
       * the fight seeded into `presetBanishPile` below (see its own doc comment).
       */
      presetMissionZone?: Card[];
      /** See GameState.rollingZoneBonus. */
      rollingZoneBonus?: boolean;
      /**
       * Legacy-only (Mission 5), sourced fix: seeds GameState.banishPile with a fixed set of cards at mission
       * start, instead of leaving it empty until something is actually banished during play. Myla's card starts
       * here — "in the banish pile" per the sourced transcript — so the mission's normal end-of-turn banish-pile
       * recycle (rollMissionZoneBonusCard) is what slides her into the rolling zone, the same as any other card
       * that lands in the banish pile. That means her +7 is NOT live from the first attack: turn 1 hits the
       * enemy's base value, and only from turn 2 onward (once she's recycled in) does the buff apply — confirmed
       * against actual gameplay footage after an earlier reading had her seeded directly into the rolling zone
       * instead, which made the buff live one attack too early. Only meaningful alongside `rollingZoneBonus: true`.
       */
      presetBanishPile?: Card[];
      /** See GameState.zoneVengeanceOnKill. */
      zoneVengeanceOnKill?: boolean;
      /** See GameState.pilgrimMechanic. */
      pilgrimMechanic?: boolean;
      /** Vestigial (see GameState.pilgrimMechanic) — Pilgrim cards are seeded via extraReserveCards now, not this. No mission sets it anymore. */
      pilgrimCards?: Card[];
      /** See GameState.ascendingZone. */
      ascendingZone?: boolean;
      /** See GameState.capturedPilesActive. */
      capturedPilesActive?: boolean;
      /**
       * Legacy-only: named one-off cards (e.g. Pilgrim survivors) shuffled into this mission's reserve deck
       * alongside the campaign party — never added to the persisted campaign roster. Used by Mission 8's Pilgrim
       * survivors and by Mission 9 (alongside whatever's left of the party after capturedPilesActive's 30-card
       * split); unlike pilgrimCards above, these carry no special zone mechanic of their own.
       */
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
      /** See missions.ts's Mission.randomizeEnemyOrder — Mission 2 only. Shuffles `enemies` before building the fight queue. */
      randomizeEnemyOrder?: boolean;
    }
  /**
   * `chosenSuits` resolves any Mercenary any-suit Ace among `cardIds` (see SuitedCard.wildSuit) — cardId -> one
   * of the 4 base suits, required for every wildSuit card in the play, validated and applied (mutating that
   * card's `suit`) before validatePlayShape ever reads it. Omitted/empty when no wildSuit card is being played.
   * `includeKinfolkSlot` (Legacy only, gated by 'KINFOLK_FLUTE'): fold the player's own banked kinfolkSlot card
   * into this play as an extra combo card — the combined hand cards + slot card must still validate as one
   * ordinary same-rank combo (see engine.ts's playCards). The slot is cleared on success.
   */
  | { type: 'PLAY_CARDS'; playerId: string; cardIds: string[]; chosenSuits?: Record<string, Suit>; includeKinfolkSlot?: boolean }
  /**
   * Legacy-only, gated by the 'KINFOLK_FLUTE' relic: banks one hand card (value 2-5) onto the player's own
   * kinfolkSlot instead of attacking — a free side-action alongside (not instead of) their normal turn, capped
   * at once per turn and only while the slot is empty (see GameState.kinfolkBankedThisTurn).
   */
  | { type: 'BANK_KINFOLK_CARD'; playerId: string; cardId: string }
  | { type: 'YIELD'; playerId: string }
  /**
   * Legacy-only (Mission 8): places a card into the ascending mission zone, progressing the chain (see
   * GameState.ascendingZone). SOURCED CORRECTION (fan-reimplementation rules doc): `cardId` no longer refers to a
   * hand card — the shipped version's "pull a fresh card from hand" cost isn't sourced anywhere, and the real
   * rule instead reuses a card already committed to the kill's own winning attack, at no extra cost (see
   * GameState.zoneCommittedPlay). Consequently this no longer ends the turn either — the player is still mid-turn
   * after the kill that opened the window and simply continues normally afterward.
   */
  | { type: 'PLACE_IN_ZONE'; playerId: string; cardId: string }
  /** Legacy-only (Mission 8): resolves an open Ultimate Banishment window after the zone's 10-card purge (see GameState.zonePurge). Any subset of the discard pile (by id) is banished forever; the rest shuffles into the reserve deck. */
  | { type: 'RESOLVE_ZONE_PURGE'; playerId: string; banishCardIds: string[] }
  /**
   * Legacy-only (Mission 8): the front-of-queue player in an open chant window (see GameState.chanterWindow)
   * discards exactly enough hand cards to reach their hand limit again, after the chant's mass draw pushed them
   * over it.
   */
  | { type: 'RESOLVE_CHANT'; playerId: string; discardCardIds: string[] }
  | { type: 'ACTIVATE_JESTER'; playerId: string; cardId: string; nextPlayerId: string }
  /** Legacy-only equivalent of ACTIVATE_JESTER: plays the Jester into the open claim window instead of choosing who goes next. */
  | { type: 'PLAY_JESTER'; playerId: string; cardId: string }
  /**
   * Legacy-only: claim an open Jester window. Validated against the window being open, not turn ownership — any
   * player may claim. Resolves immediately and atomically as its own attack: a flat 8-strength hit, ignoring the
   * enemy's immunity and triggering no class power of its own (see engine.ts's resolveJesterAttack — the
   * synthetic attack card carries an inert placeholder suit, same shape as a Mercenary "19"), followed by the
   * claimant discarding their whole hand and drawing a fresh one — the base game's own printed Jester power,
   * which Legacy never overrides (deliberate house rule; see engine.ts's claimJester — unsourced beyond the base
   * game's own printed card text, since Mission 2's compendium page isn't published yet, but confirmed against
   * footage of actual play). This used to let the claimant also pick a suit to trigger that class's own power
   * (heal/draw/double-damage/reduce-enemy-attack) — dropped per John's own call: the base game's real Jester
   * carries no suit and no class power at all, and the choice was pure house-rule scaffolding this engine no
   * longer needs now that immunity-ignoring is driven by `claimedJester`, not by any particular suit.
   */
  | { type: 'CLAIM_JESTER'; playerId: string }
  /**
   * Legacy-only (Missions 2/3, unsourced house rule — see GameState.standingJesters): use one of the mission's
   * standing Jesters directly, as the current player's own turn action. Same flat, suit-less, immunity-ignoring
   * resolution as CLAIM_JESTER (see its own doc comment) but requires no PLAY_JESTER/CLAIM_JESTER handshake
   * first, since a standing Jester was never drawn into anyone's hand to begin with.
   */
  | { type: 'USE_STANDING_JESTER'; playerId: string }
  /**
   * Legacy-only, gated by the 'SCARLET_WHISTLE' relic: silently add a card from hand to the open combo-assist
   * window. Any player except the attacker. `chosenSuit` resolves `cardId` if it's a Mercenary any-suit Ace (see
   * SuitedCard.wildSuit / PLAY_CARDS's chosenSuits) — this window can open on a lone Companion-pairing play (see
   * engine.ts's assistCombo), which reads the assisting card's suit too.
   */
  | { type: 'ASSIST_COMBO'; playerId: string; cardId: string; chosenSuit?: Suit }
  /** Legacy-only, gated by the 'SCARLET_WHISTLE' relic: the attacker locks in and resolves the open combo-assist window. */
  | { type: 'RESOLVE_COMBO'; playerId: string }
  /**
   * Legacy-only, gated by the 'AZURE_EMBLEM' relic: the attacking player in an open Azure Emblem window (see
   * GameState.azureEmblemWindow) either banks `cardId` (one of this play's own Mage cards) onto the reserve
   * deck, or declines by omitting it.
   */
  | { type: 'RESOLVE_AZURE_EMBLEM'; playerId: string; cardId?: string }
  /**
   * Legacy-only (Mission 6), sourced fix, from AWAIT_ZONE_VENGEANCE_CHOICE: the player who just landed the kill
   * chooses `cardId`, from the defeated enemy's own table (see GameState.zoneVengeanceChoice), to sacrifice
   * permanently into the mission zone.
   */
  | { type: 'CHOOSE_ZONE_VENGEANCE_SACRIFICE'; playerId: string; cardId: string }
  /**
   * Legacy-only (Mission 6), sourced fix (see zoneVengeanceOnKill's own doc comment), from
   * AWAIT_ZONE_RELIEF_CHOICE: the player who just landed an exact-damage kill chooses `cardId`, any card in the
   * mission zone other than Myla, to discard permanently before Myla's strike total is computed.
   */
  | { type: 'CHOOSE_ZONE_RELIEF_CARD'; playerId: string; cardId: string }
  /**
   * Legacy-only (Mission 3+), sourced fix, from AWAIT_MAGE_REVEAL: the player whose Mage card opened the reveal
   * (see GameState.mageReveal) chooses `cardId`, from the cards just revealed off the reserve deck, to tuck under
   * the attack. Every candidate not chosen falls to the discard pile.
   */
  | { type: 'CHOOSE_MAGE_REVEAL_CARD'; playerId: string; cardId: string }
  /**
   * Legacy-only (Mission 5+), from AWAIT_REAVER_REVEAL: the player whose Reaver card opened the reveal (see
   * GameState.reaverReveal) chooses `cardId`, from the cards just revealed off the reserve deck, to add its
   * numeric strength to the attack. Every revealed card, chosen or not, is banished for good.
   */
  | { type: 'CHOOSE_REAVER_REVEAL_CARD'; playerId: string; cardId: string }
  | { type: 'DEFEND'; playerId: string; cardIds: string[] }
  | { type: 'USE_SOLO_JESTER'; playerId: string }
  /**
   * Legacy-only (Mission 9), from AWAIT_END_OF_TURN: banishes `cardId` from hand to rescue `pileIndex`'s
   * face-up captured card into the discard pile, then advances the turn.
   */
  | { type: 'BANISH_FOR_RESCUE'; playerId: string; cardId: string; pileIndex: number }
  /** Legacy-only (Mission 9), from AWAIT_END_OF_TURN: declines to banish — every captured pile cycles to its next card, then the turn advances. */
  | { type: 'DECLINE_RESCUE'; playerId: string }
  /** Legacy-only (Mission 9), from AWAIT_RESCUE_CHOICE: an exact kill's bonus — sends `pileIndex`'s face-up captured card straight to the top of the reserve deck. */
  | { type: 'CHOOSE_EXACT_KILL_RESCUE'; playerId: string; pileIndex: number }
  /**
   * Legacy-only (Mission 10), from AWAIT_BARD_SURRENDER: the ending player picks `cardId` from their own hand to
   * move into the mission zone, per an enemy Bard's end-of-turn power. Sourced correction (regicidelegacy.com's
   * compendium, corroborated by BGG threads and a working fan digital reimplementation's own UI — see the
   * legacy-missions-transcript-mismatches memory doc's Mission 10 section): the shipped version used to auto-pick
   * the player's lowest-value card instead of offering a real choice. Resuming turn-advancement after this
   * resolves is engine.ts's surrenderCardToZone's job.
   */
  | { type: 'SURRENDER_CARD_TO_ZONE'; playerId: string; cardId: string }
  /** Classic Regicide only, from WON: continues into another round with Kings shuffled into the Tavern deck and enemies scaled up. */
  | { type: 'START_ENDLESS_ROUND' }
  /**
   * Classic Regicide only, from LOBBY: starts a brand-new game directly into a saved Endless run (see
   * RoomManager's checkpointEndlessSave / engine.ts's ENDLESS_MODE_MAX_LOOP) instead of a fresh classic game.
   * `deck` is the save's 52 suited cards as they stood when that run's last round was won (tier bumps included,
   * no jesters — a fresh set is added per player count, same as START_ENDLESS_ROUND). `endlessLoop` is the round
   * that save last won; this action continues into `endlessLoop + 1`.
   */
  | { type: 'RESUME_ENDLESS_SAVE'; playerIds: string[]; playerNames: string[]; seed: string; deck: SuitedCard[]; endlessLoop: number };

export type EngineResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: string };

/** Redacted view of GameState sent to a specific client: other players' hands are counts only. */
export interface ClientPlayerView {
  id: string;
  name: string;
  connected: boolean;
  handCount: number;
  hand?: Card[]; // present only for the viewing player
  /** See PlayerState.kinfolkSlot. Public information — it sits on the shared relic, visible to the whole table. */
  kinfolkSlot: Card | null;
}

export interface ClientGameState {
  phase: GamePhase;
  ruleset: Ruleset;
  players: ClientPlayerView[];
  currentPlayerIndex: number;
  turnPhase: TurnPhase;
  pendingDamage: number;
  currentEnemy: EnemyState | null;
  /** See engine.ts's resolvedEnemyAttack — the enemy's true current attack after every mission-specific buff/shield is folded in. Null when there's no current enemy. */
  liveEnemyAttack: number | null;
  castleDeckCount: number;
  tavernDeckCount: number;
  discardPile: Card[];
  maxHandSize: number;
  log: GameEvent[];
  lossReason: string | null;
  soloJestersUsed: number;
  victoryMedal: VictoryMedal | null;
  /** Legacy-only: the Jester sitting in the open claim window, if any (public information — it's on the table). */
  jesterClaim: { card: Card; claimedBy: string | null } | null;
  /** See GameState.standingJesters. Public information — every player needs to know how many are left to use. */
  standingJesters: Card[];
  endlessLoop: number;
  /** See GameState.comboAssist. */
  comboAssist: { attackerId: string; cardIds: string[] } | null;
  /** Legacy-only: relic ids the campaign has earned (e.g. 'KINFOLK_FLUTE', 'SCARLET_WHISTLE'). Public information. */
  relics: string[];
  /** See GameState.kinfolkBankedThisTurn. */
  kinfolkBankedThisTurn: boolean;
  /** See GameState.azureEmblemWindow. Public information — it's on the table. */
  azureEmblemWindow: { pendingPlayerIds: string[]; eligibleCardIds: string[]; blockNextAttack: boolean } | null;
  /** See GameState.mageReveal. Public information, same as every other pending-choice window. */
  mageReveal: {
    playerId: string;
    candidates: SuitedCard[];
    queue: Card[];
    cards: Card[];
    claimedJester: Card | null;
    forcedPlay: boolean;
    totalValue: number;
    arcaneBonus: number;
    arcaneSuits: Suit[];
    trigger: Card;
  } | null;
  /** See GameState.reaverReveal. Public information, same as every other pending-choice window. */
  reaverReveal: {
    playerId: string;
    candidates: SuitedCard[];
    allRevealed: Card[];
    cards: Card[];
    claimedJester: Card | null;
    forcedPlay: boolean;
    totalValue: number;
    arcaneBonus: number;
    arcaneSuits: Suit[];
    trigger: SuitedCard;
  } | null;
  /** See GameState.discardTopBuffsAttack. */
  discardTopBuffsAttack: boolean;
  /** See GameState.missionZone. Public information — it's on the table. */
  missionZone: Card[];
  /** See GameState.rollingZoneBonus. */
  rollingZoneBonus: boolean;
  /** See GameState.rollingZoneCards. Public information — it's on the table. */
  rollingZoneCards: Card[];
  /** See GameState.zoneVengeanceOnKill. */
  zoneVengeanceOnKill: boolean;
  /** See GameState.zoneVengeanceChoice. Public information — the eligible cards are the enemy's own (public) table. */
  zoneVengeanceChoice: { remaining: number; attackIncludesGuardian: boolean; attackIncludesMage: boolean } | null;
  /** See GameState.zoneReliefChoice. Public information — the eligible cards are the mission zone's own (public) contents. */
  zoneReliefChoice: { attackIncludesGuardian: boolean; remaining: number } | null;
  /** See GameState.pilgrimMechanic. */
  pilgrimMechanic: boolean;
  /** Vestigial (see GameState.pilgrimMechanic) — always empty now; a Pilgrim card sits in the owning player's own (redacted) hand instead of any shared zone. */
  pilgrimZone: Card[];
  /** Vestigial (see GameState.pilgrimMechanic) — always 0 now. */
  pilgrimDeckCount: number;
  /** See GameState.ascendingZone. */
  ascendingZone: boolean;
  /** See GameState.zoneOpenForPlacement. */
  zoneOpenForPlacement: boolean;
  /** See GameState.zoneCommittedPlay. Public information — it's the cards that were just played, on the table. */
  zoneCommittedPlay: Card[];
  /** See GameState.zoneClosed. */
  zoneClosed: boolean;
  /** See GameState.zonePurge. Public information — it's on the table. */
  zonePurge: { playerId: string } | null;
  /** See GameState.chanterWindow. Public information — it's on the table. */
  chanterWindow: { pendingPlayerIds: string[]; onResolved: ChanterResolution } | null;
  /** See GameState.capturedPilesActive. */
  capturedPilesActive: boolean;
  /** See GameState.capturedPiles — each pile's face-down cards are redacted to a count, its face-up card is public. */
  capturedPiles: ClientCapturedPile[];
  /** See GameState.zoneImmuneSuits. Public information — it's on the table. */
  zoneImmuneSuits: Suit[];
  /** See GameState.banishPile. Public information — it's a visible discard-style pile, just permanent. */
  banishPile: Card[];
  /** See GameState.beastDeckMechanic. */
  beastDeckMechanic: boolean;
  /** See GameState.beastDeck — count only, it's face-down. */
  beastDeckCount: number;
  /** See GameState.beastDeckDiscard. Public information — already-flipped beast cards sit face-up. */
  beastDeckDiscard: Card[];
  /** See GameState.restoredCardMechanic. */
  restoredCardMechanic: boolean;
  you: {
    playerId: string;
  };
}

/** Redacted view of a captured pile: the face-up card is public, the face-down stack is only a count. */
export interface ClientCapturedPile {
  faceUp: Card | null;
  faceDownCount: number;
}
