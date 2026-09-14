import test from 'node:test';
import assert from 'node:assert/strict';
import { newRun, addRunMessage, effectiveStatus, decideRun, queueChatMessage, finishChat, runKey } from '../server/runtime.js';
import { chatInput, chatInstructions } from '../worker/chat-context.js';
import { chatDelivery } from '../src/office/chat-status.js';
import { CORE_TEAM } from '../src/office/workflow-config.js';
import { cleanEnvironment } from '../worker/codex-client.js';
import { checkoutPath } from '../worker/repository.js';

function review() {
  const run = newRun('task-1'); run.status = 'in_review';
  run.review = { revision: 2, digest: 'exact-content-hash', decision: null, publishable: true };
  return run;
}
test('offline leases become interrupted without automatically re-executing work', () => {
  const run = newRun('task-1'); run.status = 'working'; run.leaseUntil = 100;
  assert.equal(effectiveStatus(run, 101), 'interrupted');
  assert.equal(run.status, 'working');
  run.status = 'in_review'; assert.equal(effectiveStatus(run, 101), 'in_review');
});
test('approval requires the exact reviewed revision and content', () => {
  const run = review();
  assert.throws(() => decideRun(run, { revision: 1, digest: run.review.digest, decision: 'approved' }), /changed/);
  assert.throws(() => decideRun(run, { revision: 2, digest: 'other-code', decision: 'approved' }), /changed/);
  assert.equal(run.review.decision, null);
});
test('failed checks cannot be approved for publishing', () => {
  const run = review(); run.review.publishable = false;
  assert.throws(() => decideRun(run, { revision: 2, digest: run.review.digest, decision: 'approved' }), /cannot be published/);
  assert.equal(run.status, 'in_review');
});
test('an exact approval queues publishing and does not mark work merged', () => {
  const run = review(); decideRun(run, { revision: 2, digest: run.review.digest, decision: 'approved' });
  assert.equal(run.mode, 'publish'); assert.equal(run.status, 'queued'); assert.equal(run.review.decision, 'approved');
  assert.match(run.messages[0].text, /manual merging/);
  assert.throws(() => decideRun(run, { revision: 2, digest: run.review.digest, decision: 'approved' }), /changed/);
});
test('change requests need feedback and queue another code iteration', () => {
  const run = review();
  assert.throws(() => decideRun(run, { revision: 2, digest: run.review.digest, decision: 'changes_requested' }), /feedback/);
  decideRun(run, { revision: 2, digest: run.review.digest, decision: 'changes_requested', comment: 'Keep the keyboard shortcut.' });
  assert.equal(run.mode, 'code'); assert.equal(run.review.comment, 'Keep the keyboard shortcut.');
});
test('repeated runtime event IDs do not duplicate chat entries', () => {
  const run = newRun(null); addRunMessage(run, 'Hello', 'agent', 'event-1'); addRunMessage(run, 'Hello', 'agent', 'event-1');
  assert.equal(run.messages.length, 1); assert.equal(run.messages[0].delivery, 'live');
});
test('the coding subprocess cannot inherit database or cloud credentials', () => {
  const result = cleanEnvironment({ PATH: '/bin', HOME: '/user', DATABASE_URL: 'private', SESSION_SECRET: 'private', WORKSPACE_ACCESS_CODE: 'private', GH_TOKEN: 'private', OPENAI_API_KEY: 'private', VERCEL_TOKEN: 'private' });
  assert.deepEqual(result, { PATH: '/bin', HOME: '/user' });
});
test('task IDs never become filesystem paths', () => {
  assert.match(checkoutPath('/safe/state', '../../escape'), /^\/safe\/state\/jobs\/[a-f0-9]{24}\/repo$/);
  assert.notEqual(checkoutPath('/safe/state', 'one'), checkoutPath('/safe/state', 'two'));
});
test('core general conversations have distinct identities, references and checkout paths', () => {
  const paths = new Set();
  for (const agentId of CORE_TEAM) {
    const run = newRun(null, 1, agentId);
    addRunMessage(run, 'A response', 'agent');
    assert.equal(run.messages[0].agentId, agentId);
    assert.equal(run.mode, 'chat');
    paths.add(checkoutPath('/safe/state', runKey(null, agentId)));
    assert.match(chatInstructions(agentId, '/skills'), /General chat is read-only/);
  }
  assert.equal(paths.size, 6);
  assert.throws(() => newRun(null, 1, 'milo'), /not connected/);
  assert.throws(() => newRun('task-1', 1, 'nora'), /not connected/);
});
test('a new message during a reply remains queued even if the first response came later', () => {
  const run = newRun(null, 1, 'nora');
  run.status = 'working'; run.owner = 'worker'; run.leaseUntil = Date.now() + 60_000;
  run.inputMessages = ['first'];
  queueChatMessage(run, { text: 'Follow-up', messageId: 'second' });
  finishChat(run);
  assert.equal(run.status, 'queued');
  assert.deepEqual(run.respondedMessageIds, ['first']);
  assert.equal(run.owner, null);
  const user = (id, agentId, taskId, text, createdAt) => ({ id, agentId, taskId, text, createdAt, role: 'user' });
  run.messages = [{ ...user('reply', 'nora', null, 'First reply', 4), role: 'agent' }];
  const input = chatInput([
    user('first', 'nora', null, 'Initial question', 1), user('second', 'nora', null, 'Follow-up', 2),
    user('private-maya', 'maya', null, 'Another chat secret', 2), user('private-task', 'nora', 'task-1', 'Assignment secret', 2),
  ], run);
  assert.doesNotMatch(input, /Another chat secret|Assignment secret/);
  assert.equal(input.split('NEW USER MESSAGES\n')[1], 'Owner: Follow-up');
});
test('chat questions release the worker and only their matching answer queues a continuation', () => {
  const run = newRun(null, 1, 'noor');
  run.status = 'working'; run.owner = 'worker'; run.question = { id: 'q1', text: 'Which browser?' }; run.inputMessages = ['first'];
  finishChat(run, { asked: true });
  assert.equal(effectiveStatus(run, Date.now() + 999_999), 'waiting_for_user');
  assert.equal(run.owner, null);
  assert.throws(() => queueChatMessage(run, { questionId: 'old', text: 'Chrome' }), /question changed/);
  queueChatMessage(run, { questionId: 'q1', text: 'Chrome', messageId: 'answer' });
  assert.equal(run.status, 'queued'); assert.equal(run.question, null);
  assert.equal(run.answer.text, 'Chrome');
});
test('chat message delivery distinguishes replies, queued follow-ups, offline and recovery', () => {
  const execution = { status: 'working', respondedMessageIds: ['old'], inputMessageIds: ['old', 'current'] };
  assert.equal(chatDelivery('old', execution, true), 'Reply received');
  assert.equal(chatDelivery('current', execution, true), 'Agent is preparing a reply');
  assert.equal(chatDelivery('followup', execution, true), 'Queued for a reply');
  assert.equal(chatDelivery('current', execution, false), 'Saved · waiting for the worker');
  assert.match(chatDelivery('current', { ...execution, status: 'failed' }, true), /retry/);
  assert.match(chatDelivery('current', { ...execution, status: 'cancelled' }, true), /Stopped/);
  assert.equal(chatDelivery('old-message', null, true), 'Saved · ready to send');
});
