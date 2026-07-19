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
    expect(gameState.currentEnemy?.name).toBe('Grommash the Cinder-Handed');

    // White-box rig: force the enemy down to 1 health so the next card played wins the mission,
    // instead of simulating an unpredictable number of random turns.
    const room = rooms.getRoom(created.code)!;
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
    expect(legacyAfterWin.party.length).toBe(41); // mission 1's reward grants exactly 1 recruit

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
    expect(resumedLegacyState.party.length).toBe(41);
    expect(resumedLegacyState.currentMission).toBe(2);
  });

  it('rejects resuming an unknown campaign code', async () => {
    const client = ioClient(`http://localhost:${port}`);
    await waitFor(client, 'connect');
    const res = await emitAsync<{ ok: true } | { ok: false; error: string }>(client, 'legacy:resume', { code: 'ZZZZZZ', name: 'Nobody' });
    expect(res.ok).toBe(false);
    client.close();
  });
});
