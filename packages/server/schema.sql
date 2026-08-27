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
