import type { Card, ClientGameState, GameAction } from './game/types.js';
import type { MercenaryProgress, MercenaryTypeId } from './legacy/mercenaries.js';

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

export interface LegacyStatePayload {
  campaignCode: string;
  party: Card[];
  missionsCompleted: number[];
  currentMission: number;
  permanentRules: string[];
  mercenaryProgress: MercenaryProgress | null;
  /** Mission 4's Beast Companion reward, sourced (see tutorial_vids/summaries/mission-4.md): a rotating pool of 4 companion cards, kept separate from `party` — see RoomManager's setBeastCompanionSelection. */
  beastCompanionPool: Card[];
  /** Which one card (by id) from `beastCompanionPool`, if any, rides along into the next mission attempt. */
  selectedBeastCompanionId: string | null;
}

/** The portable, downloadable shape of a Legacy campaign's progress — same fields as LegacyStatePayload minus the server-assigned code, since restoring a save always mints a fresh one. */
export interface LegacySavePayload {
  party: Card[];
  missionsCompleted: number[];
  currentMission: number;
  permanentRules: string[];
  /** Optional so a save file exported before this field existed still restores cleanly (see RoomManager's createLegacyCampaignFromSave). */
  mercenaryProgress?: MercenaryProgress | null;
  /** Optional for the same reason as mercenaryProgress above — older save files predate the Beast Companion pool. */
  beastCompanionPool?: Card[];
  selectedBeastCompanionId?: string | null;
}

/**
 * Classic Regicide's durable Endless Mode save — mirrors LegacyStatePayload's role, but with just a code and the
 * round reached (the deck itself, with its per-card tier bumps, stays server-side; the client never needs it
 * before RESUME_ENDLESS_SAVE deals it out). Checkpointed at every WON, same boundary Legacy checkpoints at.
 */
export interface EndlessStatePayload {
  saveCode: string;
  endlessLoop: number;
}

// Client -> server
export interface ClientToServerEvents {
  'room:create': (payload: { name: string }, cb: (res: { ok: true; code: string; playerToken: string; playerId: string } | { ok: false; error: string }) => void) => void;
  'room:join': (payload: { code: string; name: string }, cb: (res: { ok: true; playerToken: string; playerId: string } | { ok: false; error: string }) => void) => void;
  'room:rejoin': (payload: { code: string; playerToken: string }, cb: (res: { ok: true } | { ok: false; error: string }) => void) => void;
  'room:start': (payload: { code: string }, cb: (res: { ok: true } | { ok: false; error: string }) => void) => void;
  'room:restart': (payload: { code: string }, cb: (res: { ok: true } | { ok: false; error: string }) => void) => void;
  'game:action': (payload: { code: string; action: GameAction }, cb: (res: { ok: true } | { ok: false; error: string }) => void) => void;
  'legacy:create': (payload: { name: string }, cb: (res: { ok: true; code: string; playerToken: string; playerId: string } | { ok: false; error: string }) => void) => void;
  'legacy:resume': (payload: { code: string; name: string }, cb: (res: { ok: true; code: string; playerToken: string; playerId: string } | { ok: false; error: string }) => void) => void;
  /** Restores a campaign from a downloaded save file, minting a brand-new campaign code (never reuses the old one — the server may have no record of it, e.g. a restart with no database configured). */
  'legacy:restore': (payload: { name: string; save: LegacySavePayload }, cb: (res: { ok: true; code: string; playerToken: string; playerId: string } | { ok: false; error: string }) => void) => void;
  /** `stopForPendingChoices`: when jumping ahead crosses a mission granting an interactive reward pick (Mission 4's Beast Companion, Mission 5's Reaver sticker), stop after granting rewards instead of starting the target mission immediately, so the host can resolve the pick on CampaignLobbyPage first (see RoomManager.startLegacyMission). Defaults to false (starts immediately) when omitted. */
  'legacy:startMission': (payload: { code: string; missionId: number; stopForPendingChoices?: boolean }, cb: (res: { ok: true } | { ok: false; error: string }) => void) => void;
  /** Legacy-only sourced mechanic (see legacy/mercenaries.ts): sets the FULL mercenary loadout for whatever mission legacy:state's mercenaryProgress is currently tracking a loss streak on — a free re-pick each call (validated against the mission's current coin budget), not an incremental add/swap. */
  'legacy:setMercenaryLoadout': (payload: { code: string; loadout: Partial<Record<MercenaryTypeId, number>> }, cb: (res: { ok: true } | { ok: false; error: string }) => void) => void;
  /** Sourced Mission 4 mechanic (see tutorial_vids/summaries/mission-4.md): picks one card (by id, or null to bring none) from legacy:state's beastCompanionPool to ride along into the next mission attempt's reserve deck. */
  'legacy:setBeastCompanionSelection': (payload: { code: string; cardId: string | null }, cb: (res: { ok: true } | { ok: false; error: string }) => void) => void;
  /** Mission 5's reward, sourced fix (see legacy/party.ts's MissionReward.reaverStickerChoice): permanently gives the named existing party card a bonus Reaver sticker — validated server-side against reaverStickerEligible, not trusted from the client. */
  'legacy:chooseReaverSticker': (payload: { code: string; cardId: string }, cb: (res: { ok: true } | { ok: false; error: string }) => void) => void;
  /** Mission 6's reward, confirmed live (see legacy/party.ts's MissionReward.guardianStickerChoice): permanently gives the named existing party card a bonus Guardian sticker — validated server-side against guardianStickerEligible, not trusted from the client. */
  'legacy:chooseGuardianSticker': (payload: { code: string; cardId: string }, cb: (res: { ok: true } | { ok: false; error: string }) => void) => void;
  /** Loads a durable Endless Mode save by code, same shape as legacy:resume — joins the in-memory room if it's still in its post-load lobby, otherwise fetches it from storage and starts a fresh one. The host then fires room:start to actually deal into the next round (RESUME_ENDLESS_SAVE). */
  'endless:load': (payload: { code: string; name: string }, cb: (res: { ok: true; code: string; playerToken: string; playerId: string } | { ok: false; error: string }) => void) => void;
}

// Server -> client
export interface ServerToClientEvents {
  'room:state': (payload: RoomStatePayload) => void;
  'game:state': (payload: ClientGameState) => void;
  'legacy:state': (payload: LegacyStatePayload) => void;
  'endless:state': (payload: EndlessStatePayload) => void;
  error: (payload: { message: string }) => void;
}
