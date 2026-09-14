// A handoff advances only when every listed prerequisite has completed.
export const WORKFLOW_STEPS = [
  { id: 'prd', title: 'Write the PRD', agentId: 'nora', kind: 'document', needs: [], output: 'Product requirements document', guidance: 'Create a project-specific PRD from the owner brief and source text. Include users, goals, scope, exclusions, journeys, requirements with stable IDs, measurable acceptance criteria, constraints, dependencies, assumptions and open questions. Read the actual repository where relevant. Do not block the PRD on a missing Figma link; record it as an input needed for design. Do not invent user research.' },
  { id: 'prd_review', title: 'Review scope and feasibility', agentId: 'theo', kind: 'review', needs: ['prd'], returnTo: 'prd', output: 'PRD feasibility review', guidance: 'Independently inspect the PRD and relevant current source. Check feasibility, scope boundaries, dependencies and whether the acceptance criteria are testable. Return approved, changes_requested or blocked, with concrete evidence and actionable feedback. Missing future design access alone does not block PRD approval.' },
  { id: 'scope_approval', title: 'Your PRD approval', agentId: 'owner', kind: 'approval', needs: ['prd_review'], returnTo: 'prd' },
  { id: 'design_system', title: 'Assess design foundations', agentId: 'eden', kind: 'document', needs: ['scope_approval'], output: 'Design system proposal', guidance: 'Inspect existing code components and tokens. Propose reuse, minimal extension or a new foundation, with explicit missing Figma evidence. This is a proposal, not a claim that a Figma library was created or inspected. Cover desktop and tablet, component states, accessibility and code/Figma consistency.' },
  { id: 'ux_plan', title: 'Plan the office experience', agentId: 'maya', kind: 'document', needs: ['design_system'], output: 'UX and screen brief', guidance: 'Translate approved PRD requirements and design foundations into user journeys, information architecture, screen/state inventory and design handoff criteria. Record layout and navigation proposals in text. Do not claim Figma frames or visual review exist. Include the full team and department presence when the brief calls for it.' },
  { id: 'motion_plan', title: 'Plan motion and interactions', agentId: 'milo', kind: 'document', needs: ['ux_plan'], output: 'Motion specification', guidance: 'Specify purposeful transitions and interactive feedback for the UX plan, including triggers, duration/easing guidance, reduced motion, keyboard behavior and performance constraints. Do not add perpetual decorative motion or removed office activities. This is a specification; do not claim implementation or measurements.' },
  { id: 'concept_review', title: 'Lead designer reviews the direction', agentId: 'ava', kind: 'review', needs: ['design_system', 'ux_plan', 'motion_plan'], returnTo: 'design_system', output: 'Design direction review', guidance: 'Independently review the written design foundation, UX and motion proposals against the approved PRD. Check coherence, usability, accessibility, desktop/tablet scope and handoff completeness. This is a concept review, not approval of unseen Figma frames.' },
  { id: 'foundation_approval', title: 'Your design direction approval', agentId: 'owner', kind: 'approval', needs: ['concept_review'], returnTo: 'design_system' },
  { id: 'figma_design', title: 'Create the Figma designs', agentId: 'maya', kind: 'figma', needs: ['foundation_approval'], output: 'Versioned Figma design' },
  { id: 'design_review', title: 'Lead designer reviews the screens', agentId: 'ava', kind: 'figma_review', needs: ['figma_design'], returnTo: 'figma_design', output: 'Screen design review' },
  { id: 'design_approval', title: 'Your screen design approval', agentId: 'owner', kind: 'approval', needs: ['design_review'], returnTo: 'figma_design' },
  { id: 'implementation', title: 'Implement the approved design', agentId: 'arjun', kind: 'workflow_code', needs: ['design_approval'], output: 'Code and preview' },
  { id: 'code_review', title: 'Review the implementation', agentId: 'jules', kind: 'code_review', needs: ['implementation'], returnTo: 'implementation', output: 'Code review' },
  { id: 'engineering_review', title: 'Lead developer approves the code', agentId: 'theo', kind: 'code_review', needs: ['code_review'], returnTo: 'implementation', output: 'Engineering approval' },
  { id: 'design_qa', title: 'Check design fidelity', agentId: 'maya', kind: 'visual_qa', needs: ['engineering_review'], returnTo: 'implementation', output: 'Design QA evidence' },
  { id: 'functional_qa', title: 'Test the user journeys', agentId: 'noor', kind: 'browser_qa', needs: ['engineering_review'], returnTo: 'implementation', output: 'Functional QA evidence' },
  { id: 'product_acceptance', title: 'PM verifies the PRD', agentId: 'nora', kind: 'review', needs: ['design_qa', 'functional_qa'], returnTo: 'implementation', output: 'Product acceptance review', guidance: 'Verify every approved acceptance criterion against actual implementation and QA evidence. Never infer that an unexecuted test passed.' },
  { id: 'coo_review', title: 'COO checks delivery readiness', agentId: 'alex', kind: 'review', needs: ['product_acceptance'], returnTo: 'implementation', output: 'Delivery recommendation', guidance: 'Check required reviews, matching artifact versions, unresolved issues and delivery readiness. Summarize the actual evidence for the owner. Do not overrule failed specialist reviews or approve on behalf of the owner.' },
  { id: 'delivery_approval', title: 'Your final delivery approval', agentId: 'owner', kind: 'approval', needs: ['coo_review'], returnTo: 'implementation' },
];
export const WORKFLOW_STATUS = { locked: 'Waiting on earlier work', queued: 'Queued', working: 'Working', waiting_for_user: 'Needs your answer', needs_approval: 'Awaiting your approval', completed: 'Completed', blocked: 'Blocked', failed: 'Needs attention', interrupted: 'Interrupted', cancelled: 'Stopped' };
export const CORE_TEAM = ['nora', 'maya', 'sam', 'ava', 'theo', 'noor'];
export const PROJECT_SPECIALISTS = [
  { id: 'milo', name: 'Milo', role: 'Motion design', purpose: 'Add a motion specification and include it in Ava’s review.' },
  { id: 'eden', name: 'Eden', role: 'Design systems', purpose: 'Assess substantial design-system work before Maya plans the experience.' },
  { id: 'alex', name: 'Alex', role: 'Delivery oversight', purpose: 'Add a delivery-readiness review before your final decision.' },
];
// Saved projects retain their original reviewers and approval dependencies.
export function workflowSteps(project) {
  if (project?.workflowVersion !== 2) return WORKFLOW_STEPS;
  const specialists = project.specialists || [];
  return WORKFLOW_STEPS.filter(d => d.id !== 'code_review' && (d.id !== 'motion_plan' || specialists.includes('milo')) && (d.id !== 'design_system' || specialists.includes('eden')) && (d.id !== 'coo_review' || specialists.includes('alex'))).map(d => {
    const step = { ...d, needs: [...d.needs] };
    if (d.id === 'prd') step.guidance += ' Keep the first PRD focused: aim for 600–1000 words with a short summary, numbered requirements and a compact acceptance checklist. Do not design the entire organisation or repeat the workflow documentation. Missing future tools belong under dependencies; they do not justify invented deliverables.';
    if (d.id === 'ux_plan') { step.needs = [specialists.includes('eden') ? 'design_system' : 'scope_approval']; step.guidance += ' Assess and reuse existing design foundations as part of this plan when Eden is not assigned. Keep the deliverable concise and actionable.'; }
    if (d.id === 'concept_review') { step.needs = [specialists.includes('eden') ? 'design_system' : null, 'ux_plan', specialists.includes('milo') ? 'motion_plan' : null].filter(Boolean); step.returnTo = specialists.includes('eden') ? 'design_system' : 'ux_plan'; }
    if (d.id === 'foundation_approval') step.returnTo = specialists.includes('eden') ? 'design_system' : 'ux_plan';
    if (d.id === 'implementation') step.agentId = 'sam';
    if (d.id === 'engineering_review') step.needs = ['implementation'];
    if (d.id === 'delivery_approval') step.needs = [specialists.includes('alex') ? 'coo_review' : 'product_acceptance'];
    return step;
  });
}
export const WORKFLOW_PHASES = [
  { title: 'Requirements', ids: ['prd', 'prd_review', 'scope_approval'] },
  { title: 'Design direction', ids: ['design_system', 'ux_plan', 'motion_plan', 'concept_review', 'foundation_approval'] },
  { title: 'Screen designs', ids: ['figma_design', 'design_review', 'design_approval'] },
  { title: 'Build & test', ids: ['implementation', 'code_review', 'engineering_review', 'design_qa', 'functional_qa'] },
  { title: 'Delivery', ids: ['product_acceptance', 'coo_review', 'delivery_approval'] },
];
export const WORKFLOW_CAPABILITIES = { document: true, review: true, figma: false, figma_review: false, workflow_code: false, code_review: false, visual_qa: false, browser_qa: false };
export const CAPABILITY_REASON = {
  figma: 'A Figma file and an authorized editing connection are required before Maya can create real screens.',
  figma_review: 'The reviewer needs authorized access to the exact Figma design before reviewing it.',
  workflow_code: 'The approved Figma-to-frontend handoff is not connected yet. Sam’s separate coding tasks remain available; they do not satisfy this project gate.',
  code_review: 'The project code checkout and exact revision must be connected to independent reviewers.',
  visual_qa: 'Visual QA needs the approved design, a matching preview and browser access.',
  browser_qa: 'Functional QA needs the implementation preview and a connected browser test environment.',
};
export const OFFICE_PROJECT_BRIEF = `Improve the Virtual Team office itself. Keep desktop and tablet support from 768px; no phone layout. Improve the interface and user experience for project kickoff, agent chats, task handoffs, questions, reviews and owner approvals. Make department and agent activity easy to understand. Keep six core agents visible in the 3D office and all twenty profiles available. Make core roles and on-demand specialists clear. Assess room usability without automatically expanding to twenty physical characters. Include motion designer Milo to make transitions and interactive feedback delightful, useful, accessible and lightweight. Preserve reduced motion and pause unnecessary rendering while hidden. Do not reintroduce the wandering dog, walking conversations or playable arcade game. Preserve cloud persistence, private access and existing conversations. The owner gives final approval after lead review at each required stage. Nora creates the PRD first. Designers receive the approved PRD, Ava reviews design, then the owner reviews before frontend implementation. Engineering review precedes parallel design and functional QA, then PM acceptance and final owner approval. Add COO oversight only when explicitly selected. Figma links and design-system choice are inputs to resolve during design; do not assume access or invent completed research. This brief authorizes planning; it does not approve a PRD, visual direction, design or release.`;
