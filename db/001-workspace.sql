-- Additive schema for a private, single-workspace office. No existing data is reset.
CREATE TABLE IF NOT EXISTS virtual_team_workspaces (
  id text PRIMARY KEY CHECK (id = 'default'),
  state jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(state) = 'object'),
  CHECK (state ->> 'version' = '1')
);

CREATE TABLE IF NOT EXISTS virtual_team_operations (
  workspace_id text NOT NULL REFERENCES virtual_team_workspaces (id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL,
  fingerprint text NOT NULL,
  result jsonb NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, operation_id)
);

CREATE TABLE IF NOT EXISTS virtual_team_login_attempts (
  key text PRIMARY KEY,
  attempts integer NOT NULL CHECK (attempts > 0),
  resets_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS virtual_team_login_attempts_expiry ON virtual_team_login_attempts (resets_at);
