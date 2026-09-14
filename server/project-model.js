import { randomUUID, createHash } from 'node:crypto';
import { ApiError } from './errors.js';
import { WORKFLOW_STEPS, WORKFLOW_CAPABILITIES, CAPABILITY_REASON, workflowSteps, PROJECT_SPECIALISTS } from '../src/office/workflow-config.js';
export const PROJECT_LEASE_MS = 60_000;
const fail = message => { throw new ApiError(409, 'project_conflict', message); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function text(value, label, max = 24000, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new ApiError(400, 'invalid_input', `Enter ${label}${max ? ` (up to ${max.toLocaleString()} characters)` : ''}.`);
  return value.trim();
}
export function definition(id, project) { const item = workflowSteps(project).find(d => d.id === id); if (!item) fail('Unknown project step.'); return item; }
export function event(project, message, agentId = 'system', now = Date.now()) {
  if (project.events.length >= 1000) fail('The project has reached its activity limit. Existing records are preserved.');
  project.events.push({ id: randomUUID(), agentId, text: message.slice(0, 3000), createdAt: now });
}
function artifact(project, step) { return project.artifacts.find(a => a.id === step.artifactId); }
export function inputsFor(project, stepId) {
  const all = new Set();
  const visit = id => { for (const parent of definition(id, project).needs) { visit(parent); const a = artifact(project, project.steps[parent]); if (a) all.add(a.id); } };
  visit(stepId);
  return [...all].sort().map(id => { const a = project.artifacts.find(a => a.id === id); return { id, digest: a.digest }; });
}
export function approvalToken(project, stepId) { return hash([project.id, stepId, project.steps[stepId].generation, inputsFor(project, stepId)]); }
export function advanceProject(project, capabilities = WORKFLOW_CAPABILITIES) {
  if (project.paused || project.discardedAt) return;
  for (const d of workflowSteps(project)) {
    const step = project.steps[d.id];
    if (step.status !== 'locked' || !d.needs.every(id => project.steps[id].status === 'completed')) continue;
    step.inputs = inputsFor(project, d.id);
    step.token = approvalToken(project, d.id);
    if (d.kind === 'approval') { step.status = 'needs_approval'; event(project, `${d.title} is ready.`, 'system'); }
    else if (!capabilities[d.kind]) { step.status = 'blocked'; step.error = CAPABILITY_REASON[d.kind] || 'This step needs a connected capability.'; event(project, `${d.title}: ${step.error}`); }
    else { step.status = 'queued'; event(project, `${d.title} handed to ${d.agentId}.`, d.agentId); }
  }
}
export function createProject(input, { id = randomUUID(), now = Date.now(), workflowVersion = 2 } = {}) {
  const title = text(input.title, 'a project title', 140), brief = text(input.brief, 'the project brief', 12000);
  const sourceText = text(input.sourceText || '', 'project reference text', 16000, false);
  const specialists = text(input.specialists || '', 'specialist selections', 100, false).split(',').filter(Boolean).sort();
  if (new Set(specialists).size !== specialists.length || specialists.some(id => !PROJECT_SPECIALISTS.some(s => s.id === id))) throw new ApiError(400, 'invalid_input', 'Choose supported project specialists.');
  for (const key of ['figmaUrl', 'designSystemUrl']) {
    if (input[key]) { let u; try { u = new URL(input[key]); } catch {} if (!u || u.protocol !== 'https:' || u.username || u.password || input[key].length > 1800) throw new ApiError(400, 'invalid_input', 'Use an HTTPS reference link without credentials.'); }
  }
  const project = { version: 1, workflowVersion, specialists, id, title, brief, sourceText, figmaUrl: input.figmaUrl || '', designSystemUrl: input.designSystemUrl || '', repository: 'priyanshp1859/Virtual-Team', paused: false, revision: 1, createdAt: now, updatedAt: now, steps: {}, artifacts: [], messages: [], events: [] };
  for (const d of workflowSteps(project)) project.steps[d.id] = { id: d.id, status: 'locked', generation: 1, attempt: 0, version: 0, artifactId: null, inputs: [], token: null, owner: null, leaseUntil: 0, question: null, error: null, activity: null, revisionRounds: 0 };
  event(project, 'Project created. Nora will prepare the PRD; your approval is required before design work.', 'owner', now);
  advanceProject(project); return project;
}
export function invalidateFrom(project, stepId, comment, actor = 'owner') {
  const affected = new Set([stepId]);
  for (const d of workflowSteps(project)) if (d.needs.some(id => affected.has(id))) affected.add(d.id);
  for (const id of affected) {
    const step = project.steps[id]; step.generation++; step.status = 'locked'; step.artifactId = null; step.owner = null; step.leaseUntil = 0; step.question = null; step.activity = null; step.token = null; step.error = null; step.inputs = [];
  }
  project.steps[stepId].feedback = comment;
  event(project, `Revision requested for ${definition(stepId, project).title}: ${comment}`, actor);
}
export function ownerCommand(project, action, input, now = Date.now()) {
  if (project.discardedAt) fail('This project was discarded. Create a new brief to start again.');
  const step = input.stepId ? project.steps[input.stepId] : null;
  if (input.stepId && !step) fail('Choose a step in this project.');
  if (action === 'decide') {
    if (!step || definition(step.id, project).kind !== 'approval' || step.status !== 'needs_approval' || input.token !== approvalToken(project, step.id) || project.paused) fail('This approval changed or is no longer ready. Refresh and review its current version.');
    if (!['approved', 'changes_requested'].includes(input.decision)) fail('Choose approve or request changes.');
    const comment = text(input.comment || '', 'review feedback', 5000, input.decision === 'changes_requested');
    if (input.decision === 'changes_requested') invalidateFrom(project, definition(step.id, project).returnTo, comment);
    else {
      const a = { id: randomUUID(), stepId: step.id, authorId: 'owner', version: ++step.version, title: definition(step.id, project).title, body: comment || 'Approved the listed scope and versions.', inputs: inputsFor(project, step.id), createdAt: now, outcome: 'approved' };
      a.digest = hash(a); project.artifacts.push(a); step.artifactId = a.id; step.status = 'completed';
      event(project, `${definition(step.id, project).title}: approved. This does not merge or deploy code.`, 'owner', now);
    }
  } else if (action === 'answer') {
    if (!step || step.status !== 'waiting_for_user' || input.questionId !== step.question?.id) fail('This question is no longer awaiting your answer.');
    const message = text(input.text, 'your answer', 5000);
    if (project.messages.length >= 300) fail('The project conversation is full.');
    project.messages.push({ id: randomUUID(), stepId: step.id, agentId: 'owner', text: message, questionId: step.question.id, createdAt: now });
    step.question = null; step.generation++; step.owner = null; step.leaseUntil = 0; step.status = 'queued'; step.activity = null;
    event(project, `Your answer was sent to ${definition(step.id, project).agentId}.`, 'owner', now);
  } else if (action === 'note') {
    const message = text(input.text, 'a project note', 5000);
    if (project.messages.length >= 300) fail('The project conversation is full.');
    project.messages.push({ id: randomUUID(), stepId: step?.id || null, agentId: 'owner', text: message, createdAt: now });
    event(project, 'A project note was saved. Notes do not change approved scope or grant approvals.', 'owner', now);
  } else if (action === 'retry') {
    if (!step || !['failed', 'interrupted', 'blocked', 'cancelled'].includes(effectiveStepStatus(step, now))) fail('This step cannot be retried now.');
    const d = definition(step.id, project);
    if (!WORKFLOW_CAPABILITIES[d.kind]) fail(CAPABILITY_REASON[d.kind] || 'Connect the required capability before retrying.');
    if (!d.needs.every(id => project.steps[id].status === 'completed')) fail('Earlier approvals or reviews must finish first.');
    step.status = 'queued'; step.generation++; step.owner = null; step.error = null; step.question = null; step.activity = null;
    event(project, `${d.title} queued for an explicit retry.`, 'owner', now);
  } else if (action === 'discard') {
    project.discardedAt = now; project.paused = true;
    for (const s of Object.values(project.steps)) if (s.status !== 'completed') { s.status = 'cancelled'; s.generation++; s.owner = null; s.leaseUntil = 0; s.question = null; s.activity = null; }
    event(project, 'Project discarded by the owner. No further work will run.', 'owner', now);
  } else if (action === 'pause') {
    project.paused = true;
    for (const s of Object.values(project.steps)) if (['working', 'waiting_for_user'].includes(s.status)) { s.status = 'interrupted'; s.generation++; s.owner = null; s.leaseUntil = 0; s.question = null; s.activity = null; s.error = 'Project paused. Existing work was preserved; retry this step when ready.'; }
    event(project, 'Project paused. No new steps will start.', 'owner', now);
  } else if (action === 'resume') { project.paused = false; event(project, 'Project resumed. Interrupted steps require an explicit retry.', 'owner', now); }
  else fail('Unknown project action.');
  advanceProject(project); return project;
}
export function effectiveStepStatus(step, now = Date.now()) { return step.status === 'working' && step.leaseUntil < now ? 'interrupted' : step.status; }
export function claimStep(project, owner, now = Date.now()) {
  if (project.paused || project.discardedAt) return null;
  const step = Object.values(project.steps).find(s => s.status === 'queued'); if (!step) return null;
  const d = definition(step.id, project);
  if (!WORKFLOW_CAPABILITIES[d.kind] || !d.needs.every(id => project.steps[id].status === 'completed')) fail('This step is not eligible to run.');
  step.owner = owner; step.attempt++; step.status = 'working'; step.leaseUntil = now + PROJECT_LEASE_MS; step.error = null; step.activity = 'Reading the project brief';
  step.inputs = inputsFor(project, step.id); event(project, `${d.title} started.`, d.agentId, now);
  return { projectId: project.id, stepId: step.id, owner, attempt: step.attempt, generation: step.generation, inputs: structuredClone(step.inputs) };
}
export function requireClaim(project, claim, now = Date.now()) {
  const step = project.steps[claim.stepId];
  if (project.id !== claim.projectId || project.paused || !step || !['working', 'waiting_for_user'].includes(step.status) || step.owner !== claim.owner || step.attempt !== claim.attempt || step.generation !== claim.generation || step.leaseUntil < now || hash(inputsFor(project, step.id)) !== hash(claim.inputs)) fail('This run was replaced, stopped or its inputs changed.');
  return step;
}
export function completeStep(project, claim, result, now = Date.now()) {
  const step = requireClaim(project, claim, now), d = definition(step.id, project);
  if (step.status !== 'working') fail('Answer the pending question before completing this step.');
  const title = text(result.title, 'an artifact title', 160), body = text(result.body, 'the completed document or review', 24000);
  const outcome = result.outcome;
  if (d.kind === 'document' && !['submitted', 'blocked'].includes(outcome)) fail('A document submission cannot grant approval.');
  if (d.kind === 'review' && !['approved', 'changes_requested', 'blocked'].includes(outcome)) fail('An independent review must record its decision.');
  if (d.kind === 'review' && step.inputs.some(ref => project.artifacts.find(a => a.id === ref.id)?.authorId === d.agentId)) {
    // Review only direct targets for authorship; participation in an earlier, unrelated stage is allowed.
    if (d.needs.some(id => artifact(project, project.steps[id])?.authorId === d.agentId)) fail('An author cannot independently approve their own work.');
  }
  if (project.artifacts.length >= 150) fail('The project artifact history is full.');
  const a = { id: randomUUID(), stepId: step.id, authorId: d.agentId, version: ++step.version, title, body, inputs: structuredClone(claim.inputs), createdAt: now, outcome: d.kind === 'review' ? outcome : 'submitted' };
  a.digest = hash(a); project.artifacts.push(a); step.artifactId = a.id; step.owner = null; step.leaseUntil = 0; step.activity = null;
  if (d.kind === 'review' && outcome === 'changes_requested') {
    step.revisionRounds++; const rounds = step.revisionRounds;
    invalidateFrom(project, d.returnTo, `${d.agentId}'s review: ${body}`, d.agentId);
    if (rounds >= 2) { project.steps[d.returnTo].status = 'blocked'; project.steps[d.returnTo].error = 'Two review rounds need your attention. Read the feedback, then explicitly retry when ready.'; }
    event(project, `${d.title}: changes requested.`, d.agentId, now);
  } else if (outcome === 'blocked') { step.status = 'blocked'; step.error = body; event(project, `${d.title}: blocked.`, d.agentId, now); }
  else { step.status = 'completed'; event(project, `${d.title} completed; ${d.output || 'artifact'} v${a.version} saved.`, d.agentId, now); }
  advanceProject(project); return a;
}
export function publicProject(project, now = Date.now()) {
  const copy = structuredClone(project);
  delete copy.checkout; delete copy.base; delete copy.branch;
  for (const step of Object.values(copy.steps)) { step.status = effectiveStepStatus(step, now); delete step.owner; delete step.leaseUntil; if (step.status === 'interrupted') step.error ||= 'Worker interrupted. Work is preserved; explicitly retry when it is online.'; }
  return copy;
}
