export type Suit = 'H' | 'D' | 'C' | 'S';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'A' | 'J' | 'Q' | 'K';

/**
 * A signature ability a Legacy card can carry on top of its base suit power, one per class
 * (see legacy/classes.ts). Boosts the normal suit effect when the card is played: CLEAVE triples
 * (instead of doubles) Clubs damage, INSPIRE draws 2 extra on Diamonds, REVIVE heals 2 extra on
 * Hearts, BULWARK reduces the enemy's attack to 0 for the fight instead of by the play's value,
 * ARCANE_SURGE doubles a Mage card's own arcane bolt, PLUNDER tears 2 reserve cards instead of 1 for a Reaver
 * (both still banished; the higher value is kept), AEGIS makes a Guardian's shield hold permanently — reducing
 * the enemy's attack to 0 for the rest of the fight instead of blocking just its next attack, WELLSPRING salvages
 * 2 cards from the banish pile instead of 1 for a Druid's Regrowth, ENCORE doubles how many cards everyone
 * draws in a Chanter's chant, and EVERGREEN is Gøran's own signature (see SuitedCard.evergreen) carried here
 * only for type-shape consistency with the other classes.
 */
export type SpecialAbilityId =
  | 'CLEAVE'
  | 'INSPIRE'
  | 'REVIVE'
  | 'BULWARK'
  | 'ARCANE_SURGE'
  | 'PLUNDER'
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
   * Legacy-only: marks a Mage card. A Mage still carries a suit (for immunity bookkeeping) but its class
   * powers don't resolve as part of the combined suit powers — instead it fires its own arcane bolt, at its
   * own card value, before the play's other class powers resolve (see engine.ts's resolveArcaneBolts).
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
   * Legacy-only (Mission 8): marks a Pilgrim survivor card seeded into that mission's own reserve deck —
   * unrelated to Mission 7's separate pilgrimDeck/pilgrimZone mechanic (see GameState.pilgrimZone), despite the
   * shared name; both missions independently reused "Pilgrim" as flavor for stranded survivors. Otherwise an
   * entirely ordinary card — playable and discardable like any other — except when placed into Mission 8's
   * ascending mission zone: a Pilgrim card placed there never buffs the current enemy's attack the way a
   * non-Pilgrim card bridging a gap does (see GameState.ascendingZone / rules.ts's ascendingZoneAttackBuff).
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
   * resolution entirely), this card keeps resolving its normal suit power AND fires an arcane bolt at its own
   * value (see engine.ts's resolveArcaneBolts).
   */
  secondClassArcane?: boolean;
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
  /** Spade values played while this enemy was immune to spades; folded into spadesShield if immunity is later broken. */
  blockedSpadesShield: number;
  /** True once a Jester has cancelled this enemy's suit immunity. */
  immunityBroken: boolean;
  /** All cards played against this enemy so far this fight (go to discard together on defeat). */
  tableCards: Card[];
  /**
   * Legacy-only (Mission 4): true for an enemy that's already been through the fight queue once and come back
   * corrupted (see GameState.corruptedReturnQueue). Follows the same rule as a corrupted party card (see
   * SuitedCard.corrupted): every play against it ignores its class immunity, at the cost of banishing the top of
   * the reserve deck (see engine.ts's resolveCommittedPlay / applyCorruptedCost).
   */
  corrupted?: boolean;
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
 * GameState.capturedPilesActive). AWAIT_BEAST_REWARD_CHOICE is Mission 11 only (see GameState.beastDeckMechanic) —
 * opened once the mission's last enemy falls, resolved via CHOOSE_BEAST_REWARD; the mission only actually
 * completes (phase -> WON) once it's resolved.
 */
export type TurnPhase =
  | 'AWAIT_PLAY'
  | 'AWAIT_DEFEND'
  | 'AWAIT_JESTER_CLAIM'
  | 'AWAIT_COMBO_ASSIST'
  | 'AWAIT_AZURE_EMBLEM'
  | 'AWAIT_ZONE_PURGE'
  | 'AWAIT_CHANT_TRIM'
  | 'AWAIT_END_OF_TURN'
  | 'AWAIT_RESCUE_CHOICE'
  | 'AWAIT_BEAST_REWARD_CHOICE';

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
   * Legacy-only: the open Jester-claim window. Non-null from PLAY_JESTER until the claimant's
   * combined attack resolves. `claimedBy` is null while the window is open to any player.
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
   * Legacy-only, gated by the 'KINFOLK_FLUTE' relic: the open combo-assist window. Non-null from the moment a
   * player commits cards to an attack (with room left in the combo) until it's resolved — any other player may
   * silently add one matching card via ASSIST_COMBO before the attacker calls RESOLVE_COMBO.
   */
  comboAssist: { attackerId: string; cardIds: string[] } | null;
  /**
   * Legacy-only (Mission 6), gated by the 'AZURE_EMBLEM' relic: the open Azure Emblem window — opened whenever
   * a play includes a Mage card. Every other player, one at a time in turn order, may silently place a single
   * card from hand atop the reserve deck via RESOLVE_AZURE_EMBLEM (or decline by omitting a card), stocking it
   * for later. `blockNextAttack` mirrors a Guardian shield raised in the same play.
   */
  azureEmblemWindow: { pendingPlayerIds: string[]; blockNextAttack: boolean } | null;
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
  /** Legacy-only (Mission 2's hydras): when true, an open Jester claim window may only be claimed by the next player in turn order, not any player. */
  jesterClaimNextPlayerOnly: boolean;
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
   * Legacy-only (Mission 4): when true, a defeated enemy doesn't just vanish to the discard pile — it rejoins
   * the fight queue later, corrupted (see EnemyState.corrupted): every play against it from then on ignores its
   * class immunity, at the cost of banishing the reserve deck's top card (the same rule a corrupted party card
   * follows — see SuitedCard.corrupted / engine.ts's applyCorruptedCost). A corrupted enemy that's defeated
   * again does not re-queue a second time.
   */
  corruptedReturnQueue: boolean;
  /**
   * Legacy-only (Mission 5): when true, an exact-damage kill bursts outward — the defeated enemy's own base
   * attack is dealt as splash damage straight into whatever's newly revealed at the top of the enemy deck
   * (which can itself chain into a further kill; see engine.ts's dealDamageAndCheckDefeat).
   */
  exactKillSplashDamage: boolean;
  /**
   * Legacy-only (Mission 5): when true, a single "rolling" card cycles through its own zone slot every turn —
   * separate from `missionZone`, which here holds only Myla's static presetMissionZone seat (fixed immunity,
   * never flipped or banished). Each turn, whatever card currently occupies `rollingZoneCard` is banished for
   * good and a fresh one flips in off the reserve deck to replace it (see engine.ts's rollMissionZoneBonusCard),
   * its value buffing the current enemy's attack for as long as it sits there (see resolvedEnemyAttack) — the
   * transcript's "rolling mission-zone/banish-pile cycle each turn feeds bonus strength to the current enemy."
   */
  rollingZoneBonus: boolean;
  /** Legacy-only (Mission 5): the card currently occupying the rolling zone slot, if any (see rollingZoneBonus). */
  rollingZoneCard: Card | null;
  /**
   * Legacy-only (Mission 6): when true, every enemy kill permanently grows `missionZone` — the lowest-value
   * card left on the enemy's table is moved into the zone instead of the discard pile — and then Myla (the
   * zone's permanent occupant, see presetMissionZone) strikes: pendingDamage is set to the live sum of every
   * card's value in missionZone and turnPhase becomes AWAIT_DEFEND, reusing the normal defend/loss flow so an
   * uncovered hit ends the mission exactly like any other undefended attack (see engine.ts's
   * dealDamageAndCheckDefeat). An exact-damage kill excludes the single highest-value zone card from that
   * one strike's total. The zone itself is never cleared for the rest of the mission.
   */
  zoneVengeanceOnKill: boolean;
  /**
   * Legacy-only (Mission 7): when true, gates the whole Pilgrim mechanic — the start-of-turn flip into
   * `pilgrimZone`, the value-matching rescue on any attack play, and the deck-burn penalty on every enemy kill
   * (see engine.ts's flipPilgrimCard / checkPilgrimRescue / dealDamageAndCheckDefeat).
   */
  pilgrimMechanic: boolean;
  /** Legacy-only (Mission 7): the face-down Pilgrim deck, separate from the reserve deck — its top card flips into `pilgrimZone` at the start of every turn. */
  pilgrimDeck: Card[];
  /**
   * Legacy-only (Mission 7): Pilgrim cards flipped face-up into the shared mission zone, awaiting rescue.
   * Playing an attack whose total value exactly matches a Pilgrim's value here banishes that Pilgrim (rescued
   * for good). On every enemy kill, the reserve deck burns cards from its top equal to the combined value of
   * every Pilgrim still waiting here — never cleared except by exact-value rescues.
   */
  pilgrimZone: Card[];
  /**
   * Legacy-only (Mission 8): when true, the mission zone builds an ascending A-through-10 chain instead of any
   * of the other missionZone modes above. A player may place a card from hand into the zone via PLACE_IN_ZONE
   * only if its value is exactly one higher than the zone's current top card — starting from the "Pilgrim
   * Puppy" (value 1) seeded via presetMissionZone. Non-Pilgrim cards used to bridge a gap buff the current
   * enemy's attack for as long as they sit there (see rules.ts's ascendingZoneAttackBuff); Pilgrim cards never
   * do. Completing the chain at 10 triggers the purge (see zonePurge) and permanently closes the zone
   * (zoneClosed). Unrelated to Mission 7's pilgrimZone above — see SuitedCard.pilgrim.
   *
   * PLACE_IN_ZONE is further gated by `zoneOpenForPlacement` below — building the run only opens up right after
   * an enemy kill, per the transcript ("Defeating an enemy lets the party build an ascending 'run' of cards").
   */
  ascendingZone: boolean;
  /**
   * Legacy-only (Mission 8): true only in the placement window right after an enemy kill — set whenever a kill
   * lets the same player continue their turn (see engine.ts's dealDamageAndCheckDefeat), cleared at the end of
   * that turn (see engine.ts's advanceToNextPlayer). PLACE_IN_ZONE checks this before allowing a placement, so a
   * later turn with no fresh kill can't build the run further.
   */
  zoneOpenForPlacement: boolean;
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
   * the queue first. `blockNextAttack` mirrors a Guardian shield raised in the same play, applied once the last
   * trim resolves and the turn's enemy-attack tail finally runs.
   */
  chanterWindow: { pendingPlayerIds: string[]; blockNextAttack: boolean } | null;
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
   * `party` (see START_LEGACY_MISSION), corrupted, sorted weakest-to-strongest by card value, and each becomes an
   * enemy with health fixed at 5x its (base, pre-zone-bonus) strength (see deck.ts's buildCorruptedPartyEnemies).
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
   * the start-of-turn class-keyed flip (see engine.ts's flipBeastDeckCard), the exact-kill-skips-next-flip rule
   * (see skipNextBeastDeckFlip), and the end-of-mission AWAIT_BEAST_REWARD_CHOICE window.
   */
  beastDeckMechanic: boolean;
  /**
   * Legacy-only (Mission 11): the face-down deck built from every Beast Companion card in the campaign party
   * (Mission 4's reward pool, see SuitedCard.beast / deck.ts's buildBeastDeck) — pulled out of circulation and
   * seeded here at mission start instead of joining the reserve deck, so no Beast card is available to draw or
   * play this mission. Its top card flips for a one-shot effect at the start of every turn (see
   * flipBeastDeckCard), moving to `beastDeckDiscard`; once empty, it reshuffles from there and the cycle
   * continues. At mission end, `beastDeck` and `beastDeckDiscard` together are the pool CHOOSE_BEAST_REWARD picks
   * from (see GameState.restoredPartyCards / party.ts's applyBeastCardChoice).
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
      /**
       * Legacy-only (Mission 5): seeds GameState.missionZone/zoneImmuneSuits with a fixed set of cards at
       * mission start — unlike Mission 3's endOfTurnZoneFlip, this zone is static for the whole mission (never
       * flipped into, never banished on defeat) since endOfTurnZoneFlip is left unset.
       */
      presetMissionZone?: Card[];
      /** See GameState.rollingZoneBonus. */
      rollingZoneBonus?: boolean;
      /** See GameState.zoneVengeanceOnKill. */
      zoneVengeanceOnKill?: boolean;
      /** See GameState.pilgrimMechanic. */
      pilgrimMechanic?: boolean;
      /** Unshuffled Pilgrim cards to seed GameState.pilgrimDeck with (shuffled at mission start). */
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
    }
  | { type: 'PLAY_CARDS'; playerId: string; cardIds: string[] }
  | { type: 'YIELD'; playerId: string }
  /** Legacy-only (Mission 8): places a card from hand into the ascending mission zone instead of attacking — ends the turn like a Yield, but progresses the chain (see GameState.ascendingZone). */
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
  /** Legacy-only: claim an open Jester window. Validated against the window being open, not turn ownership — any player may claim. */
  | { type: 'CLAIM_JESTER'; playerId: string }
  /** Legacy-only, gated by the 'KINFOLK_FLUTE' relic: silently add a matching card from hand to the open combo-assist window. Any player except the attacker. */
  | { type: 'ASSIST_COMBO'; playerId: string; cardId: string }
  /** Legacy-only, gated by the 'KINFOLK_FLUTE' relic: the attacker locks in and resolves the open combo-assist window. */
  | { type: 'RESOLVE_COMBO'; playerId: string }
  /**
   * Legacy-only, gated by the 'AZURE_EMBLEM' relic: the front-of-queue player in an open Azure Emblem window
   * (see GameState.azureEmblemWindow) either places `cardId` from their hand atop the reserve deck, or declines
   * by omitting it.
   */
  | { type: 'RESOLVE_AZURE_EMBLEM'; playerId: string; cardId?: string }
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
   * Legacy-only (Mission 11), from AWAIT_BEAST_REWARD_CHOICE: picks `cardId` (one of the beast-deck cards, see
   * GameState.beastDeck/beastDeckDiscard) to carry into Mission 12. Validated against the window being open, not
   * turn ownership — any player may make the pick for the party, same as CLAIM_JESTER.
   */
  | { type: 'CHOOSE_BEAST_REWARD'; playerId: string; cardId: string }
  /** Classic Regicide only, from WON: continues into another round with Kings shuffled into the Tavern deck and enemies scaled up. */
  | { type: 'START_ENDLESS_ROUND' };

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
}

export interface ClientGameState {
  phase: GamePhase;
  ruleset: Ruleset;
  players: ClientPlayerView[];
  currentPlayerIndex: number;
  turnPhase: TurnPhase;
  pendingDamage: number;
  currentEnemy: EnemyState | null;
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
  endlessLoop: number;
  /** See GameState.comboAssist. */
  comboAssist: { attackerId: string; cardIds: string[] } | null;
  /** See GameState.azureEmblemWindow. Public information — it's on the table. */
  azureEmblemWindow: { pendingPlayerIds: string[]; blockNextAttack: boolean } | null;
  /** See GameState.discardTopBuffsAttack. */
  discardTopBuffsAttack: boolean;
  /** See GameState.missionZone. Public information — it's on the table. */
  missionZone: Card[];
  /** See GameState.rollingZoneBonus. */
  rollingZoneBonus: boolean;
  /** See GameState.rollingZoneCard. Public information — it's on the table. */
  rollingZoneCard: Card | null;
  /** See GameState.zoneVengeanceOnKill. */
  zoneVengeanceOnKill: boolean;
  /** See GameState.pilgrimMechanic. */
  pilgrimMechanic: boolean;
  /** See GameState.pilgrimZone. Public information — it's on the table. */
  pilgrimZone: Card[];
  /** See GameState.pilgrimDeck — count only, it's face-down. */
  pilgrimDeckCount: number;
  /** See GameState.ascendingZone. */
  ascendingZone: boolean;
  /** See GameState.zoneOpenForPlacement. */
  zoneOpenForPlacement: boolean;
  /** See GameState.zoneClosed. */
  zoneClosed: boolean;
  /** See GameState.zonePurge. Public information — it's on the table. */
  zonePurge: { playerId: string } | null;
  /** See GameState.chanterWindow. Public information — it's on the table. */
  chanterWindow: { pendingPlayerIds: string[]; blockNextAttack: boolean } | null;
  /** See GameState.capturedPilesActive. */
  capturedPilesActive: boolean;
  /** See GameState.capturedPiles — each pile's face-down cards are redacted to a count, its face-up card is public. */
  capturedPiles: ClientCapturedPile[];
  you: {
    playerId: string;
  };
}

/** Redacted view of a captured pile: the face-up card is public, the face-down stack is only a count. */
export interface ClientCapturedPile {
  faceUp: Card | null;
  faceDownCount: number;
}
