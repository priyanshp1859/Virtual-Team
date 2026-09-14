-- Runtime records are separate from the earlier local/sample workspace model.
CREATE TABLE IF NOT EXISTS virtual_team_runs (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS virtual_team_worker (
  id text PRIMARY KEY CHECK (id = 'sam'),
  instance_id uuid NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('online', 'offline'))
);
