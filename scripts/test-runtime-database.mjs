// Explicit integration check: a temporary schema in the separate QA database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { createRepository } from '../server/database.js';
import { mutateWorkspace, readWorkspace } from '../server/workspace.js';
import { runtimeHooks, runtimeTransaction, runtimeSnapshot, workerHeartbeat, claimRun, updateOwnedRun, getRun, saveRun, finishChat, addRunMessage } from '../server/runtime.js';

const url = process.env.DATABASE_URL;
if (!url || new URL(url).pathname !== '/virtual_team_qa') throw new Error('Use the separate virtual_team_qa database for this check.');
const schema = `runtime_test_${randomUUID().replaceAll('-', '')}`;
const admin = postgres(url, { max: 1, prepare: false });
// Scope every transaction explicitly; managed connections can reset startup settings.
const pool = postgres(url, { max: 5, prepare: false });
async function scoped(callback) {
  return pool.begin(async tx => {
    await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
    assert.equal((await tx`SELECT current_schema() AS schema`)[0].schema, schema, 'Never run outside the temporary test schema.');
    return callback(tx);
  });
}
const sql = (...args) => scoped(tx => tx(...args));
sql.begin = scoped;
sql.json = pool.json;
sql.unsafe = source => scoped(tx => tx.unsafe(source));
const db = createRepository(sql);
const command = (action, input, operationId = randomUUID()) => mutateWorkspace(db, { action, input, operationId }, { runtime: runtimeHooks });
try {
  await admin.unsafe(`CREATE SCHEMA ${schema}`);
  assert.equal((await sql`SELECT current_schema() AS schema`)[0].schema, schema, 'Never run outside the temporary test schema.');
  for (const migration of ['001-workspace.sql', '002-runtime.sql', '003-project-workflow.sql']) await sql.unsafe(await readFile(new URL(`../db/${migration}`, import.meta.url), 'utf8'));
  const operationId = randomUUID();
  const input = { agentId: 'sam', title: 'Runtime integration verification', brief: 'This isolated schema is removed after the checks.' };
  const [first, replay] = await Promise.all([command('createTask', input, operationId), command('createTask', input, operationId)]);
  assert.equal(first.result, replay.result);
  assert.equal((await readWorkspace(db)).state.tasks.length, 1);
  assert.equal((await sql`SELECT id FROM virtual_team_runs`).length, 1);
  const id = first.result, owner = randomUUID(), other = randomUUID();
  await workerHeartbeat(sql, owner);
  await assert.rejects(workerHeartbeat(sql, other), /Another Sam worker/);
  const job = await claimRun(sql, owner);
  assert.equal(job.run.taskId, id);
  assert.equal(await claimRun(sql, owner), null);
  await updateOwnedRun(sql, id, owner, job.run.attempt, run => { run.status = 'waiting_for_user'; run.question = { id: 'current-question', text: 'Choose a word.' }; });
  const before = await readWorkspace(db);
  await assert.rejects(command('sendMessage', { agentId: 'sam', taskId: id, text: 'Old answer', questionId: 'old-question' }), /question changed/);
  assert.deepEqual(await readWorkspace(db), before, 'Rejected answers roll back their user message and receipt.');
  const answerId = randomUUID();
  await command('sendMessage', { agentId: 'sam', taskId: id, text: 'sunflower', questionId: 'current-question' }, answerId);
  await command('sendMessage', { agentId: 'sam', taskId: id, text: 'sunflower', questionId: 'current-question' }, answerId);
  assert.equal((await getRun(sql, id)).answer.text, 'sunflower');
  assert.equal((await readWorkspace(db)).state.messages.filter(message => message.role === 'user').length, 1);
  await command('cancelRun', { taskId: id });
  await assert.rejects(updateOwnedRun(sql, id, owner, job.run.attempt, run => { run.status = 'completed'; }), /stopped/);
  assert.equal((await getRun(sql, id)).status, 'cancelled');
  await command('runTask', { taskId: id });
  const retried = await claimRun(sql, owner);
  assert.equal(retried.run.attempt, job.run.attempt + 1);
  await assert.rejects(updateOwnedRun(sql, id, owner, job.run.attempt, () => {}), /replaced/);
  await runtimeTransaction(sql, async tx => {
    const run = await getRun(tx, id); run.leaseUntil = 1; await saveRun(tx, run); return { changed: true };
  });
  const snapshot = await runtimeSnapshot(sql, await readWorkspace(db));
  assert.equal(snapshot.state.tasks[0].status, 'interrupted');
  assert.equal(await claimRun(sql, owner), null, 'Expired work is never silently resumed.');
  assert.equal(snapshot.state.tasks[0].execution.owner, undefined);
  assert.equal(snapshot.state.tasks[0].execution.checkout, undefined);
  await command('runTask', { taskId: id });
  const final = await claimRun(sql, owner);
  await updateOwnedRun(sql, id, owner, final.run.attempt, run => {
    run.status = 'in_review'; run.review = { revision: 1, digest: 'exact', publishable: true, decision: null };
  });
  await assert.rejects(command('runTask', { taskId: id }), /Review this revision/);
  await command('reviewRun', { taskId: id, revision: 1, digest: 'exact', decision: 'approved' });
  assert.equal((await claimRun(sql, owner)).run.status, 'publishing');
  await assert.rejects(command('cancelRun', { taskId: id }), /already being published/);
  // General chats share the worker, never another role's history or task queue.
  await command('sendMessage', { agentId: 'milo', text: 'Specialist outbox only.' });
  const noraOp = randomUUID(), noraInput = { agentId: 'nora', text: 'Nora-only greeting' };
  const noraMessage = await command('sendMessage', noraInput, noraOp);
  await command('sendMessage', noraInput, noraOp);
  await command('sendMessage', { agentId: 'maya', text: 'Maya-only greeting' });
  assert.equal(await getRun(sql, null, 'milo'), null);
  const nora = await claimRun(sql, owner);
  assert.equal(nora.run.agentId, 'nora');
  assert.deepEqual(nora.messages.map(m => m.text), ['Nora-only greeting']);
  const maya = await claimRun(sql, owner);
  assert.equal(maya.run.agentId, 'maya');
  assert.deepEqual(maya.messages.map(m => m.text), ['Maya-only greeting']);
  const noraUpdate = mutate => updateOwnedRun(sql, null, owner, nora.run.attempt, mutate, { agentId: 'nora' });
  const followup = await command('sendMessage', { agentId: 'nora', text: 'Nora follow-up during reply' });
  await noraUpdate(run => { addRunMessage(run, 'Nora reply', 'agent'); finishChat(run); });
  assert.equal((await getRun(sql, null, 'nora')).status, 'queued');
  assert.deepEqual((await getRun(sql, null, 'nora')).respondedMessageIds, [noraMessage.result]);
  await command('cancelRun', { taskId: 'maya:general' });
  await assert.rejects(updateOwnedRun(sql, null, owner, maya.run.attempt, () => {}, { agentId: 'maya' }), /stopped/);
  const nextNora = await claimRun(sql, owner);
  assert.equal(nextNora.run.agentId, 'nora');
  assert(nextNora.run.inputMessages.includes(followup.result));
  await assert.rejects(noraUpdate(() => {}), /replaced/);
  await updateOwnedRun(sql, null, owner, nextNora.run.attempt, run => {
    run.question = { id: 'nora-question', text: 'Which screen?' }; finishChat(run, { asked: true });
  }, { agentId: 'nora' });
  await command('runTask', { taskId: 'maya:general' });
  const mayaRetry = await claimRun(sql, owner);
  assert.equal(mayaRetry.run.agentId, 'maya', 'A question in Nora chat does not block Maya.');
  await updateOwnedRun(sql, null, owner, mayaRetry.run.attempt, run => { addRunMessage(run, 'Maya reply', 'agent'); finishChat(run); }, { agentId: 'maya' });
  const beforeOldAnswer = await readWorkspace(db);
  await assert.rejects(command('sendMessage', { agentId: 'nora', text: 'An outdated answer', questionId: 'old' }), /question changed/);
  assert.deepEqual(await readWorkspace(db), beforeOldAnswer);
  await command('sendMessage', { agentId: 'nora', text: 'Payment screen', questionId: 'nora-question' });
  await assert.rejects(updateOwnedRun(sql, null, owner, nextNora.run.attempt, () => {}, { agentId: 'nora' }), /replaced/);
  const continued = await claimRun(sql, owner);
  assert.equal(continued.run.agentId, 'nora');
  assert(continued.messages.some(m => m.text === 'Payment screen'));
  await updateOwnedRun(sql, null, owner, continued.run.attempt, finishChat, { agentId: 'nora' });
  const chats = await runtimeSnapshot(sql, await readWorkspace(db));
  assert.equal(chats.state.runtime.chatOnline, true);
  assert.equal(chats.state.runtime.generals.nora.status, 'completed');
  assert.equal(chats.state.runtime.generals.maya.status, 'completed');
  assert.equal(chats.state.messages.find(m => m.text === 'Nora reply').agentId, 'nora');
  assert.equal(chats.state.messages.find(m => m.text === 'Maya reply').agentId, 'maya');
  assert.equal(chats.state.messages.filter(m => m.agentId === 'nora' && m.delivery === 'local' && m.role === 'system').length, 0);
  assert.equal(chats.state.runtime.generals.nora.owner, undefined);
  await assert.rejects(command('runTask', { taskId: 'milo:general' }), /real task/);
  await assert.rejects(command('reviewRun', { taskId: 'nora:general', revision: 1, digest: 'exact', decision: 'approved' }), /No live result/);
  console.log('PASS database queue idempotency, question binding, rollback, cancellation, retry, lease fencing and approval state.');
  console.log('PASS core chat isolation, pending follow-ups, question release, role-specific cancellation, retry, late-result fencing and snapshot delivery.');
} finally {
  await pool.end();
  await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
