import { requireSession } from '../server/auth.js';
import { getDatabase } from '../server/database.js';
import { endpoint, methodNotAllowed, readJson, sameOrigin, sendJson } from '../server/http.js';
import { mutateWorkspace, readWorkspace } from '../server/workspace.js';
import { runtimeHooks, runtimeSnapshot } from '../server/runtime.js';

export function createWorkspaceHandler({ env = process.env, database = getDatabase } = {}) {
  return endpoint(async (req, res) => {
    if (!['GET', 'POST'].includes(req.method)) return methodNotAllowed(res, ['GET', 'POST']);
    const config = requireSession(req, env);
    if (req.method === 'POST') sameOrigin(req, env);
    const db = await database(config);
    const enabled = env.SAM_RUNTIME_ENABLED === 'true';
    const response = req.method === 'GET' ? await readWorkspace(db) : await mutateWorkspace(db, await readJson(req), enabled ? { runtime: runtimeHooks } : undefined);
    sendJson(res, 200, enabled ? await runtimeSnapshot(db.sql, response) : response);
  });
}

export default createWorkspaceHandler();
