import type { Server, Socket } from 'socket.io';
import { redactStateFor } from '@regicide/shared';
import type { ClientToServerEvents, EndlessStatePayload, LegacyStatePayload, RoomStatePayload, ServerToClientEvents } from '@regicide/shared';
import { RoomManager, type Room } from '../rooms/RoomManager.js';

type IOServer = Server<ClientToServerEvents, ServerToClientEvents>;
type IOSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

function roomStatePayload(room: Room): RoomStatePayload {
  return {
    code: room.code,
    started: room.gameState.phase !== 'LOBBY',
    players: room.playerOrder.map((id) => {
      const p = room.players.get(id)!;
      return { id: p.id, name: p.name, connected: p.connected, isHost: id === room.hostPlayerId };
    }),
  };
}

function legacyStatePayload(room: Room): LegacyStatePayload | null {
  if (!room.legacy) return null;
  return {
    campaignCode: room.legacy.campaignCode,
    party: room.legacy.party,
    missionsCompleted: room.legacy.missionsCompleted,
    currentMission: room.legacy.currentMission,
    permanentRules: room.legacy.permanentRules,
    mercenaryProgress: room.legacy.mercenaryProgress,
    beastCompanionPool: room.legacy.beastCompanionPool,
    selectedBeastCompanionId: room.legacy.selectedBeastCompanionId,
  };
}

function endlessStatePayload(room: Room): EndlessStatePayload | null {
  if (!room.endless) return null;
  return { saveCode: room.endless.saveCode, endlessLoop: room.endless.endlessLoop };
}

function broadcastRoom(io: IOServer, room: Room): void {
  io.to(room.code).emit('room:state', roomStatePayload(room));
  const legacyState = legacyStatePayload(room);
  if (legacyState) io.to(room.code).emit('legacy:state', legacyState);
  const endlessState = endlessStatePayload(room);
  if (endlessState) io.to(room.code).emit('endless:state', endlessState);
  if (room.gameState.phase !== 'LOBBY') {
    for (const playerId of room.playerOrder) {
      const player = room.players.get(playerId);
      if (player?.socketId) {
        io.to(player.socketId).emit('game:state', redactStateFor(room.gameState, playerId));
      }
    }
  }
}

export function registerSocketHandlers(io: IOServer, socket: IOSocket, rooms: RoomManager): void {
  socket.on('room:create', ({ name }, cb) => {
    const trimmed = (name || '').trim().slice(0, 24) || 'Player';
    const { room, player } = rooms.createRoom(trimmed);
    player.socketId = socket.id;
    socket.join(room.code);
    cb({ ok: true, code: room.code, playerToken: player.token, playerId: player.id });
    broadcastRoom(io, room);
  });

  socket.on('room:join', ({ code, name }, cb) => {
    const trimmed = (name || '').trim().slice(0, 24) || 'Player';
    const result = rooms.joinRoom(code, trimmed);
    if ('error' in result) return cb({ ok: false, error: result.error });
    const { room, player } = result;
    player.socketId = socket.id;
    socket.join(room.code);
    cb({ ok: true, playerToken: player.token, playerId: player.id });
    broadcastRoom(io, room);
  });

  socket.on('room:rejoin', ({ code, playerToken }, cb) => {
    const result = rooms.rejoin(code, playerToken, socket.id);
    if ('error' in result) return cb({ ok: false, error: result.error });
    socket.join(result.room.code);
    cb({ ok: true });
    broadcastRoom(io, result.room);
  });

  socket.on('room:start', ({ code }, cb) => {
    const found = rooms.findPlayerBySocket(socket.id);
    if (!found) return cb({ ok: false, error: 'Not in a room.' });
    const result = rooms.startGame(code, found.player.id, `${code}-${Date.now()}`);
    if ('error' in result) return cb({ ok: false, error: result.error });
    cb({ ok: true });
    broadcastRoom(io, result.room);
  });

  socket.on('room:restart', ({ code }, cb) => {
    const found = rooms.findPlayerBySocket(socket.id);
    if (!found) return cb({ ok: false, error: 'Not in a room.' });
    const result = rooms.restartGame(code, found.player.id);
    if ('error' in result) return cb({ ok: false, error: result.error });
    cb({ ok: true });
    broadcastRoom(io, result.room);
  });

  socket.on('game:action', async ({ code, action }, cb) => {
    const result = await rooms.applyGameAction(code, action);
    if ('error' in result) {
      cb({ ok: false, error: result.error });
      socket.emit('error', { message: result.error });
      return;
    }
    cb({ ok: true });
    broadcastRoom(io, result.room);
  });

  socket.on('legacy:create', async ({ name }, cb) => {
    const trimmed = (name || '').trim().slice(0, 24) || 'Player';
    const { room, player } = await rooms.createLegacyCampaign(trimmed);
    player.socketId = socket.id;
    socket.join(room.code);
    cb({ ok: true, code: room.code, playerToken: player.token, playerId: player.id });
    broadcastRoom(io, room);
  });

  socket.on('legacy:resume', async ({ code, name }, cb) => {
    const trimmed = (name || '').trim().slice(0, 24) || 'Player';
    const result = await rooms.resumeLegacyCampaign(code, trimmed);
    if ('error' in result) return cb({ ok: false, error: result.error });
    const { room, player } = result;
    player.socketId = socket.id;
    socket.join(room.code);
    cb({ ok: true, code: room.code, playerToken: player.token, playerId: player.id });
    broadcastRoom(io, room);
  });

  socket.on('endless:load', async ({ code, name }, cb) => {
    const trimmed = (name || '').trim().slice(0, 24) || 'Player';
    const result = await rooms.loadEndlessSave(code, trimmed);
    if ('error' in result) return cb({ ok: false, error: result.error });
    const { room, player } = result;
    player.socketId = socket.id;
    socket.join(room.code);
    cb({ ok: true, code: room.code, playerToken: player.token, playerId: player.id });
    broadcastRoom(io, room);
  });

  socket.on('legacy:restore', async ({ name, save }, cb) => {
    const trimmed = (name || '').trim().slice(0, 24) || 'Player';
    const result = await rooms.createLegacyCampaignFromSave(trimmed, save);
    if ('error' in result) return cb({ ok: false, error: result.error });
    const { room, player } = result;
    player.socketId = socket.id;
    socket.join(room.code);
    cb({ ok: true, code: room.code, playerToken: player.token, playerId: player.id });
    broadcastRoom(io, room);
  });

  socket.on('legacy:startMission', ({ code, missionId, stopForPendingChoices }, cb) => {
    const found = rooms.findPlayerBySocket(socket.id);
    if (!found) return cb({ ok: false, error: 'Not in a room.' });
    const result = rooms.startLegacyMission(code, found.player.id, missionId, { stopForPendingChoices });
    if ('error' in result) return cb({ ok: false, error: result.error });
    cb({ ok: true });
    broadcastRoom(io, result.room);
  });

  socket.on('legacy:setMercenaryLoadout', async ({ code, loadout }, cb) => {
    const found = rooms.findPlayerBySocket(socket.id);
    if (!found) return cb({ ok: false, error: 'Not in a room.' });
    const result = await rooms.setMercenaryLoadout(code, found.player.id, loadout);
    if ('error' in result) return cb({ ok: false, error: result.error });
    cb({ ok: true });
    broadcastRoom(io, result.room);
  });

  socket.on('legacy:setBeastCompanionSelection', async ({ code, cardId }, cb) => {
    const found = rooms.findPlayerBySocket(socket.id);
    if (!found) return cb({ ok: false, error: 'Not in a room.' });
    const result = await rooms.setBeastCompanionSelection(code, found.player.id, cardId);
    if ('error' in result) return cb({ ok: false, error: result.error });
    cb({ ok: true });
    broadcastRoom(io, result.room);
  });

  socket.on('legacy:chooseReaverSticker', async ({ code, cardId }, cb) => {
    const found = rooms.findPlayerBySocket(socket.id);
    if (!found) return cb({ ok: false, error: 'Not in a room.' });
    const result = await rooms.chooseReaverSticker(code, found.player.id, cardId);
    if ('error' in result) return cb({ ok: false, error: result.error });
    cb({ ok: true });
    broadcastRoom(io, result.room);
  });

  socket.on('legacy:chooseGuardianSticker', async ({ code, cardId }, cb) => {
    const found = rooms.findPlayerBySocket(socket.id);
    if (!found) return cb({ ok: false, error: 'Not in a room.' });
    const result = await rooms.chooseGuardianSticker(code, found.player.id, cardId);
    if ('error' in result) return cb({ ok: false, error: result.error });
    cb({ ok: true });
    broadcastRoom(io, result.room);
  });

  socket.on('legacy:chooseDruidSticker', async ({ code, cardId }, cb) => {
    const found = rooms.findPlayerBySocket(socket.id);
    if (!found) return cb({ ok: false, error: 'Not in a room.' });
    const result = await rooms.chooseDruidSticker(code, found.player.id, cardId);
    if ('error' in result) return cb({ ok: false, error: result.error });
    cb({ ok: true });
    broadcastRoom(io, result.room);
  });

  socket.on('legacy:chooseChanterSticker', async ({ code, cardId }, cb) => {
    const found = rooms.findPlayerBySocket(socket.id);
    if (!found) return cb({ ok: false, error: 'Not in a room.' });
    const result = await rooms.chooseChanterSticker(code, found.player.id, cardId);
    if ('error' in result) return cb({ ok: false, error: result.error });
    cb({ ok: true });
    broadcastRoom(io, result.room);
  });

  socket.on('disconnect', () => {
    const found = rooms.findPlayerBySocket(socket.id);
    if (!found) return;
    rooms.markDisconnected(found.room.code, found.player.id);
    broadcastRoom(io, found.room);
  });
}
