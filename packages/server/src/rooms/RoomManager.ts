import { randomUUID } from 'node:crypto';
import { applyAction, createLobbyState, ENDLESS_MODE_MAX_LOOP } from '@regicide/shared';
import type { Card, GameAction, GameState, LegacySavePayload, MercenaryProgress, MercenaryTypeId, SuitedCard } from '@regicide/shared';
import {
  applyChanterStickerChoice,
  applyDruidStickerChoice,
  applyGuardianStickerChoice,
  applyReaverStickerChoice,
  applyRestoredPartyCards,
  applyReward,
  buildInitialParty,
  buildMercenaryLoadout,
  buildRecruitCard,
  getMission,
  chanterStickerEligible,
  druidStickerEligible,
  guardianStickerEligible,
  LEGACY_JESTER_COUNT,
  mercenaryCoinsForLosses,
  missionEnemiesToSpecs,
  reaverStickerEligible,
} from '@regicide/shared';
import { generateRoomCode } from './roomCode.js';
import { generateUniqueCampaignCode, type CampaignRecord, type CampaignStore } from '../db/campaigns.js';
import { generateUniqueEndlessSaveCode, type EndlessSaveRecord, type EndlessSaveStore } from '../db/endlessSaves.js';

export interface RoomPlayer {
  id: string;
  token: string;
  name: string;
  socketId: string | null;
  connected: boolean;
}

/**
 * Re-points `progress` at `missionId`, carrying the party's currently-selected mercenary loadout across rather
 * than throwing it away. The loss STREAK never travels — a different mission means the old streak is over one way
 * or another (won, jumped past, or abandoned), so lossCount resets to 0 and the budget drops back to
 * mercenaryCoinsForLosses(0) — but the party's PICKS survive, as long as that fresh budget can still afford them.
 *
 * BUG FIX (2026-09-02, reported from live play): this used to clear `loadout` outright whenever the mission
 * changed, which silently threw away a purchase made in the lobby immediately before jumping to another mission —
 * CampaignLobbyPage renders the Mercenary Camp directly above the mission picker, and the camp's own copy
 * promises the hires "ride along in the deck on your next attempt", so buying two Jesters and then jumping to
 * Mission 5 read as 4 standing Jesters but delivered 2. Re-validating against the destination's own budget is
 * what keeps this honest: a loadout bought under a long loss streak's inflated coins can't be smuggled into a
 * fresh mission for free, it's simply dropped.
 */
function repointMercenaryProgress(progress: MercenaryProgress | null, missionId: number): MercenaryProgress {
  const carried = progress?.loadout ?? {};
  const affordable = buildMercenaryLoadout(carried, mercenaryCoinsForLosses(0));
  return { missionId, lossCount: 0, loadout: Array.isArray(affordable) ? carried : {} };
}

/** A Legacy room's durable campaign data, mirrored from CampaignStore and kept in sync at mission boundaries. */
export interface LegacyRoomData {
  campaignCode: string;
  party: Card[];
  missionsCompleted: number[];
  currentMission: number;
  permanentRules: string[];
  mercenaryProgress: MercenaryProgress | null;
  /** Mission 4's Beast Companion reward, sourced (see tutorial_vids/summaries/mission-4.md): a rotating pool of 4 companion cards, kept out of `party` entirely — see grantMissionReward/startLegacyMission/setBeastCompanionSelection. */
  beastCompanionPool: Card[];
  /** Which one card (by id) from `beastCompanionPool`, if any, rides along into the next mission attempt (see startLegacyMission). Sticky across missions until changed. */
  selectedBeastCompanionId: string | null;
}

/** Classic Regicide's durable Endless Mode save data, mirrored from EndlessSaveStore and kept in sync at every WON. */
export interface EndlessRoomData {
  saveCode: string;
  deck: SuitedCard[];
  endlessLoop: number;
}

export interface Room {
  code: string;
  createdAt: number;
  hostPlayerId: string;
  playerOrder: string[]; // stable seat order, used as the game's turn order
  players: Map<string, RoomPlayer>;
  gameState: GameState;
  legacy?: LegacyRoomData;
  /**
   * Set once this room has ever won a classic Regicide game — kept in sync at every WON (see
   * checkpointEndlessSave) purely so the save code/round can be shown to players. Only `pendingEndlessResume`
   * below actually redirects room:start; an ordinary room that simply won a game once (and could "Play again"
   * into a fresh one) must NOT have that win silently hijack its next start.
   */
  endless?: EndlessRoomData;
  /** True only right after loadEndlessSave attaches a save to a fresh LOBBY room — tells startGame to deal into that save's next round instead of a brand-new game. Cleared the moment that happens. */
  pendingEndlessResume?: boolean;
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
    mercenaryProgress: legacy.mercenaryProgress,
    beastCompanionPool: legacy.beastCompanionPool,
    selectedBeastCompanionId: legacy.selectedBeastCompanionId,
    updatedAt: Date.now(),
  };
}

function toEndlessRecord(room: Room): EndlessSaveRecord {
  const endless = room.endless!;
  return { code: endless.saveCode, deck: endless.deck, endlessLoop: endless.endlessLoop, updatedAt: Date.now() };
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(
    private campaignStore: CampaignStore,
    private endlessSaveStore: EndlessSaveStore,
  ) {}

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
    // A room just loaded from an Endless save (see loadEndlessSave) deals straight into its next saved round
    // instead of a fresh classic game — but only for that first start; see pendingEndlessResume's own doc.
    const action: GameAction =
      room.pendingEndlessResume && room.endless
        ? { type: 'RESUME_ENDLESS_SAVE', playerIds: room.playerOrder, playerNames, seed, deck: room.endless.deck, endlessLoop: room.endless.endlessLoop }
        : { type: 'START_GAME', playerIds: room.playerOrder, playerNames, seed };
    const result = applyAction(room.gameState, action);
    if (!result.ok) return { error: result.error };
    room.gameState = result.state;
    room.pendingEndlessResume = false;
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
    // Classic Regicide only, every WON (the very first classic win as well as every further Endless round) —
    // a loss deliberately does NOT touch the save, so reloading the same code retries the same next round.
    if (result.state.ruleset === 'regicide' && wasInProgress && result.state.phase === 'WON') {
      await this.checkpointEndlessSave(room, result.state);
    }
    return { room };
  }

  /**
   * Creates or updates this room's durable Endless save with the deck as it stands right after a classic
   * Regicide win — the 52 suited cards only (see EndlessRoomData.deck's own doc), same "no jesters" convention
   * startEndlessRound/resumeEndlessSave already use. Mints a fresh code the first time a room ever wins.
   */
  private async checkpointEndlessSave(room: Room, state: GameState): Promise<void> {
    const deck = [...state.tavernDeck, ...state.discardPile, ...state.players.flatMap((p) => p.hand)].filter(
      (c): c is SuitedCard => c.kind === 'suited',
    );
    if (!room.endless) {
      const saveCode = await generateUniqueEndlessSaveCode(this.endlessSaveStore);
      room.endless = { saveCode, deck, endlessLoop: state.endlessLoop };
      await this.endlessSaveStore.create(toEndlessRecord(room));
    } else {
      room.endless.deck = deck;
      room.endless.endlessLoop = state.endlessLoop;
      await this.endlessSaveStore.save(toEndlessRecord(room));
    }
  }

  /**
   * Loads a durable Endless save by code (see checkpointEndlessSave) into a fresh LOBBY room, or — mirroring
   * resumeLegacyCampaign — adds a joining player to that save's room if it's already been loaded and is still
   * waiting to start. Refuses a save that already conquered the final round: there's no next round to deal into.
   */
  async loadEndlessSave(code: string, name: string): Promise<{ room: Room; player: RoomPlayer } | { error: string }> {
    const upperCode = code.toUpperCase();
    const existing = this.getRoom(upperCode);
    if (existing?.endless) {
      if (existing.gameState.phase !== 'LOBBY') return { error: 'This game is already in progress — wait for it to finish.' };
      if (existing.playerOrder.length >= MAX_PLAYERS) return { error: 'This save already has 4 players.' };
      const player: RoomPlayer = { id: randomUUID(), token: randomUUID(), name, socketId: null, connected: true };
      existing.players.set(player.id, player);
      existing.playerOrder.push(player.id);
      return { room: existing, player };
    }

    const record = await this.endlessSaveStore.get(upperCode);
    if (!record) return { error: 'No Endless save found with that code.' };
    if (record.endlessLoop >= ENDLESS_MODE_MAX_LOOP) {
      return { error: `This save already conquered Endless Mode's final round (${ENDLESS_MODE_MAX_LOOP}) — there's no further round to load into.` };
    }

    const endless: EndlessRoomData = { saveCode: record.code, deck: record.deck, endlessLoop: record.endlessLoop };
    const player: RoomPlayer = { id: randomUUID(), token: randomUUID(), name, socketId: null, connected: true };
    const room: Room = {
      code: record.code,
      createdAt: Date.now(),
      hostPlayerId: player.id,
      playerOrder: [player.id],
      players: new Map([[player.id, player]]),
      gameState: createLobbyState(),
      endless,
      pendingEndlessResume: true,
    };
    this.rooms.set(record.code, room);
    return { room, player };
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
      // John's easy-mode call: every mission starts with a mercenary loadout tracker already open (0 losses),
      // not null, so the Mercenary Camp's +15 easy-mode coin bonus (see mercenaryCoinsForLosses) is spendable
      // on the very first attempt instead of only unlocking after a loss.
      mercenaryProgress: { missionId: 1, lossCount: 0, loadout: {} },
      beastCompanionPool: [],
      selectedBeastCompanionId: null,
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

  /**
   * Restores a campaign from a client-uploaded save file. Always mints a brand-new campaign code — the server
   * may have no record of whatever code the save was originally created under (e.g. an in-memory store that's
   * been restarted, or a save being moved to a different deployment entirely), so this creates a fresh row
   * seeded with the save's contents rather than trying to overwrite an existing one.
   */
  async createLegacyCampaignFromSave(hostName: string, save: LegacySavePayload): Promise<{ room: Room; player: RoomPlayer } | { error: string }> {
    if (!Array.isArray(save.party) || save.party.length === 0) return { error: 'Save file has no party — it looks corrupted.' };
    if (!Array.isArray(save.missionsCompleted)) return { error: 'Save file is missing its mission history.' };
    if (typeof save.currentMission !== 'number' || save.currentMission < 1) return { error: 'Save file has an invalid current mission.' };
    // Deliberately not validated against getMission: a currentMission that isn't built yet is a normal state for
    // a campaign ahead of the currently-shipped mission list (missions can land out of id order across parallel
    // sessions, e.g. 9 merging before 8), not evidence of a corrupted save.

    const campaignCode = await generateUniqueCampaignCode(this.campaignStore);
    const legacy: LegacyRoomData = {
      campaignCode,
      party: save.party,
      missionsCompleted: save.missionsCompleted,
      currentMission: save.currentMission,
      permanentRules: Array.isArray(save.permanentRules) ? save.permanentRules : [],
      // Older save files predate this field — a fresh mission carries no stale loss/coin progress either way.
      mercenaryProgress: save.mercenaryProgress ?? null,
      // Older save files predate the Beast Companion pool too — an empty pool/no selection is the correct default,
      // not data loss, since a campaign that never reached Mission 4 (or predates this feature) never had one.
      beastCompanionPool: Array.isArray(save.beastCompanionPool) ? save.beastCompanionPool : [],
      selectedBeastCompanionId: save.selectedBeastCompanionId ?? null,
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
      mercenaryProgress: record.mercenaryProgress,
      beastCompanionPool: record.beastCompanionPool,
      selectedBeastCompanionId: record.selectedBeastCompanionId,
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

  /**
   * Grants a single mission's reward (recruits, Dual-class Stickers, relics, Mission 11's sidelined-card upgrade)
   * and marks it completed. Shared by a normal win and by jumping ahead into a later mission (see
   * startLegacyMission). `restoredPartyCards` is Mission 10's "deck rehabilitation" only (see
   * GameState.restoredPartyCards) — omitted (or empty) for every other mission, and for a jumped-ahead grant where
   * no mission was actually played.
   *
   * Beast-flagged recruits (see RecruitSpec.beast) are pulled out before applyReward ever sees them — sourced
   * correction (a full solo playthrough, see tutorial_vids/summaries/mission-4.md): Mission 4's "reward" isn't 4
   * permanent recruits, it's "keep the four in a box; each mission attempt you may include one in your reserve
   * deck." They go to legacy.beastCompanionPool instead of legacy.party — a rotating pool, not a roster addition —
   * consumed by startLegacyMission/setBeastCompanionSelection. Data-driven, not Mission-4-specific: any future
   * mission's beast-flagged recruits would route the same way.
   */
  private grantMissionReward(
    legacy: LegacyRoomData,
    mission: NonNullable<ReturnType<typeof getMission>>,
    restoredPartyCards: Card[] = [],
  ): void {
    const beastRecruits = mission.reward.recruits.filter((r) => r.beast);
    const nonBeastReward = beastRecruits.length > 0 ? { ...mission.reward, recruits: mission.reward.recruits.filter((r) => !r.beast) } : mission.reward;
    legacy.party = applyReward(legacy.party, nonBeastReward);
    legacy.party = applyRestoredPartyCards(legacy.party, restoredPartyCards);
    if (beastRecruits.length > 0) {
      legacy.beastCompanionPool = [...legacy.beastCompanionPool, ...beastRecruits.map((r) => buildRecruitCard(r))];
    }
    if (mission.reward.relics?.length) {
      legacy.permanentRules = [...legacy.permanentRules, ...mission.reward.relics];
    }
    if (!legacy.missionsCompleted.includes(mission.id)) {
      legacy.missionsCompleted = [...legacy.missionsCompleted, mission.id];
    }
  }

  /**
   * `stopForPendingChoices` (default false, preserving every existing caller's one-shot jump-and-start behavior
   * — see below): the client sets this when the host clicks "Jump to Mission N" from CampaignLobbyPage.
   */
  startLegacyMission(
    code: string,
    requestingPlayerId: string,
    missionId: number,
    opts: { stopForPendingChoices?: boolean } = {},
  ): { room: Room } | { error: string } {
    const room = this.getRoom(code);
    if (!room || !room.legacy) return { error: 'Campaign not found.' };
    if (room.hostPlayerId !== requestingPlayerId) return { error: 'Only the host can start the mission.' };
    if (room.playerOrder.length < 1) return { error: 'Need at least 1 player.' };
    // Checked against getMission directly (not MISSIONS.length) since ids aren't guaranteed contiguous — a
    // mission built out of order in a parallel session (e.g. 9 landing before 8) leaves a gap in the array.
    const mission = getMission(missionId);
    if (!mission) return { error: `Mission ${missionId} isn't built yet.` };

    // Jumping ahead of the campaign's current mission (any mission in the list is unlocked for direct play):
    // grant every skipped mission's reward first, as if it had been won normally, so the party arrives at
    // full strength.
    if (missionId > room.legacy.currentMission) {
      // BUG FIX: a skipped mission can grant an interactive reward choice — Mission 4's Beast Companion pool
      // pick (BeastCompanionPicker), Mission 5's Reaver sticker pick (ReaverStickerPicker), or Mission 6's
      // Guardian sticker pick (GuardianStickerPicker) — all of which only ever render on CampaignLobbyPage.
      // Granting the reward and starting the target mission in this same call
      // used to fuse those two steps atomically, so the client never got routed back through the lobby screen to
      // show the picker before gameplay began (the pool/choice was still there server-side, just unreachable
      // until the party happened to return to the lobby after finishing the jumped-to mission).
      //
      // Gated behind `stopForPendingChoices` (only the live client UI sets it) rather than made unconditional:
      // plenty of existing, deliberate test coverage calls this one-shot-jump-and-start in a single call (see
      // legacy.integration.test.ts's mission 8/10/11 jump tests) and asserts gameState is already IN_PROGRESS by
      // the time it returns — flipping this on for every caller would silently break all of those. So: if any
      // skipped mission introduces one of these choices AND the caller asked to stop for them, stop here —
      // advance currentMission and return the updated room (still in LOBBY) without dispatching
      // START_LEGACY_MISSION, so the host sees the lobby refresh with the picker(s) available and its "Jump to
      // Mission N" button turn into "Begin Mission N" (see CampaignLobbyPage's isCurrent/isSelected derivation) —
      // a second click, now with currentMission already caught up, actually starts the mission below.
      let introducesInteractiveChoice = false;
      for (let id = room.legacy.currentMission; id < missionId; id++) {
        const skipped = getMission(id);
        if (skipped) {
          this.grantMissionReward(room.legacy, skipped);
          if (
            skipped.reward.recruits.some((r) => r.beast) ||
            skipped.reward.reaverStickerChoice ||
            skipped.reward.guardianStickerChoice ||
            skipped.reward.druidStickerChoice ||
            skipped.reward.chanterStickerChoice
          )
            introducesInteractiveChoice = true;
        }
      }
      room.legacy.currentMission = missionId;
      // Re-point the mercenary tracker at the destination as soon as currentMission moves, not later at the
      // mission-start step below: CampaignLobbyPage only renders the Mercenary Camp while
      // mercenaryProgress.missionId === currentMission, so leaving it on the old mission makes the camp vanish
      // from the lobby for the whole stop-for-choices pause — exactly when the party is standing there deciding
      // what to bring. Carries the equipped loadout across (see repointMercenaryProgress).
      room.legacy.mercenaryProgress = repointMercenaryProgress(room.legacy.mercenaryProgress, missionId);
      if (opts.stopForPendingChoices && introducesInteractiveChoice) return { room };
    }

    // Mercenary loadout (see shared/legacy/mercenaries.ts): a different mission than whatever mercenaryProgress
    // was tracking means its loss streak is over one way or another (won, skipped past, or simply abandoned for
    // another mission) — coins never carry across missions, so clear it. Otherwise carry the equipped loadout
    // (already coin-budget-validated when it was set, see setMercenaryLoadout) into this attempt's deck.
    if (room.legacy.mercenaryProgress?.missionId !== missionId) {
      // Easy-mode call (see createLegacyCampaign): a fresh 0-loss tracker for THIS mission, not null, so its
      // +15-coin bonus is available right away instead of only after a loss. The equipped loadout rides across
      // with it (see repointMercenaryProgress) instead of being silently discarded.
      room.legacy.mercenaryProgress = repointMercenaryProgress(room.legacy.mercenaryProgress, missionId);
    }
    const built = buildMercenaryLoadout(room.legacy.mercenaryProgress.loadout, mercenaryCoinsForLosses(room.legacy.mercenaryProgress.lossCount));
    // A stored loadout was already validated when set — a re-validation failure here would mean the catalog
    // itself changed underneath a persisted campaign, not a real user-facing error. Fall back to no mercenaries
    // rather than blocking the mission from starting at all.
    const mercenaryCards: Card[] = Array.isArray(built) ? built : [];

    // Mission-specific sideline: pull `sidelineCount` random members out of the reserve deck for this fight only
    // — the campaign's persisted roster (room.legacy.party) is untouched, so they're back next mission.
    let missionParty = room.legacy.party;
    if (mission.sidelineCount) {
      const shuffled = [...missionParty].sort(() => Math.random() - 0.5);
      const sidelinedIds = new Set(shuffled.slice(0, mission.sidelineCount).map((c) => c.id));
      missionParty = missionParty.filter((c) => !sidelinedIds.has(c.id));
    }
    // Mission 11's own sideline: a specific card by identity (Esme, 6 of Clubs), not a random pick — same
    // "sits out, comes back automatically" shape as sidelineCount above (see missions.ts's Mission 11
    // sidelineIdentity / reward.upgradeSidelinedCard).
    if (mission.sidelineIdentity) {
      const { suit, rank } = mission.sidelineIdentity;
      missionParty = missionParty.filter((c) => !(c.kind === 'suited' && c.suit === suit && c.rank === rank));
    }
    // High Arcana (Mission 1's own reward recruit) is Mission 12's final boss and never a playable party card in
    // between — same filter shape as sidelineIdentity above, just its own flag since Mission 11 already uses
    // sidelineIdentity for Esme (see missions.ts's MissionDef.sidelineHighArcana).
    if (mission.sidelineHighArcana) {
      missionParty = missionParty.filter((c) => !(c.kind === 'suited' && c.suit === 'D' && c.rank === '25'));
    }

    // Beast Companion pool (Mission 4's reward, sourced — see tutorial_vids/summaries/mission-4.md): Mission 11's
    // own beastDeckMechanic needs all 4 at once for its finale mechanic (buildBeastDeck only ever scans `party` —
    // see engine.ts's startLegacyMission), overriding the normal "pick one per attempt" restriction below. Every
    // other mission instead folds in just the ONE selected card (if any) as an extra reserve card, same
    // not-a-permanent-party-member treatment mercenaries get — the rest of the pool sits out this attempt.
    const beastCompanionPool = room.legacy.beastCompanionPool;
    const selectedBeastCompanionId = room.legacy.selectedBeastCompanionId;
    if (mission.beastDeckMechanic) {
      missionParty = [...missionParty, ...beastCompanionPool];
    }
    const selectedBeastCard = mission.beastDeckMechanic ? undefined : beastCompanionPool.find((c) => c.id === selectedBeastCompanionId);
    const extraExtras = selectedBeastCard ? [...mercenaryCards, selectedBeastCard] : mercenaryCards;

    const playerNames = room.playerOrder.map((id) => room.players.get(id)!.name);
    const result = applyAction(room.gameState, {
      type: 'START_LEGACY_MISSION',
      playerIds: room.playerOrder,
      playerNames,
      seed: `${code}-${Date.now()}`,
      party: missionParty,
      enemies: mission.standardCastle ? [] : missionEnemiesToSpecs(mission.enemies),
      jesterCount: LEGACY_JESTER_COUNT,
      standardCastle: mission.standardCastle,
      exactKillOnly: mission.exactKillOnly,
      endOfTurnZoneFlip: mission.endOfTurnZoneFlip,
      standingJesters: mission.standingJesters,
      discardTopBuffsAttack: mission.discardTopBuffsAttack,
      exactKillToReserveDeck: mission.exactKillToReserveDeck,
      discardCleanupLowToHigh: mission.discardCleanupLowToHigh,
      exactKillSplashDamage: mission.exactKillSplashDamage,
      presetMissionZone: mission.presetMissionZone,
      rollingZoneBonus: mission.rollingZoneBonus,
      presetBanishPile: mission.presetBanishPile,
      zoneVengeanceOnKill: mission.zoneVengeanceOnKill,
      pilgrimMechanic: mission.pilgrimMechanic,
      pilgrimCards: mission.pilgrimCards,
      ascendingZone: mission.ascendingZone,
      capturedPilesActive: mission.capturedPilesActive,
      extraReserveCards: extraExtras.length > 0 ? [...(mission.extraReserveCards ?? []), ...extraExtras] : mission.extraReserveCards,
      corruptedPartyEnemies: mission.corruptedPartyEnemies,
      startOfTurnZoneFlip: mission.startOfTurnZoneFlip,
      beastDeckMechanic: mission.beastDeckMechanic,
      pileTopEnemyBonus: mission.pileTopEnemyBonus,
      restoredCardMechanic: mission.restoredCardMechanic,
      randomizeEnemyOrder: mission.randomizeEnemyOrder,
      randomizeEnemyTierOrder: mission.randomizeEnemyTierOrder,
      relics: room.legacy.permanentRules,
      startingCorruptedRelics: mission.startingCorruptedRelics,
    });
    if (!result.ok) return { error: result.error };
    room.gameState = result.state;
    return { room };
  }

  /**
   * Applies a mission's outcome to the campaign: on a win, grants the reward, advances, and clears any mercenary
   * progress (coins never carry to the next mission). On a loss, the party/mission pointer are untouched (the
   * group can retry) but a loss now DOES persist — it's the sourced mercenary mechanic's whole trigger (see
   * shared/legacy/mercenaries.ts): increments this mission's loss streak, from which the next attempt's coin
   * budget is derived (mercenaryCoinsForLosses). Previously "on loss, nothing to persist" was correct; it no
   * longer is, now that a loss is itself progress worth remembering.
   */
  private async completeLegacyMission(room: Room, outcome: 'won' | 'lost'): Promise<void> {
    const legacy = room.legacy!;
    const missionId = legacy.currentMission;
    if (outcome === 'won') {
      const mission = getMission(missionId);
      if (mission) {
        this.grantMissionReward(legacy, mission, room.gameState.restoredPartyCards);
        legacy.currentMission = missionId + 1;
      }
      // Easy-mode call (see createLegacyCampaign): the new mission gets a fresh 0-loss tracker, not null, so its
      // own +15-coin bonus is available right away rather than only after a loss.
      legacy.mercenaryProgress = { missionId: legacy.currentMission, lossCount: 0, loadout: {} };
    } else {
      const priorLosses = legacy.mercenaryProgress?.missionId === missionId ? legacy.mercenaryProgress.lossCount : 0;
      const priorLoadout = legacy.mercenaryProgress?.missionId === missionId ? legacy.mercenaryProgress.loadout : {};
      legacy.mercenaryProgress = { missionId, lossCount: priorLosses + 1, loadout: priorLoadout };
    }
    await this.campaignStore.save(toRecord(room));
  }

  /**
   * Sets the party's mercenary loadout for the mission mercenaryProgress is currently tracking a loss streak on
   * (see startLegacyMission, which consumes this at the next attempt). Re-validates the FULL loadout against the
   * mission's current coin budget every time — a free re-pick each call, not an incremental add/swap (see the
   * sourced "budget ceiling" framing in mercenaryCoinsForLosses's doc).
   */
  async setMercenaryLoadout(
    code: string,
    requestingPlayerId: string,
    loadout: Partial<Record<MercenaryTypeId, number>>,
  ): Promise<{ room: Room } | { error: string }> {
    const room = this.getRoom(code);
    if (!room || !room.legacy) return { error: 'Campaign not found.' };
    if (room.hostPlayerId !== requestingPlayerId) return { error: 'Only the host can set the mercenary loadout.' };
    const progress = room.legacy.mercenaryProgress;
    if (!progress) return { error: 'No mercenaries are available right now — that mission has no loss streak.' };
    const validated = buildMercenaryLoadout(loadout, mercenaryCoinsForLosses(progress.lossCount));
    if (!Array.isArray(validated)) return { error: validated.error };
    progress.loadout = loadout;
    await this.campaignStore.save(toRecord(room));
    return { room };
  }

  /**
   * Sets which one card (by id, or null for none) from beastCompanionPool rides along into the next mission
   * attempt (see startLegacyMission) — sourced Mission 4 mechanic (tutorial_vids/summaries/mission-4.md's "keep
   * the four in a box; each mission attempt you may include one in your reserve deck"). Sticky across missions,
   * unlike mercenaryProgress's loadout, since there's no per-mission budget to re-validate — just pick one, or
   * change your mind any time from the lobby.
   */
  async setBeastCompanionSelection(code: string, requestingPlayerId: string, cardId: string | null): Promise<{ room: Room } | { error: string }> {
    const room = this.getRoom(code);
    if (!room || !room.legacy) return { error: 'Campaign not found.' };
    if (room.hostPlayerId !== requestingPlayerId) return { error: 'Only the host can choose the Beast Companion.' };
    if (cardId !== null && !room.legacy.beastCompanionPool.some((c) => c.id === cardId)) {
      return { error: 'That card is not in the Beast Companion pool.' };
    }
    room.legacy.selectedBeastCompanionId = cardId;
    await this.campaignStore.save(toRecord(room));
    return { room };
  }

  /**
   * Resolves Mission 5's player-chosen Reaver-sticker reward (see MissionReward.reaverStickerChoice's doc):
   * permanently gives `cardId` a bonus Reaver sticker. Unlike the Mage/Guardian stickers elsewhere (auto-applied,
   * random, inside applyReward), this one needs the player's own pick, so there's no dedicated pending-state
   * field to check here — "is this still available" is derived the same way the client derives it (see
   * CampaignLobbyPage): has any completed mission's reward set reaverStickerChoice, and does no party card carry
   * the sticker yet. `cardId` is re-validated against reaverStickerEligible here regardless of what the client
   * already filtered for, same as every other player-submitted id in this file.
   */
  async chooseReaverSticker(code: string, requestingPlayerId: string, cardId: string): Promise<{ room: Room } | { error: string }> {
    const room = this.getRoom(code);
    if (!room || !room.legacy) return { error: 'Campaign not found.' };
    if (room.hostPlayerId !== requestingPlayerId) return { error: 'Only the host can choose the Reaver sticker.' };
    if (room.legacy.party.some((c) => c.kind === 'suited' && c.secondClassReaver)) {
      return { error: 'The Reaver sticker has already been used.' };
    }
    const target = room.legacy.party.find((c) => c.id === cardId);
    if (!target || !reaverStickerEligible(target)) {
      return { error: 'That card is not eligible for the Reaver sticker.' };
    }
    room.legacy.party = applyReaverStickerChoice(room.legacy.party, cardId);
    await this.campaignStore.save(toRecord(room));
    return { room };
  }

  /**
   * Resolves Mission 6's player-chosen Guardian-sticker reward (see MissionReward.guardianStickerChoice's doc):
   * permanently gives `cardId` a bonus Guardian sticker. Mirrors chooseReaverSticker exactly, just for rank-8
   * cards and `secondClassGuardian` instead of rank-6/`secondClassReaver` — see that method's own doc comment for
   * why there's no dedicated pending-state field here either.
   */
  async chooseGuardianSticker(code: string, requestingPlayerId: string, cardId: string): Promise<{ room: Room } | { error: string }> {
    const room = this.getRoom(code);
    if (!room || !room.legacy) return { error: 'Campaign not found.' };
    if (room.hostPlayerId !== requestingPlayerId) return { error: 'Only the host can choose the Guardian sticker.' };
    if (room.legacy.party.some((c) => c.kind === 'suited' && c.secondClassGuardian)) {
      return { error: 'The Guardian sticker has already been used.' };
    }
    const target = room.legacy.party.find((c) => c.id === cardId);
    if (!target || !guardianStickerEligible(target)) {
      return { error: 'That card is not eligible for the Guardian sticker.' };
    }
    room.legacy.party = applyGuardianStickerChoice(room.legacy.party, cardId);
    await this.campaignStore.save(toRecord(room));
    return { room };
  }

  /**
   * Resolves Mission 7's player-chosen Druid-sticker reward (see MissionReward.druidStickerChoice's doc):
   * permanently gives `cardId` a bonus Druid sticker. Mirrors chooseGuardianSticker exactly, just for the
   * 4♦/4♣/4♠ and `secondClassDruid` instead of rank-8/`secondClassGuardian`.
   */
  async chooseDruidSticker(code: string, requestingPlayerId: string, cardId: string): Promise<{ room: Room } | { error: string }> {
    const room = this.getRoom(code);
    if (!room || !room.legacy) return { error: 'Campaign not found.' };
    if (room.hostPlayerId !== requestingPlayerId) return { error: 'Only the host can choose the Druid sticker.' };
    if (room.legacy.party.some((c) => c.kind === 'suited' && c.secondClassDruid)) {
      return { error: 'The Druid sticker has already been used.' };
    }
    const target = room.legacy.party.find((c) => c.id === cardId);
    if (!target || !druidStickerEligible(target)) {
      return { error: 'That card is not eligible for the Druid sticker.' };
    }
    room.legacy.party = applyDruidStickerChoice(room.legacy.party, cardId);
    await this.campaignStore.save(toRecord(room));
    return { room };
  }

  /**
   * Resolves Mission 8's player-chosen Chanter-sticker reward (see MissionReward.chanterStickerChoice's doc):
   * permanently gives `cardId` a bonus Chanter sticker. Mirrors chooseDruidSticker exactly, just for rank-2
   * non-Bard cards and `secondClassChanter` instead of the 4♦/4♣/4♠/`secondClassDruid`.
   */
  async chooseChanterSticker(code: string, requestingPlayerId: string, cardId: string): Promise<{ room: Room } | { error: string }> {
    const room = this.getRoom(code);
    if (!room || !room.legacy) return { error: 'Campaign not found.' };
    if (room.hostPlayerId !== requestingPlayerId) return { error: 'Only the host can choose the Chanter sticker.' };
    if (room.legacy.party.some((c) => c.kind === 'suited' && c.secondClassChanter)) {
      return { error: 'The Chanter sticker has already been used.' };
    }
    const target = room.legacy.party.find((c) => c.id === cardId);
    if (!target || !chanterStickerEligible(target)) {
      return { error: 'That card is not eligible for the Chanter sticker.' };
    }
    room.legacy.party = applyChanterStickerChoice(room.legacy.party, cardId);
    await this.campaignStore.save(toRecord(room));
    return { room };
  }
}
