import type { SuitedCard } from '@regicide/shared';
import type { Pool } from 'pg';
import { generateRoomCode } from '../rooms/roomCode.js';

export interface EndlessSaveRecord {
  code: string;
  /** The 52 suited cards as they stood when this round was won (tier bumps included) — no jesters, see RoomManager's checkpointEndlessSave. */
  deck: SuitedCard[];
  /** The Endless round this save last won (see engine.ts's ENDLESS_MODE_MAX_LOOP). Resuming continues into endlessLoop + 1. */
  endlessLoop: number;
  updatedAt: number;
}

/**
 * Durable Endless Mode save storage — touched only at round boundaries (every WON in classic Regicide, see
 * RoomManager.checkpointEndlessSave), never per-turn, same tradeoff as CampaignStore.
 */
export interface EndlessSaveStore {
  get(code: string): Promise<EndlessSaveRecord | null>;
  create(record: EndlessSaveRecord): Promise<void>;
  save(record: EndlessSaveRecord): Promise<void>;
  codeExists(code: string): Promise<boolean>;
}

/** Generates a fresh, unused save code (6 chars — longer than the ephemeral 4-char room code, since these persist indefinitely). */
export async function generateUniqueEndlessSaveCode(store: EndlessSaveStore): Promise<string> {
  let code = generateRoomCode(6);
  while (await store.codeExists(code)) {
    code = generateRoomCode(6);
  }
  return code;
}

/** In-memory implementation — used in tests and as a fallback when no DATABASE_URL is configured. */
export class InMemoryEndlessSaveStore implements EndlessSaveStore {
  private records = new Map<string, EndlessSaveRecord>();

  async get(code: string): Promise<EndlessSaveRecord | null> {
    return this.records.get(code.toUpperCase()) ?? null;
  }

  async create(record: EndlessSaveRecord): Promise<void> {
    this.records.set(record.code.toUpperCase(), record);
  }

  async save(record: EndlessSaveRecord): Promise<void> {
    this.records.set(record.code.toUpperCase(), { ...record, updatedAt: Date.now() });
  }

  async codeExists(code: string): Promise<boolean> {
    return this.records.has(code.toUpperCase());
  }
}

/** Postgres implementation (one `endless_saves` table — see packages/server/schema.sql). */
export class PostgresEndlessSaveStore implements EndlessSaveStore {
  constructor(private pool: Pool) {}

  async get(code: string): Promise<EndlessSaveRecord | null> {
    const res = await this.pool.query(
      `SELECT code, deck, endless_loop, extract(epoch from updated_at) * 1000 AS updated_at_ms
       FROM endless_saves WHERE code = $1`,
      [code.toUpperCase()],
    );
    if (res.rowCount === 0) return null;
    const row = res.rows[0];
    return {
      code: row.code,
      deck: row.deck,
      endlessLoop: row.endless_loop,
      updatedAt: Number(row.updated_at_ms),
    };
  }

  async create(record: EndlessSaveRecord): Promise<void> {
    await this.pool.query(`INSERT INTO endless_saves (code, deck, endless_loop) VALUES ($1, $2, $3)`, [
      record.code.toUpperCase(),
      JSON.stringify(record.deck),
      record.endlessLoop,
    ]);
  }

  async save(record: EndlessSaveRecord): Promise<void> {
    await this.pool.query(`UPDATE endless_saves SET deck = $2, endless_loop = $3, updated_at = now() WHERE code = $1`, [
      record.code.toUpperCase(),
      JSON.stringify(record.deck),
      record.endlessLoop,
    ]);
  }

  async codeExists(code: string): Promise<boolean> {
    const res = await this.pool.query(`SELECT 1 FROM endless_saves WHERE code = $1`, [code.toUpperCase()]);
    return (res.rowCount ?? 0) > 0;
  }
}
