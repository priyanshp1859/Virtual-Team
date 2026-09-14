import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectStore } from '../src/office/project-store.js';
const response = payload => ({ ok: true, json: async () => payload });
const snapshot = (revision = 1) => ({ revision, projects: [], runtime: { online: true } });
test('lost-save retries keep the same operation ID and do not claim unsaved projects', async () => {
  const bodies = []; let fail = true;
  const store = createProjectStore({ id: () => 'stable-id', fetch: async (_, options) => { if (options.method === 'GET') return response(snapshot()); bodies.push(JSON.parse(options.body)); if (fail) { fail = false; throw new TypeError('Disconnected'); } return response({ ...snapshot(2), result: { projectId: 'saved' } }); } });
  store.setAuthenticated(true); await store.refresh(); await assert.rejects(store.command('create', { title: 'Office' })); assert.equal(store.getState().projects.length, 0);
  assert.deepEqual(await store.command('create', { title: 'Office' }), { projectId: 'saved' }); assert.equal(bodies[0].operationId, bodies[1].operationId);
});
test('signout discards late project responses and does not leak records to a later session', async () => {
  let release;
  const store = createProjectStore({ fetch: () => new Promise(resolve => { release = resolve; }) });
  store.setAuthenticated(true); const pending = store.refresh(); store.setAuthenticated(false);
  release(response({ ...snapshot(), projects: [{ id: 'private' }] })); await pending; assert.deepEqual(store.getState().projects, []);
  store.setAuthenticated(true); assert.deepEqual(store.getState().projects, []);
});
test('a stale response cannot replace a later confirmed project revision', async () => {
  let releaseGet;
  const store = createProjectStore({ id: () => 'id', fetch: async (_, options) => options.method === 'GET' ? new Promise(resolve => { releaseGet = resolve; }) : response({ ...snapshot(3), projects: [{ id: 'latest' }], result: {} }) });
  store.setAuthenticated(true); const refresh = store.refresh(); await store.command('note', { text: 'hello' }); releaseGet(response(snapshot(2))); await refresh; assert.equal(store.getState().projects[0].id, 'latest');
});
