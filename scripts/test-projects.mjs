import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createProject, claimStep, completeStep, ownerCommand, requireClaim, approvalToken, publicProject, invalidateFrom, advanceProject } from '../server/project-model.js';
import { validateProjectOperation } from '../server/projects.js';
import { createProjectsHandler } from '../api/projects.js';
import { createSessionCookie, configuration } from '../server/auth.js';
import { workflowSteps, CORE_TEAM } from '../src/office/workflow-config.js';
const fresh = () => createProject({ title: 'Office improvements', brief: 'Desktop and tablet; retain privacy and owner approval.' }, { workflowVersion: 1 });
function finish(p, outcome = 'submitted') { const c = claimStep(p, 'worker'); assert(c); completeStep(p, c, { title: 'A completed artifact', body: 'Actual artifact and evidence for this unit fixture.', outcome }); return c; }
function scopeReady() { const p = fresh(); finish(p); finish(p, 'approved'); return p; }
const approve = (p, stepId) => ownerCommand(p, 'decide', { stepId, token: p.steps[stepId].token, decision: 'approved' });
test('new core projects assign six distinct roles and omit unrequested specialists', () => {
  const p = createProject({ title: 'Core project', brief: 'A scoped feature.' });
  const defs = workflowSteps(p); assert.equal(p.workflowVersion, 2);
  assert.deepEqual([...new Set(defs.map(d => d.agentId).filter(id => id !== 'owner'))].sort(), [...CORE_TEAM].sort());
  assert.equal(defs.find(d => d.id === 'implementation').agentId, 'sam');
  for (const id of ['design_system', 'motion_plan', 'coo_review', 'code_review']) assert.equal(p.steps[id], undefined);
  finish(p); finish(p, 'approved'); approve(p, 'scope_approval');
  assert.equal(p.steps.ux_plan.status, 'queued'); finish(p); finish(p, 'approved');
  assert.equal(p.steps.foundation_approval.status, 'needs_approval'); approve(p, 'foundation_approval');
  assert.equal(p.steps.figma_design.status, 'blocked'); assert.equal(p.steps.implementation.status, 'locked');
});
test('all optional specialist combinations route to the correct author and independent reviewer', () => {
  for (let mask = 0; mask < 8; mask++) {
    const specialists = ['milo', 'eden', 'alex'].filter((_, i) => mask & (1 << i));
    const p = createProject({ title: 'Selected specialists', brief: 'A focused project.', specialists: specialists.join(',') });
    const defs = workflowSteps(p); const lookup = id => defs.find(d => d.id === id);
    assert.equal(Boolean(p.steps.motion_plan), specialists.includes('milo'));
    assert.equal(Boolean(p.steps.design_system), specialists.includes('eden'));
    assert.equal(Boolean(p.steps.coo_review), specialists.includes('alex'));
    assert.equal(lookup('concept_review').agentId, 'ava');
    assert.equal(lookup('foundation_approval').returnTo, specialists.includes('eden') ? 'design_system' : 'ux_plan');
    assert.deepEqual(lookup('engineering_review').needs, ['implementation']);
    assert.deepEqual(lookup('delivery_approval').needs, [specialists.includes('alex') ? 'coo_review' : 'product_acceptance']);
    finish(p); finish(p, 'approved'); approve(p, 'scope_approval');
    if (specialists.includes('eden')) finish(p); finish(p); if (specialists.includes('milo')) finish(p);
    finish(p, 'approved'); const old = p.steps.foundation_approval.token;
    ownerCommand(p, 'decide', { stepId: 'foundation_approval', token: old, decision: 'changes_requested', comment: 'Clarify the screen states.' });
    assert.equal(p.steps[lookup('foundation_approval').returnTo].status, 'queued');
    assert.equal(p.steps.concept_review.status, 'locked'); assert.equal(p.steps.foundation_approval.status, 'locked');
  }
});
test('unsupported specialists and client-supplied workflow definitions are rejected', () => {
  for (const specialists of ['sam', 'unknown', 'milo,milo']) assert.throws(() => createProject({ title: 'test', brief: 'test', specialists }), /specialist/);
  const op = { operationId: randomUUID(), action: 'create', input: { title: 'test', brief: 'test', specialists: 'milo' } };
  assert(validateProjectOperation(op));
  assert.throws(() => validateProjectOperation({ ...op, input: { ...op.input, workflowVersion: '1' } }), /valid project/);
});
test('discard stops queued and running work, preserves artifacts and prevents stale completion or resume', () => {
  const p = createProject({ title: 'Discarded fixture', brief: 'Test cancellation.' }); finish(p); const saved = p.artifacts[0]; const claim = claimStep(p, 'worker');
  ownerCommand(p, 'discard', {}); assert(p.discardedAt); assert.equal(claimStep(p, 'worker'), null);
  assert.equal(p.artifacts[0].id, saved.id); assert.equal(p.steps.prd_review.status, 'cancelled');
  assert.throws(() => completeStep(p, claim, { title: 'Late', body: 'Late', outcome: 'approved' }), /replaced/);
  assert.throws(() => ownerCommand(p, 'resume', {}), /discarded/);
});
test('saved legacy workflows keep their original reviewer assignments', () => {
  const p = fresh(); delete p.workflowVersion; delete p.specialists;
  const defs = workflowSteps(p); assert.equal(defs.length, 19);
  assert.equal(defs.find(d => d.id === 'implementation').agentId, 'arjun');
  assert.equal(defs.find(d => d.id === 'code_review').agentId, 'jules');
  finish(p); finish(p, 'approved'); approve(p, 'scope_approval'); assert.equal(p.steps.design_system.status, 'queued');
});
test('new projects queue Nora only and reject unsigned or premature owner gates', () => {
  const p = fresh(); assert.equal(p.steps.prd.status, 'queued'); assert.equal(p.steps.design_system.status, 'locked');
  assert.throws(() => approve(p, 'scope_approval'), /approval changed/);
  assert.throws(() => ownerCommand(p, 'decide', { stepId: 'prd', decision: 'approved' }), /approval changed/);
  assert.equal(Object.values(p.steps).filter(s => s.status === 'queued').length, 1);
});
test('independent review must finish before owner approval; owner approval unlocks design planning only', () => {
  const p = fresh(); finish(p); assert.equal(p.steps.prd_review.status, 'queued'); assert.equal(p.steps.scope_approval.status, 'locked');
  finish(p, 'approved'); assert.equal(p.steps.scope_approval.status, 'needs_approval');
  assert.throws(() => ownerCommand(p, 'decide', { stepId: 'scope_approval', token: 'stale', decision: 'approved' }), /approval changed/);
  approve(p, 'scope_approval'); assert.equal(p.steps.design_system.status, 'queued'); assert.equal(p.steps.figma_design.status, 'locked'); assert.equal(p.steps.implementation.status, 'locked');
  assert.equal(p.artifacts.at(-1).authorId, 'owner');
});
test('a reviewer change request invalidates dependent approvals but retains previous versions', () => {
  const p = fresh(); finish(p); const original = p.artifacts[0]; finish(p, 'changes_requested');
  assert.equal(p.steps.prd.status, 'queued'); assert.equal(p.steps.prd_review.status, 'locked'); assert.equal(p.artifacts[0].id, original.id);
  assert.match(p.steps.prd.feedback, /theo/); assert.equal(p.events.find(e => e.text.startsWith('Revision requested')).agentId, 'theo');
  finish(p); assert.equal(p.artifacts.at(-1).version, 2);
});
test('owner feedback needs text and a new version cannot reuse an old approval token', () => {
  const p = scopeReady(), old = p.steps.scope_approval.token;
  assert.throws(() => ownerCommand(p, 'decide', { stepId: 'scope_approval', token: old, decision: 'changes_requested', comment: '' }), /feedback/);
  ownerCommand(p, 'decide', { stepId: 'scope_approval', token: old, decision: 'changes_requested', comment: 'Add a requirement for keyboard navigation.' });
  finish(p); finish(p, 'approved'); assert.notEqual(p.steps.scope_approval.token, old);
  assert.throws(() => ownerCommand(p, 'decide', { stepId: 'scope_approval', token: old, decision: 'approved' }), /approval changed/);
});
test('claims cannot cross projects, input versions, generations or worker ownership', () => {
  const p = fresh(), c = claimStep(p, 'first'); assert.equal(claimStep(p, 'second'), null);
  assert.throws(() => requireClaim(p, { ...c, owner: 'other' }), /replaced/);
  const p2 = fresh(); claimStep(p2, 'first'); assert.throws(() => requireClaim(p2, c), /replaced/);
  invalidateFrom(p, 'prd', 'Scope changed'); assert.throws(() => completeStep(p, c, { title: 'old', body: 'old', outcome: 'submitted' }), /replaced/);
});
test('expired work requires explicit retry and pause invalidates active callbacks', () => {
  const p = fresh(), c = claimStep(p, 'one', 100); assert.equal(publicProject(p, 60101).steps.prd.status, 'interrupted');
  assert.equal(claimStep(p, 'two', 60101), null);
  ownerCommand(p, 'retry', { stepId: 'prd' }, 60101); const next = claimStep(p, 'two'); assert.equal(next.attempt, 2);
  assert.throws(() => requireClaim(p, c), /replaced/);
  ownerCommand(p, 'pause', {}); assert.equal(claimStep(p, 'three'), null); assert.throws(() => requireClaim(p, next), /replaced/);
  ownerCommand(p, 'resume', {}); assert.equal(p.steps.prd.status, 'interrupted');
});
test('question replies are bound to the current question; notes do not satisfy questions or approvals', () => {
  const p = fresh(), c = claimStep(p, 'one'); const s = p.steps.prd; s.status = 'waiting_for_user'; s.question = { id: 'q1', text: 'A necessary decision' };
  ownerCommand(p, 'note', { stepId: 'prd', text: 'A note, not an answer.' }); assert.equal(s.status, 'waiting_for_user');
  assert.throws(() => ownerCommand(p, 'answer', { stepId: 'prd', questionId: 'old', text: 'Answer' }), /question/);
  ownerCommand(p, 'answer', { stepId: 'prd', questionId: 'q1', text: 'An exact answer.' }); assert.equal(s.status, 'queued'); assert.equal(s.question, null); assert.throws(() => requireClaim(p, c), /replaced/);
  assert.equal(p.messages.at(-1).questionId, 'q1');
});
test('document submissions cannot forge approval and reviewers cannot approve their own artifact', () => {
  const p = fresh(), c = claimStep(p, 'one'); assert.throws(() => completeStep(p, c, { title: 'PRD', body: 'text', outcome: 'approved' }), /cannot grant approval/);
  completeStep(p, c, { title: 'PRD', body: 'text', outcome: 'submitted' });
  p.artifacts[0].authorId = 'theo'; const review = claimStep(p, 'one');
  assert.throws(() => completeStep(p, review, { title: 'review', body: 'text', outcome: 'approved' }), /author cannot/);
});
test('design planning can reach owner review; missing Figma capability blocks screens and frontend', () => {
  const p = scopeReady(); approve(p, 'scope_approval'); finish(p); finish(p); finish(p); finish(p, 'approved');
  assert.equal(p.steps.foundation_approval.status, 'needs_approval'); approve(p, 'foundation_approval');
  assert.equal(p.steps.figma_design.status, 'blocked'); assert.match(p.steps.figma_design.error, /Figma/);
  assert.equal(p.steps.implementation.status, 'locked'); assert.throws(() => ownerCommand(p, 'retry', { stepId: 'figma_design' }), /Figma/);
});
test('both QA tracks are prerequisites for PM acceptance', () => {
  const p = fresh(); p.steps.engineering_review.status = 'completed'; advanceProject(p);
  assert.equal(p.steps.design_qa.status, 'blocked'); assert.equal(p.steps.functional_qa.status, 'blocked');
  p.steps.design_qa.status = 'completed'; advanceProject(p); assert.equal(p.steps.product_acceptance.status, 'locked');
  p.steps.functional_qa.status = 'completed'; advanceProject(p); assert.equal(p.steps.product_acceptance.status, 'queued');
});
test('project commands reject injected actor, artifacts, nested input and unsupported actions', () => {
  const base = { operationId: randomUUID(), action: 'create', input: { title: 'test', brief: 'test' } };
  assert.throws(() => validateProjectOperation({ ...base, input: { ...base.input, actor: 'owner' } }), /valid project/);
  assert.throws(() => validateProjectOperation({ ...base, input: { ...base.input, brief: {} } }), /valid project/);
  assert.throws(() => validateProjectOperation({ ...base, action: 'submit_artifact' }), /valid project/);
  assert.equal(validateProjectOperation(base).fingerprint, validateProjectOperation({ ...base, input: { brief: 'test', title: 'test' } }).fingerprint);
});
test('project endpoints require authentication before DB access and same-origin for writes', async () => {
  const env = { NODE_ENV: 'production', VERCEL: '1', DATABASE_URL: 'postgres://test.invalid/test', WORKSPACE_ACCESS_CODE: 'unit-only-project-test-access', SESSION_SECRET: 'unit-only-project-test-signing-secret' };
  let calls = 0; const handler = createProjectsHandler({ env, database: async () => { calls++; return {}; }, snapshot: async () => ({ projects: [], revision: 0 }), mutate: async () => ({}) });
  async function request(method, headers) { let body; const res = { setHeader() {}, end(v) { body = JSON.parse(v); } }; await handler({ method, headers, body: {} }, res); return { status: res.statusCode, body }; }
  assert.equal((await request('GET', {})).status, 401); assert.equal(calls, 0);
  const cookie = createSessionCookie(configuration(env)).split(';')[0];
  assert.equal((await request('POST', { cookie, host: 'office.example', origin: 'https://evil.example' })).status, 403); assert.equal(calls, 0);
  assert.equal((await request('GET', { cookie })).status, 200); assert.equal(calls, 1);
});
