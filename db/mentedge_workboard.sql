CREATE SCHEMA IF NOT EXISTS mentedge;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS mentedge.workboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  internship_id UUID NOT NULL REFERENCES mentedge.internships(id) ON DELETE CASCADE,
  domain_name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES mentedge.mentors(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workboards_domain_fk
    FOREIGN KEY (internship_id, domain_name)
    REFERENCES mentedge.internship_domains (internship_id, domain_name)
    ON DELETE CASCADE,
  CONSTRAINT workboards_domain_unique UNIQUE (internship_id, domain_name)
);

CREATE TABLE IF NOT EXISTS mentedge.milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workboard_id UUID NOT NULL REFERENCES mentedge.workboards(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  start_date DATE,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'planned',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT milestones_status_check CHECK (
    status IN ('planned', 'active', 'completed', 'archived')
  )
);

CREATE TABLE IF NOT EXISTS mentedge.concepts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID NOT NULL REFERENCES mentedge.milestones(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT concepts_status_check CHECK (
    status IN ('draft', 'published', 'archived')
  )
);

CREATE TABLE IF NOT EXISTS mentedge.concept_progress (
  concept_id UUID NOT NULL REFERENCES mentedge.concepts(id) ON DELETE CASCADE,
  intern_id UUID NOT NULL REFERENCES mentedge.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_started',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (concept_id, intern_id),
  CONSTRAINT concept_progress_status_check CHECK (
    status IN ('not_started', 'in_progress', 'completed')
  )
);

CREATE TABLE IF NOT EXISTS mentedge.concept_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id UUID NOT NULL REFERENCES mentedge.concepts(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_name TEXT,
  file_type TEXT,
  uploaded_by_user_id UUID REFERENCES mentedge.users(id) ON DELETE SET NULL,
  uploaded_by_mentor_id UUID REFERENCES mentedge.mentors(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT concept_files_uploader_check CHECK (
    (uploaded_by_user_id IS NOT NULL)::INT + (uploaded_by_mentor_id IS NOT NULL)::INT = 1
  )
);

CREATE TABLE IF NOT EXISTS mentedge.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID NOT NULL REFERENCES mentedge.milestones(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  assigned_to UUID REFERENCES mentedge.users(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES mentedge.mentors(id) ON DELETE CASCADE,
  due_date DATE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tasks_status_check CHECK (
    status IN ('todo', 'in_progress', 'blocked', 'done')
  )
);

CREATE TABLE IF NOT EXISTS mentedge.task_progress (
  task_id UUID NOT NULL REFERENCES mentedge.tasks(id) ON DELETE CASCADE,
  intern_id UUID NOT NULL REFERENCES mentedge.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'todo',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, intern_id),
  CONSTRAINT task_progress_status_check CHECK (
    status IN ('todo', 'in_progress', 'blocked', 'done')
  )
);

CREATE TABLE IF NOT EXISTS mentedge.task_assignments (
  task_id UUID NOT NULL REFERENCES mentedge.tasks(id) ON DELETE CASCADE,
  intern_id UUID NOT NULL REFERENCES mentedge.users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, intern_id)
);

CREATE TABLE IF NOT EXISTS mentedge.assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID NOT NULL REFERENCES mentedge.milestones(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  max_score INTEGER NOT NULL DEFAULT 100,
  due_date DATE,
  created_by UUID NOT NULL REFERENCES mentedge.mentors(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT assignments_status_check CHECK (
    status IN ('draft', 'published', 'closed')
  )
);

CREATE TABLE IF NOT EXISTS mentedge.assignment_assignments (
  assignment_id UUID NOT NULL REFERENCES mentedge.assignments(id) ON DELETE CASCADE,
  intern_id UUID NOT NULL REFERENCES mentedge.users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (assignment_id, intern_id)
);

CREATE TABLE IF NOT EXISTS mentedge.assignment_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES mentedge.assignments(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_name TEXT,
  file_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mentedge.assignment_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES mentedge.assignments(id) ON DELETE CASCADE,
  intern_id UUID NOT NULL REFERENCES mentedge.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'submitted',
  score INTEGER,
  feedback TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  graded_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT assignment_submissions_status_check CHECK (
    status IN ('submitted', 'graded', 'returned', 'late')
  ),
  CONSTRAINT assignment_submissions_unique UNIQUE (assignment_id, intern_id)
);

CREATE TABLE IF NOT EXISTS mentedge.assignment_submission_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES mentedge.assignment_submissions(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_name TEXT,
  file_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS workboards_internship_idx
  ON mentedge.workboards (internship_id);
CREATE INDEX IF NOT EXISTS milestones_workboard_idx
  ON mentedge.milestones (workboard_id);
CREATE INDEX IF NOT EXISTS concepts_milestone_idx
  ON mentedge.concepts (milestone_id);
CREATE INDEX IF NOT EXISTS concept_progress_intern_idx
  ON mentedge.concept_progress (intern_id);
CREATE INDEX IF NOT EXISTS tasks_milestone_idx
  ON mentedge.tasks (milestone_id);
CREATE INDEX IF NOT EXISTS tasks_assigned_to_idx
  ON mentedge.tasks (assigned_to);
CREATE INDEX IF NOT EXISTS task_progress_intern_idx
  ON mentedge.task_progress (intern_id);
CREATE INDEX IF NOT EXISTS task_assignments_intern_idx
  ON mentedge.task_assignments (intern_id);
CREATE INDEX IF NOT EXISTS assignments_milestone_idx
  ON mentedge.assignments (milestone_id);
CREATE INDEX IF NOT EXISTS assignment_assignments_intern_idx
  ON mentedge.assignment_assignments (intern_id);
CREATE INDEX IF NOT EXISTS assignment_submissions_assignment_idx
  ON mentedge.assignment_submissions (assignment_id);
CREATE INDEX IF NOT EXISTS assignment_submissions_intern_idx
  ON mentedge.assignment_submissions (intern_id);
