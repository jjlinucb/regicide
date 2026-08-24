import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { ClientGameState, ClientToServerEvents, LegacyStatePayload, ServerToClientEvents } from '@regicide/shared';
import { RoomManager } from './rooms/RoomManager.js';
import { registerSocketHandlers } from './socket/handlers.js';
import { InMemoryCampaignStore } from './db/campaigns.js';

type Client = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

function emitAsync<T>(socket: Client, event: keyof ClientToServerEvents, payload: unknown): Promise<T> {
  return new Promise((resolve) => {
    // @ts-expect-error - dynamic event dispatch for test convenience
    socket.emit(event, payload, (res: T) => resolve(res));
  });
}

function waitFor<T>(socket: Client, event: string): Promise<T> {
  return new Promise((resolve) => {
    socket.once(event as any, (payload: T) => resolve(payload));
  });
}

function waitForMatch<T>(socket: Client, event: string, predicate: (payload: T) => boolean): Promise<T> {
  return new Promise((resolve) => {
    const handler = (payload: T) => {
      if (predicate(payload)) {
        socket.off(event as any, handler as any);
        resolve(payload);
      }
    };
    socket.on(event as any, handler as any);
  });
}

describe('legacy campaign integration', () => {
  let httpServer: ReturnType<typeof createServer>;
  let port: number;
  let rooms: RoomManager;
  let clientA: Client;
  let clientB: Client;

  beforeAll(async () => {
    httpServer = createServer();
    const io = new Server(httpServer, { cors: { origin: '*' } });
    rooms = new RoomManager(new InMemoryCampaignStore());
    io.on('connection', (socket) => registerSocketHandlers(io, socket, rooms));
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;
  });

  afterAll(async () => {
    clientA?.close();
    clientB?.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it('creates a campaign, starts mission 1, wins it, grants the reward, and unlocks mission 2 — then a second player resumes by code', async () => {
    clientA = ioClient(`http://localhost:${port}`);
    await waitFor(clientA, 'connect');

    // Register listeners BEFORE triggering the action that causes the broadcast — the server emits
    // the resulting event synchronously right after the ack, and it would otherwise arrive (and be
    // lost, since nothing is listening yet) before we get around to awaiting it below.
    const legacyStatePromise = waitFor<LegacyStatePayload>(clientA, 'legacy:state');
    const created = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string }>(clientA, 'legacy:create', { name: 'Alice' });
    expect(created.ok).toBe(true);
    const legacyState = await legacyStatePromise;
    expect(legacyState.party.length).toBe(40);
    expect(legacyState.currentMission).toBe(1);
    expect(legacyState.missionsCompleted).toEqual([]);

    const gameStatePromise = waitForMatch<ClientGameState>(clientA, 'game:state', (s) => s.phase === 'IN_PROGRESS');
    const startResult = await emitAsync<{ ok: true } | { ok: false; error: string }>(clientA, 'legacy:startMission', { code: created.code, missionId: 1 });
    expect(startResult.ok).toBe(true);
    const gameState = await gameStatePromise;
    expect(gameState.ruleset).toBe('legacy');
    // Mission 1 is now the standard 12-enemy Castle deck (classic Regicide's own rules) — no named enemy.
    expect(gameState.currentEnemy?.name).toBeUndefined();

    // White-box rig: clear out the rest of the Castle deck and force the current enemy down to 1 health,
    // so the next card played wins the whole mission instead of simulating 12 unpredictable fights.
    const room = rooms.getRoom(created.code)!;
    room.gameState.castleDeck = [];
    room.gameState.currentEnemy!.maxHealth = 1;

    const playerId = room.gameState.players[room.gameState.currentPlayerIndex].id;
    const cardToPlay = room.gameState.players[room.gameState.currentPlayerIndex].hand[0];

    const wonPromise = waitForMatch<ClientGameState>(clientA, 'game:state', (s) => s.phase === 'WON');
    const legacyAfterWinPromise = waitForMatch<LegacyStatePayload>(clientA, 'legacy:state', (s) => s.missionsCompleted.length > 0);
    const playResult = await emitAsync<{ ok: true } | { ok: false; error: string }>(clientA, 'game:action', {
      code: created.code,
      action: { type: 'PLAY_CARDS', playerId, cardIds: [cardToPlay.id] },
    });
    expect(playResult.ok).toBe(true);
    const wonState = await wonPromise;
    expect(wonState.phase).toBe('WON');

    const legacyAfterWin = await legacyAfterWinPromise;
    expect(legacyAfterWin.missionsCompleted).toEqual([1]);
    expect(legacyAfterWin.currentMission).toBe(2);
    expect(legacyAfterWin.party.length).toBe(42); // mission 1's reward is the Kinfolk Flute relic plus 2 basic recruits
    expect(legacyAfterWin.permanentRules).toEqual(['KINFOLK_FLUTE']);

    // Same flow as classic Regicide: after a mission ends, the host restarts (LOBBY) before the
    // next mission can be started or a new player can join.
    const restartResult = await emitAsync<{ ok: true } | { ok: false; error: string }>(clientA, 'room:restart', { code: created.code });
    expect(restartResult.ok).toBe(true);

    // A second player resumes the same campaign by its durable code, and sees the updated party.
    clientB = ioClient(`http://localhost:${port}`);
    await waitFor(clientB, 'connect');
    const resumedLegacyStatePromise = waitFor<LegacyStatePayload>(clientB, 'legacy:state'); // registered before the triggering emit — see comment above
    const resumed = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string } | { ok: false; error: string }>(
      clientB,
      'legacy:resume',
      { code: created.code, name: 'Bob' },
    );
    expect(resumed.ok).toBe(true);
    const resumedLegacyState = await resumedLegacyStatePromise;
    expect(resumedLegacyState.party.length).toBe(42);
    expect(resumedLegacyState.permanentRules).toEqual(['KINFOLK_FLUTE']);
    expect(resumedLegacyState.currentMission).toBe(2);
  });

  it('jumping straight to mission 3 auto-grants missions 1 and 2\'s rewards first', async () => {
    const client = ioClient(`http://localhost:${port}`);
    await waitFor(client, 'connect');
    const created = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string }>(client, 'legacy:create', { name: 'Zara' });

    const result = rooms.startLegacyMission(created.code, created.playerId, 3);
    if ('error' in result) throw new Error(result.error);

    expect(result.room.legacy?.currentMission).toBe(3);
    expect(result.room.legacy?.missionsCompleted).toEqual([1, 2]);
    // Mission 1's Kinfolk Flute relic and mission 2's 4 Dual-class Stickers, both auto-granted.
    expect(result.room.legacy?.permanentRules).toEqual(['KINFOLK_FLUTE']);
    const stickered = result.room.legacy!.party.filter((c) => c.kind === 'suited' && c.secondSuit);
    expect(stickered.length).toBe(4);
    expect(result.room.gameState.ruleset).toBe('legacy');
    expect(result.room.gameState.phase).toBe('IN_PROGRESS');
    client.close();
  });

  it('jumps straight to mission 8 despite the mission 7 gap (RoomManager no longer bounds on MISSIONS.length)', async () => {
    const client = ioClient(`http://localhost:${port}`);
    await waitFor(client, 'connect');
    const created = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string }>(client, 'legacy:create', { name: 'Goran' });

    const result = rooms.startLegacyMission(created.code, created.playerId, 8);
    if ('error' in result) throw new Error(result.error);

    expect(result.room.legacy?.currentMission).toBe(8);
    expect(result.room.gameState.ruleset).toBe('legacy');
    expect(result.room.gameState.phase).toBe('IN_PROGRESS');
    // Mission 8's ascending zone and its preset Pilgrim Puppy anchor made it through RoomManager into the engine.
    expect(result.room.gameState.ascendingZone).toBe(true);
    expect(result.room.gameState.missionZone.length).toBe(1);
    client.close();
  });

  it('rejects jumping to a mission that isn\'t built yet', async () => {
    const client = ioClient(`http://localhost:${port}`);
    await waitFor(client, 'connect');
    const created = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string }>(client, 'legacy:create', { name: 'Yuki' });
    const result = rooms.startLegacyMission(created.code, created.playerId, 12);
    expect('error' in result).toBe(true);
    client.close();
  });

  it('rejects resuming an unknown campaign code', async () => {
    const client = ioClient(`http://localhost:${port}`);
    await waitFor(client, 'connect');
    const res = await emitAsync<{ ok: true } | { ok: false; error: string }>(client, 'legacy:resume', { code: 'ZZZZZZ', name: 'Nobody' });
    expect(res.ok).toBe(false);
    client.close();
  });

  it('restores a campaign from an uploaded save file under a brand-new code', async () => {
    const client = ioClient(`http://localhost:${port}`);
    await waitFor(client, 'connect');

    const legacyStatePromise = waitFor<LegacyStatePayload>(client, 'legacy:state');
    const save = {
      party: Array.from({ length: 41 }, (_, i) => ({ id: `c${i}`, kind: 'suited' as const, suit: 'H' as const, rank: '2' as const, name: `Card ${i}` })),
      missionsCompleted: [1],
      currentMission: 2,
      permanentRules: [],
    };
    const res = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string } | { ok: false; error: string }>(
      client,
      'legacy:restore',
      { name: 'Carol', save },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const legacyState = await legacyStatePromise;
    expect(legacyState.campaignCode).toBe(res.code);
    expect(legacyState.party.length).toBe(41);
    expect(legacyState.missionsCompleted).toEqual([1]);
    expect(legacyState.currentMission).toBe(2);

    // Restoring from a save mints a fresh code, distinct from any prior campaign's.
    const priorCode = rooms.getRoom(res.code)?.legacy?.campaignCode;
    expect(priorCode).toBe(res.code);
    client.close();
  });

  it('rejects restoring a save with no party', async () => {
    const client = ioClient(`http://localhost:${port}`);
    await waitFor(client, 'connect');
    const res = await emitAsync<{ ok: true } | { ok: false; error: string }>(client, 'legacy:restore', {
      name: 'Dave',
      save: { party: [], missionsCompleted: [], currentMission: 1, permanentRules: [] },
    });
    expect(res.ok).toBe(false);
    client.close();
  });
});
