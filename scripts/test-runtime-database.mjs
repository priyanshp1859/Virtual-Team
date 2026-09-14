// Explicit integration check: a temporary schema in the separate QA database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { createRepository } from '../server/database.js';
import { mutateWorkspace, readWorkspace } from '../server/workspace.js';
import { runtimeHooks, runtimeTransaction, runtimeSnapshot, workerHeartbeat, claimRun, updateOwnedRun, getRun, saveRun } from '../server/runtime.js';

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
  console.log('PASS database queue idempotency, question binding, rollback, cancellation, retry, lease fencing and approval state.');
} finally {
  await pool.end();
  await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
