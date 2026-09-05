import { useEffect, useMemo, useState } from 'react';
import {
  cardValue,
  ENDLESS_MODE_MAX_LOOP,
  isMageCard,
  MAX_SOLO_JESTERS,
  matchesAscendingZoneSlot,
  SOLO_JESTER_ABILITY_TEXT,
  validatePlayShape,
  type ClientGameState,
  type EndlessStatePayload,
  type GameAction,
  type Suit,
} from '@regicide/shared';
import { EnemyDisplay } from '../components/EnemyDisplay';
import { MissionZonePanel } from '../components/MissionZonePanel';
import { DeckPiles } from '../components/DeckPiles';
import { PlayerList } from '../components/PlayerList';
import { ActionLog } from '../components/ActionLog';
import { Hand } from '../components/Hand';
import { ConfirmPlayBar } from '../components/ConfirmPlayBar';
import { JesterPicker } from '../components/JesterPicker';
import { VictoryCrest } from '../components/VictoryCrest';
import { ZonePurgePicker } from '../components/ZonePurgePicker';
import { CapturedPiles } from '../components/CapturedPiles';
import { EnemyCardPicker } from '../components/EnemyCardPicker';
import { ReaverRevealCountPicker } from '../components/ReaverRevealCountPicker';
import { ChanterCountPicker } from '../components/ChanterCountPicker';
import { RelicsTray } from '../components/RelicsTray';
import { RegrowthWindow } from '../components/RegrowthWindow';

const MEDAL_INFO: Record<'gold' | 'silver' | 'bronze', { emoji: string; label: string }> = {
  gold: { emoji: '🥇', label: 'Gold Victory' },
  silver: { emoji: '🥈', label: 'Silver Victory' },
  bronze: { emoji: '🥉', label: 'Bronze Victory' },
};

const SUIT_LABEL: Record<Suit, string> = { H: '♥ Hearts', D: '♦ Diamonds', C: '♣ Clubs', S: '♠ Spades' };

export function GamePage({
  state,
  myPlayerId,
  isHost,
  sendAction,
  onLeave,
  onRestart,
  endlessState,
}: {
  state: ClientGameState;
  myPlayerId: string;
  isHost: boolean;
  sendAction: (action: GameAction) => void;
  onLeave: () => void;
  onRestart: () => void;
  endlessState?: EndlessStatePayload | null;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // A Mercenary any-suit Ace (see SuitedCard.wildSuit) needs a suit picked client-side before it can be played
  // or assisted with — cardId -> the player's choice, submitted alongside PLAY_CARDS/ASSIST_COMBO.
  const [chosenSuits, setChosenSuits] = useState<Record<string, Suit>>({});
  // Kinfolk Flute: whether to fold the player's own banked slot card into this play (see PLAY_CARDS's includeKinfolkSlot).
  const [includeKinfolkSlot, setIncludeKinfolkSlot] = useState(false);

  useEffect(() => {
    setSelectedIds(new Set());
    setChosenSuits({});
    setIncludeKinfolkSlot(false);
  }, [state.currentPlayerIndex, state.turnPhase]);

  const me = state.players.find((p) => p.id === myPlayerId);
  const myHand = me?.hand ?? [];
  const isMyTurn = state.players[state.currentPlayerIndex]?.id === myPlayerId;
  const selectedCards = myHand.filter((c) => selectedIds.has(c.id));
  const isLoneJester = selectedCards.length === 1 && selectedCards[0].kind === 'jester';
  const unresolvedWildCard = selectedCards.find((c) => c.kind === 'suited' && c.wildSuit && !chosenSuits[c.id]);

  // Kinfolk Flute: a personal storage slot, gated on the relic actually being earned.
  const hasKinfolkFlute = state.relics.includes('KINFOLK_FLUTE');
  const myKinfolkSlot = me?.kinfolkSlot ?? null;
  const canBankKinfolk =
    hasKinfolkFlute &&
    isMyTurn &&
    state.turnPhase === 'AWAIT_PLAY' &&
    !myKinfolkSlot &&
    !state.kinfolkBankedThisTurn &&
    selectedCards.length === 1 &&
    selectedCards[0].kind === 'suited' &&
    cardValue(selectedCards[0]) >= 2 &&
    cardValue(selectedCards[0]) <= 5;

  // Folds the banked Kinfolk slot card into the local preview/validation whenever the player has it toggled on.
  const previewCards = includeKinfolkSlot && myKinfolkSlot ? [...selectedCards, myKinfolkSlot] : selectedCards;
  const selectedTotal = previewCards.reduce((sum, c) => sum + cardValue(c), 0);

  const playError = useMemo(() => {
    if (selectedCards.length === 0 || isLoneJester) return null;
    if (state.turnPhase === 'AWAIT_PLAY' && unresolvedWildCard) {
      return 'Choose a suit for the any-suit Ace before playing it.';
    }
    const shape = validatePlayShape(previewCards, state.endlessLoop);
    return 'error' in shape ? shape.error : null;
  }, [previewCards, selectedCards, isLoneJester, state.turnPhase, state.endlessLoop, unresolvedWildCard]);

  function toggleCard(cardId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  const isLegacy = state.ruleset === 'legacy';
  const isComboAssistWindow = state.turnPhase === 'AWAIT_COMBO_ASSIST' && Boolean(state.comboAssist);
  const isComboAttacker = state.comboAssist?.attackerId === myPlayerId;
  const canAssistCombo = isComboAssistWindow && !isComboAttacker;
  const isAwaitEndOfTurn = state.turnPhase === 'AWAIT_END_OF_TURN';
  const isAwaitRescueChoice = state.turnPhase === 'AWAIT_RESCUE_CHOICE';

  // Mission 8: the ascending mission zone chain, the chant's hand-trim queue, and the post-purge banishment window.
  // Required value is tracked by POSITION (missionZone.length + 1), not the top card's own printed value — the
  // mission's "2/5" wildcard can fill an out-of-order slot (see rules.ts's matchesAscendingZoneSlot), which would
  // desync a value-derived "top + 1" the moment one lands.
  const zoneRequiredValue = state.missionZone.length + 1;
  // SOURCED FIX: placement no longer costs a fresh hand card — it reuses a card already committed to the kill's
  // own winning attack (see GameState.zoneCommittedPlay), at no extra cost. EVERY committed card that fills the
  // current required slot stays selectable — a single kill can free more than one match at once (e.g. a Pilgrim
  // card alongside an ordinary one of the same value), and which one gets placed matters: only a non-Pilgrim card
  // buffs the enemy's attack once seated (see rules.ts's ascendingZoneAttackBuff), so silently taking the first
  // match would deny the player the obviously-better Pilgrim choice.
  const placeableZoneCards = state.zoneCommittedPlay.filter((c) => matchesAscendingZoneSlot(c, zoneRequiredValue));
  const placeableZoneCard = placeableZoneCards[0];
  const placeableZoneCardIds = new Set(placeableZoneCards.map((c) => c.id));
  // John's house rule (2026-09-04): opened by a Chanter card BEFORE anything is drawn — the player freely
  // declares how many cards the chant draws for everyone, independent of the Chanter card's own printed rank.
  const isChanterCountWindow = state.turnPhase === 'AWAIT_CHANT_COUNT' && Boolean(state.chanterCountChoice);
  const chanterCountPlayerId = state.chanterCountChoice?.playerId;
  const isMyChanterCountWindow = isChanterCountWindow && chanterCountPlayerId === myPlayerId;

  const isChantWindow = state.turnPhase === 'AWAIT_CHANT_TRIM' && Boolean(state.chanterWindow);
  const chantTrimmerId = state.chanterWindow?.pendingPlayerIds[0];
  const isMyChantTrim = isChantWindow && chantTrimmerId === myPlayerId;
  const myChantOverflow = Math.max(0, myHand.length - state.maxHandSize);
  // Mission 7's Regrowth window — every player who was dealt cards resolves in queue order.
  const isRegrowthWindow = state.turnPhase === 'AWAIT_REGROWTH' && Boolean(state.druidWindow);
  const regrowthPickerId = state.druidWindow?.pendingPlayerIds[0];
  const isMyRegrowth = isRegrowthWindow && regrowthPickerId === myPlayerId;
  const myRegrowthDealt = state.druidWindow?.dealt[myPlayerId] ?? [];
  const isZonePurgeWindow = state.turnPhase === 'AWAIT_ZONE_PURGE' && Boolean(state.zonePurge);
  const isMyZonePurgeWindow = isZonePurgeWindow && state.zonePurge?.playerId === myPlayerId;

  // Mission 6 relic: the Azure Emblem window, opened whenever a play resolves that included a Mage card — win,
  // lose, exact hit, or overkill (John's house rule, 2026-09-04), so it's no longer safe to assume the window's
  // cards are still sitting on the enemy's table (the kill may have already swept it away, or revealed a whole
  // new enemy) — the window carries its own cards directly instead (see GameState.azureEmblemWindow).
  const isAzureEmblemWindow = state.turnPhase === 'AWAIT_AZURE_EMBLEM' && Boolean(state.azureEmblemWindow);
  const azureEmblemTurnPlayerId = state.azureEmblemWindow?.pendingPlayerIds[0];
  const isMyAzureEmblemTurn = isAzureEmblemWindow && azureEmblemTurnPlayerId === myPlayerId;
  const azureEmblemEligibleCards = state.azureEmblemWindow?.cards.filter(isMageCard) ?? [];

  // Mission 6, sourced fix: the zone-vengeance sacrifice window opened by a kill under zoneVengeanceOnKill —
  // only the current player (who landed the kill) resolves it.
  const isZoneVengeanceWindow = state.turnPhase === 'AWAIT_ZONE_VENGEANCE_CHOICE' && Boolean(state.zoneVengeanceChoice);
  const isMyZoneVengeanceWindow = isZoneVengeanceWindow && isMyTurn;

  // Mission 6, sourced fix (2nd-edition rules update): an exact-damage kill's zone-relief window — choose one
  // non-Myla card from the mission zone to discard for good, before Myla's own strike total is computed.
  const isZoneReliefWindow = state.turnPhase === 'AWAIT_ZONE_RELIEF_CHOICE' && Boolean(state.zoneReliefChoice);
  const isMyZoneReliefWindow = isZoneReliefWindow && isMyTurn;
  const zoneReliefEligibleCards = state.missionZone.filter((c) => !(c.kind === 'suited' && c.name === 'Myla'));

  // Mission 3+, sourced from a full solo playthrough (see tutorial_vids/summaries/mission-3.md): the Mage reveal
  // window, opened whenever a Mage card joins an attack — only the player whose Mage it is resolves it.
  const isMageRevealWindow = state.turnPhase === 'AWAIT_MAGE_REVEAL' && Boolean(state.mageReveal);
  const mageRevealPlayerId = state.mageReveal?.playerId;
  const isMyMageRevealWindow = isMageRevealWindow && mageRevealPlayerId === myPlayerId;
  // Naming whose reveal is on screen — plain "The Mage reveals..." was ambiguous the moment a combo stacked up
  // more than one reveal in a row (a second Mage card still queued, or a chain from a revealed card that's
  // itself a Mage): every round looked identical, so there was no way to tell which one you were resolving.
  const mageTrigger = state.mageReveal?.trigger;
  const mageTriggerLabel = mageTrigger ? (mageTrigger.kind === 'suited' ? (mageTrigger.name ?? `the ${mageTrigger.rank}`) : 'The Mage') : 'The Mage';
  const mageQueueRemaining = state.mageReveal?.queue.length ?? 0;
  // John's house rule: a corrupted ("cursed") Mage's reveal passes its immunity-ignoring property on to whatever
  // card it pulls up (see engine.ts's resolveMageRevealChoice) — flagged here so the reveal prompt can call it out.
  const mageTriggerIsCursed = mageTrigger?.kind === 'suited' && Boolean(mageTrigger.corrupted);

  // Mission 5+, John's ruling: opened by a Reaver card BEFORE anything is revealed — the player picks how many
  // cards (1 up to the play's total value) the reveal should actually pull off the reserve deck.
  const isReaverRevealCountWindow = state.turnPhase === 'AWAIT_REAVER_REVEAL_COUNT' && Boolean(state.reaverRevealCountChoice);
  const reaverRevealCountPlayerId = state.reaverRevealCountChoice?.playerId;
  const isMyReaverRevealCountWindow = isReaverRevealCountWindow && reaverRevealCountPlayerId === myPlayerId;
  const reaverCountTrigger = state.reaverRevealCountChoice?.trigger;
  const reaverCountTriggerLabel = reaverCountTrigger ? (reaverCountTrigger.name ?? `the ${reaverCountTrigger.rank}`) : 'The Reaver';

  // Mission 5+, John's ruling ("Reveal and Add"): the Reaver reveal window, opened whenever a Reaver card joins
  // an attack — only the player whose Reaver it is resolves it.
  const isReaverRevealWindow = state.turnPhase === 'AWAIT_REAVER_REVEAL' && Boolean(state.reaverReveal);
  const reaverRevealPlayerId = state.reaverReveal?.playerId;
  const isMyReaverRevealWindow = isReaverRevealWindow && reaverRevealPlayerId === myPlayerId;
  const reaverTrigger = state.reaverReveal?.trigger;
  const reaverTriggerLabel = reaverTrigger ? (reaverTrigger.name ?? `the ${reaverTrigger.rank}`) : 'The Reaver';

  // Mission 4+, John's house rule (see engine.ts's resolveScarletWhistleSoloChoice): the solo Scarlet Whistle
  // window — playing a lone Companion in solo play opens a real choice among the WHOLE discard pile instead of
  // silently auto-pulling its top card.
  const isScarletWhistleSoloWindow = state.turnPhase === 'AWAIT_SCARLET_WHISTLE_SOLO' && Boolean(state.scarletWhistleSoloChoice);
  const isMyScarletWhistleSoloWindow = isScarletWhistleSoloWindow && state.scarletWhistleSoloChoice?.playerId === myPlayerId;
  const canPlaceInZone =
    isLegacy &&
    state.ascendingZone &&
    !state.zoneClosed &&
    state.zoneOpenForPlacement &&
    isMyTurn &&
    state.turnPhase === 'AWAIT_PLAY' &&
    Boolean(placeableZoneCard);

  if (state.phase === 'WON' || state.phase === 'LOST') {
    return (
      <div className="centered-page">
        {state.phase === 'WON' && !isLegacy && (
          <div className="victory-crest">
            <VictoryCrest />
          </div>
        )}
        <h1>{state.phase === 'WON' ? (isLegacy ? 'Mission Complete!' : 'Victory!') : 'Defeat'}</h1>
        <p>
          {state.phase === 'WON'
            ? isLegacy
              ? 'Every enemy has fallen — the Golden Blade Syndicate carries the day.'
              : 'The realm is saved — every enemy has fallen.'
            : state.lossReason}
        </p>
        {state.phase === 'WON' && state.victoryMedal && (
          <p className={`victory-medal medal-${state.victoryMedal}`}>
            {MEDAL_INFO[state.victoryMedal].emoji} {MEDAL_INFO[state.victoryMedal].label} — used {state.soloJestersUsed} of{' '}
            {MAX_SOLO_JESTERS} solo Jesters.
          </p>
        )}
        {state.phase === 'WON' && !isLegacy && state.endlessLoop > 0 && (
          <p style={{ color: 'var(--ink-dim)' }}>
            Endless Mode: survived {state.endlessLoop} round{state.endlessLoop === 1 ? '' : 's'}
            {state.endlessLoop >= ENDLESS_MODE_MAX_LOOP ? ' — the final round!' : '.'}
          </p>
        )}
        {state.phase === 'WON' && !isLegacy && endlessState && (
          <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)' }}>
            Endless save code: <strong>{endlessState.saveCode}</strong> — load it from the home screen to pick this run back up later.
          </p>
        )}
        <ActionLog state={state} />
        {state.phase === 'WON' && !isLegacy && state.endlessLoop >= ENDLESS_MODE_MAX_LOOP && (
          <p style={{ color: 'var(--ink-dim)' }}>Endless Mode ends here — there is no round {ENDLESS_MODE_MAX_LOOP + 1} to continue into.</p>
        )}
        {state.phase === 'WON' && !isLegacy && state.endlessLoop < ENDLESS_MODE_MAX_LOOP && isHost && (
          <button
            className="btn"
            title="Continue with the Kings shuffled into the Tavern deck and every enemy scaled up"
            onClick={() => sendAction({ type: 'START_ENDLESS_ROUND' })}
          >
            ♛ Continue in Endless Mode
          </button>
        )}
        {isHost ? (
          <button className="btn" onClick={onRestart}>
            Play again
          </button>
        ) : (
          <p style={{ color: 'var(--ink-dim)' }}>Waiting for the host to start a new game...</p>
        )}
        <button className="btn btn-secondary" onClick={onLeave}>
          Leave
        </button>
      </div>
    );
  }

  return (
    <div className="game-page">
      <div className="game-top">
        <div className={`status-banner${isMyTurn ? ' your-turn' : ''}`}>
          {state.endlessLoop > 0 && (
            <span className="endless-badge" title="Endless Mode round">
              ♛ Round {state.endlessLoop}
              {state.endlessLoop >= ENDLESS_MODE_MAX_LOOP ? ' (final)' : ''}
            </span>
          )}
          {isComboAssistWindow
            ? isComboAttacker
              ? 'Your attack is open for the Scarlet Whistle — resolve it when ready.'
              : 'An attack is open for the Scarlet Whistle — silently add a matching card, or leave it alone.'
            : isAzureEmblemWindow
              ? isMyAzureEmblemTurn
                ? 'Azure Emblem: bank one of your Mage card(s) onto the reserve deck, or decline.'
                : `${state.players.find((p) => p.id === azureEmblemTurnPlayerId)?.name} is responding to the Azure Emblem...`
              : isZoneVengeanceWindow
                ? isMyZoneVengeanceWindow
                  ? 'The kill draws a card permanently into the mission zone — choose one from the table below.'
                  : `${state.players[state.currentPlayerIndex]?.name} is choosing a card to sacrifice into the mission zone...`
                : isMageRevealWindow
                  ? isMyMageRevealWindow
                    ? `${mageTriggerLabel}'s reveal${mageTriggerIsCursed ? ' (cursed — the chosen card will ignore immunity)' : ''} — choose one card to banish and add to the attack.${mageQueueRemaining > 0 ? ` (${mageQueueRemaining} more Mage card${mageQueueRemaining === 1 ? '' : 's'} still to resolve after this.)` : ''}`
                    : `${state.players.find((p) => p.id === mageRevealPlayerId)?.name} is choosing a card from ${mageTriggerLabel}'s reveal...`
                  : isChanterCountWindow
                  ? isMyChanterCountWindow
                    ? 'A Chanter leads the chant — choose how many cards everyone draws, independent of the card\'s own rank.'
                    : `${state.players.find((p) => p.id === chanterCountPlayerId)?.name} is choosing how many cards the chant draws...`
                : isReaverRevealCountWindow
                    ? isMyReaverRevealCountWindow
                      ? `${reaverCountTriggerLabel} opens a reveal — choose how many cards to pull off the reserve deck (fewer is safer — every card revealed is banished either way).`
                      : `${state.players.find((p) => p.id === reaverRevealCountPlayerId)?.name} is choosing how many cards to reveal from ${reaverCountTriggerLabel}...`
                  : isReaverRevealWindow
                    ? isMyReaverRevealWindow
                      ? `${reaverTriggerLabel}'s reveal — choose one card to add to the attack.`
                      : `${state.players.find((p) => p.id === reaverRevealPlayerId)?.name} is choosing a card from ${reaverTriggerLabel}'s reveal...`
                  : isScarletWhistleSoloWindow
                    ? isMyScarletWhistleSoloWindow
                      ? 'Scarlet Whistle — choose one card from the discard pile to pair with your Companion.'
                      : `${state.players.find((p) => p.id === state.scarletWhistleSoloChoice?.playerId)?.name} is choosing a card from the discard pile (Scarlet Whistle)...`
                  : isChantWindow
                  ? isMyChantTrim
                    ? `The chant drew everyone up — discard exactly ${myChantOverflow} card(s) to get back to your hand limit.`
                    : `${state.players.find((p) => p.id === chantTrimmerId)?.name} is trimming their hand from the chant...`
                  : isRegrowthWindow
                  ? isMyRegrowth
                    ? 'Regrowth — assign the cards dealt to you from the discard pile.'
                    : `${state.players.find((p) => p.id === regrowthPickerId)?.name} is sorting their Regrowth cards...`
                  : isZonePurgeWindow
                    ? isMyZonePurgeWindow
                      ? 'Choose cards to banish forever from the discard pile, or continue.'
                      : `${state.players.find((p) => p.id === state.zonePurge!.playerId)?.name} is sorting the Ultimate Banishment...`
                    : isMyTurn
                      ? isAwaitEndOfTurn
                        ? 'End of turn: banish a hand card to rescue a captured pile, or decline and cycle them all.'
                        : isAwaitRescueChoice
                          ? 'Exact hit! Choose a captured pile to rescue to the top of the reserve deck.'
                          : state.turnPhase === 'AWAIT_DEFEND'
                            ? `Defend! Discard ${state.pendingDamage} damage worth of cards.`
                            : 'Your turn — play a card, a combo, or yield.'
                      : `Waiting for ${state.players[state.currentPlayerIndex]?.name}...`}
          {isHost && (
            <button
              type="button"
              className="btn-restart"
              title="Restart with a fresh shuffle"
              onClick={() => {
                if (window.confirm('Restart the game with a new shuffle? This ends the current run.')) {
                  onRestart();
                }
              }}
            >
              ↻ Restart
            </button>
          )}
        </div>
        {isLegacy && state.jesterClaim && (
          <div className="legacy-jester-claim-banner">
            <span>🃏 A Jester is up for grabs — claim it for a free 8-strength attack with no counter-attack in return, then refill your hand.</span>
            <div className="jester-picker-choices">
              <button type="button" className="btn" onClick={() => sendAction({ type: 'CLAIM_JESTER', playerId: myPlayerId })}>
                Claim it
              </button>
            </div>
          </div>
        )}
        {isLegacy && isMyTurn && state.turnPhase === 'AWAIT_PLAY' && state.standingJesters.length > 0 && (
          <div className="legacy-jester-claim-banner">
            <span>
              🃏 {state.standingJesters.length} standing Jester{state.standingJesters.length > 1 ? 's' : ''} available — use one now for a
              free 8-strength attack with no counter-attack in return, then draw back up to your hand limit.
            </span>
            <div className="jester-picker-choices">
              <button type="button" className="btn" onClick={() => sendAction({ type: 'USE_STANDING_JESTER', playerId: myPlayerId })}>
                Use a Jester
              </button>
            </div>
          </div>
        )}
        {isComboAssistWindow && (
          <div className="legacy-jester-claim-banner">
            {isComboAttacker ? (
              <>
                <span>🎗️ Scarlet Whistle: your attack is open — anyone else may silently add a matching card before you resolve it.</span>
                <button type="button" className="btn" onClick={() => sendAction({ type: 'RESOLVE_COMBO', playerId: myPlayerId })}>
                  Resolve attack
                </button>
              </>
            ) : (
              <span>
                🎗️ Scarlet Whistle: {state.players.find((p) => p.id === state.comboAssist!.attackerId)?.name} committed an attack —
                pick a matching card from your hand below to silently add it, or leave it alone.
              </span>
            )}
          </div>
        )}
        {isMyChantTrim && (
          <div className="legacy-jester-claim-banner">
            <span>🎼 The chant drew everyone up — pick exactly {myChantOverflow} card(s) below to discard back down to your hand limit.</span>
            <button
              type="button"
              className="btn"
              disabled={selectedCards.length !== myChantOverflow}
              onClick={() => {
                sendAction({ type: 'RESOLVE_CHANT', playerId: myPlayerId, discardCardIds: selectedCards.map((c) => c.id) });
                setSelectedIds(new Set());
              }}
            >
              Discard {selectedCards.length} / {myChantOverflow}
            </button>
          </div>
        )}
        {isMyRegrowth && <RegrowthWindow dealt={myRegrowthDealt} myPlayerId={myPlayerId} sendAction={sendAction} />}
        {isLegacy && <RelicsTray state={state} myPlayerId={myPlayerId} />}
        <div className={`game-board${state.capturedPilesActive ? ' has-captured-piles' : ''}`}>
          <div className="z-enemy">
            {state.currentEnemy && (
              <EnemyDisplay
                enemy={state.currentEnemy}
                liveAttack={state.liveEnemyAttack ?? 0}
                zoneImmuneSuits={state.zoneImmuneSuits}
              />
            )}
          </div>
          {/* Mission 9's captured piles get their own bordered zone directly under the enemy, with the draw deck
              below it — the column order on John's physical playmat. See .game-board.has-captured-piles. */}
          {state.capturedPilesActive && (
            <div className="z-piles">
              <div className="board-panel">
                <span className="board-panel-title">Captured piles</span>
                <CapturedPiles piles={state.capturedPiles} />
              </div>
            </div>
          )}
          <div className="z-missionzone">
            <MissionZonePanel
              state={state}
              placeableCardIds={canPlaceInZone ? placeableZoneCardIds : undefined}
              onPlaceInZone={
                canPlaceInZone
                  ? (cardId) => sendAction({ type: 'PLACE_IN_ZONE', playerId: myPlayerId, cardId })
                  : undefined
              }
            />
          </div>
          <div className="z-players">
            <div className="board-panel">
              <span className="board-panel-title">Party</span>
              <PlayerList state={state} myPlayerId={myPlayerId} />
            </div>
          </div>
          <div className="z-decks">
            <DeckPiles state={state} myPlayerId={myPlayerId} />
          </div>
          <div className="z-log">
            <div className="board-panel">
              <span className="board-panel-title">Log</span>
              <ActionLog state={state} />
            </div>
          </div>
        </div>
      </div>

      <div className="hand-area">
        <div className="hand-label">
          <span>
            Your hand: {myHand.length} / {state.maxHandSize}
          </span>
          {state.players.length === 1 && !isLegacy && (
            <button
              type="button"
              className="btn-solo-jester"
              title={SOLO_JESTER_ABILITY_TEXT}
              disabled={!isMyTurn || state.soloJestersUsed >= MAX_SOLO_JESTERS}
              onClick={() => {
                const left = MAX_SOLO_JESTERS - state.soloJestersUsed;
                if (window.confirm(`Flip a solo Jester: discard your whole hand and refill to ${state.maxHandSize}? (${left} left, affects your medal)`)) {
                  sendAction({ type: 'USE_SOLO_JESTER', playerId: myPlayerId });
                }
              }}
            >
              🃏 Flip Jester ({MAX_SOLO_JESTERS - state.soloJestersUsed} left)
            </button>
          )}
          {canBankKinfolk && (
            <button
              type="button"
              className="btn-solo-jester"
              title="Bank this card onto your Kinfolk slot (see it on the mat below), once per turn — play it alongside a matching-rank card later."
              onClick={() => {
                sendAction({ type: 'BANK_KINFOLK_CARD', playerId: myPlayerId, cardId: selectedCards[0].id });
                setSelectedIds(new Set());
              }}
            >
              🎵 Bank onto Kinfolk Flute
            </button>
          )}
        </div>
        <Hand
          cards={myHand}
          selectedIds={selectedIds}
          onToggle={toggleCard}
          interactive={
            canAssistCombo ||
            isMyChantTrim ||
            (isMyTurn &&
              !isComboAssistWindow &&
              state.turnPhase !== 'AWAIT_JESTER_CLAIM' &&
              state.turnPhase !== 'AWAIT_ZONE_PURGE' &&
              state.turnPhase !== 'AWAIT_AZURE_EMBLEM' &&
              state.turnPhase !== 'AWAIT_ZONE_VENGEANCE_CHOICE' &&
              !isAwaitRescueChoice)
          }
          enemy={state.currentEnemy}
          zoneImmuneSuits={state.zoneImmuneSuits}
        />
      </div>

      {canAssistCombo && (
        <div className="jester-picker">
          <span>Pick exactly one matching card from your hand to silently add to the open attack.</span>
          <div className="jester-picker-choices">
            <button
              className="btn"
              disabled={selectedCards.length !== 1 || Boolean(unresolvedWildCard)}
              onClick={() => {
                const card = selectedCards[0];
                const chosenSuit = card.kind === 'suited' && card.wildSuit ? chosenSuits[card.id] : undefined;
                sendAction({ type: 'ASSIST_COMBO', playerId: myPlayerId, cardId: card.id, chosenSuit });
                setSelectedIds(new Set());
                setChosenSuits({});
              }}
            >
              Add to attack
            </button>
            <button
              className="btn-secondary btn"
              onClick={() => {
                setSelectedIds(new Set());
                setChosenSuits({});
              }}
            >
              Leave it alone
            </button>
          </div>
        </div>
      )}

      {unresolvedWildCard && isMyTurn && (canAssistCombo || (state.turnPhase === 'AWAIT_PLAY' && !isComboAssistWindow)) && (
        <div className="jester-picker">
          <span>Choose a suit for the any-suit Ace.</span>
          <div className="jester-picker-choices">
            {(Object.keys(SUIT_LABEL) as Suit[]).map((suit) => (
              <button
                key={suit}
                className="btn-secondary btn"
                onClick={() => setChosenSuits((prev) => ({ ...prev, [unresolvedWildCard.id]: suit }))}
              >
                {SUIT_LABEL[suit]}
              </button>
            ))}
          </div>
        </div>
      )}

      {isMyTurn && isLoneJester && state.turnPhase === 'AWAIT_PLAY' && isLegacy && (
        <div className="jester-picker">
          <span>Play the Jester into the open — any player (including you) may then claim it and attack.</span>
          <div className="jester-picker-choices">
            <button
              className="btn"
              onClick={() => {
                sendAction({ type: 'PLAY_JESTER', playerId: myPlayerId, cardId: selectedCards[0].id });
                setSelectedIds(new Set());
              }}
            >
              Play the Jester
            </button>
            <button className="btn-secondary btn" onClick={() => setSelectedIds(new Set())}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {isMyTurn && isLoneJester && state.turnPhase === 'AWAIT_PLAY' && !isLegacy && (
        <JesterPicker
          state={state}
          myPlayerId={myPlayerId}
          onChoose={(nextPlayerId) => {
            sendAction({ type: 'ACTIVATE_JESTER', playerId: myPlayerId, cardId: selectedCards[0].id, nextPlayerId });
            setSelectedIds(new Set());
          }}
          onCancel={() => setSelectedIds(new Set())}
        />
      )}

      {isMyAzureEmblemTurn && (
        <div className="jester-picker">
          <span>
            🔷 Azure Emblem: pick one of your Mage card(s) below to bank onto the reserve deck, or decline — anything you don't bank stays in
            play against this enemy and is banished when it falls.
          </span>
          <EnemyCardPicker
            cards={azureEmblemEligibleCards}
            onChoose={(cardId) => sendAction({ type: 'RESOLVE_AZURE_EMBLEM', playerId: myPlayerId, cardId })}
          />
          <div className="jester-picker-choices">
            <button type="button" className="btn-secondary btn" onClick={() => sendAction({ type: 'RESOLVE_AZURE_EMBLEM', playerId: myPlayerId })}>
              Decline
            </button>
          </div>
        </div>
      )}

      {isMyZoneVengeanceWindow && (
        <div className="jester-picker">
          <span>☠️ The kill draws a card permanently into the mission zone — choose one from the enemy's table below.</span>
          <EnemyCardPicker
            cards={state.currentEnemy?.tableCards ?? []}
            onChoose={(cardId) => sendAction({ type: 'CHOOSE_ZONE_VENGEANCE_SACRIFICE', playerId: myPlayerId, cardId })}
          />
        </div>
      )}

      {isMyZoneReliefWindow && (
        <div className="jester-picker">
          <span>🥀 An exact hit! Choose one card from the mission zone (other than Myla) to discard for good.</span>
          <EnemyCardPicker
            cards={zoneReliefEligibleCards}
            onChoose={(cardId) => sendAction({ type: 'CHOOSE_ZONE_RELIEF_CARD', playerId: myPlayerId, cardId })}
          />
        </div>
      )}

      {isMyMageRevealWindow && (
        <div className="jester-picker">
          <span>
            ✦ {mageTriggerLabel}'s reveal turns up these cards — choose one to banish and add to the attack.
            {mageTriggerIsCursed && ' The chosen card will ignore enemy immunity, courtesy of the corrupted Mage.'}
            {mageQueueRemaining > 0 && ` (${mageQueueRemaining} more Mage card${mageQueueRemaining === 1 ? '' : 's'} still to resolve after this.)`}
          </span>
          <EnemyCardPicker
            cards={state.mageReveal?.candidates ?? []}
            onChoose={(cardId) => sendAction({ type: 'CHOOSE_MAGE_REVEAL_CARD', playerId: myPlayerId, cardId })}
          />
        </div>
      )}

      {isMyChanterCountWindow && (
        <div className="jester-picker">
          <span>
            🎼 A Chanter leads the chant — choose how many cards everyone draws (1-{state.chanterCountChoice?.maxCount}). This has
            nothing to do with the Chanter card's own rank.
          </span>
          <ChanterCountPicker
            maxCount={state.chanterCountChoice?.maxCount ?? 1}
            onChoose={(count) => sendAction({ type: 'CHOOSE_CHANT_COUNT', playerId: myPlayerId, count })}
          />
        </div>
      )}

      {isMyReaverRevealCountWindow && (
        <div className="jester-picker">
          <span>
            🔨 {reaverCountTriggerLabel} opens a reveal — choose how many cards (1-{state.reaverRevealCountChoice?.maxCount}) to pull from
            the reserve deck. Every card revealed is banished either way, and you must use one of them, so fewer is safer.
          </span>
          <ReaverRevealCountPicker
            maxCount={state.reaverRevealCountChoice?.maxCount ?? 1}
            onChoose={(count) => sendAction({ type: 'CHOOSE_REAVER_REVEAL_COUNT', playerId: myPlayerId, count })}
          />
        </div>
      )}

      {isMyReaverRevealWindow && (
        <div className="jester-picker">
          <span>🔨 {reaverTriggerLabel}'s reveal turns up these cards — you must use one of them, so choose which to add to the attack.</span>
          <EnemyCardPicker
            cards={state.reaverReveal?.candidates ?? []}
            onChoose={(cardId) => sendAction({ type: 'CHOOSE_REAVER_REVEAL_CARD', playerId: myPlayerId, cardId })}
          />
        </div>
      )}

      {isMyScarletWhistleSoloWindow && (
        <div className="jester-picker">
          <span>🎗️ Scarlet Whistle — choose any one card from the discard pile to pair with your Companion, or attack alone.</span>
          <EnemyCardPicker
            cards={state.scarletWhistleSoloChoice?.candidates ?? []}
            onChoose={(cardId) => sendAction({ type: 'CHOOSE_SCARLET_WHISTLE_DISCARD_CARD', playerId: myPlayerId, cardId })}
          />
          <div className="jester-picker-choices">
            <button className="btn-secondary btn" onClick={() => sendAction({ type: 'DECLINE_SCARLET_WHISTLE_SOLO', playerId: myPlayerId })}>
              Attack alone — pair with nothing
            </button>
          </div>
        </div>
      )}

      {isMyZonePurgeWindow && (
        <ZonePurgePicker
          discardPile={state.discardPile}
          onResolve={(banishCardIds) => sendAction({ type: 'RESOLVE_ZONE_PURGE', playerId: myPlayerId, banishCardIds })}
        />
      )}

      {isMyTurn && isAwaitEndOfTurn && (
        <div className="jester-picker">
          <span>
            {selectedCards.length === 1
              ? 'Choose a captured pile below to rescue with the selected card, or decline to cycle them all instead.'
              : 'Select one card from your hand to banish, then choose a captured pile to rescue — or decline to cycle them all.'}
          </span>
          <CapturedPiles
            piles={state.capturedPiles}
            chooseLabel="Banish & rescue"
            onChoosePile={
              selectedCards.length === 1
                ? (pileIndex) => {
                    sendAction({ type: 'BANISH_FOR_RESCUE', playerId: myPlayerId, cardId: selectedCards[0].id, pileIndex });
                    setSelectedIds(new Set());
                  }
                : undefined
            }
          />
          <div className="jester-picker-choices">
            <button className="btn-secondary btn" onClick={() => sendAction({ type: 'DECLINE_RESCUE', playerId: myPlayerId })}>
              Decline — cycle all piles
            </button>
          </div>
        </div>
      )}

      {isMyTurn && isAwaitRescueChoice && (
        <div className="jester-picker">
          <span>Exact hit! Choose a captured pile to send straight to the top of the reserve deck.</span>
          <CapturedPiles
            piles={state.capturedPiles}
            chooseLabel="Rescue to top of deck"
            onChoosePile={(pileIndex) => sendAction({ type: 'CHOOSE_EXACT_KILL_RESCUE', playerId: myPlayerId, pileIndex })}
          />
        </div>
      )}

      {isMyTurn &&
        myKinfolkSlot &&
        state.turnPhase === 'AWAIT_PLAY' &&
        selectedCards.length > 0 && (
          <label className="kinfolk-include-toggle">
            <input type="checkbox" checked={includeKinfolkSlot} onChange={(e) => setIncludeKinfolkSlot(e.target.checked)} />
            Play alongside your Kinfolk slot card ({myKinfolkSlot.kind === 'suited' ? myKinfolkSlot.name ?? `the ${myKinfolkSlot.rank}` : ''})
          </label>
        )}

      {isMyTurn &&
        !isComboAssistWindow &&
        !isAzureEmblemWindow &&
        !isZoneVengeanceWindow &&
        !isMageRevealWindow &&
        !isChantWindow &&
        !isRegrowthWindow &&
        !isZonePurgeWindow &&
        state.turnPhase !== 'AWAIT_JESTER_CLAIM' &&
        !isAwaitEndOfTurn &&
        !isAwaitRescueChoice &&
        !(isLoneJester && state.turnPhase === 'AWAIT_PLAY') && (
          <ConfirmPlayBar
            turnPhase={state.turnPhase}
            pendingDamage={state.pendingDamage}
            selectedTotal={selectedTotal}
            selectedCount={selectedCards.length}
            handSize={myHand.length}
            playError={playError}
            canYield={true}
            onClear={() => setSelectedIds(new Set())}
            onPlay={() => {
              sendAction({
                type: 'PLAY_CARDS',
                playerId: myPlayerId,
                cardIds: selectedCards.map((c) => c.id),
                chosenSuits: Object.keys(chosenSuits).length > 0 ? chosenSuits : undefined,
                includeKinfolkSlot: includeKinfolkSlot || undefined,
              });
              setSelectedIds(new Set());
              setChosenSuits({});
              setIncludeKinfolkSlot(false);
            }}
            onYield={() => sendAction({ type: 'YIELD', playerId: myPlayerId })}
            onDefend={() => {
              sendAction({ type: 'DEFEND', playerId: myPlayerId, cardIds: selectedCards.map((c) => c.id) });
              setSelectedIds(new Set());
            }}
            placeInZone={
              isLegacy && state.ascendingZone && !state.zoneClosed && state.turnPhase === 'AWAIT_PLAY'
                ? {
                    // More than one committed card can match the same slot at once (e.g. a Pilgrim card and an
                    // ordinary card of equal value) — this generic button only auto-picks when the choice is
                    // unambiguous; with a real choice on the table, it's disabled and the player must click the
                    // specific card they want in the Mission Zone panel instead (see placeableCardIds above).
                    canPlace: canPlaceInZone && placeableZoneCards.length === 1,
                    ambiguous: placeableZoneCards.length > 1,
                    requiredValue: zoneRequiredValue,
                    onPlace: () => {
                      if (!placeableZoneCard) return;
                      sendAction({ type: 'PLACE_IN_ZONE', playerId: myPlayerId, cardId: placeableZoneCard.id });
                    },
                  }
                : undefined
            }
          />
        )}
    </div>
  );
}
