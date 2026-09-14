import { authenticated, clearSessionCookie, configuration, createSessionCookie, loginAttemptKey, requireConfiguration, verifyCode } from '../server/auth.js';
import { getDatabase } from '../server/database.js';
import { ApiError } from '../server/errors.js';
import { endpoint, methodNotAllowed, readJson, sameOrigin, sendJson } from '../server/http.js';

export function createSessionHandler({ env = process.env, database = getDatabase } = {}) {
  return endpoint(async (req, res) => {
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) return methodNotAllowed(res, ['GET', 'POST', 'DELETE']);
    const config = configuration(env);
    if (req.method === 'GET') return sendJson(res, 200, { authenticated: authenticated(req, config), configured: config.configured });
    sameOrigin(req, env);
    if (req.method === 'DELETE') {
      res.setHeader('Set-Cookie', clearSessionCookie(config));
      return sendJson(res, 200, { authenticated: false, configured: config.configured });
    }
    requireConfiguration(env);
    const body = await readJson(req);
    if (Object.keys(body).some((key) => key !== 'code') || typeof body.code !== 'string' || body.code.length > 512) throw new ApiError(400, 'invalid_input', 'Enter your workspace access code.');
    const db = await database(config);
    await db.consumeLoginAttempt(loginAttemptKey(req, config, env));
    if (!verifyCode(body.code, config)) throw new ApiError(401, 'invalid_access_code', 'The access code is incorrect.');
    res.setHeader('Set-Cookie', createSessionCookie(config));
    sendJson(res, 200, { authenticated: true, configured: true });
  });
}

export default createSessionHandler();
