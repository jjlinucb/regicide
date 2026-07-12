import { useEffect, useMemo, useState } from 'react';
import { cardValue, validatePlayShape, type ClientGameState, type GameAction } from '@regicide/shared';
import { EnemyDisplay } from '../components/EnemyDisplay';
import { DeckPiles } from '../components/DeckPiles';
import { PlayerList } from '../components/PlayerList';
import { ActionLog } from '../components/ActionLog';
import { Hand } from '../components/Hand';
import { ConfirmPlayBar } from '../components/ConfirmPlayBar';
import { JesterPicker } from '../components/JesterPicker';

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

  if (state.phase === 'WON' || state.phase === 'LOST') {
    return (
      <div className="centered-page">
        <h1>{state.phase === 'WON' ? 'Victory!' : 'Defeat'}</h1>
        <p>{state.phase === 'WON' ? 'The realm is saved — every enemy has fallen.' : state.lossReason}</p>
        <ActionLog state={state} />
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
          {isMyTurn
            ? state.turnPhase === 'AWAIT_DEFEND'
              ? `Defend! Discard ${state.pendingDamage} damage worth of cards.`
              : 'Your turn — play a card, a combo, or yield.'
            : `Waiting for ${state.players[state.currentPlayerIndex]?.name}...`}
        </div>
        {state.currentEnemy && <EnemyDisplay enemy={state.currentEnemy} />}
        <DeckPiles state={state} />
        <PlayerList state={state} myPlayerId={myPlayerId} />
        <ActionLog state={state} />
      </div>

      <div className="hand-area">
        <div className="hand-label">
          Your hand: {myHand.length} / {state.maxHandSize}
        </div>
        <Hand cards={myHand} selectedIds={selectedIds} onToggle={toggleCard} interactive={isMyTurn} />
      </div>

      {isMyTurn && isLoneJester && state.turnPhase === 'AWAIT_PLAY' && (
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

      {isMyTurn && !(isLoneJester && state.turnPhase === 'AWAIT_PLAY') && (
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
        />
      )}
    </div>
  );
}
