import { AGENTS, DEPARTMENTS, SKILLS, AVATAR_AGENTS } from './config.js';
import { WORKFLOW_STEPS } from './workflow-config.js';
import './team-directory.css';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const list = items => {
  const node = el('ul', 'ap-list');
  for (const item of items) node.append(el('li', '', item));
  return node;
};
const sourceLink = (label, url) => {
  const link = el('a', 'ap-source', label); link.href = url;
  link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;
};

export function renderAgentProfile(agent, runtime) {
  const fragment = document.createDocumentFragment();
  const department = DEPARTMENTS.find(item => item.id === agent.department);
  const summary = el('div', 'ap-summary');
  summary.append(el('span', 'ap-department', department.name), el('h3', '', agent.description));
  const badges = el('div', 'ap-badges');
  if (agent.launchTeam) badges.append(el('span', 'ap-tag', 'Core team'));
  badges.append(el('span', 'ap-tag', runtime?.chatAgents?.includes(agent.id) ? runtime.chatOnline ? 'Chat connected' : 'Chat worker offline' : agent.id === 'sam' && runtime?.enabled ? runtime.online ? 'Worker connected' : 'Worker offline' : runtime?.projectAgents?.includes(agent.id) ? runtime.projectOnline ? 'Project worker connected' : 'Project worker offline' : 'Profile ready · connection pending'));
  summary.append(badges); fragment.append(summary);
  fragment.append(el('h4', 'ap-heading', 'Responsibilities'), list(agent.responsibilities));
  fragment.append(el('h4', 'ap-heading', 'What you can expect'), list(agent.deliverables));
  fragment.append(el('h4', 'ap-heading', 'Working boundaries'), list(agent.boundaries));
  const skillsHeading = el('div', 'ap-skills-heading');
  skillsHeading.append(el('h4', 'ap-heading', 'Assigned skills'), el('span', 'ap-skill-count', `${agent.skills.length} mapped`));
  fragment.append(skillsHeading, el('p', 'ap-help', 'Skills provide task guidance. Tools, access and team connections are configured separately.'));
  for (const binding of agent.skills) {
    const skill = SKILLS.find(item => item.id === binding.id);
    const card = el('article', 'ap-skill'); card.dataset.skill = skill.id;
    const top = el('div', 'ap-skill-top'); top.append(el('h5', '', skill.name), el('span', 'ap-installed', 'Installed'));
    card.append(top, el('p', 'ap-skill-purpose', binding.purpose));
    card.append(el('p', 'ap-skill-provider', skill.repository));
    const details = el('details', 'ap-skill-details');
    details.append(el('summary', '', 'When and how to use it'), el('p', '', skill.adaptation), el('p', '', `Needs: ${skill.requires}`));
    card.append(details);
    const links = el('div', 'ap-links');
    links.append(sourceLink('View on skills.sh ↗', skill.directoryUrl), sourceLink('Source ↗', skill.sourceUrl));
    card.append(links); fragment.append(card);
  }
  fragment.append(el('p', 'ap-help ap-footnote', 'Source versions checked on 14 September 2026. Each package is pinned; updates are reviewed before replacing it.'));
  return fragment;
}

export function createTeamDirectory({ store, projectStore, onSelect }) {
  const dialog = el('dialog', 'team-directory'); dialog.dataset.testid = 'team-directory';
  dialog.setAttribute('aria-labelledby', 'team-directory-title');
  const header = el('header', 'td-header');
  const heading = el('div'); heading.append(el('p', 'td-eyebrow', 'THE PEOPLE BEHIND THE WORK'));
  const title = el('h2', '', 'Your team, thoughtfully assembled.'); title.id = 'team-directory-title';
  heading.append(title, el('p', 'td-subtitle', `${AGENTS.length} agents · ${DEPARTMENTS.length} departments · ${SKILLS.length} selected skills`));
  const close = el('button', 'td-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close team directory'); close.addEventListener('click', () => dialog.close());
  header.append(heading, close);
  const toolbar = el('div', 'td-toolbar');
  const searchLabel = el('label', 'td-search-label'); searchLabel.append(el('span', 'sr-only', 'Search agents, roles or skills'));
  const search = el('input', 'td-search'); search.type = 'search'; search.placeholder = 'Find a role, person or skill…'; search.dataset.testid = 'team-search'; searchLabel.append(search);
  const count = el('span', 'td-count'); count.setAttribute('role', 'status');
  toolbar.append(searchLabel, count);
  const filters = el('div', 'td-filters'); filters.setAttribute('aria-label', 'Filter by department');
  let selected = 'all', coreOnly = true, opener = null, openingProfile = false;
  const filterButtons = new Map();
  for (const department of [{ id: 'all', name: 'All departments' }, ...DEPARTMENTS]) {
    const button = el('button', 'td-filter', department.name); button.type = 'button'; button.dataset.department = department.id;
    button.addEventListener('click', () => { selected = department.id; render(); }); filterButtons.set(department.id, button); filters.append(button);
  }
  const scope = el('button', 'td-filter', 'Show on-demand specialists'); scope.type = 'button'; scope.dataset.testid = 'team-scope'; scope.addEventListener('click', () => { coreOnly = !coreOnly; scope.textContent = coreOnly ? 'Show on-demand specialists' : 'Show core team only'; render(); }); toolbar.append(scope);
  const body = el('div', 'td-body'); body.dataset.testid = 'team-results';
  const foot = el('footer', 'td-footer');
  foot.append(el('span', '', 'Open a profile to see responsibilities and skill sources.'), el('span', '', `${AVATAR_AGENTS.length} core team seats · specialists join when needed`));
  dialog.append(header, toolbar, filters, body, foot); document.body.append(dialog);

  function render() {
    const query = search.value.trim().toLowerCase();
    let total = 0; body.replaceChildren();
    for (const [id, button] of filterButtons) button.setAttribute('aria-pressed', String(id === selected));
    for (const department of DEPARTMENTS) {
      if (selected !== 'all' && selected !== department.id) continue;
      const matches = AGENTS.filter(agent => agent.department === department.id && (!coreOnly || agent.launchTeam || query) &&
        [agent.name, agent.role, agent.description, department.name, ...agent.skills.flatMap(binding => [binding.id, SKILLS.find(skill => skill.id === binding.id)?.name])].join(' ').toLowerCase().includes(query));
      if (!matches.length) continue;
      total += matches.length;
      const section = el('section', 'td-department'); section.style.setProperty('--department-color', department.color);
      const sectionHeading = el('div', 'td-department-heading'); sectionHeading.append(el('h3', '', department.name), el('span', '', String(matches.length).padStart(2, '0')));
      section.append(sectionHeading, el('p', 'td-purpose', department.purpose));
      const grid = el('div', 'td-grid');
      for (const agent of matches) {
        const card = el('button', 'td-agent'); card.type = 'button'; card.dataset.profileAgent = agent.id;
        card.setAttribute('aria-label', `View ${agent.name}, ${agent.role}`);
        const identity = el('div', 'td-agent-identity');
        const avatar = el('span', 'td-avatar', agent.name[0]); avatar.style.setProperty('--agent-color', agent.color); avatar.setAttribute('aria-hidden', 'true');
        const names = el('span'); names.append(el('strong', '', agent.name), el('span', 'td-role', agent.role)); identity.append(avatar, names);
        const tags = el('div', 'td-tags');
        const projectRuntime = projectStore?.getState().runtime;
        const projectRole = WORKFLOW_STEPS.some(d => d.agentId === agent.id && projectRuntime?.capabilities?.[d.kind]);
        tags.append(el('span', agent.id === 'sam' && store.getState().runtime?.online ? 'td-tag connected' : 'td-tag', agent.id === 'sam' && store.getState().runtime?.online ? 'Connected' : projectRole ? projectRuntime.online ? 'Project worker' : 'Worker offline' : 'Profile ready'));
        tags.append(el('span', agent.launchTeam ? 'td-tag core' : 'td-tag', agent.launchTeam ? 'Core team' : 'On demand'));
        const skills = el('div', 'td-skill-names');
        for (const binding of agent.skills) skills.append(el('span', '', SKILLS.find(skill => skill.id === binding.id).name));
        card.append(identity, tags, el('p', 'td-description', agent.description), skills, el('span', 'td-open', 'View profile & skills ↗'));
        card.addEventListener('click', () => { openingProfile = true; dialog.close(); onSelect(agent.id); }); grid.append(card);
      }
      section.append(grid); body.append(section);
    }
    count.textContent = `${total} ${total === 1 ? 'agent' : 'agents'}`;
    if (!total) body.append(el('p', 'td-empty', 'No matching agents. Try another role, skill or department.'));
  }
  search.addEventListener('input', render);
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
  dialog.addEventListener('close', () => { if (!openingProfile && opener?.isConnected) opener.focus({ preventScroll: true }); });
  return {
    open() { opener = document.activeElement; openingProfile = false; selected = 'all'; coreOnly = true; scope.textContent = 'Show on-demand specialists'; search.value = ''; render(); dialog.showModal(); search.focus(); },
    close() { dialog.close(); },
    dispose() { dialog.remove(); },
  };
}
