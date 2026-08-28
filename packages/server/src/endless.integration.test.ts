import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { ClientGameState, ClientToServerEvents, EndlessStatePayload, ServerToClientEvents } from '@regicide/shared';
import { ENDLESS_MODE_MAX_LOOP } from '@regicide/shared';
import { RoomManager } from './rooms/RoomManager.js';
import { registerSocketHandlers } from './socket/handlers.js';
import { InMemoryCampaignStore } from './db/campaigns.js';
import { InMemoryEndlessSaveStore } from './db/endlessSaves.js';

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

/** White-box: forces the room's current game to a 1-card win, mirroring legacy.integration.test.ts's own rig. */
function rigForWin(rooms: RoomManager, code: string): { playerId: string; cardId: string } {
  const room = rooms.getRoom(code)!;
  room.gameState.castleDeck = [];
  room.gameState.currentEnemy!.maxHealth = 1;
  const player = room.gameState.players[room.gameState.currentPlayerIndex];
  return { playerId: player.id, cardId: player.hand[0].id };
}

describe('classic Regicide Endless save/load integration', () => {
  let httpServer: ReturnType<typeof createServer>;
  let port: number;
  let rooms: RoomManager;
  let endlessSaveStore: InMemoryEndlessSaveStore;
  let clientA: Client;
  let clientB: Client;

  beforeAll(async () => {
    httpServer = createServer();
    const io = new Server(httpServer, { cors: { origin: '*' } });
    endlessSaveStore = new InMemoryEndlessSaveStore();
    rooms = new RoomManager(new InMemoryCampaignStore(), endlessSaveStore);
    io.on('connection', (socket) => registerSocketHandlers(io, socket, rooms));
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;
  });

  afterAll(async () => {
    clientA?.close();
    clientB?.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it('checkpoints a durable save on the first classic win, and a second player loads it by code straight into Round 1', async () => {
    clientA = ioClient(`http://localhost:${port}`);
    await waitFor(clientA, 'connect');

    const created = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string }>(clientA, 'room:create', { name: 'Alice' });
    expect(created.ok).toBe(true);

    const gameStatePromise = waitForMatch<ClientGameState>(clientA, 'game:state', (s) => s.phase === 'IN_PROGRESS');
    const startResult = await emitAsync<{ ok: true } | { ok: false; error: string }>(clientA, 'room:start', { code: created.code });
    expect(startResult.ok).toBe(true);
    await gameStatePromise;

    const { playerId, cardId } = rigForWin(rooms, created.code);

    const wonPromise = waitForMatch<ClientGameState>(clientA, 'game:state', (s) => s.phase === 'WON');
    const endlessStatePromise = waitFor<EndlessStatePayload>(clientA, 'endless:state'); // registered before the triggering emit, per the other integration tests' own convention
    const playResult = await emitAsync<{ ok: true } | { ok: false; error: string }>(clientA, 'game:action', {
      code: created.code,
      action: { type: 'PLAY_CARDS', playerId, cardIds: [cardId] },
    });
    expect(playResult.ok).toBe(true);
    const wonState = await wonPromise;
    expect(wonState.phase).toBe('WON');
    expect(wonState.endlessLoop).toBe(0); // hasn't continued into Endless Mode yet, just the first classic win

    const endlessState = await endlessStatePromise;
    expect(endlessState.endlessLoop).toBe(0);
    expect(endlessState.saveCode).toBeTruthy();

    // A second player, on a fresh connection, loads that save by code — a stand-in for resuming in a whole new
    // session/browser, not just continuing the still-live room A is sitting in.
    clientB = ioClient(`http://localhost:${port}`);
    await waitFor(clientB, 'connect');
    const loaded = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string } | { ok: false; error: string }>(
      clientB,
      'endless:load',
      { code: endlessState.saveCode, name: 'Bob' },
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error('unreachable');
    expect(loaded.code).toBe(endlessState.saveCode);

    const round1Promise = waitForMatch<ClientGameState>(clientB, 'game:state', (s) => s.phase === 'IN_PROGRESS');
    const roundStartResult = await emitAsync<{ ok: true } | { ok: false; error: string }>(clientB, 'room:start', { code: loaded.code });
    expect(roundStartResult.ok).toBe(true);
    const round1State = await round1Promise;
    expect(round1State.ruleset).toBe('regicide');
    expect(round1State.endlessLoop).toBe(1);
    expect(1 + round1State.castleDeckCount).toBe(12);
    // Scaled-up Jack (base 20/10) confirms this dealt from the saved/continued deck, not a brand-new classic game.
    expect(round1State.currentEnemy!.maxHealth).toBeGreaterThan(20);
  });

  it('refuses to load a save that already conquered the final round', async () => {
    const client = ioClient(`http://localhost:${port}`);
    await waitFor(client, 'connect');
    const created = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string }>(client, 'room:create', { name: 'Zara' });

    const startedPromise = waitForMatch<ClientGameState>(client, 'game:state', (s) => s.phase === 'IN_PROGRESS');
    await emitAsync(client, 'room:start', { code: created.code });
    await startedPromise;

    const { playerId, cardId } = rigForWin(rooms, created.code);
    const wonPromise = waitForMatch<ClientGameState>(client, 'game:state', (s) => s.phase === 'WON');
    await emitAsync(client, 'game:action', { code: created.code, action: { type: 'PLAY_CARDS', playerId, cardIds: [cardId] } });
    await wonPromise;

    // White-box: fast-forward the PERSISTED record straight to the final round, as if 10 real rounds had been
    // played and won (loadEndlessSave reads the store, not the live room's cached copy — see checkpointEndlessSave).
    const room = rooms.getRoom(created.code)!;
    const saveCode = room.endless!.saveCode;
    const record = (await endlessSaveStore.get(saveCode))!;
    await endlessSaveStore.save({ ...record, endlessLoop: ENDLESS_MODE_MAX_LOOP });

    const result = await rooms.loadEndlessSave(saveCode, 'Yusuf');
    expect('error' in result).toBe(true);
    client.close();
  });
});
