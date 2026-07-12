import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  ClientGameState,
  ClientToServerEvents,
  GameAction,
  RoomStatePayload,
  ServerToClientEvents,
} from '@regicide/shared';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const STORAGE_KEY = 'regicide:session';

interface StoredSession {
  code: string;
  playerToken: string;
  playerId: string;
}

function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function saveSession(session: StoredSession | null): void {
  if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  else localStorage.removeItem(STORAGE_KEY);
}

export function useGameConnection() {
  const socketRef = useRef<GameSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [session, setSession] = useState<StoredSession | null>(() => loadSession());
  const [roomState, setRoomState] = useState<RoomStatePayload | null>(null);
  const [gameState, setGameState] = useState<ClientGameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejoinAttempted, setRejoinAttempted] = useState(false);

  useEffect(() => {
    const socket: GameSocket = io({ autoConnect: true });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('room:state', (payload) => setRoomState(payload));
    socket.on('game:state', (payload) => setGameState(payload));
    socket.on('error', (payload) => setError(payload.message));

    return () => {
      socket.close();
    };
  }, []);

  // Attempt to resume a previous session once connected.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !connected || !session || rejoinAttempted) return;
    setRejoinAttempted(true);
    socket.emit('room:rejoin', { code: session.code, playerToken: session.playerToken }, (res) => {
      if (!res.ok) {
        saveSession(null);
        setSession(null);
      }
    });
  }, [connected, session, rejoinAttempted]);

  const createRoom = useCallback((name: string): Promise<{ ok: true } | { ok: false; error: string }> => {
    return new Promise((resolve) => {
      socketRef.current?.emit('room:create', { name }, (res) => {
        if (res.ok) {
          const next: StoredSession = { code: res.code, playerToken: res.playerToken, playerId: res.playerId };
          saveSession(next);
          setSession(next);
        }
        resolve(res.ok ? { ok: true } : res);
      });
    });
  }, []);

  const joinRoom = useCallback((code: string, name: string): Promise<{ ok: true } | { ok: false; error: string }> => {
    return new Promise((resolve) => {
      socketRef.current?.emit('room:join', { code: code.toUpperCase(), name }, (res) => {
        if (res.ok) {
          const next: StoredSession = { code: code.toUpperCase(), playerToken: res.playerToken, playerId: res.playerId };
          saveSession(next);
          setSession(next);
        }
        resolve(res.ok ? { ok: true } : res);
      });
    });
  }, []);

  const startGame = useCallback((): void => {
    if (!session) return;
    socketRef.current?.emit('room:start', { code: session.code }, (res) => {
      if (!res.ok) setError(res.error);
    });
  }, [session]);

  const sendAction = useCallback(
    (action: GameAction): void => {
      if (!session) return;
      socketRef.current?.emit('game:action', { code: session.code, action }, (res) => {
        if (!res.ok) setError(res.error);
      });
    },
    [session],
  );

  const leaveSession = useCallback((): void => {
    saveSession(null);
    setSession(null);
    setRoomState(null);
    setGameState(null);
  }, []);

  return {
    connected,
    session,
    roomState,
    gameState,
    error,
    clearError: () => setError(null),
    createRoom,
    joinRoom,
    startGame,
    sendAction,
    leaveSession,
  };
}
