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
}

/** The portable, downloadable shape of a Legacy campaign's progress — same fields as LegacyStatePayload minus the server-assigned code, since restoring a save always mints a fresh one. */
export interface LegacySavePayload {
  party: Card[];
  missionsCompleted: number[];
  currentMission: number;
  permanentRules: string[];
  /** Optional so a save file exported before this field existed still restores cleanly (see RoomManager's createLegacyCampaignFromSave). */
  mercenaryProgress?: MercenaryProgress | null;
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
  'legacy:startMission': (payload: { code: string; missionId: number }, cb: (res: { ok: true } | { ok: false; error: string }) => void) => void;
  /** Legacy-only sourced mechanic (see legacy/mercenaries.ts): sets the FULL mercenary loadout for whatever mission legacy:state's mercenaryProgress is currently tracking a loss streak on — a free re-pick each call (validated against the mission's current coin budget), not an incremental add/swap. */
  'legacy:setMercenaryLoadout': (payload: { code: string; loadout: Partial<Record<MercenaryTypeId, number>> }, cb: (res: { ok: true } | { ok: false; error: string }) => void) => void;
}

// Server -> client
export interface ServerToClientEvents {
  'room:state': (payload: RoomStatePayload) => void;
  'game:state': (payload: ClientGameState) => void;
  'legacy:state': (payload: LegacyStatePayload) => void;
  error: (payload: { message: string }) => void;
}
