import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceStore, STATUS_LABELS } from '../src/office/workspace-store.js';

const KEY = 'agent-office.workspace.v1';
function memoryStorage(initial = null) {
  let value = initial;
  return {
    writes: 0,
    failWrite: false,
    getItem(key) { assert.equal(key, KEY); return value; },
    setItem(key, next) { assert.equal(key, KEY); if (this.failWrite) throw new Error('QuotaExceededError'); this.writes++; value = next; },
    read() { return value; },
  };
}
function create(storage = memoryStorage(), offset = 0) {
  let sequence = offset;
  let clock = Date.UTC(2026, 8, 14, 9, 0);
  const store = createWorkspaceStore({ storage, now: () => clock += 1000, id: () => `record-${++sequence}` });
  return { store, storage };
}
function findTask(store, taskId) { return store.getState().tasks.find(({ id }) => id === taskId); }
function reviewReady(store, agentId = 'sam') {
  const taskId = store.startSample(agentId);
  store.advanceSample(taskId);
  store.sendMessage({ agentId, taskId, text: 'Use the filtered-results wording.' });
  return taskId;
}

test('real tasks and messages persist across reload and remain a local queue', () => {
  const { store, storage } = create();
  const taskId = store.createTask({ agentId: 'sam', title: 'Fix reservation search', brief: 'Keep the current API integration.' });
  store.sendMessage({ agentId: 'sam', taskId, text: 'Start with the empty-state behavior.' });
  store.sendMessage({ agentId: 'sam', taskId, text: 'Preserve the selected date.' });
  const state = store.getState();
  assert.equal(findTask(store, taskId).status, 'queued');
  assert.equal(findTask(store, taskId).isSample, false);
  assert.equal(typeof findTask(store, taskId).updatedAt, 'number');
  assert.equal(state.messages.filter(({ role }) => role === 'agent').length, 0);
  assert.equal(state.messages.filter(({ role }) => role === 'system').length, 1);
  assert(state.messages.every(({ delivery }) => delivery === 'local'));
  assert.match(state.messages.find(({ role }) => role === 'system').text, /No agent runtime is connected/);
  const reloaded = create(storage, 100).store;
  assert.deepEqual(reloaded.getState(), state);
  assert.equal(Object.hasOwn(JSON.parse(storage.read()), 'storageAvailable'), false);
  assert.throws(() => reloaded.advanceSample(taskId), /Only the sample/);
  assert.throws(() => reloaded.decideReview(taskId, { revision: 1, decision: 'approved' }), /Only the sample/);
});

test('agent conversations and task links stay isolated', () => {
  const { store } = create();
  const samTask = store.createTask({ agentId: 'sam', title: 'Code review', brief: '' });
  const mayaTask = store.createTask({ agentId: 'maya', title: 'Design review', brief: '' });
  store.sendMessage({ agentId: 'sam', taskId: samTask, text: 'Sam-only context' });
  store.sendMessage({ agentId: 'maya', taskId: mayaTask, text: 'Maya-only context' });
  const before = store.getState();
  assert.throws(() => store.sendMessage({ agentId: 'sam', taskId: mayaTask, text: 'Wrong destination' }), /assigned to that task/);
  assert.deepEqual(store.getState(), before);
  assert.deepEqual(before.messages.filter((m) => m.agentId === 'sam' && m.role === 'user').map((m) => m.text), ['Sam-only context']);
  assert.deepEqual(before.messages.filter((m) => m.agentId === 'maya' && m.role === 'user').map((m) => m.text), ['Maya-only context']);
});

test('unassigned chats create one truthful local-outbox note', () => {
  const { store } = create();
  store.sendMessage({ agentId: 'alex', text: 'Help me plan this task.' });
  store.sendMessage({ agentId: 'alex', text: 'Here are my priorities.' });
  assert.equal(store.getState().tasks.length, 0);
  assert.equal(store.getState().messages.filter((m) => m.role === 'system').length, 1);
  assert(store.getState().messages.every((m) => m.taskId === null && m.delivery === 'local'));
});

test('invalid agents, record links, empty fields and excessive input are rejected atomically', () => {
  const { store } = create();
  const invalid = [
    () => store.createTask({ agentId: 'unknown', title: 'Task' }),
    () => store.startSample('unknown'),
    () => store.createTask({ agentId: 'sam', title: '   ' }),
    () => store.createTask({ agentId: 'sam', title: 'x'.repeat(121) }),
    () => store.createTask({ agentId: 'sam', title: 'Title', brief: 'x'.repeat(8001) }),
    () => store.sendMessage({ agentId: 'sam', text: '' }),
    () => store.sendMessage({ agentId: 'sam', text: 'x'.repeat(8001) }),
    () => store.sendMessage({ agentId: 'sam', taskId: 'missing', text: 'Hello' }),
    () => store.sendMessage({ agentId: 'sam', taskId: '<invalid>', text: 'Hello' }),
    () => store.sendMessage(null),
  ];
  for (const mutation of invalid) assert.throws(mutation);
  assert.equal(store.getState().tasks.length, 0);
  assert.equal(store.getState().messages.length, 0);
});

test('HTML-looking user content remains literal plain text in local storage', () => {
  const { store, storage } = create();
  const payload = '<img src=x onerror="window.pwned=true"><script>alert(1)</script>';
  const messageId = store.sendMessage({ agentId: 'maya', text: payload });
  assert.equal(store.getState().messages.find((m) => m.id === messageId).text, payload);
  assert.equal(JSON.parse(storage.read()).messages.find((m) => m.id === messageId).text, payload);
  assert.equal(create(storage, 100).store.getState().messages.find((m) => m.id === messageId).text, payload);
});

test('the sample question, feedback, new revision and approval form a complete local walkthrough', () => {
  const { store, storage } = create();
  const taskId = store.startSample();
  assert.equal(findTask(store, taskId).status, 'working');
  assert.equal(findTask(store, taskId).isSample, true);
  store.advanceSample(taskId);
  assert.equal(findTask(store, taskId).status, 'waiting_for_user');
  assert.match(store.getState().messages.at(-1).text, /Sample question/);
  store.sendMessage({ agentId: 'sam', taskId, text: 'No matching reservations.' });
  let task = findTask(store, taskId);
  assert.equal(task.status, 'in_review');
  assert.equal(task.review.revision, 1);
  assert.equal(task.review.isSample, true);
  assert(task.review.files.every((file) => file.path.startsWith('sample/') && file.before && file.after));
  assert(task.review.checks.every((check) => check.detail.includes('No ') && check.detail.includes('were run')));
  assert.deepEqual(create(storage, 100).store.getState(), store.getState(), 'source whitespace and all review fields survive reload');
  const before = store.getState();
  assert.throws(() => store.decideReview(taskId, { revision: 1, decision: 'changes_requested', comment: ' ' }), /cannot be empty/);
  assert.deepEqual(store.getState(), before);
  store.decideReview(taskId, { revision: 1, decision: 'changes_requested', comment: 'Offer a way to clear the filters.' });
  assert.equal(findTask(store, taskId).status, 'changes_requested');
  assert.equal(findTask(store, taskId).review.decision, 'changes_requested');
  store.advanceSample(taskId);
  task = findTask(store, taskId);
  assert.equal(task.status, 'in_review');
  assert.equal(task.review.revision, 2);
  assert.equal(task.review.decision, null);
  assert.equal(task.review.comment, null);
  assert.match(task.review.files[0].after, /Clear filters/);
  assert.throws(() => store.decideReview(taskId, { revision: 1, decision: 'approved' }), /stale/);
  store.decideReview(taskId, { revision: 2, decision: 'approved' });
  assert.equal(findTask(store, taskId).status, 'completed');
  assert.equal(findTask(store, taskId).review.decision, 'approved');
  assert.equal(typeof findTask(store, taskId).review.decidedAt, 'number');
  assert.match(store.getState().messages.at(-1).text, /No files were applied, committed, or merged/);
  assert.deepEqual(create(storage, 100).store.getState(), store.getState());
  assert.throws(() => store.decideReview(taskId, { revision: 2, decision: 'approved' }), /no longer/);
  assert.throws(() => store.advanceSample(taskId), /current state/);
});

test('sample controls cannot skip a question or review, and unrelated chat cannot answer one', () => {
  const { store } = create();
  const taskId = store.startSample('sam');
  assert.throws(() => store.decideReview(taskId, { revision: 1, decision: 'approved' }), /stale/);
  store.advanceSample(taskId);
  assert.throws(() => store.advanceSample(taskId), /current state/);
  store.sendMessage({ agentId: 'sam', text: 'A general message, not a task answer.' });
  assert.equal(findTask(store, taskId).status, 'waiting_for_user');
  store.sendMessage({ agentId: 'sam', taskId, text: 'Task answer.' });
  assert.throws(() => store.advanceSample(taskId), /current state/);
  assert.throws(() => store.decideReview(taskId, { revision: 1, decision: 'merge' }), /Choose approve/);
  assert.throws(() => store.decideReview(taskId, { revision: 1.5, decision: 'approved' }), /exact revision/);
});

test('each subscriber receives an independent snapshot synchronously', () => {
  const { store } = create();
  const events = [];
  const unsubscribe = store.subscribe((snapshot) => { events.push(snapshot.tasks.length); snapshot.tasks.length = 0; });
  store.subscribe((snapshot) => { assert.equal(snapshot.tasks.length, 1); });
  const taskId = store.createTask({ agentId: 'sam', title: 'Persist me' });
  assert.deepEqual(events, [1]);
  assert.equal(findTask(store, taskId).title, 'Persist me');
  const read = store.getState();
  read.tasks[0].title = 'External mutation';
  assert.equal(findTask(store, taskId).title, 'Persist me');
  unsubscribe();
  store.sendMessage({ agentId: 'sam', taskId, text: 'Message after unsubscribe' });
  assert.deepEqual(events, [1]);
  store.dispose();
  assert.throws(() => store.createTask({ agentId: 'sam', title: 'Closed' }), /closed/);
  assert.throws(() => store.subscribe(() => {}), /closed/);
});

test('corrupt persisted data is preserved without silent overwrite', () => {
  const broken = '{"version":1,broken-json';
  const storage = memoryStorage(broken);
  const { store } = create(storage);
  assert.equal(store.getState().storageAvailable, false);
  assert.match(store.getState().persistenceError, /left untouched/);
  store.createTask({ agentId: 'sam', title: 'In-memory task' });
  assert.equal(store.getState().tasks.length, 1);
  assert.equal(storage.read(), broken);
  assert.equal(storage.writes, 0);
});

test('saved unknown agents/statuses, mismatched links and fictitious live results are rejected', () => {
  const { store, storage } = create();
  const taskId = store.createTask({ agentId: 'sam', title: 'Valid saved task' });
  store.sendMessage({ agentId: 'sam', taskId, text: 'Saved text' });
  const valid = JSON.parse(storage.read());
  const mutations = [
    (saved) => { saved.tasks[0].agentId = 'unknown'; },
    (saved) => { saved.tasks[0].status = 'running_unknown'; },
    (saved) => { saved.tasks[0].status = 'completed'; },
    (saved) => { saved.messages.at(-1).agentId = 'maya'; },
    (saved) => { saved.messages.at(-1).role = 'agent'; },
    (saved) => { saved.messages.at(-1).id = saved.tasks[0].id; },
    (saved) => { saved.version = 99; },
  ];
  for (const mutate of mutations) {
    const broken = structuredClone(valid);
    mutate(broken);
    const raw = JSON.stringify(broken);
    const target = memoryStorage(raw);
    const recovered = create(target, 100).store;
    assert.equal(recovered.getState().tasks.length, 0);
    assert.equal(recovered.getState().storageAvailable, false);
    recovered.sendMessage({ agentId: 'sam', text: 'Memory-only after unsafe load' });
    assert.equal(target.read(), raw);
    assert.equal(target.writes, 0);
  }
});

test('quota failures preserve current in-memory work and later saves can recover', () => {
  const { store, storage } = create();
  storage.failWrite = true;
  const taskId = store.createTask({ agentId: 'sam', title: 'Retain despite quota' });
  assert.equal(findTask(store, taskId).title, 'Retain despite quota');
  assert.equal(store.getState().storageAvailable, false);
  assert.match(store.getState().persistenceError, /could not be saved/);
  assert.equal(storage.read(), null);
  storage.failWrite = false;
  store.sendMessage({ agentId: 'sam', taskId, text: 'Retry persistence' });
  assert.equal(store.getState().storageAvailable, true);
  assert.equal(store.getState().persistenceError, null);
  assert.deepEqual(create(storage, 100).store.getState(), store.getState());
});

test('unavailable or unreadable storage remains usable in memory', () => {
  const { store } = create(null);
  store.createTask({ agentId: 'sam', title: 'Memory only' });
  assert.equal(store.getState().storageAvailable, false);
  assert.match(store.getState().persistenceError, /only for this session/);
  let writes = 0;
  const blocked = create({ getItem() { throw new Error('SecurityError'); }, setItem() { writes++; } }).store;
  blocked.startSample();
  assert.equal(blocked.getState().tasks.length, 1);
  assert.equal(blocked.getState().storageAvailable, false);
  assert.equal(writes, 0);
});

test('invalid ID providers and clock values cannot leave partial records', () => {
  const duplicate = createWorkspaceStore({ storage: memoryStorage(), now: () => 1_800_000_000_000, id: () => 'same-id' });
  assert.throws(() => duplicate.createTask({ agentId: 'sam', title: 'Duplicate IDs' }), /duplicate identifier/);
  assert.equal(duplicate.getState().tasks.length, 0);
  const clock = createWorkspaceStore({ storage: memoryStorage(), now: () => NaN, id: () => 'valid-id' });
  assert.throws(() => clock.startSample(), /invalid date/);
  assert.equal(clock.getState().tasks.length, 0);
});

test('all public statuses have visible labels and every sample transition uses them', () => {
  assert.deepEqual(Object.keys(STATUS_LABELS), ['queued', 'working', 'waiting_for_user', 'in_review', 'changes_requested', 'completed']);
  const { store } = create();
  const taskId = reviewReady(store);
  assert.equal(STATUS_LABELS[findTask(store, taskId).status], 'Ready for review');
});
