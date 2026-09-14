import { AGENTS } from './config.js';
import { STATUS_LABELS } from './cloud-store.js';
import './workspace-overview.css';

export function createWorkspaceOverview({ mount, store, onOpenTask, onNewTask }) {
  const groups = [
    { id: 'queued', label: 'Queued', statuses: ['queued'] },
    { id: 'working', label: 'Working', statuses: ['working'] },
    { id: 'attention', label: 'Needs you', statuses: ['waiting_for_user', 'changes_requested'] },
    { id: 'review', label: 'In review', statuses: ['in_review'] },
  ];
  let expanded = false, filter = 'all';
  mount.className = 'work-summary';
  mount.innerHTML = `<div class="work-summary-row"><div class="work-counts" aria-label="Task counts"></div><button type="button" class="work-queue-toggle" aria-expanded="false" aria-controls="work-queue">Work queue <span aria-hidden="true">↗</span></button></div><div class="work-queue" id="work-queue" hidden><div class="work-queue-heading"><div><h2>Your work queue</h2><p>Saved to your private workspace. Agents are not connected.</p></div><button type="button" class="queue-new-task">+ New task</button></div><div class="work-queue-filters" aria-label="Filter tasks"></div><div class="work-queue-list"></div></div>`;
  const $ = selector => mount.querySelector(selector);
  const counts = $('.work-counts');
  const toggle = $('.work-queue-toggle');
  const queue = $('.work-queue');
  const list = $('.work-queue-list');
  const filters = $('.work-queue-filters');
  const countButtons = groups.map(group => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = `work-count ${group.id}`;
    button.innerHTML = '<span class="work-count-dot" aria-hidden="true"></span><strong>0</strong><span></span>';
    button.lastElementChild.textContent = group.label;
    button.addEventListener('click', () => { expanded = true; filter = group.id; render(); });
    counts.append(button);
    return button;
  });
  const filterOptions = [{ id: 'all', label: 'All tasks' }, ...groups, { id: 'completed', label: 'Completed', statuses: ['completed'] }];
  const filterButtons = filterOptions.map(option => {
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = option.label;
    button.addEventListener('click', () => { filter = option.id; render(); });
    filters.append(button); return button;
  });

  function render() {
    const { tasks, connectionStatus } = store.getState();
    $('.work-queue-heading p').textContent = connectionStatus === 'error'
      ? 'Showing the last confirmed save. Refresh to reconnect. Agents are not connected.'
      : 'Saved to your private workspace. Agents are not connected.';
    groups.forEach((group, i) => {
      const count = tasks.filter(task => group.statuses.includes(task.status)).length;
      countButtons[i].querySelector('strong').textContent = count;
      countButtons[i].setAttribute('aria-label', `${count} ${group.label.toLowerCase()} tasks`);
      countButtons[i].setAttribute('aria-pressed', String(expanded && filter === group.id));
    });
    toggle.setAttribute('aria-expanded', String(expanded));
    queue.hidden = !expanded;
    filterButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(filterOptions[i].id === filter)));
    if (!expanded) return;
    const activeFilter = filterOptions.find(option => option.id === filter);
    const visible = tasks.filter(task => !activeFilter.statuses || activeFilter.statuses.includes(task.status)).sort((a, b) => b.updatedAt - a.updatedAt);
    list.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement('p'); empty.className = 'work-queue-empty';
      empty.textContent = filter === 'all' ? 'A clear desk. Queue your first task to get started.' : 'No tasks here right now.';
      list.append(empty); return;
    }
    visible.forEach(task => {
      const agent = AGENTS.find(a => a.id === task.agentId);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'work-queue-task';
      button.dataset.taskId = task.id;
      const avatar = document.createElement('span'); avatar.className = 'queue-avatar'; avatar.textContent = agent.name[0]; avatar.style.setProperty('--agent-color', agent.color);
      const copy = document.createElement('span'); copy.className = 'queue-task-copy';
      const title = document.createElement('strong'); title.textContent = task.title;
      const meta = document.createElement('small'); meta.textContent = `${agent.name} · ${task.isSample ? 'Sample task' : 'Workspace task'}`;
      copy.append(title, meta);
      const status = document.createElement('span'); status.className = `queue-status ${task.status}`; status.textContent = STATUS_LABELS[task.status];
      button.append(avatar, copy, status);
      button.addEventListener('click', () => onOpenTask(task));
      list.append(button);
    });
  }

  const toggleQueue = () => { expanded = !expanded; render(); };
  toggle.addEventListener('click', toggleQueue);
  $('.queue-new-task').addEventListener('click', onNewTask);
  const unsubscribe = store.subscribe(render);
  render();
  return { dispose() { unsubscribe(); mount.replaceChildren(); } };
}
