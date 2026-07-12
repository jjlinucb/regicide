import type { ClientGameState, GameAction } from './game/types.js';

export interface RoomPlayerInfo {
  id: string;
  name: string;
  connected: boolean;
  isHost: boolean;
}

export interface RoomStatePayload {
  code: string;
  players: RoomPlayerInfo[];
  started: boolean;
}

// Client -> server
export interface ClientToServerEvents {
  'room:create': (payload: { name: string }, cb: (res: { ok: true; code: string; playerToken: string; playerId: string } | { ok: false; error: string }) => void) => void;
  'room:join': (payload: { code: string; name: string }, cb: (res: { ok: true; playerToken: string; playerId: string } | { ok: false; error: string }) => void) => void;
  'room:rejoin': (payload: { code: string; playerToken: string }, cb: (res: { ok: true } | { ok: false; error: string }) => void) => void;
  'room:start': (payload: { code: string }, cb: (res: { ok: true } | { ok: false; error: string }) => void) => void;
  'game:action': (payload: { code: string; action: GameAction }, cb: (res: { ok: true } | { ok: false; error: string }) => void) => void;
}

// Server -> client
export interface ServerToClientEvents {
  'room:state': (payload: RoomStatePayload) => void;
  'game:state': (payload: ClientGameState) => void;
  error: (payload: { message: string }) => void;
}
