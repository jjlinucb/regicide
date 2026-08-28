-- Regicide Legacy campaign persistence. Run this once against your Postgres database
-- (e.g. a free Supabase project) before setting DATABASE_URL. Safe to re-run against an
-- existing database too (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS throughout) to pick up
-- later columns, like mercenary_progress below.
CREATE TABLE IF NOT EXISTS campaigns (
  code TEXT PRIMARY KEY,
  party JSONB NOT NULL,
  missions_completed INT[] NOT NULL DEFAULT '{}',
  current_mission INT NOT NULL DEFAULT 1,
  permanent_rules JSONB NOT NULL DEFAULT '[]',
  mercenary_progress JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mercenary loss/coin tracking (see shared/legacy/mercenaries.ts) — added after the table above already
-- shipped; this backfills existing databases created before this column existed.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS mercenary_progress JSONB;

-- Mission 4's Beast Companion reward (see RoomManager's grantMissionReward/setBeastCompanionSelection): the 4
-- beast-flagged recruits live in their own pool, separate from the persisted party, rather than as permanent
-- recruits — sourced from a full solo playthrough (see tutorial_vids/summaries/mission-4.md), the reward is "keep
-- the four in a box; each mission attempt you may include one in your reserve deck," not four permanent recruits.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS beast_companion_pool JSONB NOT NULL DEFAULT '[]';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS selected_beast_companion_id TEXT;

-- Classic Regicide's durable Endless Mode saves (see server/src/db/endlessSaves.ts). Checkpointed at every WON,
-- the same round-boundary tradeoff as campaigns above — a live in-progress round lost to a server restart just
-- means replaying that round.
CREATE TABLE IF NOT EXISTS endless_saves (
  code TEXT PRIMARY KEY,
  deck JSONB NOT NULL,
  endless_loop INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
