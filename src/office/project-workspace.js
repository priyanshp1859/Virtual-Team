import { documentView } from './document-view.js';
import { AGENTS } from './config.js';
import { WORKFLOW_STEPS, WORKFLOW_STATUS, OFFICE_PROJECT_BRIEF, workflowSteps, CORE_TEAM, PROJECT_SPECIALISTS, WORKFLOW_PHASES } from './workflow-config.js';
import './project-workspace.css';
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
const button = (text, action, className = 'pw-button') => { const n = el('button', className, text); n.type = 'button'; n.addEventListener('click', action); return n; };
const name = id => id === 'owner' ? 'You' : AGENTS.find(a => a.id === id)?.name || 'Workspace';
function inputField(label, { area = false, value = '', placeholder = '', required = false, maxLength = 5000, testid } = {}) {
  const wrap = el('label', 'pw-field'); wrap.append(el('span', '', label));
  const input = el(area ? 'textarea' : 'input'); input.value = value; input.placeholder = placeholder; input.required = required; input.maxLength = maxLength; if (testid) input.dataset.testid = testid; wrap.append(input); return { wrap, input };
}
export function createProjectWorkspace({ store, onOpenAgent, mount }) {
  let snapshot = store.getState(), selectedProject = null, selectedStep = 'prd', pane = 'work', opener, pending = false, shownSignature = '', formMode = false;
  const drafts = new Map(); let kickoffDraft = null;
  const dialog = el('dialog', 'project-workspace'); dialog.dataset.testid = 'project-workspace'; dialog.setAttribute('aria-labelledby', 'pw-title');
  const header = el('header', 'pw-header'), identity = el('div');
  const title = el('h2', '', 'Projects'); title.id = 'pw-title';
  const status = el('p', 'pw-worker'); identity.append(el('span', 'pw-eyebrow', 'FROM BRIEF TO APPROVAL'), title, status);
  header.append(identity, button('×', () => dialog.close(), 'pw-close')); header.lastChild.setAttribute('aria-label', 'Close projects');
  const controls = el('div', 'pw-controls');
  const projectSelect = el('select'); projectSelect.setAttribute('aria-label', 'Select project'); projectSelect.dataset.testid = 'project-select';
  projectSelect.addEventListener('change', () => { selectedProject = projectSelect.value; selectedStep = nextStep(project()); formMode = false; shownSignature = ''; render(); });
  const add = button('New project', () => newProject(), 'pw-button pw-primary'); add.dataset.testid = 'new-project';
  const refresh = button('Refresh', () => act(() => store.refresh()));
  const pause = button('Pause project', () => { const p = project(); if (p) act(() => store.command(p.paused ? 'resume' : 'pause', { projectId: p.id })); });
  const follow = button('Current task', () => { selectedStep = nextStep(project()); pane = 'work'; shownSignature = ''; render(); }); follow.dataset.testid = 'current-project-step';
  const discard = button('Discard project', () => { const p = project(); if (p && confirm('Discard this project and stop its remaining work? It will leave your active project list.')) act(() => store.command('discard', { projectId: p.id })); }); discard.dataset.testid = 'discard-project';
  controls.append(projectSelect, add, follow, refresh, pause, discard);
  const error = el('p', 'pw-error'); error.setAttribute('role', 'alert'); error.hidden = true;
  const body = el('div', 'pw-layout'), steps = el('nav', 'pw-steps'); steps.setAttribute('aria-label', 'Project workflow');
  const content = el('section', 'pw-content'); content.dataset.testid = 'project-content';
  body.append(steps, content); dialog.append(header, controls, error, body); document.body.append(dialog);
  dialog.addEventListener('keydown', e => { if (e.key === 'Escape') e.stopPropagation(); });
  dialog.addEventListener('close', () => opener?.isConnected && opener.focus({ preventScroll: true }));
  const launcher = button('Projects & approvals', () => open(), 'pw-launch'); launcher.dataset.testid = 'open-projects';
  const summary = el('span', 'pw-launch-summary'); launcher.append(summary); mount.append(launcher);
  function project() { return snapshot.projects.find(p => p.id === selectedProject); }
  function nextStep(p) { if (!p) return 'prd'; const defs = workflowSteps(p); for (const status of ['waiting_for_user', 'needs_approval', 'failed', 'interrupted', 'blocked', 'working', 'queued', 'locked']) { const d = defs.find(d => p.steps[d.id]?.status === status); if (d) return d.id; } return 'delivery_approval'; }
  async function act(fn) {
    if (pending) return; pending = true; renderControls();
    try { await fn(); } catch (e) { error.textContent = e.message; error.hidden = false; }
    finally { pending = false; renderControls(); }
  }
  function renderControls() { [add, refresh, pause, follow, discard, projectSelect].forEach(n => n.disabled = pending || snapshot.pending > 0); pause.hidden = follow.hidden = discard.hidden = !project() || formMode; if (project()) pause.textContent = project().paused ? 'Resume project' : 'Pause project'; }
  function render() {
    const active = content.contains(document.activeElement) && document.activeElement.dataset.testid ? document.activeElement : null;
    const cursor = active ? { id: active.dataset.testid, start: active.selectionStart, end: active.selectionEnd, scroll: content.scrollTop } : null;
    renderView();
    if (cursor) { const field = content.querySelector(`[data-testid="${cursor.id}"]`); if (field && field !== active) { field.focus({ preventScroll: true }); if (typeof field.setSelectionRange === 'function' && cursor.start !== null) field.setSelectionRange(cursor.start, cursor.end); content.scrollTop = cursor.scroll; } }
  }
  function renderView() {
    const approvals = snapshot.projects.reduce((total, p) => total + Object.values(p.steps).filter(s => s.status === 'needs_approval').length, 0);
    summary.textContent = approvals ? `${approvals} need your review` : `${snapshot.projects.length} ${snapshot.projects.length === 1 ? 'project' : 'projects'}`;
    if (!dialog.open) return;
    status.textContent = `${import.meta.env.DEV ? 'Local development · separate test workspace · ' : ''}${snapshot.runtime?.online ? 'Worker connected' : 'Worker offline — start it to run agents'}`;
    error.hidden = !snapshot.error; error.textContent = snapshot.error || ''; renderControls();
    const options = snapshot.projects.map(p => `${p.id}:${p.title}`).join('|');
    if (projectSelect.dataset.options !== options) { projectSelect.replaceChildren(...snapshot.projects.map(p => { const o = el('option', '', p.title); o.value = p.id; return o; })); projectSelect.dataset.options = options; }
    if (!project()) { selectedProject = snapshot.projects[0]?.id || null; shownSignature = ''; }
    projectSelect.value = selectedProject || ''; projectSelect.hidden = !snapshot.projects.length;
    if (formMode) return;
    const p = project();
    if (!p) { title.textContent = 'Projects'; steps.replaceChildren(); content.replaceChildren(el('h3', '', 'Start with a clear brief.'), el('p', 'pw-help', 'Nora writes the PRD. Your approval unlocks the next stage, with every handoff and review saved here.'), button('Create a project brief', () => newProject(), 'pw-button pw-primary'), button('Use an office improvement brief', () => newProject(true))); return; }
    title.textContent = p.title; const definitions = workflowSteps(p); if (!definitions.some(d => d.id === selectedStep)) selectedStep = nextStep(p);
    const navSignature = JSON.stringify([p.id, p.paused, selectedStep, Object.values(p.steps).map(s => [s.id, s.status])]);
    if (steps.dataset.signature !== navSignature) {
      steps.dataset.signature = navSignature;
      steps.replaceChildren();
      const team = el('div', 'pw-team-summary'); team.append(el('strong', '', 'Project team'), el('p', '', (p.workflowVersion === 2 ? [...CORE_TEAM, ...p.specialists] : [...new Set(definitions.map(d => d.agentId).filter(id => id !== 'owner'))]).map(name).join(' · '))); steps.append(team);
      for (const phase of WORKFLOW_PHASES) {
        const phaseSteps = definitions.filter(d => phase.ids.includes(d.id)); if (!phaseSteps.length) continue;
        const group = el('details', 'pw-phase'); group.open = phase.ids.includes(selectedStep);
        const complete = phaseSteps.filter(d => p.steps[d.id].status === 'completed').length;
        group.append(el('summary', '', `${phase.title} · ${complete}/${phaseSteps.length}`));
        for (const d of phaseSteps) {
          const s = p.steps[d.id], b = button('', () => { selectedStep = d.id; pane = 'work'; shownSignature = ''; render(); }, `pw-step${selectedStep === d.id ? ' selected' : ''}`);
          b.dataset.step = d.id; b.setAttribute('aria-current', selectedStep === d.id ? 'step' : 'false');
          b.append(el('span', 'pw-step-number', s.status === 'completed' ? '✓' : String(definitions.indexOf(d) + 1).padStart(2, '0')), el('strong', '', d.title), el('span', 'pw-step-status', `${name(d.agentId)} · ${WORKFLOW_STATUS[s.status] || s.status}`)); group.append(b);
        }
        steps.append(group);
      }
    }
    const d = definitions.find(d => d.id === selectedStep), s = p.steps[selectedStep];
    const signature = JSON.stringify([p.id, selectedStep, s, p.artifacts.map(a => a.id), p.messages.length, p.events.length, pane, p.paused]);
    if (signature === shownSignature) return; shownSignature = signature;
    content.replaceChildren();
    const top = el('div', 'pw-step-top'); top.append(el('span', 'pw-eyebrow', `${name(d.agentId)} / ${d.kind === 'approval' ? 'OWNER DECISION' : d.output || 'PROJECT WORK'}`), el('h3', '', d.title), el('p', 'pw-status', p.paused ? 'Project paused' : WORKFLOW_STATUS[s.status])); content.append(top);
    const tabs = el('div', 'pw-tabs');
    for (const [key, label] of [['work', 'Work & review'], ['conversation', 'Conversation'], ['history', 'History']]) { const b = button(label, () => { pane = key; shownSignature = ''; render(); }); b.setAttribute('aria-pressed', String(pane === key)); tabs.append(b); } content.append(tabs);
    if (pane === 'conversation') { renderConversation(p, d, s); return; }
    if (pane === 'history') {
      for (const e of [...p.events].reverse()) content.append(el('p', 'pw-event', `${new Date(e.createdAt).toLocaleString()} · ${name(e.agentId)}\n${e.text}`));
      for (const a of [...p.artifacts].reverse()) { const details = el('details', 'pw-artifact'); details.append(el('summary', '', `${a.title} · v${a.version} · ${name(a.authorId)}`), documentView(a.body)); content.append(details); } return;
    }
    if (s.status === 'working') { const progress = el('aside', 'pw-progress'); progress.append(el('strong', '', `${name(d.agentId)} is working`), el('p', '', p.messages.filter(m => m.agentId === d.agentId && m.stepId === d.id).at(-1)?.text || 'Reading the brief and project references.')); content.append(progress); }
    if (s.status === 'completed') content.append(button('Go to the current task →', () => { selectedStep = nextStep(p); pane = 'work'; shownSignature = ''; render(); }));
    if (s.status === 'locked') content.append(el('p', 'pw-help', `This step starts after: ${d.needs.map(id => definitions.find(x => x.id === id).title).join(', ')}. No dependent work has been started.`));
    if (s.error) { const notice = el('aside', 'pw-notice'); notice.append(el('strong', '', s.status === 'blocked' ? 'A connection or decision is needed' : 'This step needs attention'), el('p', '', s.error)); content.append(notice); }
    if (s.feedback) { const feedback = el('details', 'pw-artifact'); feedback.append(el('summary', '', 'Feedback for this revision'), documentView(s.feedback)); content.append(feedback); }
    if (s.question) renderAnswer(p, d, s);
    if (['failed', 'interrupted', 'cancelled'].includes(s.status) || (s.status === 'blocked' && ['document', 'review'].includes(d.kind))) content.append(button('Retry this step', () => act(() => store.command('retry', { projectId: p.id, stepId: d.id })), 'pw-button pw-primary'));
    const artifact = p.artifacts.find(a => a.id === s.artifactId);
    if (artifact) renderArtifact(artifact, true);
    // Owners inspect the exact author documents plus independent reviews covered by this approval.
    if (d.kind === 'approval') {
      if (s.status === 'needs_approval' && !p.paused) renderDecision(p, d, s);
      const covered = new Set((s.inputs || []).map(ref => ref.id));
      for (const a of p.artifacts.filter(a => covered.has(a.id) && a.authorId !== 'owner').sort((a, b) => Number(b.stepId === d.returnTo) - Number(a.stepId === d.returnTo) || b.createdAt - a.createdAt)) renderArtifact(a, a.stepId === d.returnTo);
    }
    if (!artifact && d.kind !== 'approval' && ['queued', 'working'].includes(s.status)) content.append(el('p', 'pw-help', s.status === 'queued' ? 'This assignment is queued. It starts when the local worker is available.' : 'The document will appear here when it is submitted. You can read progress in Conversation.'));
    if (d.id === 'prd') { const brief = el('details', 'pw-artifact'); brief.append(el('summary', '', 'Project brief and references'), documentView(p.brief)); if (p.sourceText) brief.append(el('h4', '', 'Source document'), documentView(p.sourceText)); content.append(brief); }
  }
  function renderArtifact(a, expanded = false) {
    const details = el('details', 'pw-artifact'); details.open = expanded; details.dataset.artifactId = a.id;
    details.append(el('summary', '', `${a.title} · v${a.version} · ${name(a.authorId)}${a.outcome === 'approved' ? ' · reviewed' : ''}`), documentView(a.body));
    const download = button('Download document', () => { const blob = new Blob([`# ${a.title}\n\n${a.body}`], { type: 'text/markdown' }); const url = URL.createObjectURL(blob); const link = el('a'); link.href = url; link.download = `${a.stepId}-v${a.version}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }); details.append(download); content.append(details);
  }
  function renderDecision(p, d, s) {
    const block = el('form', 'pw-decision'); block.dataset.testid = 'project-approval';
    block.append(el('h4', '', 'Your decision'), el('p', 'pw-help', 'Read the documents below before deciding. Approval unlocks the next stage; requesting changes sends your feedback to the author.'));
    const key = `${p.id}:${s.id}:feedback:${s.token}`, field = inputField('Comments or requested changes', { area: true, value: drafts.get(key) || '', testid: 'project-feedback' }); field.input.addEventListener('input', () => drafts.set(key, field.input.value)); block.append(field.wrap);
    const controls = el('div', 'pw-actions'), approve = button('Approve this version', () => decide('approved'), 'pw-button pw-primary'), changes = button('Request changes', () => decide('changes_requested')); approve.dataset.testid = 'approve-project-stage'; changes.dataset.testid = 'request-project-changes'; controls.append(approve, changes); block.append(controls); controls.append(button('Read document ↓', () => content.querySelector('.pw-artifact[open]')?.scrollIntoView({ block: 'start' }))); content.append(block);
    async function decide(decision) { if (pending) return; if (decision === 'changes_requested' && !field.input.value.trim()) { field.input.setCustomValidity('Add the changes you need.'); field.input.reportValidity(); return; } field.input.setCustomValidity(''); approve.disabled = changes.disabled = true;
      await act(async () => { await store.command('decide', { projectId: p.id, stepId: s.id, token: s.token, decision, comment: field.input.value }); drafts.delete(key); selectedStep = nextStep(project()); shownSignature = ''; render(); }); if (block.isConnected) approve.disabled = changes.disabled = false; }
    block.addEventListener('submit', e => e.preventDefault()); field.input.addEventListener('input', () => field.input.setCustomValidity(''));
  }
  function renderAnswer(p, d, s) {
    const wrap = el('form', 'pw-decision'); wrap.append(el('h4', '', `${name(d.agentId)} needs your answer`), el('p', '', s.question.text));
    const key = `${p.id}:${s.question.id}`, field = inputField('Your answer', { area: true, value: drafts.get(key) || '', required: true, testid: 'project-answer' }); field.input.addEventListener('input', () => drafts.set(key, field.input.value));
    const send = button('Send answer', () => { if (!wrap.reportValidity()) return; act(async () => { await store.command('answer', { projectId: p.id, stepId: d.id, questionId: s.question.id, text: field.input.value }); drafts.delete(key); }); }); send.dataset.testid = 'send-project-answer'; wrap.append(field.wrap, send); wrap.addEventListener('submit', e => e.preventDefault()); content.append(wrap);
  }
  function renderConversation(p, d, s) {
    content.append(el('p', 'pw-help', 'Notes stay with this project and are included in the next assigned run. Use the question form for a pending answer. Notes do not approve work or change scope.'));
    for (const m of p.messages.filter(m => !m.stepId || m.stepId === d.id)) { const message = el('article', 'pw-message'); message.append(el('strong', '', `${name(m.agentId)} · ${new Date(m.createdAt).toLocaleString()}`), el('p', '', m.text)); content.append(message); }
    if (s.question) renderAnswer(p, d, s);
    const key = `${p.id}:${d.id}:note`, field = inputField('Project note', { area: true, value: drafts.get(key) || '', testid: 'project-note' }); field.input.addEventListener('input', () => drafts.set(key, field.input.value)); content.append(field.wrap, button('Save note', () => act(async () => { await store.command('note', { projectId: p.id, stepId: d.id, text: field.input.value }); drafts.delete(key); shownSignature = ''; render(); })));
  }
  function newProject(office = false) {
    formMode = true; title.textContent = 'Start a project'; if (office) kickoffDraft = { title: 'Office experience and team expansion', brief: OFFICE_PROJECT_BRIEF, specialists: 'milo' }; kickoffDraft ||= {}; steps.replaceChildren(); content.replaceChildren(); renderControls();
    const form = el('form', 'pw-kickoff'); form.dataset.testid = 'project-kickoff';
    form.append(el('h3', '', 'Give Nora the starting point.'), el('p', 'pw-help', 'Start from an idea or paste a project document. Nora creates a PRD for review before design starts. This release connects planning to the Virtual-Team repository.'));
    const fields = {
      title: inputField('Project name', { value: kickoffDraft.title || '', required: true, maxLength: 140, testid: 'project-title' }),
      brief: inputField('What should this project achieve?', { area: true, value: kickoffDraft.brief || '', required: true, maxLength: 12000, testid: 'project-brief' }),
      sourceText: inputField('Existing document or reference text (optional)', { area: true, value: kickoffDraft.sourceText || '', maxLength: 16000 }),
      figmaUrl: inputField('Figma link (optional at kickoff)', { value: kickoffDraft.figmaUrl || '', maxLength: 1800, placeholder: 'https://www.figma.com/…' }),
      designSystemUrl: inputField('Design system reference (optional)', { value: kickoffDraft.designSystemUrl || '', maxLength: 1800, placeholder: 'https://…' }),
    };
    for (const [key, f] of Object.entries(fields)) { form.append(f.wrap); f.input.addEventListener('input', () => { kickoffDraft[key] = f.input.value; }); }
    const team = el('fieldset', 'pw-team-picker'); team.append(el('legend', '', 'Choose the project team'), el('p', '', `Core team: ${CORE_TEAM.map(name).join(', ')}.`));
    const selected = new Set((kickoffDraft.specialists || '').split(',').filter(Boolean));
    for (const specialist of PROJECT_SPECIALISTS) { const label = el('label', 'pw-specialist'); const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.value = specialist.id; checkbox.dataset.testid = `specialist-${specialist.id}`; checkbox.checked = selected.has(specialist.id); checkbox.addEventListener('change', () => { checkbox.checked ? selected.add(specialist.id) : selected.delete(specialist.id); kickoffDraft.specialists = [...selected].sort().join(','); }); label.append(checkbox, el('span', '', `${specialist.name} · ${specialist.role}`), el('small', '', specialist.purpose)); team.append(label); }
    form.append(team, el('p', 'pw-notice', 'Planning and document reviews are connected. Figma editing, project coding and browser QA need their tool connections before those stages can run.'));
    const actions = el('div', 'pw-actions'), submit = el('button', 'pw-button pw-primary', 'Create project & ask Nora'); submit.type = 'submit'; submit.dataset.testid = 'create-project';
    actions.append(submit, button('Cancel', () => { formMode = false; shownSignature = ''; render(); })); form.append(actions); content.append(form);
    form.addEventListener('submit', async e => { e.preventDefault(); if (!form.reportValidity() || pending) return; submit.disabled = true; await act(async () => { const result = await store.command('create', { ...Object.fromEntries(Object.entries(fields).map(([key, f]) => [key, f.input.value])), specialists: [...selected].sort().join(',') }); selectedProject = result.projectId; kickoffDraft = null; selectedStep = 'prd'; formMode = false; shownSignature = ''; render(); }); if (form.isConnected) submit.disabled = false; }); fields.title.input.focus();
  }
  function open({ projectId, stepId } = {}) { opener = document.activeElement; if (projectId) selectedProject = projectId; formMode = false; if (!dialog.open) dialog.showModal(); if (!selectedProject) selectedProject = snapshot.projects[0]?.id; selectedStep = stepId || nextStep(project()); shownSignature = ''; render(); store.refresh().catch(() => {}); }
  store.subscribe(value => { snapshot = value; if (!value.authenticated) { dialog.close(); selectedProject = null; drafts.clear(); kickoffDraft = null; formMode = false; content.replaceChildren(); steps.replaceChildren(); } render(); }); render();
  return { open, close: () => dialog.close(), isOpen: () => dialog.open };
}
