import { workflowSteps, WORKFLOW_PHASES } from './workflow-config.js';
export const attentionStates = ['waiting_for_user', 'needs_approval', 'failed', 'interrupted', 'blocked'];
export function currentStep(project) {
  const defs = workflowSteps(project);
  for (const status of [...attentionStates, 'working', 'queued', 'locked']) {
    const step = defs.find(d => project.steps[d.id]?.status === status);
    if (step) return step;
  }
  return defs.at(-1);
}
export function projectSummary(project) {
  const step = currentStep(project), state = project.steps[step.id];
  const phase = WORKFLOW_PHASES.find(p => p.ids.includes(step.id))?.title || 'Requirements';
  if (project.draft) return { label: 'Draft', tone: 'neutral', step, phase: 'Getting started' };
  if (project.steps.delivery_approval?.status === 'completed') return { label: 'Completed', tone: 'green', step, phase: 'Delivered' };
  if (project.paused) return { label: 'Paused', tone: 'neutral', step, phase };
  if (attentionStates.includes(state.status)) return { label: state.status === 'needs_approval' ? 'Needs approval' : state.status === 'waiting_for_user' ? 'Question for you' : 'Needs attention', tone: 'amber', step, phase };
  return { label: state.status === 'working' ? 'In progress' : 'Ready to work', tone: 'green', step, phase };
}
export function activeProject(projects) {
  return projects.find(p => !p.paused && !p.draft && !p.discardedAt && p.steps.delivery_approval?.status !== 'completed');
}
export function projectAttention(projects) {
  return projects.flatMap(p => p.draft || p.paused ? [] : workflowSteps(p).filter(d => attentionStates.includes(p.steps[d.id]?.status)).map(d => ({ project: p, definition: d, step: p.steps[d.id] })));
}
export function previewProjects() {
  const now = Date.now();
  const make = (id, title, brief, stage, paused) => {
    const p = { id, title, brief, sourceText: '', figmaUrl: '', designSystemUrl: '', repository: 'priyanshp1859/Virtual-Team', resources: [], workflowVersion: 2, specialists: [], draft: false, paused, createdAt: now, updatedAt: now, artifacts: [], messages: [], events: [], steps: {}, preview: true };
    let passed = false;
    for (const d of workflowSteps(p)) { if (d.id === stage) passed = true; p.steps[d.id] = { id: d.id, status: !passed ? 'completed' : d.id === stage ? 'queued' : 'locked', version: 0 }; }
    return p;
  };
  const abc = make('preview-abc', 'ABC', 'A calmer checkout experience. Help customers review their order, choose a payment method and recover from a failed payment.', 'scope_approval', false);
  abc.steps.scope_approval.status = 'needs_approval';
  abc.artifacts = [{ id: 'preview-prd', title: 'Checkout experience · PRD', stepId: 'prd', authorId: 'nora', version: 1, body: '# Checkout experience\n\nThis is sample content for reviewing the screens.\n\n## Goal\nHelp customers complete checkout with confidence.\n\n- Make totals and fees clear before payment.\n- Preserve the order if payment fails.\n- Support keyboard navigation on desktop and tablet.\n\n## Acceptance criteria\n1. Customers can review the total before confirming.\n2. A failed payment offers a clear retry without duplicating the order.\n3. Each input has an accessible label.', createdAt: now - 25 * 60000 }];
  abc.events = [{ id: 'e1', text: 'Theo finished the independent PRD review.', createdAt: now - 10 * 60000 }, { id: 'e2', text: 'Nora prepared the first PRD.', createdAt: now - 25 * 60000 }];
  const xyz = make('preview-xyz', 'XYZ', 'A thoughtful brand website that explains the product and makes it easy for visitors to get in touch.', 'ux_plan', true);
  xyz.events = [{ id: 'e3', text: 'Project paused after scope approval.', createdAt: now - 86400000 }];
  const atlas = make('preview-atlas', 'Atlas', 'A booking platform for small teams. Start by exploring the customer journey and defining the first release.', 'prd', true); atlas.draft = true;
  return [abc, xyz, atlas];
}
