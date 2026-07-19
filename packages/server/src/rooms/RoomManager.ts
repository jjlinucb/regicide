import { randomUUID } from 'node:crypto';
import { applyAction, createLobbyState } from '@regicide/shared';
import type { Card, GameAction, GameState } from '@regicide/shared';
import { applyReward, buildInitialParty, getMission, JESTERS_BY_PLAYER_COUNT, missionEnemiesToSpecs } from '@regicide/shared';
import { generateRoomCode } from './roomCode.js';
import { generateUniqueCampaignCode, type CampaignRecord, type CampaignStore } from '../db/campaigns.js';

export interface RoomPlayer {
  id: string;
  token: string;
  name: string;
  socketId: string | null;
  connected: boolean;
}

/** A Legacy room's durable campaign data, mirrored from CampaignStore and kept in sync at mission boundaries. */
export interface LegacyRoomData {
  campaignCode: string;
  party: Card[];
  missionsCompleted: number[];
  currentMission: number;
  permanentRules: string[];
}

export interface Room {
  code: string;
  createdAt: number;
  hostPlayerId: string;
  playerOrder: string[]; // stable seat order, used as the game's turn order
  players: Map<string, RoomPlayer>;
  gameState: GameState;
  legacy?: LegacyRoomData;
}

const MAX_PLAYERS = 4;

function toRecord(room: Room): CampaignRecord {
  const legacy = room.legacy!;
  return {
    code: legacy.campaignCode,
    party: legacy.party,
    missionsCompleted: legacy.missionsCompleted,
    currentMission: legacy.currentMission,
    permanentRules: legacy.permanentRules,
    updatedAt: Date.now(),
  };
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(private campaignStore: CampaignStore) {}

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
    // Allowed at any phase (including mid-game) so a solo player can bail on a losing run
    // and reshuffle immediately instead of waiting to die.
    room.gameState = createLobbyState();
    return { room };
  }

  async applyGameAction(code: string, action: GameAction): Promise<{ room: Room } | { error: string }> {
    const room = this.getRoom(code);
    if (!room) return { error: 'Room not found.' };
    const wasInProgress = room.gameState.phase === 'IN_PROGRESS';
    const result = applyAction(room.gameState, action);
    if (!result.ok) return { error: result.error };
    room.gameState = result.state;

    // Detect the exact IN_PROGRESS -> WON/LOST transition for a Legacy mission, and checkpoint the campaign.
    if (room.legacy && wasInProgress && result.state.ruleset === 'legacy' && result.state.phase !== 'IN_PROGRESS') {
      await this.completeLegacyMission(room, result.state.phase === 'WON' ? 'won' : 'lost');
    }
    return { room };
  }

  // ---------- Legacy campaigns ----------

  async createLegacyCampaign(hostName: string): Promise<{ room: Room; player: RoomPlayer }> {
    const campaignCode = await generateUniqueCampaignCode(this.campaignStore);
    const legacy: LegacyRoomData = {
      campaignCode,
      party: buildInitialParty(),
      missionsCompleted: [],
      currentMission: 1,
      permanentRules: [],
    };
    const player: RoomPlayer = { id: randomUUID(), token: randomUUID(), name: hostName, socketId: null, connected: true };
    const room: Room = {
      code: campaignCode,
      createdAt: Date.now(),
      hostPlayerId: player.id,
      playerOrder: [player.id],
      players: new Map([[player.id, player]]),
      gameState: createLobbyState(),
      legacy,
    };
    this.rooms.set(campaignCode, room);
    await this.campaignStore.create(toRecord(room));
    return { room, player };
  }

  async resumeLegacyCampaign(code: string, name: string): Promise<{ room: Room; player: RoomPlayer } | { error: string }> {
    const upperCode = code.toUpperCase();
    const existing = this.getRoom(upperCode);
    if (existing?.legacy) {
      if (existing.gameState.phase !== 'LOBBY') return { error: 'This mission is already in progress — wait for it to finish.' };
      if (existing.playerOrder.length >= MAX_PLAYERS) return { error: 'This campaign already has 4 players.' };
      const player: RoomPlayer = { id: randomUUID(), token: randomUUID(), name, socketId: null, connected: true };
      existing.players.set(player.id, player);
      existing.playerOrder.push(player.id);
      return { room: existing, player };
    }

    const record = await this.campaignStore.get(upperCode);
    if (!record) return { error: 'No campaign found with that code.' };

    const legacy: LegacyRoomData = {
      campaignCode: record.code,
      party: record.party,
      missionsCompleted: record.missionsCompleted,
      currentMission: record.currentMission,
      permanentRules: record.permanentRules,
    };
    const player: RoomPlayer = { id: randomUUID(), token: randomUUID(), name, socketId: null, connected: true };
    const room: Room = {
      code: record.code,
      createdAt: Date.now(),
      hostPlayerId: player.id,
      playerOrder: [player.id],
      players: new Map([[player.id, player]]),
      gameState: createLobbyState(),
      legacy,
    };
    this.rooms.set(record.code, room);
    return { room, player };
  }

  startLegacyMission(code: string, requestingPlayerId: string, missionId: number): { room: Room } | { error: string } {
    const room = this.getRoom(code);
    if (!room || !room.legacy) return { error: 'Campaign not found.' };
    if (room.hostPlayerId !== requestingPlayerId) return { error: 'Only the host can start the mission.' };
    if (room.playerOrder.length < 1) return { error: 'Need at least 1 player.' };
    if (missionId !== room.legacy.currentMission) return { error: 'Missions must be played in order.' };

    const mission = getMission(missionId);
    if (!mission) return { error: 'Unknown mission.' };

    const n = room.playerOrder.length;
    const playerNames = room.playerOrder.map((id) => room.players.get(id)!.name);
    const result = applyAction(room.gameState, {
      type: 'START_LEGACY_MISSION',
      playerIds: room.playerOrder,
      playerNames,
      seed: `${code}-${Date.now()}`,
      party: room.legacy.party,
      enemies: missionEnemiesToSpecs(mission.enemies),
      jesterCount: JESTERS_BY_PLAYER_COUNT[n] ?? 0,
    });
    if (!result.ok) return { error: result.error };
    room.gameState = result.state;
    return { room };
  }

  /** Applies a mission's outcome to the campaign: on a win, grants the reward and advances; on a loss, nothing changes (retry). */
  private async completeLegacyMission(room: Room, outcome: 'won' | 'lost'): Promise<void> {
    const legacy = room.legacy!;
    const missionId = legacy.currentMission;
    if (outcome === 'won') {
      const mission = getMission(missionId);
      if (mission) {
        legacy.party = applyReward(legacy.party, mission.reward.recruits);
        legacy.missionsCompleted = [...legacy.missionsCompleted, missionId];
        legacy.currentMission = missionId + 1;
      }
      await this.campaignStore.save(toRecord(room));
    }
    // On loss, nothing to persist — the party and mission pointer are untouched, so the group can retry.
  }
}
