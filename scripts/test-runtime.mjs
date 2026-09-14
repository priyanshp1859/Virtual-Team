import test from 'node:test';
import assert from 'node:assert/strict';
import { newRun, addRunMessage, effectiveStatus, decideRun } from '../server/runtime.js';
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
