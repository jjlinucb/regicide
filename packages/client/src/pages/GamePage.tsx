import { useEffect, useMemo, useState } from 'react';
import {
  cardValue,
  ENDLESS_MODE_MAX_LOOP,
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
  // own winning attack (see GameState.zoneCommittedPlay), at no extra cost. Pick whichever committed card (if
  // any) actually fills the current required slot.
  const placeableZoneCard = state.zoneCommittedPlay.find((c) => matchesAscendingZoneSlot(c, zoneRequiredValue));
  const isChantWindow = state.turnPhase === 'AWAIT_CHANT_TRIM' && Boolean(state.chanterWindow);
  const chantTrimmerId = state.chanterWindow?.pendingPlayerIds[0];
  const isMyChantTrim = isChantWindow && chantTrimmerId === myPlayerId;
  const myChantOverflow = Math.max(0, myHand.length - state.maxHandSize);
  const isZonePurgeWindow = state.turnPhase === 'AWAIT_ZONE_PURGE' && Boolean(state.zonePurge);
  const isMyZonePurgeWindow = isZonePurgeWindow && state.zonePurge?.playerId === myPlayerId;

  // Mission 6 relic: the Azure Emblem window, opened whenever a Mage joins an attack.
  const isAzureEmblemWindow = state.turnPhase === 'AWAIT_AZURE_EMBLEM' && Boolean(state.azureEmblemWindow);
  const azureEmblemTurnPlayerId = state.azureEmblemWindow?.pendingPlayerIds[0];
  const isMyAzureEmblemTurn = isAzureEmblemWindow && azureEmblemTurnPlayerId === myPlayerId;
  const azureEmblemEligibleCards = state.currentEnemy?.tableCards.filter((c) => state.azureEmblemWindow?.eligibleCardIds.includes(c.id)) ?? [];

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
                    ? 'The Mage reveals cards from the reserve deck — choose one to tuck under the attack.'
                    : `${state.players.find((p) => p.id === mageRevealPlayerId)?.name} is choosing a card from the Mage's reveal...`
                  : isChantWindow
                  ? isMyChantTrim
                    ? `The chant drew everyone up — discard exactly ${myChantOverflow} card(s) to get back to your hand limit.`
                    : `${state.players.find((p) => p.id === chantTrimmerId)?.name} is trimming their hand from the chant...`
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
            <span>🃏 A Jester is up for grabs — claim it for a free 8-strength attack, ignoring this enemy's immunity, then refill your hand.</span>
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
              free 8-strength attack, ignoring this enemy's immunity, then draw back up to your hand limit.
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
        {state.currentEnemy && (
          <EnemyDisplay
            enemy={state.currentEnemy}
            liveAttack={state.liveEnemyAttack ?? 0}
            zoneImmuneSuits={state.zoneImmuneSuits}
          />
        )}
        <MissionZonePanel state={state} />
        <DeckPiles state={state} myPlayerId={myPlayerId} />
        {state.capturedPilesActive && <CapturedPiles piles={state.capturedPiles} />}
        <PlayerList state={state} myPlayerId={myPlayerId} />
        <ActionLog state={state} />
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
          <span>Play the Jester into the open — any player (including you) may then claim it and attack, ignoring immunity.</span>
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
          <span>🔷 Azure Emblem: pick one of your Mage card(s) below to bank onto the reserve deck, or decline.</span>
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
          <span>✦ The Mage's reveal turns up these cards — choose one to tuck under the attack.</span>
          <EnemyCardPicker
            cards={state.mageReveal?.candidates ?? []}
            onChoose={(cardId) => sendAction({ type: 'CHOOSE_MAGE_REVEAL_CARD', playerId: myPlayerId, cardId })}
          />
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
                    canPlace: canPlaceInZone,
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
