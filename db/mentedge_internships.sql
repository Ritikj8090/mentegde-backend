CREATE SCHEMA IF NOT EXISTS mentedge;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS mentedge.internships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  internship_title TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10, 2) NOT NULL DEFAULT 0,
  approval_required BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL REFERENCES mentedge.mentors(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT internships_status_check
    CHECK (status IN (
      'draft',
      'submitted',
      'rejected',
      'published',
      'pending_cohost',
      'cohost',
      'updated_by_cohost',
      'posted',
      'archived'
    ))
);

CREATE TABLE IF NOT EXISTS mentedge.internship_hosts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  internship_id UUID NOT NULL REFERENCES mentedge.internships(id) ON DELETE CASCADE,
  mentor_id UUID NOT NULL REFERENCES mentedge.mentors(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  domain TEXT NOT NULL,
  invite_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT internship_hosts_role_check CHECK (role IN ('host', 'co-host')),
  CONSTRAINT internship_hosts_domain_check CHECK (domain IN ('tech', 'management')),
  CONSTRAINT internship_hosts_invite_status_check
    CHECK (invite_status IN ('pending', 'accepted', 'rejected')),
  CONSTRAINT internship_hosts_unique UNIQUE (internship_id, mentor_id)
);

CREATE TABLE IF NOT EXISTS mentedge.internship_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  internship_id UUID NOT NULL REFERENCES mentedge.internships(id) ON DELETE CASCADE,
  domain_name TEXT NOT NULL,
  domain_title TEXT,
  domain_description TEXT,
  skills_required JSONB,
  tools_used JSONB,
  tags JSONB,
  start_date DATE,
  end_date DATE,
  application_deadline DATE,
  weekly_hours INTEGER,
  duration TEXT,
  difficulty_level TEXT,
  marketplace_category TEXT,
  max_seats INTEGER,
  join_count INTEGER NOT NULL DEFAULT 0,
  seats_left INTEGER GENERATED ALWAYS AS (
    CASE
      WHEN max_seats IS NULL THEN NULL
      ELSE GREATEST(max_seats - join_count, 0)
    END
  ) STORED,
  certificate_provided BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT internship_domains_domain_check CHECK (domain_name IN ('tech', 'management')),
  CONSTRAINT internship_domains_join_count_check CHECK (
    max_seats IS NULL OR join_count <= max_seats
  ),
  CONSTRAINT internship_domains_unique UNIQUE (internship_id, domain_name)
);

CREATE TABLE IF NOT EXISTS mentedge.internship_joined (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intern_id UUID NOT NULL REFERENCES mentedge.users(id) ON DELETE CASCADE,
  internship_id UUID NOT NULL REFERENCES mentedge.internships(id) ON DELETE CASCADE,
  domain_id UUID NOT NULL REFERENCES mentedge.internship_domains(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT internship_joined_unique UNIQUE (intern_id, domain_id)
);

CREATE TABLE IF NOT EXISTS mentedge.internship_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  internship_joined_id UUID NOT NULL REFERENCES mentedge.internship_joined(id) ON DELETE CASCADE,
  intern_id UUID NOT NULL REFERENCES mentedge.users(id) ON DELETE CASCADE,
  internship_id UUID NOT NULL REFERENCES mentedge.internships(id) ON DELETE CASCADE,
  domain_id UUID NOT NULL REFERENCES mentedge.internship_domains(id) ON DELETE CASCADE,
  amount NUMERIC(10, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'pending',
  provider TEXT,
  provider_reference TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  raw_response JSONB,
  paid_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT internship_payments_status_check
    CHECK (status IN ('pending', 'paid', 'failed', 'refunded'))
);

CREATE INDEX IF NOT EXISTS internships_created_by_idx
  ON mentedge.internships (created_by);
CREATE INDEX IF NOT EXISTS internship_hosts_internship_idx
  ON mentedge.internship_hosts (internship_id);
CREATE INDEX IF NOT EXISTS internship_domains_internship_idx
  ON mentedge.internship_domains (internship_id);
CREATE INDEX IF NOT EXISTS internship_joined_intern_idx
  ON mentedge.internship_joined (intern_id);
CREATE INDEX IF NOT EXISTS internship_joined_domain_idx
  ON mentedge.internship_joined (domain_id);
CREATE INDEX IF NOT EXISTS internship_payments_joined_idx
  ON mentedge.internship_payments (internship_joined_id);
CREATE INDEX IF NOT EXISTS internship_payments_intern_idx
  ON mentedge.internship_payments (intern_id);

CREATE OR REPLACE VIEW mentedge.internships_with_computed_status AS
SELECT
  i.*,
  i.status AS computed_status
FROM mentedge.internships i;
