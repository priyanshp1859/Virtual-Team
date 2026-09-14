import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { authenticated, clearSessionCookie, configuration, createSessionCookie, loginAttemptKey, verifyCode } from '../server/auth.js';
import { ApiError } from '../server/errors.js';
import { BODY_LIMIT, readJson, sameOrigin } from '../server/http.js';
import { applyOperation, EMPTY_STATE, MAX_STATE_BYTES, mutateWorkspace, readWorkspace, validateOperation } from '../server/workspace.js';
import { createSessionHandler } from '../api/session.js';
import { createWorkspaceHandler } from '../api/workspace.js';

const env = { NODE_ENV: 'production', VERCEL: '1', DATABASE_URL: 'postgres://test.invalid/test', WORKSPACE_ACCESS_CODE: 'unit-test-code-not-a-live-secret', SESSION_SECRET: 'unit-test-session-secret-never-used-for-deployments' };
const config = configuration(env);
const cookie = createSessionCookie(config).split(';')[0];
const headers = { host: 'office.example', origin: 'https://office.example', 'content-type': 'application/json', cookie };
const operation = (action, input, operationId = randomUUID()) => ({ operationId, action, input });
const createTask = (title = 'A real task') => operation('createTask', { agentId: 'sam', title, brief: 'Do not pretend this has run.' });

// Model a repository transaction with an exclusive lock and rollback. The real
// PostgreSQL repository implements this contract with BEGIN and SELECT FOR UPDATE.
function memoryRepository(initial = EMPTY_STATE) {
  let current = { state: structuredClone(initial), revision: 0 };
  let receipts = new Map();
  let lock = Promise.resolve();
  let attempts = 0;
  let failReceipt = false;
  return {
    get attempts() { return attempts; },
    failNextReceipt() { failReceipt = true; },
    async getWorkspace() { return structuredClone(current); },
    async consumeLoginAttempt() { attempts += 1; if (attempts > 10) throw new ApiError(429, 'too_many_attempts', 'Too many access-code attempts.'); },
    async transaction(callback) {
      const before = lock;
      let release;
      lock = new Promise((resolve) => { release = resolve; });
      await before;
      let draft = structuredClone(current);
      const nextReceipts = new Map(receipts);
      try {
        const result = await callback({
          async lockWorkspace() { return structuredClone(draft); },
          async findOperation(id) { return nextReceipts.get(id) ?? null; },
          async saveWorkspace(state, revision) { draft = { state: structuredClone(state), revision }; },
          async saveOperation(receipt) {
            if (failReceipt) { failReceipt = false; throw new Error('Simulated receipt storage failure'); }
            nextReceipts.set(receipt.operationId, receipt);
          },
        });
        current = draft;
        receipts = nextReceipts;
        return result;
      } finally { release(); }
    },
  };
}

async function request(handler, { method = 'GET', body, requestHeaders = headers } = {}) {
  const req = { method, body, headers: requestHeaders, socket: { remoteAddress: '127.0.0.1' } };
  const responseHeaders = {};
  let responseBody;
  const res = {
    statusCode: 200, headersSent: false,
    setHeader(name, value) { responseHeaders[name.toLowerCase()] = value; },
    end(value) { responseBody = value; this.headersSent = true; },
  };
  await handler(req, res);
  return { status: res.statusCode, headers: responseHeaders, body: JSON.parse(responseBody) };
}

test('sessions are signed, time-limited, HttpOnly, Secure, and revoked by either secret rotation', () => {
  const now = Date.now();
  const fullCookie = createSessionCookie(config, now);
  const req = { headers: { cookie: fullCookie.split(';')[0] } };
  assert.match(fullCookie, /^__Host-virtual_team_session=/);
  assert.match(fullCookie, /; HttpOnly/);
  assert.match(fullCookie, /; Secure/);
  assert.match(fullCookie, /; SameSite=Strict/);
  assert.match(fullCookie, /; Path=\//);
  assert.equal(authenticated(req, config, now), true);
  assert.equal(authenticated(req, config, now + 7 * 86400 * 1000), false);
  assert.equal(authenticated(req, { ...config, code: 'rotated-access-code-value' }, now), false);
  assert.equal(authenticated(req, { ...config, secret: 'rotated-session-secret-value' }, now), false);
  assert.equal(authenticated({ headers: { cookie: req.headers.cookie.slice(0, -1) + (req.headers.cookie.endsWith('X') ? 'Y' : 'X') } }, config, now), false);
  assert.equal(authenticated({ headers: { cookie: `${req.headers.cookie}; ${req.headers.cookie}` } }, config, now), false);
  assert.match(clearSessionCookie(config), /Max-Age=0/);
  assert.equal(verifyCode(env.WORKSPACE_ACCESS_CODE, config), true);
  assert.equal(verifyCode('wrong', config), false);
});

test('same-origin guard rejects absent, sibling, forged and insecure origins', () => {
  assert.doesNotThrow(() => sameOrigin({ headers }, env));
  for (const origin of [undefined, 'null', 'https://evil.example', 'https://office.example.evil', 'https://office.example/path', 'http://office.example']) {
    assert.throws(() => sameOrigin({ headers: { ...headers, origin } }, env), (e) => e.status === 403);
  }
  assert.doesNotThrow(() => sameOrigin({ headers: { host: 'localhost:5175', origin: 'http://localhost:5175' } }, {}));
  assert.throws(() => sameOrigin({ headers: { host: 'localhost:5175', origin: 'http://localhost:5175' } }, env));
});

test('JSON parser enforces content type, object shape and byte limits for parsed and streamed bodies', async () => {
  assert.deepEqual(await readJson({ headers, body: { code: 'test' } }), { code: 'test' });
  await assert.rejects(readJson({ headers, body: '[' }), (e) => e.status === 400);
  await assert.rejects(readJson({ headers, body: [] }), (e) => e.status === 400);
  await assert.rejects(readJson({ headers: { 'content-type': 'text/plain' }, body: '{}' }), (e) => e.status === 415);
  await assert.rejects(readJson({ headers, body: { text: 'x'.repeat(BODY_LIMIT) } }), (e) => e.status === 413);
  const stream = Readable.from([Buffer.alloc(BODY_LIMIT), Buffer.from('x')]);
  stream.headers = headers;
  await assert.rejects(readJson(stream), (e) => e.status === 413);
});

test('access-code endpoint closes when unconfigured and does not expose credentials', async () => {
  const handler = createSessionHandler({ env: {}, database: () => assert.fail('Must not connect') });
  const status = await request(handler);
  assert.deepEqual(status.body, { authenticated: false, configured: false });
  const login = await request(handler, { method: 'POST', body: { code: 'wrong' } });
  assert.equal(login.status, 503);
  assert.equal(JSON.stringify(login.body).includes('postgres'), false);
});

test('access-code login, logout and distributed rate-limit interface', async () => {
  const db = memoryRepository();
  const handler = createSessionHandler({ env, database: async () => db });
  const wrong = await request(handler, { method: 'POST', body: { code: 'wrong' } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers['set-cookie'], undefined);
  const success = await request(handler, { method: 'POST', body: { code: env.WORKSPACE_ACCESS_CODE } });
  assert.equal(success.status, 200);
  assert.deepEqual(success.body, { authenticated: true, configured: true });
  assert.match(success.headers['set-cookie'], /HttpOnly/);
  assert.equal(success.headers['cache-control'], 'private, no-store, max-age=0');
  for (let index = 0; index < 8; index += 1) await request(handler, { method: 'POST', body: { code: 'wrong' } });
  const limited = await request(handler, { method: 'POST', body: { code: env.WORKSPACE_ACCESS_CODE } });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers['retry-after'], '900');
  const logout = await request(handler, { method: 'DELETE' });
  assert.equal(logout.status, 200);
  assert.match(logout.headers['set-cookie'], /Max-Age=0/);
  const crossOrigin = await request(handler, { method: 'POST', body: { code: env.WORKSPACE_ACCESS_CODE }, requestHeaders: { ...headers, origin: 'https://evil.example' } });
  assert.equal(crossOrigin.status, 403);
});

test('login IP keys trust only the platform-specific header and never store raw IPs', () => {
  const req = { headers: { 'x-vercel-forwarded-for': '192.0.2.1', 'x-forwarded-for': 'spoofed' }, socket: { remoteAddress: '127.0.0.1' } };
  const trusted = loginAttemptKey(req, config, env);
  assert.match(trusted, /^[a-f0-9]{64}$/);
  assert.notEqual(trusted, loginAttemptKey(req, config, {}));
  assert.equal(loginAttemptKey(req, config, {}), loginAttemptKey({ ...req, headers: {} }, config, {}));
});

test('workspace endpoint rejects unauthenticated access before database lookup', async () => {
  const handler = createWorkspaceHandler({ env, database: () => assert.fail('Must not connect') });
  for (const method of ['GET', 'POST']) {
    const result = await request(handler, { method, body: createTask(), requestHeaders: { ...headers, cookie: undefined } });
    assert.equal(result.status, 401);
    assert.equal(result.body.code, 'unauthenticated');
    assert.equal(result.body.state, undefined);
  }
  const crossOrigin = await request(handler, { method: 'POST', body: createTask(), requestHeaders: { ...headers, origin: 'https://evil.example' } });
  assert.equal(crossOrigin.status, 403);
});

test('real tasks and messages persist, remain queued, and preserve literal user text', async () => {
  const db = memoryRepository();
  const task = await mutateWorkspace(db, createTask('<img src=x onerror=alert(1)>'));
  assert.equal(task.revision, 1);
  assert.equal(task.state.tasks[0].status, 'queued');
  assert.equal(task.state.tasks[0].isSample, false);
  assert.equal(task.state.tasks[0].title, '<img src=x onerror=alert(1)>');
  assert.match(task.state.messages[0].text, /private workspace/);
  const msg = await mutateWorkspace(db, operation('sendMessage', { agentId: 'sam', taskId: task.result, text: '<script>saved locally</script>' }));
  assert.equal(msg.state.messages.find((m) => m.role === 'user').text, '<script>saved locally</script>');
  assert.equal(msg.state.messages.filter((m) => m.role === 'system').length, 1, 'Canonical local notice is deduplicated on the server');
  assert.equal(msg.state.messages.some((m) => m.role === 'agent'), false);
  assert.deepEqual(await readWorkspace(db), { state: msg.state, revision: 2 });
});

test('atomic concurrent commands preserve every update', async () => {
  const db = memoryRepository();
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => mutateWorkspace(db, createTask(`Task ${i}`))));
  const saved = await readWorkspace(db);
  assert.equal(saved.revision, 20);
  assert.equal(saved.state.tasks.length, 20);
  assert.equal(new Set(results.map((item) => item.result)).size, 20);
});

test('idempotent retries return the original result and current state without a second change', async () => {
  const db = memoryRepository();
  const body = createTask();
  const [first, duplicate] = await Promise.all([mutateWorkspace(db, body), mutateWorkspace(db, body)]);
  assert.equal(first.result, duplicate.result);
  assert.equal(duplicate.revision, 1);
  await mutateWorkspace(db, createTask('Second task'));
  const replay = await mutateWorkspace(db, { ...body, input: { brief: body.input.brief, title: body.input.title, agentId: 'sam' } });
  assert.equal(replay.result, first.result);
  assert.equal(replay.revision, 2);
  assert.equal(replay.state.tasks.length, 2);
  await assert.rejects(mutateWorkspace(db, { ...body, input: { ...body.input, title: 'Changed' } }), (e) => e.status === 409 && e.code === 'operation_conflict');
});

test('receipt failure rolls back the state change, permitting a safe retry', async () => {
  const db = memoryRepository();
  const body = createTask();
  db.failNextReceipt();
  await assert.rejects(mutateWorkspace(db, body), /receipt storage failure/);
  assert.equal((await readWorkspace(db)).revision, 0);
  assert.equal((await readWorkspace(db)).state.tasks.length, 0);
  assert.equal((await mutateWorkspace(db, body)).revision, 1);
});

test('sample decisions enforce feedback, exact revision and current state', async () => {
  const db = memoryRepository();
  const started = await mutateWorkspace(db, operation('startSample', { agentId: 'sam' }));
  const taskId = started.result;
  await mutateWorkspace(db, operation('advanceSample', { taskId }));
  await mutateWorkspace(db, operation('sendMessage', { agentId: 'sam', taskId, text: 'Use the filtered empty state.' }));
  await assert.rejects(mutateWorkspace(db, operation('decideReview', { taskId, revision: 1, decision: 'changes_requested', comment: '' })), (e) => e.status === 400);
  await mutateWorkspace(db, operation('decideReview', { taskId, revision: 1, decision: 'changes_requested', comment: 'Please preserve: saved locally' }));
  await mutateWorkspace(db, operation('advanceSample', { taskId }));
  await assert.rejects(mutateWorkspace(db, operation('decideReview', { taskId, revision: 1, decision: 'approved' })), (e) => e.status === 409);
  const approved = await mutateWorkspace(db, operation('decideReview', { taskId, revision: 2, decision: 'approved' }));
  assert.equal(approved.state.tasks[0].status, 'completed');
  assert.equal(approved.state.tasks[0].review.isSample, true);
  assert.match(approved.state.messages.at(-1).text, /saved to this workspace/);
  assert.match(approved.state.messages.find((m) => m.text.includes('Please preserve')).text, /Please preserve: saved locally$/);
  await assert.rejects(mutateWorkspace(db, operation('decideReview', { taskId, revision: 2, decision: 'approved' })), (e) => e.status === 409);
});

test('server dispatch rejects unknown actions, extra fields, forged results and wrong agent links', async () => {
  for (const body of [
    { ...createTask(), operationId: 'not-a-uuid' },
    operation('__proto__', {}),
    operation('replaceState', { tasks: [] }),
    operation('createTask', { agentId: 'sam', title: 'test', status: 'completed' }),
    operation('sendMessage', { agentId: { fake: true }, text: 'test' }),
  ]) assert.throws(() => validateOperation(body), (e) => e.status === 400);
  const db = memoryRepository();
  await assert.rejects(mutateWorkspace(db, operation('createTask', { agentId: 'missing', title: 'test' })), (e) => e.status === 400);
  const task = await mutateWorkspace(db, createTask());
  await assert.rejects(mutateWorkspace(db, operation('sendMessage', { taskId: task.result, agentId: 'maya', text: 'Wrong task' })), (e) => e.status === 400);
  await assert.rejects(mutateWorkspace(db, operation('advanceSample', { taskId: task.result })), (e) => e.status === 400);
  assert.equal((await readWorkspace(db)).revision, 1);
});

test('corrupt saved data fails closed rather than overwriting prior state', async () => {
  const corrupt = { version: 999, tasks: [], messages: [] };
  const db = memoryRepository(corrupt);
  await assert.rejects(readWorkspace(db), (e) => e.status === 503);
  await assert.rejects(mutateWorkspace(db, createTask()), (e) => e.status === 503);
  assert.deepEqual((await db.getWorkspace()).state, corrupt);
});

test('UTF-8 state size is bounded before mutation commit', () => {
  let state = structuredClone(EMPTY_STATE);
  for (let index = 0; index < 90; index += 1) {
    const command = validateOperation(operation('sendMessage', { agentId: 'sam', text: '🙂'.repeat(3500) }));
    state = applyOperation(state, command).state;
  }
  const padding = 'a'.repeat(8000);
  while (Buffer.byteLength(JSON.stringify(state)) < MAX_STATE_BYTES - 12000) state = applyOperation(state, validateOperation(operation('sendMessage', { agentId: 'sam', text: padding }))).state;
  const dbSize = Buffer.byteLength(JSON.stringify(state));
  assert.ok(dbSize < MAX_STATE_BYTES);
  assert.throws(() => applyOperation(state, validateOperation(operation('sendMessage', { agentId: 'sam', text: '🙂'.repeat(4000) }))), (e) => e.status === 409 && e.code === 'workspace_full');
});
