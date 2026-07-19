-- Regicide Legacy campaign persistence. Run this once against your Postgres database
-- (e.g. a free Supabase project) before setting DATABASE_URL.
CREATE TABLE IF NOT EXISTS campaigns (
  code TEXT PRIMARY KEY,
  party JSONB NOT NULL,
  missions_completed INT[] NOT NULL DEFAULT '{}',
  current_mission INT NOT NULL DEFAULT 1,
  permanent_rules JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
