import { useEffect, useMemo, useState } from 'react';
import {
  cardValue,
  MAX_SOLO_JESTERS,
  SOLO_JESTER_ABILITY_TEXT,
  validatePlayShape,
  type ClientGameState,
  type GameAction,
} from '@regicide/shared';
import { EnemyDisplay } from '../components/EnemyDisplay';
import { DeckPiles } from '../components/DeckPiles';
import { PlayerList } from '../components/PlayerList';
import { ActionLog } from '../components/ActionLog';
import { Hand } from '../components/Hand';
import { ConfirmPlayBar } from '../components/ConfirmPlayBar';
import { JesterPicker } from '../components/JesterPicker';
import { VictoryCrest } from '../components/VictoryCrest';
import { ZonePurgePicker } from '../components/ZonePurgePicker';
import { CapturedPiles } from '../components/CapturedPiles';

const MEDAL_INFO: Record<'gold' | 'silver' | 'bronze', { emoji: string; label: string }> = {
  gold: { emoji: '🥇', label: 'Gold Victory' },
  silver: { emoji: '🥈', label: 'Silver Victory' },
  bronze: { emoji: '🥉', label: 'Bronze Victory' },
};

export function GamePage({
  state,
  myPlayerId,
  isHost,
  sendAction,
  onLeave,
  onRestart,
}: {
  state: ClientGameState;
  myPlayerId: string;
  isHost: boolean;
  sendAction: (action: GameAction) => void;
  onLeave: () => void;
  onRestart: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelectedIds(new Set());
  }, [state.currentPlayerIndex, state.turnPhase]);

  const me = state.players.find((p) => p.id === myPlayerId);
  const myHand = me?.hand ?? [];
  const isMyTurn = state.players[state.currentPlayerIndex]?.id === myPlayerId;
  const selectedCards = myHand.filter((c) => selectedIds.has(c.id));
  const selectedTotal = selectedCards.reduce((sum, c) => sum + cardValue(c), 0);
  const isLoneJester = selectedCards.length === 1 && selectedCards[0].kind === 'jester';

  const playError = useMemo(() => {
    if (selectedCards.length === 0 || isLoneJester) return null;
    const shape = validatePlayShape(selectedCards);
    return 'error' in shape ? shape.error : null;
  }, [selectedCards, isLoneJester]);

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
  const zoneTop = state.missionZone[state.missionZone.length - 1];
  const zoneRequiredValue = zoneTop ? cardValue(zoneTop) + 1 : 1;
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
  const canPlaceInZone =
    isLegacy &&
    state.ascendingZone &&
    !state.zoneClosed &&
    isMyTurn &&
    state.turnPhase === 'AWAIT_PLAY' &&
    selectedCards.length === 1 &&
    selectedCards[0].kind === 'suited' &&
    cardValue(selectedCards[0]) === zoneRequiredValue;

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
          <p style={{ color: 'var(--ink-dim)' }}>Endless Mode: survived {state.endlessLoop} round{state.endlessLoop === 1 ? '' : 's'}.</p>
        )}
        <ActionLog state={state} />
        {state.phase === 'WON' && !isLegacy && isHost && (
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
          {state.endlessLoop > 0 && <span className="endless-badge" title="Endless Mode round">♛ Round {state.endlessLoop}</span>}
          {isComboAssistWindow
            ? isComboAttacker
              ? 'Your attack is open for the Kinfolk Flute — resolve it when ready.'
              : 'An attack is open for the Kinfolk Flute — silently add a matching card, or leave it alone.'
            : isAzureEmblemWindow
              ? isMyAzureEmblemTurn
                ? 'Azure Emblem: silently place a card atop the reserve deck, or decline.'
                : `${state.players.find((p) => p.id === azureEmblemTurnPlayerId)?.name} is responding to the Azure Emblem...`
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
        {isLegacy && state.jesterClaim && !state.jesterClaim.claimedBy && (
          <div className="legacy-jester-claim-banner">
            <span>🃏 A Jester is up for grabs — any player may claim it and attack, ignoring this enemy's immunity!</span>
            <button type="button" className="btn" onClick={() => sendAction({ type: 'CLAIM_JESTER', playerId: myPlayerId })}>
              Claim it
            </button>
          </div>
        )}
        {isComboAssistWindow && (
          <div className="legacy-jester-claim-banner">
            {isComboAttacker ? (
              <>
                <span>🎵 Kinfolk Flute: your attack is open — anyone else may silently add a matching card before you resolve it.</span>
                <button type="button" className="btn" onClick={() => sendAction({ type: 'RESOLVE_COMBO', playerId: myPlayerId })}>
                  Resolve attack
                </button>
              </>
            ) : (
              <span>
                🎵 Kinfolk Flute: {state.players.find((p) => p.id === state.comboAssist!.attackerId)?.name} committed an attack —
                pick a matching card from your hand below to silently add it, or leave it alone.
              </span>
            )}
          </div>
        )}
        {isMyAzureEmblemTurn && (
          <div className="legacy-jester-claim-banner">
            <span>🔷 Azure Emblem: pick exactly one card below to place silently atop the reserve deck, or decline.</span>
            <div className="jester-picker-choices" style={{ display: 'inline-flex', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn"
                disabled={selectedCards.length !== 1}
                onClick={() => {
                  sendAction({ type: 'RESOLVE_AZURE_EMBLEM', playerId: myPlayerId, cardId: selectedCards[0]?.id });
                  setSelectedIds(new Set());
                }}
              >
                Place it
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => sendAction({ type: 'RESOLVE_AZURE_EMBLEM', playerId: myPlayerId })}>
                Decline
              </button>
            </div>
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
        {state.zoneVengeanceOnKill && state.missionZone.length > 0 && (
          <div className="legacy-jester-claim-banner">
            <span>
              👻 Mission Zone ({state.missionZone.length} card{state.missionZone.length === 1 ? '' : 's'}, never cleared):{' '}
              {state.missionZone.map((c) => (c.kind === 'suited' ? c.name ?? `${c.rank} of ${c.suit}` : 'Jester')).join(', ')} — Myla strikes for{' '}
              {state.missionZone.reduce((sum, c) => sum + cardValue(c), 0)} on the next kill (less her strongest card on an exact hit).
            </span>
          </div>
        )}
        {state.pilgrimMechanic && state.pilgrimZone.length > 0 && (
          <div className="legacy-jester-claim-banner">
            <span>
              🌊 Pilgrim Zone ({state.pilgrimZone.length} waiting, combined strength{' '}
              {state.pilgrimZone.reduce((sum, c) => sum + cardValue(c), 0)}): play an attack matching one's exact value to rescue
              them — {state.pilgrimZone.map((c) => (c.kind === 'suited' ? `${c.name ?? c.rank} (${cardValue(c)})` : 'Jester')).join(', ')}.
              Every kill burns that much off the top of the reserve deck.
            </span>
          </div>
        )}
        {state.ascendingZone && !state.zoneClosed && (
          <div className="legacy-jester-claim-banner">
            <span>
              🏔 Mission Zone chain: {state.missionZone.map((c) => (c.kind === 'suited' ? c.name ?? c.rank : 'Jester')).join(' → ') || '—'} — needs a{' '}
              {zoneRequiredValue} next. Non-Pilgrim cards buff the enemy's attack while they sit there.
            </span>
          </div>
        )}
        {state.ascendingZone && state.zoneClosed && (
          <div className="legacy-jester-claim-banner">
            <span>🏔 The mission zone has purged and closed for good.</span>
          </div>
        )}
        {state.currentEnemy && (
          <EnemyDisplay
            enemy={state.currentEnemy}
            discardPile={state.discardPile}
            discardTopBuffsAttack={state.discardTopBuffsAttack}
          />
        )}
        <DeckPiles state={state} />
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
        </div>
        <Hand
          cards={myHand}
          selectedIds={selectedIds}
          onToggle={toggleCard}
          interactive={
            canAssistCombo ||
            isMyChantTrim ||
            isMyAzureEmblemTurn ||
            (isMyTurn &&
              !isComboAssistWindow &&
              state.turnPhase !== 'AWAIT_JESTER_CLAIM' &&
              state.turnPhase !== 'AWAIT_ZONE_PURGE' &&
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
              disabled={selectedCards.length !== 1}
              onClick={() => {
                sendAction({ type: 'ASSIST_COMBO', playerId: myPlayerId, cardId: selectedCards[0].id });
                setSelectedIds(new Set());
              }}
            >
              Add to attack
            </button>
            <button className="btn-secondary btn" onClick={() => setSelectedIds(new Set())}>
              Leave it alone
            </button>
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
        !isComboAssistWindow &&
        !isAzureEmblemWindow &&
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
              sendAction({ type: 'PLAY_CARDS', playerId: myPlayerId, cardIds: selectedCards.map((c) => c.id) });
              setSelectedIds(new Set());
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
                      sendAction({ type: 'PLACE_IN_ZONE', playerId: myPlayerId, cardId: selectedCards[0].id });
                      setSelectedIds(new Set());
                    },
                  }
                : undefined
            }
          />
        )}
    </div>
  );
}
