import { requireSession } from '../server/auth.js';
import { getDatabase } from '../server/database.js';
import { endpoint, methodNotAllowed, readJson, sameOrigin, sendJson } from '../server/http.js';
import { mutateProject, projectSnapshot } from '../server/projects.js';
export function createProjectsHandler({ env = process.env, database = getDatabase, mutate = mutateProject, snapshot = projectSnapshot } = {}) {
  return endpoint(async (req, res) => {
    if (!['GET', 'POST'].includes(req.method)) return methodNotAllowed(res, ['GET', 'POST']);
    const config = requireSession(req, env);
    if (req.method === 'POST') sameOrigin(req, env);
    const db = await database(config);
    const result = req.method === 'POST' ? await mutate(db.sql, await readJson(req)) : undefined;
    sendJson(res, 200, { ...await snapshot(db.sql, env.SAM_RUNTIME_ENABLED === 'true'), ...(result ? { result } : {}) });
  });
}
export default createProjectsHandler();
