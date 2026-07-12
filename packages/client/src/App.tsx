import { useGameConnection } from './hooks/useGameConnection';
import { HomePage } from './pages/HomePage';
import { LobbyPage } from './pages/LobbyPage';
import { GamePage } from './pages/GamePage';

export function App() {
  const { connected, session, roomState, gameState, error, clearError, createRoom, joinRoom, startGame, sendAction, leaveSession } =
    useGameConnection();

  let body: React.ReactNode;
  if (!session) {
    body = <HomePage onCreate={createRoom} onJoin={joinRoom} />;
  } else if (!connected || !roomState) {
    body = (
      <div className="centered-page">
        <h1>Regicide</h1>
        <p>Reconnecting...</p>
      </div>
    );
  } else if (!gameState) {
    body = <LobbyPage roomState={roomState} myPlayerId={session.playerId} onStart={startGame} onLeave={leaveSession} />;
  } else {
    body = <GamePage state={gameState} myPlayerId={session.playerId} sendAction={sendAction} onLeave={leaveSession} />;
  }

  return (
    <div className="app">
      {error && (
        <div className="error-banner" onClick={clearError}>
          {error}
        </div>
      )}
      {body}
    </div>
  );
}
