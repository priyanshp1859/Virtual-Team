import { ApiError } from './errors.js';

export const BODY_LIMIT = 48 * 1024;

export function sendJson(res, status, body) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Vary', 'Cookie');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

export function sameOrigin(req, env = process.env) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (typeof origin !== 'string' || typeof host !== 'string') throw new ApiError(403, 'origin_rejected', 'Open this workspace directly to continue.');
  let parsed;
  try { parsed = new URL(origin); } catch { /* Rejected below. */ }
  const local = env.NODE_ENV !== 'production' && !env.VERCEL && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
  if (!parsed || parsed.origin !== origin || parsed.host !== host || parsed.protocol !== (local ? 'http:' : 'https:')) {
    throw new ApiError(403, 'origin_rejected', 'Open this workspace directly to continue.');
  }
}

export async function readJson(req, limit = BODY_LIMIT) {
  const contentType = req.headers['content-type'];
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(contentType)) throw new ApiError(415, 'json_required', 'Send this request as JSON.');
  const declaredLength = req.headers['content-length'];
  if (declaredLength !== undefined && (!/^\d+$/.test(String(declaredLength)) || Number(declaredLength) > limit)) throw new ApiError(413, 'body_too_large', 'This request is too large.');
  let body = req.body;
  if (body === undefined) {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > limit) throw new ApiError(413, 'body_too_large', 'This request is too large.');
      chunks.push(Buffer.from(chunk));
    }
    body = Buffer.concat(chunks).toString('utf8');
  }
  try {
    if (Buffer.isBuffer(body)) body = body.toString('utf8');
    const serialized = typeof body === 'string' ? body : JSON.stringify(body);
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > limit) throw new ApiError(413, 'body_too_large', 'This request is too large.');
    const parsed = JSON.parse(serialized);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected an object.');
    return parsed;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'invalid_json', 'Enter valid request details.');
  }
}

export function endpoint(handler) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      if (res.headersSent) return;
      if (error instanceof ApiError) {
        if (error.status === 429) res.setHeader('Retry-After', '900');
        sendJson(res, error.status, { error: error.message, code: error.code });
      } else {
        // Never log connection strings, query data, or submitted access codes.
        console.error('Workspace API request failed.', { type: error?.name ?? 'Error' });
        sendJson(res, 503, { error: 'The workspace could not reach its database. Please try again shortly.', code: 'workspace_unavailable' });
      }
    }
  };
}

export function methodNotAllowed(res, methods) {
  res.setHeader('Allow', methods.join(', '));
  sendJson(res, 405, { error: 'This method is not supported.', code: 'method_not_allowed' });
}
