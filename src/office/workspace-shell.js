import { AGENTS, DEPARTMENTS, SKILLS } from './config.js';
import { CORE_TEAM, PROJECT_SPECIALISTS, WORKFLOW_PHASES, WORKFLOW_STATUS, workflowSteps } from './workflow-config.js';
import { activeProject, currentStep, projectAttention, projectSummary, previewProjects } from './project-presentation.js';
import { createTeamDirectory } from './team-directory.js';
import { documentView } from './document-view.js';
import './workspace-shell.css';

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const btn = (text, action, cls = 'ws-button', testid) => { const n = el('button', cls, text); n.type = 'button'; n.addEventListener('click', action); if (testid) n.dataset.testid = testid; return n; };
const name = id => id === 'owner' ? 'You' : AGENTS.find(a => a.id === id)?.name || 'The team';
const stamp = time => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(time || Date.now());
const tag = (text, tone = 'neutral') => el('span', `ws-tag ws-tag--${tone}`, text);
const small = text => el('p', 'ws-muted', text);
const heading = (title, description, action) => { const n = el('div', 'ws-heading'), copy = el('div'); copy.append(el('p', 'ws-eyebrow', 'YOUR WORKSPACE'), el('h1', '', title), small(description)); n.append(copy); if (action) n.append(action); return n; };
const panel = (title, note) => { const n = el('section', 'ws-panel'); if (title) n.append(el('h2', '', title)); if (note) n.append(small(note)); return n; };
const avatars = ids => { const group = el('div', 'ws-avatars'); for (const id of ids) { const a = AGENTS.find(a => a.id === id); if (!a) continue; const n = el('span', 'ws-avatar', a.name[0]); n.style.setProperty('--person-color', a.color); n.title = `${a.name} · ${a.role}`; group.append(n); } return group; };
function resourceInput(resources = []) { return JSON.stringify(resources.map(r => ({ name: r.name, mime: r.mime, ...(typeof r.text === 'string' ? { text: r.text } : { data: r.data }) }))); }
function download(resource) {
  const blob = typeof resource.text === 'string' ? new Blob([resource.text], { type: resource.mime }) : new Blob([Uint8Array.from(atob(resource.data), c => c.charCodeAt(0))], { type: resource.mime });
  const url = URL.createObjectURL(blob), a = el('a'); a.href = url; a.download = resource.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createWorkspaceShell({ projectStore, workspaceStore, onOffice, onLeaveOffice, onOpenWork, onSelectAgent, onSignOut }) {
  let snapshot = projectStore.getState(), route = { page: 'projects' }, preview = false, samples = [], query = '', filter = 'all', pending = false, signature = '', draft = null, teamOpened = false, navSignature = '';
  const root = document.getElementById('office-app'), mount = el('section', 'workspace-screens'); mount.dataset.testid = 'workspace-screens';
  document.querySelector('.main').append(mount);
  const office = document.querySelector('.office-content'), officeNav = document.getElementById('office-navigation');
  const crumb = document.querySelector('.breadcrumb'), projectNav = document.getElementById('selected-project-nav');
  const modal = el('dialog', 'ws-dialog'); modal.dataset.testid = 'workspace-dialog'; document.body.append(modal);
  modal.addEventListener('keydown', e => { if (e.key === 'Escape') e.stopPropagation(); });
  const teamMount = el('div', 'ws-team-settings');
  const directory = createTeamDirectory({ store: workspaceStore, projectStore, mount: teamMount, onSelect: id => onSelectAgent(id, { tab: 'profile' }) });
  const all = () => preview ? samples : snapshot.projects;
  const selected = () => all().find(p => p.id === route.id);
  const active = () => activeProject(all());
  const saveTabDraft = () => { try { sessionStorage.setItem('office-project-draft', JSON.stringify(draft)); } catch { /* Explicit cloud save remains available. */ } };
  const newDraft = () => ({ title: '', brief: '', sourceText: '', figmaUrl: '', designSystemUrl: '', specialists: [], resources: [] });
  function error(message) { const old = mount.querySelector('.ws-error'); old?.remove(); const n = el('p', 'ws-error', message); n.setAttribute('role', 'alert'); mount.prepend(n); }
  async function act(fn) {
    if (pending) return; pending = true; mount.setAttribute('aria-busy', 'true'); mount.querySelectorAll('button,input,textarea,select').forEach(n => n.disabled = true);
    try { await fn(); } catch (e) { error(e.message); }
    finally { pending = false; mount.removeAttribute('aria-busy'); mount.querySelectorAll('button,input,textarea,select').forEach(n => n.disabled = false); }
  }
  function navigate(page, id, section) {
    if (page === 'new' && !draft) { try { draft = JSON.parse(sessionStorage.getItem('office-project-draft')); } catch {} draft ||= newDraft(); }
    route = { page, id, section }; signature = ''; onLeaveOffice(); modal.close();
    const params = new URLSearchParams({ page }); if (id) params.set('id', id); if (section) params.set('section', section); if (preview) params.set('preview', '1');
    history.replaceState(null, '', `${location.pathname}${location.search}#${params}`); render(true);
    if (page === 'office') onOffice(); else mount.querySelector('h1')?.focus({ preventScroll: true });
  }
  function showPreview(value) { preview = value; if (value) samples = previewProjects(); query = ''; filter = 'all'; navigate('projects'); }
  function openWork(p, stepId) {
    if (!preview) { onOpenWork({ projectId: p.id, stepId: stepId || currentStep(p).id }); return; }
    modal.replaceChildren(el('p', 'ws-eyebrow', 'SCREEN PREVIEW · SAMPLE CONTENT'), el('h2', '', p.artifacts[0]?.title || 'Project work'));
    modal.append(documentView(p.artifacts[0]?.body || 'This project has no sample deliverable yet. In your workspace, submitted documents and reviews appear here.'));
    modal.append(small('This preview cannot approve work or start an agent.'), btn('Back to project', () => modal.close(), 'ws-button ws-primary')); modal.showModal();
  }
  function moveTeam(p) {
    if (p.draft && !p.brief.trim()) { editDraft(p); error('Add a short project brief before asking Nora to begin.'); return; }
    const previous = active();
    modal.replaceChildren(el('p', 'ws-eyebrow', preview ? 'SCREEN PREVIEW' : 'TEAM ASSIGNMENT'), el('h2', '', previous && previous.id !== p.id ? `Move the team to ${p.title}?` : `Start work on ${p.title}?`));
    modal.append(small(previous && previous.id !== p.id ? `${previous.title} will pause. Its saved files, conversations and approvals stay with that project. An unfinished step may need a retry when you return.` : 'Nora starts from your brief and readable references. You review the PRD before design work begins.'));
    const buttons = el('div', 'ws-actions');
    const confirm = btn(preview ? 'Preview team switch' : 'Move team & start', async () => {
      if (pending) return; confirm.disabled = true;
      await act(async () => {
        if (preview) { for (const item of samples) if (item.id !== p.id) item.paused = true; p.paused = false; p.draft = false; if (p.steps.prd.status === 'locked') p.steps.prd.status = 'queued'; }
        else await projectStore.command('resume', { projectId: p.id });
        modal.close(); signature = ''; render(true);
      }); if (modal.open) { confirm.disabled = false; const notice = el('p', 'ws-error', 'The switch was not confirmed. Close this dialog to see the error and retry.'); modal.append(notice); }
    }, 'ws-button ws-primary', 'confirm-team-switch');
    buttons.append(btn('Keep current assignment', () => modal.close()), confirm); modal.append(buttons); modal.showModal();
  }
  function editDraft(p) { draft = { ...structuredClone(p), specialists: [...(p.specialists || [])], resources: [...(p.resources || [])] }; saveTabDraft(); navigate('new', p.id); }
  function updateNavigation() {
    const key = JSON.stringify([route, preview, all().map(p => [p.id, p.title])]);
    if (key === navSignature) return; navSignature = key;
    const p = selected();
    for (const [id, page] of [['projects-home-button', 'projects'], ['overview-button', 'office'], ['settings-button', 'settings']]) { const n = document.getElementById(id); n.classList.toggle('active', route.page === page); n.setAttribute('aria-current', route.page === page ? 'page' : 'false'); }
    root.dataset.preview = String(preview);
    const officeVisible = route.page === 'office'; office.hidden = !officeVisible; officeNav.hidden = !officeVisible; mount.hidden = officeVisible;
    root.classList.toggle('showing-office', officeVisible);
    crumb.replaceChildren(btn('Workspace', () => navigate('projects'), 'ws-crumb'), el('span', 'slash', '/'), el('strong', '', p?.title || ({ projects: 'Projects', new: 'New project', settings: 'Settings', office: 'Office' }[route.page] || 'Projects')));
    if (preview) crumb.append(tag('Preview', 'amber'));
    projectNav.replaceChildren(); projectNav.hidden = !p;
    if (p) {
      const label = el('label', 'ws-switch-label', 'VIEWING PROJECT'), select = el('select', 'ws-project-select'); select.setAttribute('aria-label', 'Switch project'); select.dataset.testid = 'switch-project';
      for (const item of all()) select.add(new Option(item.title, item.id)); select.value = p.id; select.addEventListener('change', () => navigate('project', select.value)); label.append(select); projectNav.append(label);
      for (const [key, text] of [['project', 'Overview'], ['resources', 'Resources'], ['work', 'Work & reviews'], ['project-settings', 'Project settings']]) projectNav.append(btn(text, () => navigate(key, p.id), `ws-subnav${route.page === key ? ' active' : ''}`));
    }
  }
  function render(force = false) {
    if (!snapshot.authenticated) return;
    updateNavigation();
    if (route.page === 'office') return;
    if (!force && document.activeElement?.classList.contains('ws-search')) return;
    if (!force && ((route.page === 'new' && mount.querySelector('[data-testid=project-create-form]')) || (route.page === 'settings' && mount.querySelector('.ws-settings-tabs')))) return;
    const next = JSON.stringify([route, preview, all(), snapshot.error, snapshot.runtime?.online, query, filter]);
    if (!force && next === signature) return; signature = next;
    mount.replaceChildren(); mount.classList.remove('ws-form-page');
    if (preview) { const banner = el('div', 'ws-preview-banner'); banner.append(el('span', '', 'Screen preview · sample project data. Project actions won’t start agents.'), btn('Exit preview', () => showPreview(false), 'ws-text-button', 'exit-screen-preview')); mount.append(banner); }
    if (snapshot.error && !preview) { const notice = el('div', 'ws-error'); notice.setAttribute('role', 'alert'); notice.append(el('span', '', snapshot.error), btn('Retry sync', () => projectStore.refresh().catch(() => {}))); mount.append(notice); }
    if (!preview && snapshot.revision < 0 && route.page !== 'settings') { mount.append(heading('Your projects', 'Loading your workspace…')); return; }
    const p = selected();
    if (['project', 'resources', 'work', 'project-settings'].includes(route.page) && !p) { mount.append(heading('Project unavailable', 'It may have been archived, or this link belongs to the sample preview.', btn('All projects', () => navigate('projects')))); return; }
    if (route.page === 'projects') renderHome();
    else if (route.page === 'new') renderCreate();
    else if (route.page === 'settings') renderSettings();
    else if (route.page === 'resources') renderResources(p);
    else if (route.page === 'work') renderWork(p);
    else if (route.page === 'project-settings') renderProjectSettings(p);
    else renderProject(p);
    mount.querySelector('h1')?.setAttribute('tabindex', '-1');
  }
  function focusBanner() {
    const p = active(), banner = el('div', 'ws-focus-banner');
    const copy = el('div'); copy.append(el('span', 'ws-focus-dot'), el('strong', '', p ? `The team is assigned to ${p.title}` : 'The team is ready for a project'), small(p ? 'You can browse other projects without moving the team.' : 'Create a brief, or resume a project when you’re ready.'));
    banner.append(copy, p ? btn('View project ↗', () => navigate('project', p.id), 'ws-text-button') : tag('No active project')); return banner;
  }
  function renderHome() {
    mount.append(heading('Your projects, in view.', 'A place for every idea. A clear next step for every project.', btn('+ New project', () => { if (preview) { preview = false; samples = []; } navigate('new'); }, 'ws-button ws-primary', 'create-project-screen')));
    mount.append(focusBanner());
    const attention = projectAttention(all());
    if (attention.length) {
      const box = panel('A moment of your attention', `${attention.length} ${attention.length === 1 ? 'item is' : 'items are'} waiting for your input.`); box.classList.add('ws-attention');
      for (const item of attention.slice(0, 4)) { const row = el('div', 'ws-attention-row'); row.append(el('span', 'ws-attention-mark', '!'), el('div', 'ws-grow')); row.lastChild.append(el('strong', '', `${item.project.title} · ${item.definition.title}`), small(item.step.question?.text || `${name(item.definition.agentId)} · ${WORKFLOW_STATUS[item.step.status]}`)); row.append(btn('Review →', () => { navigate('project', item.project.id); openWork(item.project, item.step.id); }, 'ws-text-button')); box.append(row); } mount.append(box);
    }
    const toolbar = el('div', 'ws-project-toolbar'), filters = el('div', 'ws-filters');
    for (const [value, label] of [['all', 'All projects'], ['active', 'Active'], ['paused', 'Paused'], ['draft', 'Drafts']]) { const n = btn(label, () => { filter = value; render(true); }, filter === value ? 'active' : ''); n.setAttribute('aria-pressed', String(filter === value)); filters.append(n); }
    const search = el('input', 'ws-search'); search.type = 'search'; search.placeholder = 'Find a project…'; search.setAttribute('aria-label', 'Find a project'); search.value = query;
    search.addEventListener('input', () => { query = search.value; renderCards(); }); toolbar.append(filters, search); mount.append(toolbar);
    const grid = el('div', 'ws-project-grid'); grid.dataset.testid = 'project-cards'; mount.append(grid);
    function renderCards() {
      grid.replaceChildren();
      const list = all().filter(p => p.title.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || filter === 'draft' && p.draft || filter === 'paused' && p.paused && !p.draft || filter === 'active' && !p.paused && !p.draft && p.steps.delivery_approval?.status !== 'completed'));
      for (const p of list) {
        const summary = projectSummary(p), card = el('article', 'ws-project-card'); card.dataset.projectCard = p.id;
        const top = el('div', 'ws-card-top'); top.append(el('span', 'ws-project-initial', p.title.slice(0, 1).toUpperCase()), tag(summary.label, summary.tone));
        card.append(top, btn(p.title, () => navigate('project', p.id), 'ws-card-title'), el('p', 'ws-card-description', p.brief || 'An idea waiting to take shape. Add a brief when you’re ready.'));
        const progress = el('div', 'ws-phase-track'); progress.setAttribute('aria-label', `Current phase: ${summary.phase}`);
        for (const phase of WORKFLOW_PHASES) { const n = el('span'); n.dataset.complete = String(phase.ids.filter(id => p.steps[id]).every(id => p.steps[id].status === 'completed')); n.dataset.current = String(phase.title === summary.phase && !p.draft); progress.append(n); }
        card.append(progress, el('div', 'ws-card-phase', summary.phase));
        const foot = el('div', 'ws-card-foot'); foot.append(avatars(CORE_TEAM.slice(0, 3)), btn('Open project ↗', () => navigate('project', p.id), 'ws-text-button')); card.append(foot); grid.append(card);
      }
      if (!list.length) { const empty = el('div', 'ws-empty'); empty.append(el('span', 'ws-empty-art', '✳'), el('h2', '', all().length ? 'No matching projects.' : 'Start with an idea.'), small(all().length ? 'Try another name or project status.' : 'Give Nora a brief, bring your references, and build a project together.'));
        if (!all().length) empty.append(btn('Create your first project', () => navigate('new'), 'ws-button ws-primary'), btn('Explore sample screens ↗', () => showPreview(true), 'ws-text-button', 'preview-screens')); grid.append(empty); }
    }
    renderCards();
    const foot = el('div', 'ws-home-foot'); foot.append(small(`${all().length} projects · One team, one active project at a time.`)); if (!preview && all().length) foot.append(btn('Explore sample screens', () => showPreview(true), 'ws-text-button', 'preview-screens')); mount.append(foot);
  }
  function renderProject(p) {
    const summary = projectSummary(p), focused = active()?.id === p.id;
    const action = p.draft ? btn('Finish the brief', () => editDraft(p), 'ws-button ws-primary', 'edit-project-draft') : focused ? btn('Pause project', () => act(async () => { if (preview) p.paused = true; else await projectStore.command('pause', { projectId: p.id }); render(true); }), 'ws-button', 'pause-current-project') : btn('Move team here', () => moveTeam(p), 'ws-button ws-primary', 'move-team');
    mount.append(heading(p.title, p.brief || 'A new project, ready to take shape.', action));
    const sub = el('div', 'ws-project-meta'); sub.append(tag(summary.label, summary.tone), el('span', '', preview ? 'Sample project' : `Updated ${stamp(p.updatedAt)}`)); mount.append(sub);
    if (!focused && !p.draft) { const notice = el('div', 'ws-context-note'); notice.append(el('strong', '', active() ? `You’re viewing ${p.title}. The team is working on ${active().title}.` : 'This project is paused.'), small('Browsing keeps the team’s current assignment unchanged.')); mount.append(notice); }
    const layout = el('div', 'ws-dashboard-grid'), main = el('div', 'ws-dashboard-main'), side = el('div', 'ws-dashboard-side'); layout.append(main, side); mount.append(layout);
    const next = panel(p.draft ? 'Your next step' : 'Where things stand'); next.classList.add('ws-next');
    next.append(el('p', 'ws-eyebrow', p.draft ? 'PROJECT KICKOFF' : summary.phase.toUpperCase()), el('h3', '', p.draft ? 'Give Nora the starting point.' : summary.step.title), small(p.draft ? 'Add your brief and references. Starting work is a separate decision.' : p.steps[summary.step.id].question?.text || p.steps[summary.step.id].error || `${name(summary.step.agentId)} · ${WORKFLOW_STATUS[p.steps[summary.step.id].status] || 'Ready'}`));
    next.append(btn(p.draft ? 'Edit project brief →' : 'Open work & review →', () => p.draft ? editDraft(p) : openWork(p), 'ws-button ws-primary')); main.append(next);
    const journey = panel('The path ahead'); const steps = el('div', 'ws-journey');
    WORKFLOW_PHASES.forEach((phase, i) => { const ids = phase.ids.filter(id => p.steps[id]); const done = ids.every(id => p.steps[id].status === 'completed'), current = phase.title === summary.phase; const row = el('div', `ws-journey-row${current ? ' current' : ''}`); row.append(el('span', 'ws-journey-number', done ? '✓' : `0${i + 1}`), el('strong', '', phase.title), el('span', 'ws-muted', done ? 'Complete' : current ? summary.label : 'Upcoming')); steps.append(row); }); journey.append(steps); main.append(journey);
    const team = panel('Your project team', 'Six core roles, with specialists when needed.');
    for (const id of [...CORE_TEAM, ...(p.specialists || [])]) { const a = AGENTS.find(a => a.id === id), row = el('div', 'ws-team-row'); row.append(avatars([id]), el('div', 'ws-grow')); row.lastChild.append(el('strong', '', a.name), el('span', 'ws-muted', a.role)); team.append(row); } side.append(team);
    const resources = panel('Project resources'); resources.append(el('strong', 'ws-big-number', String((p.resources?.length || 0) + Number(Boolean(p.sourceText)) + Number(Boolean(p.figmaUrl)) + Number(Boolean(p.designSystemUrl)))), small('Documents, references and design links'), btn('View resources ↗', () => navigate('resources', p.id), 'ws-text-button')); side.append(resources);
    const recent = panel('Recent activity'); if (!p.events.length) recent.append(small('Project activity will appear here.'));
    for (const event of [...p.events].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5)) { const row = el('div', 'ws-activity'); row.append(el('span', 'ws-activity-dot'), el('div', 'ws-grow')); row.lastChild.append(el('p', '', event.text), el('time', 'ws-muted', stamp(event.createdAt))); recent.append(row); } main.append(recent);
  }
  function renderResources(p) {
    mount.append(heading('A shared starting point.', `The brief and references for ${p.title}.`, p.draft ? btn('Edit resources', () => editDraft(p), 'ws-button ws-primary') : null));
    const brief = panel('Project brief'); brief.append(documentView(p.brief || 'No brief added yet.')); mount.append(brief);
    const files = panel('Documents & files', 'TXT and Markdown are readable by agents. PDF and image files are saved references; agent reading is not connected yet.');
    if (!p.resources?.length && !p.sourceText) files.append(small('No documents added.'));
    for (const r of p.resources || []) { const row = el('div', 'ws-resource-row'); row.append(el('span', 'ws-file-icon', r.mime?.startsWith('image/') ? 'IMG' : r.mime === 'application/pdf' ? 'PDF' : 'TXT'), el('div', 'ws-grow')); row.lastChild.append(el('strong', '', r.name), small(`${Math.max(1, Math.ceil((r.size || 0) / 1024))} KB · ${r.readable || typeof r.text === 'string' ? 'Ready for agents' : 'Saved reference · agent access pending'}`)); row.append(btn('Download ↓', () => download(r), 'ws-text-button')); files.append(row); }
    if (p.sourceText) { const details = el('details', 'ws-resource-text'); details.append(el('summary', '', 'Pasted reference document'), documentView(p.sourceText)); files.append(details); } mount.append(files);
    const links = panel('Design references');
    for (const [key, label] of [['figmaUrl', 'Figma file'], ['designSystemUrl', 'Design system']]) { const row = el('div', 'ws-resource-row'); row.append(el('div', 'ws-grow')); row.lastChild.append(el('strong', '', label), small(p[key] ? 'Reference saved · file access must be connected separately' : 'No reference added')); if (p[key]) { const a = el('a', 'ws-text-button', 'Open reference ↗'); a.href = p[key]; a.target = '_blank'; a.rel = 'noopener noreferrer'; row.append(a); } links.append(row); } mount.append(links);
    if (!p.draft) mount.append(small('These are the kickoff references. Use the project review workflow to request changes to an approved brief.'));
  }
  function renderWork(p) {
    mount.append(heading('The work, in order.', `Deliverables, decisions and next steps for ${p.title}.`, btn('Open current work ↗', () => openWork(p), 'ws-button ws-primary')));
    for (const phase of WORKFLOW_PHASES) { const box = panel(phase.title); for (const d of workflowSteps(p).filter(d => phase.ids.includes(d.id))) { const s = p.steps[d.id], row = el('div', 'ws-work-row'); row.append(el('span', 'ws-work-check', s.status === 'completed' ? '✓' : '○'), el('div', 'ws-grow')); row.lastChild.append(el('strong', '', d.title), small(name(d.agentId))); row.append(tag(WORKFLOW_STATUS[s.status] || s.status, s.status === 'completed' ? 'green' : s.status === 'needs_approval' ? 'amber' : 'neutral'), btn('View →', () => openWork(p, d.id), 'ws-text-button')); box.append(row); } mount.append(box); }
  }
  function renderProjectSettings(p) {
    mount.append(heading('Project settings', `Connections and scope for ${p.title}.`));
    const info = panel('Project details'); info.append(el('strong', '', p.title), small(p.brief || 'No brief yet.')); if (p.draft) info.append(btn('Edit draft', () => editDraft(p))); mount.append(info);
    const connections = panel('Repository & design', 'Each project keeps its own references.'); connections.append(el('strong', '', p.repository), small('Current supported repository. Other repositories need a separate execution connection.'), btn('View project resources', () => navigate('resources', p.id))); mount.append(connections);
    const life = panel('Project lifecycle', 'Archiving preserves the saved history and stops further project work.');
    life.append(btn('Archive project', () => { modal.replaceChildren(el('h2', '', `Archive ${p.title}?`), small('It leaves your project list. Saved work and decisions are retained.'), btn('Cancel', () => modal.close()), btn('Archive project', () => act(async () => { if (preview) samples = samples.filter(item => item.id !== p.id); else await projectStore.command('discard', { projectId: p.id }); modal.close(); navigate('projects'); }), 'ws-button ws-danger', 'confirm-archive')); modal.showModal(); }, 'ws-button ws-danger', 'archive-project')); mount.append(life);
  }
  function renderCreate() {
    mount.classList.add('ws-form-page'); draft ||= newDraft();
    mount.append(heading(draft.id ? 'Shape the starting point.' : 'What shall we build?', 'A short brief is enough to begin. Bring the rest of the context with you.', btn('Back to projects', () => navigate('projects'), 'ws-text-button')));
    const layout = el('div', 'ws-create-layout'), form = el('form', 'ws-create-form'); form.dataset.testid = 'project-create-form';
    const side = panel('Start small. Get clear.'); side.classList.add('ws-create-guide'); side.append(avatars(['nora']), el('h3', '', 'Nora takes it from here.'), small('She uses your brief and readable references to draft a PRD. Theo reviews it, then you make the final decision.'));
    for (const [i, line] of ['Describe the outcome', 'Bring your references', 'Review the first PRD'].entries()) { const row = el('p', 'ws-guide-step'); row.append(el('span', '', `0${i + 1}`), el('strong', '', line)); side.append(row); } side.append(small('Saving a draft does not start an agent. Starting work explicitly moves the team to this project.')); layout.append(form, side); mount.append(layout);
    const details = panel('01 / The idea'); form.append(details);
    function field(label, key, area = false, placeholder = '', maxLength = 1800) { const wrapper = el('label', 'ws-field'); wrapper.append(el('span', '', label)); const n = el(area ? 'textarea' : 'input'); n.value = draft[key] || ''; n.placeholder = placeholder; n.maxLength = maxLength; n.dataset.testid = `new-${key}`; if (key === 'title') n.required = true; n.addEventListener('input', () => { draft[key] = n.value; saveTabDraft(); }); wrapper.append(n); return wrapper; }
    details.append(field('Project name', 'title', false, 'e.g. ABC — Checkout experience', 140), field('What do you want to achieve?', 'brief', true, 'Who is this for? What should it help them do? What matters most to you?', 12000));
    const resources = panel('02 / The context', 'Add the documents and references that explain your idea.'); form.append(resources);
    let uploading = false;
    const upload = el('label', 'ws-dropzone'), input = el('input'); input.type = 'file'; input.multiple = true; input.accept = '.txt,.md,.pdf,.png,.jpg,.jpeg'; input.dataset.testid = 'project-files';
    upload.append(el('span', 'ws-upload-mark', '↑'), el('strong', '', 'Choose documents or images'), el('span', 'ws-muted', 'TXT, MD, PDF, PNG or JPG · 150 KB per file · 250 KB total'), input); resources.append(upload);
    const fileList = el('div'); resources.append(fileList);
    function renderFiles() { fileList.replaceChildren(); for (const [index, r] of (draft.resources || []).entries()) { const row = el('div', 'ws-resource-row'); row.append(el('div', 'ws-grow')); row.lastChild.append(el('strong', '', r.name), small(typeof r.text === 'string' ? 'Readable by agents after kickoff' : 'Saved reference · agent reading not connected')); row.append(btn('Remove', () => { draft.resources.splice(index, 1); saveTabDraft(); renderFiles(); }, 'ws-text-button')); fileList.append(row); } }
    renderFiles();
    async function addFiles(files) {
      if (uploading) return;
      const sourceDraft = draft; uploading = true; input.disabled = save.disabled = start.disabled = true; fileList.setAttribute('aria-busy', 'true');
      try {
        const additions = [];
        for (const file of Array.from(files)) {
          if (file.size > 150 * 1024) throw new Error(`${file.name} is too large. Keep each file below 150 KB for this first version.`);
          const extension = file.name.split('.').at(-1).toLowerCase(), mime = { txt: 'text/plain', md: 'text/markdown', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[extension];
          if (!mime) throw new Error('Choose TXT, Markdown, PDF, PNG or JPEG files.');
          const item = { name: file.name, mime, size: file.size }; if (mime.startsWith('text/')) item.text = await file.text(); else item.data = btoa(Array.from(new Uint8Array(await file.arrayBuffer()), byte => String.fromCharCode(byte)).join(''));
          additions.push(item);
        }
        if (draft !== sourceDraft) return;
        const next = [...(draft.resources || []), ...additions];
        if (next.length > 5 || next.reduce((n, r) => n + (r.size || 0), 0) > 250 * 1024 || next.reduce((n, r) => n + (r.text?.length || 0), 0) > 16000) throw new Error('Use up to five files, 250 KB total, and 16,000 text characters.');
        draft.resources = next; saveTabDraft(); renderFiles();
      } catch (e) { if (draft === sourceDraft) error(e.message); } finally { uploading = false; input.disabled = save.disabled = start.disabled = false; fileList.removeAttribute('aria-busy'); input.value = ''; }
    }
    input.addEventListener('change', () => addFiles(input.files)); upload.addEventListener('dragover', e => { e.preventDefault(); upload.classList.add('dragging'); }); upload.addEventListener('dragleave', () => upload.classList.remove('dragging')); upload.addEventListener('drop', e => { e.preventDefault(); upload.classList.remove('dragging'); addFiles(e.dataTransfer.files); });
    const more = el('details', 'ws-paste-reference'); more.append(el('summary', '', 'Or paste reference text'), field('Reference document', 'sourceText', true, 'Paste the relevant sections here…', 16000)); resources.append(more, field('Figma file (optional)', 'figmaUrl', false, 'https://www.figma.com/design/…'), field('Design system (optional)', 'designSystemUrl', false, 'https://…'));
    resources.append(small('Figma links are saved as references; agents need file access before reading or editing designs.'));
    const team = panel('03 / Your team', 'Six core roles come with every project. Add a specialist only when needed.'); team.append(avatars(CORE_TEAM), small(CORE_TEAM.map(name).join(' · ')));
    const specialists = el('details', 'ws-specialist-picker'); specialists.append(el('summary', '', 'Add an on-demand specialist'));
    for (const specialist of PROJECT_SPECIALISTS) { const label = el('label', 'ws-check-row'), checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = draft.specialists.includes(specialist.id); checkbox.addEventListener('change', () => { draft.specialists = checkbox.checked ? [...draft.specialists, specialist.id] : draft.specialists.filter(id => id !== specialist.id); saveTabDraft(); }); label.append(checkbox, el('span', '', `${specialist.name} · ${specialist.role}`)); specialists.append(label); } team.append(specialists); form.append(team);
    const actions = el('div', 'ws-create-actions'); actions.append(small('Drafts stay private. You decide when work begins.'));
    const save = btn('Save draft', () => submit(false), 'ws-button', 'save-project-draft'), start = btn('Create & brief Nora', () => submit(true), 'ws-button ws-primary', 'brief-nora'); if (draft.id) start.textContent = 'Save & brief Nora'; actions.append(save, start); form.append(actions); form.addEventListener('submit', e => { e.preventDefault(); submit(false); });
    async function submit(startWork) {
      if (pending || uploading || !form.reportValidity()) return;
      if (startWork && !draft.brief.trim()) { error('Tell Nora briefly what you want this project to achieve.'); form.querySelector('[data-testid="new-brief"]').focus(); return; }
      await act(async () => {
        const payload = { title: draft.title, brief: draft.brief, sourceText: draft.sourceText || '', figmaUrl: draft.figmaUrl || '', designSystemUrl: draft.designSystemUrl || '', specialists: draft.specialists.join(','), resources: resourceInput(draft.resources), draft: 'true' };
        let p;
        if (preview) { p = { ...previewProjects()[2], ...structuredClone(draft), id: draft.id || `preview-${crypto.randomUUID()}`, draft: true, paused: true }; const index = samples.findIndex(item => item.id === p.id); if (index < 0) samples.push(p); else samples[index] = p; }
        else { const result = await projectStore.command(draft.id ? 'updateDraft' : 'create', { ...payload, ...(draft.id ? { projectId: draft.id } : {}) }); p = projectStore.getState().projects.find(item => item.id === result.projectId); }
        draft = null; try { sessionStorage.removeItem('office-project-draft'); } catch {} navigate('project', p.id); if (startWork) moveTeam(p);
      });
    }
  }
  function renderSettings() {
    mount.append(heading('Make yourself at home.', 'Your workspace, team and connections, all in one place.'));
    const tabs = el('nav', 'ws-settings-tabs'); tabs.setAttribute('aria-label', 'Settings sections');
    const section = route.section || 'general';
    for (const [id, text] of [['general', 'General'], ['team', 'Departments & skills'], ['connections', 'Connections'], ['access', 'Access']]) tabs.append(btn(text, () => navigate('settings', undefined, id), section === id ? 'active' : '', `settings-${id}`)); mount.append(tabs);
    if (section === 'team') { mount.append(teamMount); if (!teamOpened) { directory.open(); teamOpened = true; } return; }
    if (section === 'general') {
      const about = panel('Workspace', 'The Office is your platform. Each project has its own brief, resources and work.'); about.append(el('div', 'ws-setting-row', 'Workspace name'), el('strong', '', 'The Office')); mount.append(about);
      const appearance = panel('Appearance on this device', 'Keep navigation comfortable while moving around the workspace.');
      const label = el('label', 'ws-field'); label.append(el('span', '', 'Navigation motion')); const select = el('select'); select.add(new Option('Follow system settings', 'system')); select.add(new Option('Reduce motion', 'reduce')); try { select.value = localStorage.getItem('office-motion') || 'system'; } catch {} select.addEventListener('change', () => { try { localStorage.setItem('office-motion', select.value); } catch {} document.documentElement.dataset.motion = select.value; }); label.append(select); appearance.append(label); mount.append(appearance);
      const scope = panel('Workspace overview', `${AGENTS.length} agent profiles · ${DEPARTMENTS.length} departments · ${SKILLS.length} installed skill packages.`); scope.append(btn('Manage departments & skills ↗', () => navigate('settings', undefined, 'team'), 'ws-text-button')); mount.append(scope);
    } else if (section === 'connections') {
      const worker = panel('Local worker', 'Agent work runs while this computer and its worker are online.'); const badge = tag(workspaceStore.getState().runtime?.online ? 'Connected' : 'Offline', workspaceStore.getState().runtime?.online ? 'green' : 'neutral'); badge.dataset.workerStatus = ''; worker.append(badge, small('Uses the existing Codex sign-in on this computer.')); mount.append(worker);
      const capabilities = panel('Project connections');
      for (const [label, state, note] of [['Repository', 'Connected', 'priyanshp1859/Virtual-Team'], ['Planning & document reviews', 'Connected', 'Nora, Theo, Maya, Ava and selected specialists'], ['Figma', 'Access needed', 'Save a reference in your project. File reading and editing need a connection.'], ['Project implementation & browser QA', 'Not connected', 'These project stages remain blocked until their execution tools are ready.']]) { const row = el('div', 'ws-resource-row'); row.append(el('div', 'ws-grow')); row.lastChild.append(el('strong', '', label), small(note)); row.append(tag(state, state === 'Connected' ? 'green' : 'neutral')); capabilities.append(row); } mount.append(capabilities);
    } else {
      const access = panel('Private workspace', 'Your workspace requires an access code. Everyone with the code uses this shared workspace.'); access.append(tag('Access code required', 'green'), small('Signing out hides projects and clears unsaved drafts on this device.'), btn('Sign out of workspace', onSignOut)); mount.append(access);
    }
  }
  document.getElementById('projects-home-button').addEventListener('click', () => navigate('projects'));
  document.getElementById('settings-button').addEventListener('click', () => navigate('settings'));
  document.querySelector('.wordmark').addEventListener('click', e => { e.preventDefault(); navigate('projects'); });
  workspaceStore.subscribe(s => { if (route.page === 'projects') render(); for (const n of mount.querySelectorAll('[data-worker-status]')) { n.textContent = s.runtime?.online ? 'Connected' : 'Offline'; } });
  projectStore.subscribe(s => { const wasAuthenticated = snapshot.authenticated; snapshot = s; if (!s.authenticated) { mount.replaceChildren(); modal.close(); directory.close(); teamOpened = false; draft = null; preview = false; samples = []; signature = ''; if (wasAuthenticated) { try { sessionStorage.removeItem('office-project-draft'); } catch {} } } else render(); });
  return {
    navigate, isOffice: () => route.page === 'office',
    enter() { const params = new URLSearchParams(location.hash.slice(1)); if (params.get('preview') === '1') { preview = true; samples = previewProjects(); } const page = ['projects', 'project', 'resources', 'work', 'project-settings', 'settings', 'office', 'new'].includes(params.get('page')) ? params.get('page') : 'projects'; navigate(page, params.get('id') || undefined, params.get('section') || undefined); },
  };
}
