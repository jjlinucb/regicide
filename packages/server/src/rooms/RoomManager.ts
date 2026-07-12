import { randomUUID } from 'node:crypto';
import { applyAction, createLobbyState } from '@regicide/shared';
import type { GameAction, GameState } from '@regicide/shared';
import { generateRoomCode } from './roomCode.js';

export interface RoomPlayer {
  id: string;
  token: string;
  name: string;
  socketId: string | null;
  connected: boolean;
}

export interface Room {
  code: string;
  createdAt: number;
  hostPlayerId: string;
  playerOrder: string[]; // stable seat order, used as the game's turn order
  players: Map<string, RoomPlayer>;
  gameState: GameState;
}

const MAX_PLAYERS = 4;

export class RoomManager {
  private rooms = new Map<string, Room>();

  createRoom(hostName: string): { room: Room; player: RoomPlayer } {
    let code = generateRoomCode();
    while (this.rooms.has(code)) code = generateRoomCode();

    const player: RoomPlayer = {
      id: randomUUID(),
      token: randomUUID(),
      name: hostName,
      socketId: null,
      connected: true,
    };
    const room: Room = {
      code,
      createdAt: Date.now(),
      hostPlayerId: player.id,
      playerOrder: [player.id],
      players: new Map([[player.id, player]]),
      gameState: createLobbyState(),
    };
    this.rooms.set(code, room);
    return { room, player };
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  joinRoom(code: string, name: string): { room: Room; player: RoomPlayer } | { error: string } {
    const room = this.getRoom(code);
    if (!room) return { error: 'Room not found.' };
    if (room.gameState.phase !== 'LOBBY') return { error: 'This game has already started.' };
    if (room.playerOrder.length >= MAX_PLAYERS) return { error: 'This room is full (max 4 players).' };

    const player: RoomPlayer = {
      id: randomUUID(),
      token: randomUUID(),
      name,
      socketId: null,
      connected: true,
    };
    room.players.set(player.id, player);
    room.playerOrder.push(player.id);
    return { room, player };
  }

  rejoin(code: string, token: string, socketId: string): { room: Room; player: RoomPlayer } | { error: string } {
    const room = this.getRoom(code);
    if (!room) return { error: 'Room not found.' };
    const player = [...room.players.values()].find((p) => p.token === token);
    if (!player) return { error: 'Unknown player token for this room.' };
    player.socketId = socketId;
    player.connected = true;
    const gamePlayer = room.gameState.players.find((p) => p.id === player.id);
    if (gamePlayer) gamePlayer.connected = true;
    return { room, player };
  }

  markDisconnected(code: string, playerId: string): void {
    const room = this.getRoom(code);
    if (!room) return;
    const player = room.players.get(playerId);
    if (player) {
      player.socketId = null;
      player.connected = false;
    }
    const gamePlayer = room.gameState.players.find((p) => p.id === playerId);
    if (gamePlayer) gamePlayer.connected = false;
  }

  findPlayerBySocket(socketId: string): { room: Room; player: RoomPlayer } | undefined {
    for (const room of this.rooms.values()) {
      for (const player of room.players.values()) {
        if (player.socketId === socketId) return { room, player };
      }
    }
    return undefined;
  }

  startGame(code: string, requestingPlayerId: string, seed: string): { room: Room } | { error: string } {
    const room = this.getRoom(code);
    if (!room) return { error: 'Room not found.' };
    if (room.hostPlayerId !== requestingPlayerId) return { error: 'Only the host can start the game.' };
    if (room.playerOrder.length < 1) return { error: 'Need at least 1 player.' };

    const playerNames = room.playerOrder.map((id) => room.players.get(id)!.name);
    const result = applyAction(room.gameState, {
      type: 'START_GAME',
      playerIds: room.playerOrder,
      playerNames,
      seed,
    });
    if (!result.ok) return { error: result.error };
    room.gameState = result.state;
    return { room };
  }

  restartGame(code: string, requestingPlayerId: string): { room: Room } | { error: string } {
    const room = this.getRoom(code);
    if (!room) return { error: 'Room not found.' };
    if (room.hostPlayerId !== requestingPlayerId) return { error: 'Only the host can restart the game.' };
    if (room.gameState.phase !== 'WON' && room.gameState.phase !== 'LOST') {
      return { error: 'The game is still in progress.' };
    }
    room.gameState = createLobbyState();
    return { room };
  }

  applyGameAction(code: string, action: GameAction): { room: Room } | { error: string } {
    const room = this.getRoom(code);
    if (!room) return { error: 'Room not found.' };
    const result = applyAction(room.gameState, action);
    if (!result.ok) return { error: result.error };
    room.gameState = result.state;
    return { room };
  }
}
