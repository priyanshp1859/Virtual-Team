import { requireSession } from '../server/auth.js';
import { getDatabase } from '../server/database.js';
import { endpoint, methodNotAllowed, readJson, sameOrigin, sendJson } from '../server/http.js';
import { mutateWorkspace, readWorkspace } from '../server/workspace.js';

export function createWorkspaceHandler({ env = process.env, database = getDatabase } = {}) {
  return endpoint(async (req, res) => {
    if (!['GET', 'POST'].includes(req.method)) return methodNotAllowed(res, ['GET', 'POST']);
    const config = requireSession(req, env);
    if (req.method === 'POST') sameOrigin(req, env);
    const db = await database(config);
    const response = req.method === 'GET' ? await readWorkspace(db) : await mutateWorkspace(db, await readJson(req));
    sendJson(res, 200, response);
  });
}

export default createWorkspaceHandler();
