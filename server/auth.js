import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.js';

const SESSION_SECONDS = 7 * 24 * 60 * 60;

export function configuration(env = process.env) {
  const code = env.WORKSPACE_ACCESS_CODE;
  const secret = env.SESSION_SECRET;
  const databaseUrl = env.DATABASE_URL || env.POSTGRES_URL;
  const configured = typeof code === 'string' && code.length >= 16 && typeof secret === 'string' && secret.length >= 32 && typeof databaseUrl === 'string' && /^postgres(?:ql)?:\/\//.test(databaseUrl);
  return { configured, code, secret, databaseUrl, secure: env.NODE_ENV === 'production' || Boolean(env.VERCEL) };
}

export function requireConfiguration(env) {
  const config = configuration(env);
  if (!config.configured) throw new ApiError(503, 'not_configured', 'This private workspace is not configured yet.');
  return config;
}

function signature(payload, config) {
  // Rotating either server secret or the access code revokes existing sessions.
  return createHmac('sha256', config.secret).update(config.code).update('\0').update(payload).digest('base64url');
}

function equalText(left, right) {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
}

export function verifyCode(code, config) {
  return typeof code === 'string' && code.length <= 512 && equalText(code, config.code);
}

function cookieName(config) { return config.secure ? '__Host-virtual_team_session' : 'virtual_team_session'; }

export function createSessionCookie(config, now = Date.now()) {
  const issued = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, iat: issued, exp: issued + SESSION_SECONDS })).toString('base64url');
  return `${cookieName(config)}=${payload}.${signature(payload, config)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${config.secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(config) {
  return `${cookieName(config)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${config.secure ? '; Secure' : ''}`;
}

export function authenticated(req, config, now = Date.now()) {
  if (!config.configured) return false;
  const cookies = req.headers.cookie;
  if (typeof cookies !== 'string' || cookies.length > 8192) return false;
  const values = cookies.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${cookieName(config)}=`));
  if (values.length !== 1) return false;
  const token = values[0].slice(cookieName(config).length + 1);
  if (!/^[A-Za-z0-9_-]{1,200}\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const [payload, sig] = token.split('.');
  if (!equalText(sig, signature(payload, config))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const seconds = Math.floor(now / 1000);
    return data.v === 1 && Number.isSafeInteger(data.iat) && Number.isSafeInteger(data.exp) && data.iat <= seconds + 30 && data.exp > seconds && data.exp - data.iat === SESSION_SECONDS;
  } catch { return false; }
}

export function requireSession(req, env) {
  const config = requireConfiguration(env);
  if (!authenticated(req, config)) throw new ApiError(401, 'unauthenticated', 'Enter your workspace access code to continue.');
  return config;
}

export function loginAttemptKey(req, config, env = process.env) {
  // Vercel replaces x-vercel-forwarded-for with the verified client IP.
  // Outside Vercel, do not trust arbitrary forwarded headers.
  const forwarded = env.VERCEL ? req.headers['x-vercel-forwarded-for'] : null;
  const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress ?? 'unknown';
  return createHmac('sha256', config.secret).update('login-ip\0').update(ip).digest('hex');
}
