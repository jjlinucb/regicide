import type { Card } from '@regicide/shared';
import type { Pool } from 'pg';
import { generateRoomCode } from '../rooms/roomCode.js';

export interface CampaignRecord {
  code: string;
  party: Card[];
  missionsCompleted: number[];
  currentMission: number;
  permanentRules: string[];
  updatedAt: number;
}

/**
 * Durable campaign storage — touched only at campaign creation and at mission boundaries (start/end),
 * never per-turn (an in-progress mission attempt lost to a server restart just means replaying that
 * attempt, an acceptable tradeoff already implicit in this app's free-tier hosting).
 */
export interface CampaignStore {
  get(code: string): Promise<CampaignRecord | null>;
  create(record: CampaignRecord): Promise<void>;
  save(record: CampaignRecord): Promise<void>;
  codeExists(code: string): Promise<boolean>;
}

/** Generates a fresh, unused campaign code (6 chars — longer than the ephemeral 4-char room code, since these persist indefinitely). */
export async function generateUniqueCampaignCode(store: CampaignStore): Promise<string> {
  let code = generateRoomCode(6);
  while (await store.codeExists(code)) {
    code = generateRoomCode(6);
  }
  return code;
}

/** In-memory implementation — used in tests and as a fallback when no DATABASE_URL is configured. */
export class InMemoryCampaignStore implements CampaignStore {
  private records = new Map<string, CampaignRecord>();

  async get(code: string): Promise<CampaignRecord | null> {
    return this.records.get(code.toUpperCase()) ?? null;
  }

  async create(record: CampaignRecord): Promise<void> {
    this.records.set(record.code.toUpperCase(), record);
  }

  async save(record: CampaignRecord): Promise<void> {
    this.records.set(record.code.toUpperCase(), { ...record, updatedAt: Date.now() });
  }

  async codeExists(code: string): Promise<boolean> {
    return this.records.has(code.toUpperCase());
  }
}

/** Postgres implementation (one `campaigns` table — see packages/server/schema.sql). */
export class PostgresCampaignStore implements CampaignStore {
  constructor(private pool: Pool) {}

  async get(code: string): Promise<CampaignRecord | null> {
    const res = await this.pool.query(
      `SELECT code, party, missions_completed, current_mission, permanent_rules,
              extract(epoch from updated_at) * 1000 AS updated_at_ms
       FROM campaigns WHERE code = $1`,
      [code.toUpperCase()],
    );
    if (res.rowCount === 0) return null;
    const row = res.rows[0];
    return {
      code: row.code,
      party: row.party,
      missionsCompleted: row.missions_completed,
      currentMission: row.current_mission,
      permanentRules: row.permanent_rules,
      updatedAt: Number(row.updated_at_ms),
    };
  }

  async create(record: CampaignRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO campaigns (code, party, missions_completed, current_mission, permanent_rules)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        record.code.toUpperCase(),
        JSON.stringify(record.party),
        record.missionsCompleted,
        record.currentMission,
        JSON.stringify(record.permanentRules),
      ],
    );
  }

  async save(record: CampaignRecord): Promise<void> {
    await this.pool.query(
      `UPDATE campaigns SET party = $2, missions_completed = $3, current_mission = $4, permanent_rules = $5, updated_at = now()
       WHERE code = $1`,
      [
        record.code.toUpperCase(),
        JSON.stringify(record.party),
        record.missionsCompleted,
        record.currentMission,
        JSON.stringify(record.permanentRules),
      ],
    );
  }

  async codeExists(code: string): Promise<boolean> {
    const res = await this.pool.query(`SELECT 1 FROM campaigns WHERE code = $1`, [code.toUpperCase()]);
    return (res.rowCount ?? 0) > 0;
  }
}
