-- Additive project records; existing workspace chats/tasks/runtime remain untouched.
CREATE TABLE IF NOT EXISTS virtual_team_projects (
  id uuid PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS virtual_team_project_operations (
  operation_id uuid PRIMARY KEY,
  fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE virtual_team_worker ADD COLUMN IF NOT EXISTS capabilities text[] NOT NULL DEFAULT ARRAY['sam'];
