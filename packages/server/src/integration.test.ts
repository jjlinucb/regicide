import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { ClientGameState, ClientToServerEvents, RoomStatePayload, ServerToClientEvents } from '@regicide/shared';
import { RoomManager } from './rooms/RoomManager.js';
import { registerSocketHandlers } from './socket/handlers.js';

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

/** Waits for the next event matching predicate, ignoring any already-in-flight events that don't match (e.g. a stale broadcast from a prior action). */
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

describe('server integration', () => {
  let httpServer: ReturnType<typeof createServer>;
  let port: number;
  let clientA: Client;
  let clientB: Client;

  beforeAll(async () => {
    httpServer = createServer();
    const io = new Server(httpServer, { cors: { origin: '*' } });
    const rooms = new RoomManager();
    io.on('connection', (socket) => registerSocketHandlers(io, socket, rooms));
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;
  });

  afterAll(async () => {
    clientA?.close();
    clientB?.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it('never leaks another player\'s hand contents, and keeps both clients in sync', async () => {
    clientA = ioClient(`http://localhost:${port}`);
    clientB = ioClient(`http://localhost:${port}`);
    await Promise.all([waitFor(clientA, 'connect'), waitFor(clientB, 'connect')]);

    const created = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string }>(clientA, 'room:create', { name: 'Alice' });
    expect(created.ok).toBe(true);

    const joined = await emitAsync<{ ok: true; playerToken: string; playerId: string }>(clientB, 'room:join', { code: created.code, name: 'Bob' });
    expect(joined.ok).toBe(true);

    // Register listeners BEFORE triggering room:start — the resulting broadcasts fire immediately
    // and would otherwise arrive (and be lost) before we get around to listening for them.
    const roomStatePromise = waitForMatch<RoomStatePayload>(clientA, 'room:state', (p) => p.started);
    const gameStatePromise = Promise.all([
      waitForMatch<ClientGameState>(clientA, 'game:state', (s) => s.phase === 'IN_PROGRESS'),
      waitForMatch<ClientGameState>(clientB, 'game:state', (s) => s.phase === 'IN_PROGRESS'),
    ]);

    const started = await emitAsync<{ ok: true }>(clientA, 'room:start', { code: created.code });
    expect(started.ok).toBe(true);

    const roomState = await roomStatePromise;
    expect(roomState.started).toBe(true);

    const [stateA, stateB] = await gameStatePromise;

    // Each player sees their own hand...
    const playerAView = stateA.players.find((p) => p.id === created.playerId)!;
    expect(playerAView.hand).toBeDefined();
    expect(playerAView.hand!.length).toBe(stateA.maxHandSize);

    // ...but never the other player's hand contents, only a count.
    const bobFromAlicesView = stateA.players.find((p) => p.id === joined.playerId)!;
    expect(bobFromAlicesView.hand).toBeUndefined();
    expect(bobFromAlicesView.handCount).toBe(stateA.maxHandSize);

    const aliceFromBobsView = stateB.players.find((p) => p.id === created.playerId)!;
    expect(aliceFromBobsView.hand).toBeUndefined();
    expect(aliceFromBobsView.handCount).toBe(stateB.maxHandSize);

    // Both clients agree on the shared public state.
    expect(stateA.currentEnemy).toEqual(stateB.currentEnemy);
    expect(stateA.phase).toBe('IN_PROGRESS');

    // Whoever's turn it is plays their first card; the other client should receive the update.
    const currentPlayerId = stateA.players[stateA.currentPlayerIndex].id;
    const actingClient = currentPlayerId === created.playerId ? clientA : clientB;
    const actingState = currentPlayerId === created.playerId ? stateA : stateB;
    const actingView = actingState.players.find((p) => p.id === currentPlayerId)!;
    const cardToPlay = actingView.hand![0];

    const bothUpdate = Promise.all([
      waitForMatch<ClientGameState>(clientA, 'game:state', (s) => (s.currentEnemy?.damageTaken ?? 0) > 0),
      waitForMatch<ClientGameState>(clientB, 'game:state', (s) => (s.currentEnemy?.damageTaken ?? 0) > 0),
    ]);
    const playResult = await emitAsync<{ ok: true } | { ok: false; error: string }>(actingClient, 'game:action', {
      code: created.code,
      action: { type: 'PLAY_CARDS', playerId: currentPlayerId, cardIds: [cardToPlay.id] },
    });
    expect(playResult.ok).toBe(true);
    const [afterA, afterB] = await bothUpdate;
    expect(afterA.currentEnemy!.damageTaken).toBeGreaterThan(0);
    expect(afterB.currentEnemy!.damageTaken).toBe(afterA.currentEnemy!.damageTaken);
  });
});
