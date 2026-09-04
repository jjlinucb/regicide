import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { Card, ClientGameState, ClientToServerEvents, LegacyStatePayload, ServerToClientEvents } from '@regicide/shared';
import { chanterStickerEligible, druidStickerEligible, guardianStickerEligible, reaverStickerEligible } from '@regicide/shared';
import { RoomManager } from './rooms/RoomManager.js';
import { registerSocketHandlers } from './socket/handlers.js';
import { InMemoryCampaignStore } from './db/campaigns.js';
import { InMemoryEndlessSaveStore } from './db/endlessSaves.js';

type Client = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Which of `wanted` suits still have an uncorrupted card at `rank` in this campaign's party. A jump-ahead grants
 * every earlier mission's reward, including several unseeded corruptAnotherCard steps, so a sticker test can't
 * hardcode its candidate suits — a corrupted card is permanently out (see shared party.ts's canGainSpecialClass).
 */
function uncorruptedSuitsOfRank(party: Card[], rank: string, wanted: string[]): string[] {
  const corrupted = party.filter((c) => c.kind === 'suited' && c.rank === rank && c.corrupted).map((c) => (c.kind === 'suited' ? String(c.suit) : ''));
  return wanted.filter((s) => !corrupted.includes(s)).sort();
}

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
    rooms = new RoomManager(new InMemoryCampaignStore(), new InMemoryEndlessSaveStore());
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
    expect(legacyAfterWin.party.length).toBe(41); // mission 1's reward: the Kinfolk Flute relic, corrupting one of the 40 starting members, and the High Arcana recruit
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
    expect(resumedLegacyState.party.length).toBe(41);
    expect(resumedLegacyState.permanentRules).toEqual(['KINFOLK_FLUTE']);
    expect(resumedLegacyState.currentMission).toBe(2);
  });

  it("John's easy-mode call: a fresh campaign's mercenary tracker is already open at 0 losses (not null), so the +15-coin bonus is spendable on mission 1's very first attempt, and again fresh for mission 2 after a win", async () => {
    const client = ioClient(`http://localhost:${port}`);
    await waitFor(client, 'connect');
    const created = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string }>(client, 'legacy:create', { name: 'Nell' });

    let room = rooms.getRoom(created.code)!;
    expect(room.legacy!.mercenaryProgress).toEqual({ missionId: 1, lossCount: 0, loadout: {} });

    const startResult = rooms.startLegacyMission(created.code, created.playerId, 1);
    if ('error' in startResult) throw new Error(startResult.error);
    expect(startResult.room.legacy!.mercenaryProgress).toEqual({ missionId: 1, lossCount: 0, loadout: {} });

    // Win mission 1 outright (rigged one-hit kill, same trick as the very first test in this file).
    room.gameState.castleDeck = [];
    room.gameState.currentEnemy!.maxHealth = 1;
    const playerId = room.gameState.players[room.gameState.currentPlayerIndex].id;
    const cardToPlay = room.gameState.players[room.gameState.currentPlayerIndex].hand[0];
    const playResult = await emitAsync<{ ok: true } | { ok: false; error: string }>(client, 'game:action', {
      code: created.code,
      action: { type: 'PLAY_CARDS', playerId, cardIds: [cardToPlay.id] },
    });
    expect(playResult.ok).toBe(true);

    room = rooms.getRoom(created.code)!;
    expect(room.legacy!.currentMission).toBe(2);
    // Fresh for the new mission too, not carried over and not cleared to null.
    expect(room.legacy!.mercenaryProgress).toEqual({ missionId: 2, lossCount: 0, loadout: {} });
    client.close();
  });

  it('BUG FIX: a Mercenary Camp purchase made in the lobby survives a jump to another mission instead of being silently discarded', async () => {
    const client = ioClient(`http://localhost:${port}`);
    await waitFor(client, 'connect');
    const created = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string }>(client, 'legacy:create', { name: 'John' });

    // Shop in the lobby while the tracker is still pointed at mission 1 — 2 Jesters, 10 of the 15 easy-mode coins.
    const set = await rooms.setMercenaryLoadout(created.code, created.playerId, { JESTER: 2 });
    if ('error' in set) throw new Error(set.error);
    expect(rooms.getRoom(created.code)!.legacy!.mercenaryProgress).toEqual({ missionId: 1, lossCount: 0, loadout: { JESTER: 2 } });

    // Then jump ahead to mission 5. The loss streak doesn't travel, but the picks do — and the tracker re-points
    // immediately so CampaignLobbyPage keeps rendering the camp through the stop-for-choices pause.
    const jumped = rooms.startLegacyMission(created.code, created.playerId, 5, { stopForPendingChoices: true });
    if ('error' in jumped) throw new Error(jumped.error);
    expect(jumped.room.legacy!.mercenaryProgress).toEqual({ missionId: 5, lossCount: 0, loadout: { JESTER: 2 } });

    const started = rooms.startLegacyMission(created.code, created.playerId, 5);
    if ('error' in started) throw new Error(started.error);
    // Mission 5's own 2 standing Jesters plus the 2 bought ones (see engine.ts's START_LEGACY_MISSION handling:
    // a Mercenary Camp Jester joins the standing pool, it isn't shuffled into the reserve deck).
    expect(started.room.gameState.standingJesters.length).toBe(4);
    client.close();
  });

  it("a loadout the destination mission's own budget can't cover is dropped on the way across, not smuggled in for free", async () => {
    const client = ioClient(`http://localhost:${port}`);
    await waitFor(client, 'connect');
    const created = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string }>(client, 'legacy:create', { name: 'John' });

    // Fake a long loss streak on mission 1 so its budget (losses + 15) can afford far more than a fresh mission's.
    const room = rooms.getRoom(created.code)!;
    room.legacy!.mercenaryProgress = { missionId: 1, lossCount: 10, loadout: {} };
    const set = await rooms.setMercenaryLoadout(created.code, created.playerId, { JESTER: 2, NINETEEN: 2, WILD_ACE: 2 }); // 22 coins of 25
    if ('error' in set) throw new Error(set.error);

    // Mission 5 resets the streak, so only 15 coins — 22 doesn't fit, and the whole loadout is dropped.
    const jumped = rooms.startLegacyMission(created.code, created.playerId, 5, { stopForPendingChoices: true });
    if ('error' in jumped) throw new Error(jumped.error);
    expect(jumped.room.legacy!.mercenaryProgress).toEqual({ missionId: 5, lossCount: 0, loadout: {} });
    client.close();
  });

  it('a solo (1-player) Legacy mission still gets both Jesters, unlike classic Regicide\'s player-count-scaled table', async () => {
    const client = ioClient(`http://localhost:${port}`);
    await waitFor(client, 'connect');
    const created = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string }>(client, 'legacy:create', { name: 'Solo' });

    const result = rooms.startLegacyMission(created.code, created.playerId, 1);
    if ('error' in result) throw new Error(result.error);

    // Mission 1 uses the standing-Jester house rule like every other mission (see GameState.standingJesters) —
    // both Jesters are carved out into their own always-usable pool instead of being shuffled into the reserve
    // deck, so count across everywhere a Jester could actually be.
    const allCards = [
      ...result.room.gameState.tavernDeck,
      ...result.room.gameState.players.flatMap((p) => p.hand),
      ...result.room.gameState.standingJesters,
    ];
    const jesterCount = allCards.filter((c) => c.kind === 'jester').length;
    expect(jesterCount).toBe(2);
    client.close();
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

  it(
    "a Mission 10 exact-kill deck-rehabilitation restoration survives into the persisted party, cleansed — " +
      'regression test for a silent no-op: RoomManager never removes a Mission 10 enemy\'s source card from ' +
      'the persisted party when the fight starts, so the "restored" card handed back on an exact kill is the ' +
      'exact same still-corrupted object already sitting in room.legacy.party; the old id-dedup in ' +
      'applyRestoredPartyCards treated that as "already there, skip it" and threw the restoration away',
    async () => {
      const client = ioClient(`http://localhost:${port}`);
      await waitFor(client, 'connect');
      const created = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string }>(client, 'legacy:create', {
        name: 'Mira',
      });

      // Jump straight to mission 10 (auto-grants 1-9's rewards first, same helper the tests above use).
      const startResult = rooms.startLegacyMission(created.code, created.playerId, 10);
      if ('error' in startResult) throw new Error(startResult.error);
      const room = startResult.room;
      expect(room.gameState.corruptedPartyEnemies).toBe(true);

      // White-box: buildCorruptedPartyEnemies never clones the party card it pulls in — `sourceCard` IS the same
      // object reference still sitting in room.legacy.party. Flip it corrupted here to prove the restoration
      // below actually cleanses it, not merely re-adds an already-clean card.
      const heroSourceCard = room.gameState.currentEnemy!.sourceCard!;
      expect(heroSourceCard.kind).toBe('suited');
      if (heroSourceCard.kind === 'suited') heroSourceCard.corrupted = true;
      expect(room.legacy!.party.some((c) => c.id === heroSourceCard.id && c.kind === 'suited' && c.corrupted)).toBe(true);

      // White-box rig: collapse the rest of the 8-enemy queue and hand the current player a single Diamonds
      // (Bard — no damage-affecting power) card worth exactly the enemy's remaining health, and pin the enemy's
      // own suit away from Spades (Paladin would otherwise reduce the damage it takes), so this one play both
      // wins the whole mission AND lands as an exact kill.
      room.gameState.castleDeck = [];
      room.gameState.currentEnemy!.suit = 'H';
      room.gameState.currentEnemy!.maxHealth = 5;
      room.gameState.currentEnemy!.damageTaken = 0;
      const attackCard: Card = { id: 'test-exact-kill-card', kind: 'suited', suit: 'D', rank: '5', name: 'Test Attacker' };
      const playerId = room.gameState.players[room.gameState.currentPlayerIndex].id;
      room.gameState.players[room.gameState.currentPlayerIndex].hand = [attackCard];

      const result = await rooms.applyGameAction(created.code, { type: 'PLAY_CARDS', playerId, cardIds: [attackCard.id] });
      if ('error' in result) throw new Error(result.error);
      expect(result.room.gameState.phase).toBe('WON');
      expect(result.room.gameState.restoredPartyCards.map((c) => c.id)).toEqual([heroSourceCard.id]);

      // The restored hero is a real, uncorrupted, single, kept entry in the persisted campaign party — not
      // silently deduped away because it (the very same corrupted object) was still sitting there all along.
      const matches = result.room.legacy!.party.filter((c) => c.id === heroSourceCard.id);
      expect(matches.length).toBe(1);
      expect(matches[0].kind === 'suited' && matches[0].corrupted).toBeFalsy();

      client.close();
    },
  );

  it('rejects jumping to a mission that isn\'t built yet', async () => {
    const client = ioClient(`http://localhost:${port}`);
    await waitFor(client, 'connect');
    const created = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string }>(client, 'legacy:create', { name: 'Yuki' });
    const result = rooms.startLegacyMission(created.code, created.playerId, 13);
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

  it("Mission 4's Beast Companion reward is a rotating pool, not the party — the selected one (only) rides into the next attempt's reserve deck", async () => {
    const client = ioClient(`http://localhost:${port}`);
    await waitFor(client, 'connect');
    const created = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string }>(client, 'legacy:create', { name: 'Priya' });

    // Jump straight to mission 5 (auto-grants missions 1-4's rewards, including Mission 4's Beast Companions).
    let result = rooms.startLegacyMission(created.code, created.playerId, 5);
    if ('error' in result) throw new Error(result.error);
    expect(result.room.legacy?.beastCompanionPool.length).toBe(4);
    expect(result.room.legacy?.party.some((c) => c.kind === 'suited' && c.beast)).toBe(false);

    // No selection made yet — this attempt's actual deck has no beast card in it anywhere.
    const beforeSelection = [...result.room.gameState.tavernDeck, ...result.room.gameState.players.flatMap((p) => p.hand)];
    expect(beforeSelection.some((c) => c.kind === 'suited' && c.beast)).toBe(false);

    const chosen = result.room.legacy!.beastCompanionPool[0];
    const selectResult = await rooms.setBeastCompanionSelection(created.code, created.playerId, chosen.id);
    if ('error' in selectResult) throw new Error(selectResult.error);
    expect(selectResult.room.legacy?.selectedBeastCompanionId).toBe(chosen.id);

    // Restarting the same mission attempt now includes exactly the selected companion, and no others.
    const restarted = rooms.restartGame(created.code, created.playerId);
    if ('error' in restarted) throw new Error(restarted.error);
    result = rooms.startLegacyMission(created.code, created.playerId, 5);
    if ('error' in result) throw new Error(result.error);
    const afterSelection = [...result.room.gameState.tavernDeck, ...result.room.gameState.players.flatMap((p) => p.hand)];
    const beastCardsInPlay = afterSelection.filter((c) => c.kind === 'suited' && c.beast);
    expect(beastCardsInPlay.length).toBe(1);
    expect(beastCardsInPlay[0].id).toBe(chosen.id);

    client.close();
  });

  it('stopForPendingChoices: jumping past a mission with an interactive reward pick stops for it instead of launching straight into the target mission', async () => {
    const client = ioClient(`http://localhost:${port}`);
    await waitFor(client, 'connect');
    const created = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string }>(client, 'legacy:create', { name: 'Nadia' });

    // BUG FIX regression test: without stopForPendingChoices, this single call used to grant Mission 4's Beast
    // Companion pool AND launch straight into Mission 5's fight in the same atomic step — so the client (whose
    // BeastCompanionPicker only ever renders on CampaignLobbyPage) never got a chance to show it before gameplay
    // began. The pool was still there server-side, just unreachable until the party happened to return to the
    // lobby later. `stopForPendingChoices: true` (only ever set by the live client UI — see
    // CampaignLobbyPage.tsx's onStartMission call) fixes that by stopping right after the grant.
    let result = rooms.startLegacyMission(created.code, created.playerId, 5, { stopForPendingChoices: true });
    if ('error' in result) throw new Error(result.error);
    expect(result.room.legacy?.currentMission).toBe(5);
    expect(result.room.legacy?.beastCompanionPool.length).toBe(4);
    // The mission was NOT actually started — the host still needs to make (or skip) the pick from the lobby.
    expect(result.room.gameState.phase).toBe('LOBBY');

    const chosen = result.room.legacy!.beastCompanionPool[0];
    const selectResult = await rooms.setBeastCompanionSelection(created.code, created.playerId, chosen.id);
    if ('error' in selectResult) throw new Error(selectResult.error);

    // A second call, now that currentMission already caught up to 5, actually starts the mission — with the
    // chosen companion folded into this attempt's reserve deck.
    result = rooms.startLegacyMission(created.code, created.playerId, 5, { stopForPendingChoices: true });
    if ('error' in result) throw new Error(result.error);
    expect(result.room.gameState.phase).toBe('IN_PROGRESS');
    const inPlay = [...result.room.gameState.tavernDeck, ...result.room.gameState.players.flatMap((p) => p.hand)];
    expect(inPlay.some((c) => c.id === chosen.id)).toBe(true);

    client.close();
  });

  it('omitting stopForPendingChoices preserves the original one-shot jump-and-start behavior (every existing caller relies on this)', async () => {
    const client = ioClient(`http://localhost:${port}`);
    await waitFor(client, 'connect');
    const created = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string }>(client, 'legacy:create', { name: 'Omar' });

    const result = rooms.startLegacyMission(created.code, created.playerId, 5);
    if ('error' in result) throw new Error(result.error);
    expect(result.room.legacy?.beastCompanionPool.length).toBe(4);
    expect(result.room.gameState.phase).toBe('IN_PROGRESS');

    client.close();
  });

  it('Mission 11 pulls the WHOLE Beast Companion pool into play at once, overriding the "pick one" restriction', async () => {
    const client = ioClient(`http://localhost:${port}`);
    await waitFor(client, 'connect');
    const created = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string }>(client, 'legacy:create', { name: 'Tomas' });

    const result = rooms.startLegacyMission(created.code, created.playerId, 11);
    if ('error' in result) throw new Error(result.error);
    expect(result.room.legacy?.beastCompanionPool.length).toBe(4);
    expect(result.room.gameState.beastDeckMechanic).toBe(true);
    // All 4 beast cards are accounted for between the face-down deck and its used-card pile, same as the
    // shared-package Mission 11 test (which builds its party the old way, directly from Mission 4's recruit specs).
    const pool = [...result.room.gameState.beastDeck, ...result.room.gameState.beastDeckDiscard];
    expect(pool.length).toBe(4);
    expect(new Set(pool.map((c) => c.id))).toEqual(new Set(result.room.legacy!.beastCompanionPool.map((c) => c.id)));

    client.close();
  });

  it('rejects a non-host trying to set the Beast Companion selection, and a card id not actually in the pool', async () => {
    const client = ioClient(`http://localhost:${port}`);
    await waitFor(client, 'connect');
    const created = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string }>(client, 'legacy:create', { name: 'Owen' });
    const result = rooms.startLegacyMission(created.code, created.playerId, 5);
    if ('error' in result) throw new Error(result.error);

    const notHost = await rooms.setBeastCompanionSelection(created.code, 'not-the-host', result.room.legacy!.beastCompanionPool[0].id);
    expect('error' in notHost).toBe(true);

    const badCard = await rooms.setBeastCompanionSelection(created.code, created.playerId, 'not-a-real-card');
    expect('error' in badCard).toBe(true);

    client.close();
  });

  it("Mission 5's Reaver-sticker reward is a one-time player choice: rejects a non-host, an ineligible card, and reusing it a second time", async () => {
    const client = ioClient(`http://localhost:${port}`);
    await waitFor(client, 'connect');
    const created = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string }>(client, 'legacy:create', { name: 'Sana' });

    // Jump straight to mission 6 (auto-grants missions 1-5's rewards, including Mission 5's Reaver-sticker choice).
    const result = rooms.startLegacyMission(created.code, created.playerId, 6);
    if ('error' in result) throw new Error(result.error);
    expect(result.room.legacy?.party.some((c) => c.kind === 'suited' && c.secondClassReaver)).toBe(false);
    const eligible = result.room.legacy!.party.filter(reaverStickerEligible);
    expect(eligible.length).toBeGreaterThan(0);

    const notHost = await rooms.chooseReaverSticker(created.code, 'not-the-host', eligible[0].id);
    expect('error' in notHost).toBe(true);

    const badCard = await rooms.chooseReaverSticker(created.code, created.playerId, 'not-a-real-card');
    expect('error' in badCard).toBe(true);

    const applied = await rooms.chooseReaverSticker(created.code, created.playerId, eligible[0].id);
    if ('error' in applied) throw new Error(applied.error);
    const stickered = applied.room.legacy?.party.find((c) => c.id === eligible[0].id);
    expect(stickered?.kind === 'suited' && stickered.secondClassReaver).toBe(true);

    // One-time only — a second eligible card is rejected once the sticker's already been used.
    if (eligible.length > 1) {
      const again = await rooms.chooseReaverSticker(created.code, created.playerId, eligible[1].id);
      expect('error' in again).toBe(true);
    }

    client.close();
  });

  it("Mission 6's Guardian-sticker reward is a one-time player choice: rejects a non-host, an ineligible card, and reusing it a second time", async () => {
    const client = ioClient(`http://localhost:${port}`);
    await waitFor(client, 'connect');
    const created = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string }>(client, 'legacy:create', { name: 'Priya' });

    // Jump past mission 6 (auto-grants missions 1-6's rewards, including Mission 6's Guardian-sticker choice).
    const result = rooms.startLegacyMission(created.code, created.playerId, 7);
    if ('error' in result) throw new Error(result.error);
    expect(result.room.legacy?.party.some((c) => c.kind === 'suited' && c.secondClassGuardian)).toBe(false);
    const eligible = result.room.legacy!.party.filter(guardianStickerEligible);
    expect(eligible.length).toBeGreaterThan(0);

    const notHost = await rooms.chooseGuardianSticker(created.code, 'not-the-host', eligible[0].id);
    expect('error' in notHost).toBe(true);

    const badCard = await rooms.chooseGuardianSticker(created.code, created.playerId, 'not-a-real-card');
    expect('error' in badCard).toBe(true);

    const applied = await rooms.chooseGuardianSticker(created.code, created.playerId, eligible[0].id);
    if ('error' in applied) throw new Error(applied.error);
    const stickered = applied.room.legacy?.party.find((c) => c.id === eligible[0].id);
    expect(stickered?.kind === 'suited' && stickered.secondClassGuardian).toBe(true);

    // One-time only — a second eligible card is rejected once the sticker's already been used.
    if (eligible.length > 1) {
      const again = await rooms.chooseGuardianSticker(created.code, created.playerId, eligible[1].id);
      expect('error' in again).toBe(true);
    }

    client.close();
  });

  it("Mission 7's Druid-sticker reward is a one-time player choice, limited to the 4 of Diamonds/Clubs/Spades", async () => {
    const client = ioClient(`http://localhost:${port}`);
    await waitFor(client, 'connect');
    const created = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string }>(client, 'legacy:create', { name: 'Rashid' });

    // Jump past mission 7 (auto-grants missions 1-7's rewards, including Mission 7's Druid-sticker choice).
    const result = rooms.startLegacyMission(created.code, created.playerId, 8);
    if ('error' in result) throw new Error(result.error);
    expect(result.room.legacy?.party.some((c) => c.kind === 'suited' && c.secondClassDruid)).toBe(false);
    const eligible = result.room.legacy!.party.filter(druidStickerEligible);
    // The three rank-4 cards the source names — the 4 of Hearts is excluded — minus any that this run's random
    // corruptAnotherCard rewards happened to hit, since a corrupted card can never gain a special class (see
    // party.ts's canGainSpecialClass). Which cards get corrupted is unseeded, so this is derived, not hardcoded.
    expect(eligible.map((c) => c.suit).sort()).toEqual(uncorruptedSuitsOfRank(result.room.legacy!.party, '4', ['C', 'D', 'S']));
    expect(eligible.length).toBeGreaterThan(0);

    const notHost = await rooms.chooseDruidSticker(created.code, 'not-the-host', eligible[0].id);
    expect('error' in notHost).toBe(true);

    const hearts4 = result.room.legacy!.party.find((c) => c.kind === 'suited' && c.suit === 'H' && c.rank === '4')!;
    const ineligible = await rooms.chooseDruidSticker(created.code, created.playerId, hearts4.id);
    expect('error' in ineligible).toBe(true);

    const applied = await rooms.chooseDruidSticker(created.code, created.playerId, eligible[0].id);
    if ('error' in applied) throw new Error(applied.error);
    const stickered = applied.room.legacy?.party.find((c) => c.id === eligible[0].id);
    expect(stickered?.kind === 'suited' && stickered.secondClassDruid).toBe(true);

    // One-time only — a second eligible card is rejected once the sticker's already been used. Guarded on there
    // BEING a second one: this run's random corruption may have taken the others out of the running.
    if (eligible.length > 1) {
      const again = await rooms.chooseDruidSticker(created.code, created.playerId, eligible[1].id);
      expect('error' in again).toBe(true);
    }

    client.close();
  });

  it("Mission 8's Chanter-sticker reward is a one-time player choice, limited to rank-2 non-Bard cards", async () => {
    const client = ioClient(`http://localhost:${port}`);
    await waitFor(client, 'connect');
    const created = await emitAsync<{ ok: true; code: string; playerToken: string; playerId: string }>(client, 'legacy:create', { name: 'Rashid' });

    // Jump past mission 8 (auto-grants missions 1-8's rewards, including Mission 8's Chanter-sticker choice).
    const result = rooms.startLegacyMission(created.code, created.playerId, 9);
    if ('error' in result) throw new Error(result.error);
    expect(result.room.legacy?.party.some((c) => c.kind === 'suited' && c.secondClassChanter)).toBe(false);
    const eligible = result.room.legacy!.party.filter(chanterStickerEligible);
    // Rank 2, any base class except Bard — minus any corrupted by an earlier mission's reward (see the Druid
    // test above for why this is derived rather than hardcoded).
    expect(eligible.every((c) => c.rank === '2')).toBe(true);
    expect(eligible.map((c) => c.suit).sort()).toEqual(uncorruptedSuitsOfRank(result.room.legacy!.party, '2', ['C', 'H', 'S']));
    expect(eligible.length).toBeGreaterThan(0);

    const notHost = await rooms.chooseChanterSticker(created.code, 'not-the-host', eligible[0].id);
    expect('error' in notHost).toBe(true);

    const diamonds2 = result.room.legacy!.party.find((c) => c.kind === 'suited' && c.suit === 'D' && c.rank === '2')!;
    const ineligible = await rooms.chooseChanterSticker(created.code, created.playerId, diamonds2.id);
    expect('error' in ineligible).toBe(true);

    const applied = await rooms.chooseChanterSticker(created.code, created.playerId, eligible[0].id);
    if ('error' in applied) throw new Error(applied.error);
    const stickered = applied.room.legacy?.party.find((c) => c.id === eligible[0].id);
    expect(stickered?.kind === 'suited' && stickered.secondClassChanter).toBe(true);

    // One-time only — a second eligible card is rejected once the sticker's already been used. Guarded on there
    // BEING a second one: this run's random corruption may have taken the others out of the running.
    if (eligible.length > 1) {
      const again = await rooms.chooseChanterSticker(created.code, created.playerId, eligible[1].id);
      expect('error' in again).toBe(true);
    }

    client.close();
  });
});
