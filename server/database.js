import { ApiError } from './errors.js';
import { EMPTY_STATE } from './workspace.js';

let cachedSql;
let cachedUrl;

export async function getDatabase(config) {
  if (!cachedSql || cachedUrl !== config.databaseUrl) {
    const { default: postgres } = await import('postgres');
    cachedSql = postgres(config.databaseUrl, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      connection: { application_name: 'virtual-team', statement_timeout: 15000 },
    });
    cachedUrl = config.databaseUrl;
  }
  return createRepository(cachedSql);
}

export function createRepository(sql) {
  return {
    sql,
    async getWorkspace() {
      const rows = await sql`SELECT state, revision FROM virtual_team_workspaces WHERE id = 'default'`;
      return rows.length ? { state: rows[0].state, revision: Number(rows[0].revision) } : { state: structuredClone(EMPTY_STATE), revision: 0 };
    },
    async transaction(callback) {
      return sql.begin(async (tx) => callback({
        sql: tx,
        async lockWorkspace() {
          await tx`INSERT INTO virtual_team_workspaces (id, state) VALUES ('default', ${tx.json(EMPTY_STATE)}) ON CONFLICT (id) DO NOTHING`;
          const [row] = await tx`SELECT state, revision FROM virtual_team_workspaces WHERE id = 'default' FOR UPDATE`;
          return { state: row.state, revision: Number(row.revision) };
        },
        async findOperation(operationId) {
          const rows = await tx`SELECT fingerprint, result FROM virtual_team_operations WHERE workspace_id = 'default' AND operation_id = ${operationId}::uuid`;
          return rows[0] ?? null;
        },
        async saveWorkspace(state, revision) {
          await tx`UPDATE virtual_team_workspaces SET state = ${tx.json(state)}, revision = ${revision}, updated_at = now() WHERE id = 'default'`;
        },
        async saveOperation({ operationId, fingerprint, result, revision }) {
          await tx`INSERT INTO virtual_team_operations (workspace_id, operation_id, fingerprint, result, revision) VALUES ('default', ${operationId}::uuid, ${fingerprint}, ${tx.json(result)}, ${revision})`;
        },
      }));
    },
    async consumeLoginAttempt(key) {
      // Consume attempts before credential verification, including correct codes.
      // The counters are shared by every serverless instance and deployments.
      const allowed = await sql.begin(async (tx) => {
        // Check the global bucket first so blocked traffic cannot create an
        // unlimited number of per-address rows. Expired counters are disposable.
        await tx`DELETE FROM virtual_team_login_attempts WHERE resets_at < now() - interval '1 day'`;
        for (const [bucket, limit, windowSeconds] of [['global', 120, 900], [`ip:${key}`, 10, 900]]) {
          const [row] = await tx`
            INSERT INTO virtual_team_login_attempts (key, attempts, resets_at)
            VALUES (${bucket}, 1, now() + ${windowSeconds} * interval '1 second')
            ON CONFLICT (key) DO UPDATE SET
              attempts = CASE WHEN virtual_team_login_attempts.resets_at <= now() THEN 1 ELSE virtual_team_login_attempts.attempts + 1 END,
              resets_at = CASE WHEN virtual_team_login_attempts.resets_at <= now() THEN now() + ${windowSeconds} * interval '1 second' ELSE virtual_team_login_attempts.resets_at END
            RETURNING attempts`;
          if (row.attempts > limit) return false;
        }
        return true;
      });
      if (!allowed) throw new ApiError(429, 'too_many_attempts', 'Too many access-code attempts. Please try again in 15 minutes.');
    },
  };
}
