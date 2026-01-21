CREATE SCHEMA IF NOT EXISTS mentedge;

CREATE TABLE IF NOT EXISTS mentedge.coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  percent_off INTEGER NOT NULL CHECK (percent_off > 0 AND percent_off <= 100),
  is_active BOOLEAN NOT NULL DEFAULT true,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS coupons_code_idx
  ON mentedge.coupons (code);
