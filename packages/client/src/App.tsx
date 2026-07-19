import { useEffect, useState } from 'react';
import { useGameConnection } from './hooks/useGameConnection';
import { HomePage } from './pages/HomePage';
import { LobbyPage } from './pages/LobbyPage';
import { CampaignLobbyPage } from './pages/CampaignLobbyPage';
import { RewardRevealPage } from './pages/RewardRevealPage';
import { GamePage } from './pages/GamePage';
import { RulesPage } from './pages/RulesPage';

function useRoute() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const navigate = (to: string) => {
    window.history.pushState({}, '', to);
    setPath(to);
  };
  return { path, navigate };
}

export function App() {
  const { path, navigate } = useRoute();
  const [mode, setMode] = useState<'regicide' | 'legacy'>('regicide');
  const {
    connected,
    session,
    roomState,
    gameState,
    legacyState,
    error,
    clearError,
    createRoom,
    joinRoom,
    startGame,
    restartGame,
    sendAction,
    leaveSession,
    createLegacyCampaign,
    resumeLegacyCampaign,
    startLegacyMission,
  } = useGameConnection();

  // A page reload can only rejoin by stored token, so this component has no local memory of which
  // mode that session was — trust the server's legacy:state broadcast once it arrives (Legacy rooms
  // only). Fresh create/resume clicks set `mode` immediately below, avoiding a render race entirely.
  useEffect(() => {
    if (legacyState) setMode('legacy');
  }, [legacyState]);

  function handleCreate(name: string) {
    setMode('regicide');
    return createRoom(name);
  }
  function handleJoin(code: string, name: string) {
    setMode('regicide');
    return joinRoom(code, name);
  }
  function handleCreateLegacy(name: string) {
    setMode('legacy');
    return createLegacyCampaign(name);
  }
  function handleResumeLegacy(code: string, name: string) {
    setMode('legacy');
    return resumeLegacyCampaign(code, name);
  }
  function handleLeave() {
    setMode('regicide');
    leaveSession();
  }

  let body: React.ReactNode;
  if (path === '/rules') {
    body = <RulesPage onBack={() => navigate('/')} />;
  } else if (!session) {
    body = (
      <HomePage
        onCreate={handleCreate}
        onJoin={handleJoin}
        onCreateLegacy={handleCreateLegacy}
        onResumeLegacy={handleResumeLegacy}
        onShowRules={() => navigate('/rules')}
      />
    );
  } else if (!connected || !roomState) {
    body = (
      <div className="centered-page">
        <h1>Regicide</h1>
        <p>Reconnecting...</p>
      </div>
    );
  } else if (mode === 'legacy') {
    if (!legacyState) {
      body = (
        <div className="centered-page">
          <h1>Regicide Legacy</h1>
          <p>Loading your campaign...</p>
        </div>
      );
    } else if (!gameState || gameState.phase === 'LOBBY') {
      body = (
        <CampaignLobbyPage
          roomState={roomState}
          legacyState={legacyState}
          myPlayerId={session.playerId}
          onStartMission={startLegacyMission}
          onLeave={handleLeave}
        />
      );
    } else if (gameState.phase === 'WON') {
      body = <RewardRevealPage missionId={legacyState.currentMission - 1} onContinue={restartGame} />;
    } else {
      const isHost = roomState.players.find((p) => p.id === session.playerId)?.isHost ?? false;
      body = (
        <GamePage
          state={gameState}
          myPlayerId={session.playerId}
          isHost={isHost}
          sendAction={sendAction}
          onLeave={handleLeave}
          onRestart={restartGame}
        />
      );
    }
  } else if (!gameState) {
    body = <LobbyPage roomState={roomState} myPlayerId={session.playerId} onStart={startGame} onLeave={handleLeave} />;
  } else {
    const isHost = roomState.players.find((p) => p.id === session.playerId)?.isHost ?? false;
    body = (
      <GamePage
        state={gameState}
        myPlayerId={session.playerId}
        isHost={isHost}
        sendAction={sendAction}
        onLeave={handleLeave}
        onRestart={restartGame}
      />
    );
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
