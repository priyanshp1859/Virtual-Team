import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCloudStore } from '../src/office/cloud-store.js';

const state = tasks => ({ version: 1, tasks, messages: [] });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('locked workspace never requests private data, signs in before loading, and clears on logout', async () => {
  const requests = []; let signedIn = false;
  const store = createCloudStore({ fetch: async (url, options) => {
    requests.push([url, options]);
    if (url === '/api/session') {
      if (options.method === 'POST') { assert.deepEqual(JSON.parse(options.body), { code: 'test-access-code' }); signedIn = true; }
      if (options.method === 'DELETE') signedIn = false;
      return response({ authenticated: signedIn, configured: true });
    }
    assert.equal(signedIn, true);
    return response({ state: state([{ id: 'private-task' }]), revision: 4 });
  } });
  await store.initialize(); assert.equal(requests.length, 1); assert.equal(store.getState().authenticated, false);
  await assert.rejects(store.createTask({ agentId: 'sam', title: 'Locked' }), /Open your workspace/);
  await store.signIn('test-access-code'); assert.equal(store.getState().tasks[0].id, 'private-task'); assert.equal(store.getState().revision, 4);
  for (const [, options] of requests) { assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store'); }
  await store.signOut(); assert.equal(store.getState().authenticated, false); assert.deepEqual(store.getState().tasks, []); assert.equal(store.getState().revision, -1);
  store.dispose();
});

test('failed save stays unsaved and retries the same operation id after an ambiguous network failure', async () => {
  const mutations = []; let attempt = 0;
  const store = createCloudStore({ id: () => `test-operation-${++attempt}`, fetch: async (url, options) => {
    if (url === '/api/session') return response({ authenticated: true, configured: true });
    if (options.method === 'GET') return response({ state: state([]), revision: 0 });
    mutations.push(JSON.parse(options.body));
    if (mutations.length === 1) throw new TypeError('Failed to fetch');
    return response({ state: state([{ id: 'task-saved-once' }]), revision: 1, result: 'task-saved-once' });
  } });
  await store.initialize();
  await assert.rejects(store.createTask({ agentId: 'sam', title: 'Keep my draft' }), /draft is still here/);
  assert.deepEqual(store.getState().tasks, []); assert.equal(store.getState().connectionStatus, 'error');
  const result = await store.createTask({ agentId: 'sam', title: 'Keep my draft' });
  assert.equal(result, 'task-saved-once'); assert.equal(mutations[0].operationId, mutations[1].operationId);
  assert.equal(store.getState().tasks.length, 1); assert.equal(store.getState().connectionStatus, 'ready');
  store.dispose();
});

test('mutations serialize and a late refresh cannot replace a newer revision', async () => {
  const first = defer(), stale = defer(); const mutations = []; let reads = 0;
  const store = createCloudStore({ id: (() => { let n = 0; return () => `operation-${++n}`; })(), fetch: async (url, options) => {
    if (url === '/api/session') return response({ authenticated: true, configured: true });
    if (options.method === 'GET') return ++reads === 1 ? response({ state: state([]), revision: 0 }) : stale.promise;
    mutations.push(JSON.parse(options.body));
    return mutations.length === 1 ? first.promise : response({ state: state([{ id: 'one' }, { id: 'two' }]), revision: 2, result: 'two' });
  } });
  await store.initialize();
  const refresh = store.refresh();
  const one = store.createTask({ title: 'One' }), two = store.createTask({ title: 'Two' });
  await nextTurn(); assert.equal(mutations.length, 1); assert.equal(store.getState().connectionStatus, 'saving');
  first.resolve(response({ state: state([{ id: 'one' }]), revision: 1, result: 'one' }));
  assert.deepEqual(await Promise.all([one, two]), ['one', 'two']);
  stale.resolve(response({ state: state([]), revision: 0 })); await refresh;
  assert.equal(store.getState().revision, 2); assert.equal(store.getState().tasks.length, 2);
  store.dispose();
});

test('expired session clears private records and ignores delayed responses from the old session', async () => {
  const delayed = defer(); let reads = 0;
  const store = createCloudStore({ fetch: async (url, options) => {
    if (url === '/api/session') return response({ authenticated: true, configured: true });
    if (options.method === 'GET') return ++reads === 1 ? response({ state: state([{ id: 'private' }]), revision: 1 }) : delayed.promise;
    return response({ error: 'Session expired', code: 'unauthenticated' }, 401);
  } });
  await store.initialize(); const refresh = store.refresh();
  await assert.rejects(store.sendMessage({ agentId: 'sam', text: 'Hello' }), /Session expired/);
  assert.equal(store.getState().authenticated, false); assert.deepEqual(store.getState().tasks, []);
  delayed.resolve(response({ state: state([{ id: 'must-not-return' }]), revision: 10 })); await refresh;
  assert.deepEqual(store.getState().tasks, []); assert.equal(store.getState().revision, -1);
  store.dispose();
});

test('database unavailability never becomes a local-only successful workspace', async () => {
  const store = createCloudStore({ fetch: async url => url === '/api/session'
    ? response({ authenticated: true, configured: true })
    : response({ error: 'Database unavailable', code: 'database_unavailable' }, 503) });
  await assert.rejects(store.initialize(), /Database unavailable/);
  assert.equal(store.getState().authenticated, true); assert.equal(store.getState().storageAvailable, false);
  assert.equal(store.getState().revision, -1); assert.equal(store.getState().connectionStatus, 'error');
  await assert.rejects(store.createTask({ title: 'Unsaved' }), /Open your workspace/);
  store.dispose();
});

test('an incorrect access code retains its error instead of claiming the session expired', async () => {
  const requests = [];
  const store = createCloudStore({ fetch: async (url, options) => {
    requests.push(url);
    assert.equal(url, '/api/session');
    return options.method === 'GET'
      ? response({ authenticated: false, configured: true })
      : response({ error: 'The access code is incorrect.', code: 'invalid_access_code' }, 401);
  } });
  await store.initialize();
  await assert.rejects(store.signIn('wrong-code'), /access code is incorrect/);
  assert.equal(store.getState().persistenceError, 'The access code is incorrect.');
  assert.equal(store.getState().authenticated, false);
  assert.deepEqual(store.getState().tasks, []);
  assert.deepEqual(requests, ['/api/session', '/api/session']);
  store.dispose();
});
