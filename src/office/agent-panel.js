import { AGENTS, DEPARTMENTS } from './config.js';
import { WORKFLOW_STEPS, workflowSteps } from './workflow-config.js';
import { STATUS_LABELS } from './cloud-store.js';
import { renderAgentProfile } from './team-directory.js';
import './agent-panel.css';
import './runtime.css';

const TABS = ['chat', 'tasks', 'review', 'profile'];
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (text, className = 'aw-button') => {
  const node = el('button', className, text); node.type = 'button'; return node;
};
function stamp(value, detailed = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, detailed
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { hour: 'numeric', minute: '2-digit' });
}
function badge(status) {
  return el('span', `aw-status aw-status--${status}`, STATUS_LABELS[status] || status);
}

// A line-aware diff keeps inserted lines distinct from changed line positions.
// For very large input, use a bounded prefix/suffix comparison instead of an
// unbounded matrix. Source text is always rendered as text, never HTML.
export function diffLines(before, after) {
  const left = String(before ?? '').split('\n'); const right = String(after ?? '').split('\n');
  let rows;
  if (left.length * right.length > 250000) {
    let first = 0; let last = 0;
    while (first < Math.min(left.length, right.length) && left[first] === right[first]) first++;
    while (last < Math.min(left.length, right.length) - first && left[left.length - 1 - last] === right[right.length - 1 - last]) last++;
    rows = [...left.slice(0, first).map(text => ({ kind: 'context', text })),
      ...left.slice(first, left.length - last).map(text => ({ kind: 'removed', text })),
      ...right.slice(first, right.length - last).map(text => ({ kind: 'added', text })),
      ...left.slice(left.length - last).map(text => ({ kind: 'context', text }))];
  } else {
    const matrix = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
    for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--)
      matrix[i][j] = left[i] === right[j] ? matrix[i + 1][j + 1] + 1 : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
    rows = []; let i = 0; let j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) { rows.push({ kind: 'context', text: left[i] }); i++; j++; }
      else if (i < left.length && (j === right.length || matrix[i + 1][j] >= matrix[i][j + 1])) rows.push({ kind: 'removed', text: left[i++] });
      else rows.push({ kind: 'added', text: right[j++] });
    }
  }
  let oldLine = 0; let newLine = 0;
  return rows.map(row => ({ ...row, beforeLine: row.kind === 'added' ? '' : ++oldLine, afterLine: row.kind === 'removed' ? '' : ++newLine }));
}

/** Cloud-saved conversations and review UI; no model or file execution. */
export function createAgentPanel({ mount, store, onClose = () => {}, onSelectAgent = () => {}, onOpenProject = () => {} }) {
  if (!mount || !store) throw new Error('Agent workspace needs a mount and store.');
  let snapshot = store.getState();
  let projectState = { projects: [], runtime: null };
  let agentId = 'sam'; let tab = 'chat'; let opened = false; let disposed = false;
  let returnFocus = null; let presence = null; let reviewTarget = null;
  let composerKey = ''; let formAgent = ''; let feedbackKey = '';
  let logSignature = ''; let taskSignature = ''; let reviewSignature = ''; let contextSignature = '';
  let pending = false;
  const selectedTasks = new Map(); const drafts = new Map(); const taskDrafts = new Map(); const feedbackDrafts = new Map();
  const agent = () => AGENTS.find(item => item.id === agentId);
  const tasks = () => snapshot.tasks.filter(task => task.agentId === agentId).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const currentTask = () => snapshot.tasks.find(task => task.id === selectedTasks.get(agentId) && task.agentId === agentId) || null;
  const connectedAgent = () => agentId === 'sam' && snapshot.runtime?.enabled;
  const currentExecution = () => connectedAgent() ? currentTask()?.execution || (!currentTask() ? snapshot.runtime?.general : null) : null;
  const draftKey = () => `${agentId}:${currentTask()?.id || 'general'}`;

  mount.classList.add('agent-workspace'); mount.hidden = true;
  mount.setAttribute('aria-label', 'Agent workspace'); mount.dataset.testid = 'agent-workspace';
  const header = el('header', 'aw-header');
  const avatar = el('span', 'aw-avatar'); avatar.setAttribute('aria-hidden', 'true');
  const identity = el('div', 'aw-identity');
  const name = el('h2', 'aw-name'); name.id = 'agent-workspace-title'; name.tabIndex = -1;
  const role = el('p', 'aw-role'); const presenceLabel = el('p', 'aw-presence');
  identity.append(name, role, presenceLabel);
  const closeButton = button('×', 'aw-close'); closeButton.setAttribute('aria-label', 'Close agent workspace'); closeButton.dataset.testid = 'agent-workspace-close';
  closeButton.addEventListener('click', () => close(true));
  header.append(avatar, identity, closeButton);

  const connection = el('div', 'aw-connection');
  const offline = el('span', 'aw-offline', 'Not connected');
  const connectionNote = el('span');
  connection.append(offline, connectionNote);
  const projectWork = button('Open project work', 'aw-project-work'); projectWork.hidden = true;
  projectWork.addEventListener('click', () => {
    for (const project of projectState.projects) {
      const step = workflowSteps(project).find(d => d.agentId === agentId && project.steps[d.id].status !== 'locked');
      if (step) { onOpenProject({ projectId: project.id, stepId: step.id }); return; }
    }
    onOpenProject({});
  });
  const storageWarning = el('p', 'aw-storage-warning'); storageWarning.setAttribute('role', 'status'); storageWarning.hidden = true;
  const error = el('p', 'aw-error'); error.setAttribute('role', 'alert'); error.hidden = true; error.dataset.testid = 'workspace-error';
  const nav = el('div', 'aw-tabs'); nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', 'Agent workspace sections');
  const tabButtons = new Map(); const sections = new Map();
  TABS.forEach((key, index) => {
    const control = button('', 'aw-tab'); control.id = `aw-tab-${key}`; control.setAttribute('role', 'tab'); control.setAttribute('aria-controls', `aw-section-${key}`); control.dataset.testid = `agent-tab-${key}`;
    control.append(el('span', '', key[0].toUpperCase() + key.slice(1)), el('span', 'aw-tab-count', '0'));
    control.addEventListener('click', () => setTab(key));
    control.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
      if (event.key === 'ArrowLeft') next = (index + TABS.length - 1) % TABS.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = TABS.length - 1;
      if (next !== undefined) { event.preventDefault(); setTab(TABS[next]); tabButtons.get(TABS[next]).focus(); }
    });
    tabButtons.set(key, control); nav.append(control);
    const section = el('section', `aw-section aw-section--${key}`); section.id = `aw-section-${key}`; section.setAttribute('role', 'tabpanel'); section.setAttribute('aria-labelledby', control.id); sections.set(key, section);
  });

  // Chat structure remains mounted so store updates never replace a focused
  // composer, its IME composition, selection, or per-conversation draft.
  const chat = sections.get('chat');
  const context = el('div', 'aw-context');
  const contextLabel = el('label', 'aw-field-label', 'Conversation'); contextLabel.htmlFor = 'aw-task-select';
  const taskSelect = el('select', 'aw-select'); taskSelect.id = 'aw-task-select'; taskSelect.dataset.testid = 'chat-task-select';
  taskSelect.addEventListener('change', () => { saveDraft(); selectedTasks.set(agentId, taskSelect.value || null); clearError(); render(); });
  const contextMeta = el('div', 'aw-context-meta');
  const contextBrief = el('details', 'aw-context-brief'); contextBrief.hidden = true;
  const briefSummary = el('summary', '', 'Task brief');
  const briefBody = el('p'); contextBrief.append(briefSummary, briefBody);
  let briefTaskId = null;
  const viewReview = button('View review ↗', 'aw-text-button'); viewReview.addEventListener('click', () => setTab('review'));
  context.append(contextLabel, taskSelect, contextMeta, contextBrief);
  const sampleBar = el('div', 'aw-sample-bar'); sampleBar.dataset.testid = 'sample-controls';
  const sampleCopy = el('div', 'aw-sample-copy');
  const sampleAction = button('', 'aw-small-button'); sampleAction.dataset.testid = 'sample-next';
  sampleAction.addEventListener('click', () => {
    const task = currentTask(); const owner = agentId; if (!task?.isSample) return;
    if (task.status === 'waiting_for_user') { composer.focus(); return; }
    if (task.status === 'in_review' || task.status === 'completed') { setTab('review'); return; }
    mutate(() => store.advanceSample(task.id), () => { if (agentId === owner && task.status === 'changes_requested') setTab('review'); });
  });
  sampleBar.append(sampleCopy, sampleAction);
  const runBar = el('div', 'aw-run-bar'); runBar.hidden = true; runBar.dataset.testid = 'runtime-controls';
  const runCopy = el('div', 'aw-run-copy'); const runTitle = el('strong'); const runDetail = el('p'); runCopy.append(runTitle, runDetail);
  const runAction = button('Start Sam', 'aw-small-button'); runAction.dataset.testid = 'runtime-action';
  runAction.addEventListener('click', () => {
    const task = currentTask(), execution = currentExecution();
    const active = ['queued', 'working', 'waiting_for_user', 'publishing'].includes(execution?.status);
    mutate(() => active ? store.cancelRun(task?.id) : store.runTask(task?.id));
  });
  runBar.append(runCopy, runAction);
  const log = el('div', 'aw-messages'); log.setAttribute('role', 'log'); log.setAttribute('aria-label', 'Conversation messages'); log.setAttribute('aria-live', 'polite'); log.dataset.testid = 'chat-messages';
  const composerForm = el('form', 'aw-composer');
  const composerLabel = el('label', 'aw-field-label'); composerLabel.htmlFor = 'aw-message';
  const composer = el('textarea', 'aw-message-input'); composer.id = 'aw-message'; composer.rows = 3; composer.maxLength = 8000; composer.dataset.testid = 'message-composer';
  composer.addEventListener('input', () => { drafts.set(composerKey, composer.value); sendButton.disabled = pending || !composer.value.trim(); });
  composer.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); sendMessage(); }
  });
  const composerFoot = el('div', 'aw-composer-foot');
  const deliveryNote = el('span', 'aw-delivery-note', 'Cloud workspace · agent offline');
  const sendButton = button('Send ↑', 'aw-button aw-primary'); sendButton.type = 'submit'; sendButton.dataset.testid = 'send-message';
  composerFoot.append(deliveryNote, sendButton);
  const keyboardHint = el('p', 'aw-keyboard-hint', 'Enter to send · Shift + Enter for a new line');
  composerForm.append(composerLabel, composer, composerFoot, keyboardHint);
  composerForm.addEventListener('submit', event => { event.preventDefault(); sendMessage(); });
  chat.append(context, sampleBar, runBar, log, composerForm);

  const taskSection = sections.get('tasks');
  const taskHeader = el('div', 'aw-section-heading');
  taskHeader.append(el('h3', '', 'Assignments'));
  const addTask = button('+ New task', 'aw-small-button'); addTask.dataset.testid = 'new-task'; addTask.addEventListener('click', showTaskForm); taskHeader.append(addTask);
  const taskForm = el('form', 'aw-task-form'); taskForm.hidden = true; taskForm.dataset.testid = 'new-task-form';
  const titleLabel = el('label', 'aw-field-label', 'Task title'); titleLabel.htmlFor = 'aw-task-title';
  const titleInput = el('input', 'aw-input'); titleInput.id = 'aw-task-title'; titleInput.type = 'text'; titleInput.maxLength = 120; titleInput.placeholder = 'What should this agent work on?'; titleInput.dataset.testid = 'task-title';
  const briefLabel = el('label', 'aw-field-label', 'Brief'); briefLabel.htmlFor = 'aw-task-brief';
  const briefInput = el('textarea', 'aw-input'); briefInput.id = 'aw-task-brief'; briefInput.rows = 4; briefInput.maxLength = 8000; briefInput.placeholder = 'Describe the outcome, guidelines, and useful context.'; briefInput.dataset.testid = 'task-brief';
  const taskFormFoot = el('div', 'aw-form-actions');
  const cancelTask = button('Cancel', 'aw-text-button'); cancelTask.addEventListener('click', () => { saveTaskDraft(); taskForm.hidden = true; addTask.focus(); });
  const queueTask = button('Queue task', 'aw-button aw-primary'); queueTask.type = 'submit'; queueTask.dataset.testid = 'queue-task';
  taskFormFoot.append(cancelTask, queueTask);
  const taskQueueHelp = el('p', 'aw-help');
  taskForm.append(el('h4', '', 'A new assignment'), titleLabel, titleInput, briefLabel, briefInput, taskQueueHelp, taskFormFoot);
  titleInput.addEventListener('input', saveTaskDraft); briefInput.addEventListener('input', saveTaskDraft);
  taskForm.addEventListener('submit', event => {
    event.preventDefault();
    if (pending) return;
    if (!titleInput.value.trim()) { showError('Add a task title before queuing it.'); titleInput.focus(); return; }
    const owner = agentId;
    mutate(() => store.createTask({ agentId: owner, title: titleInput.value.trim(), brief: briefInput.value.trim() }), id => {
      selectedTasks.set(owner, id); taskDrafts.delete(owner);
      if (agentId === owner) { titleInput.value = ''; briefInput.value = ''; taskForm.hidden = true; setTab('chat'); composer.focus(); }
    });
  });
  const taskList = el('div', 'aw-task-list'); taskList.dataset.testid = 'task-list';
  taskSection.append(taskHeader, taskForm, taskList);

  const reviewSection = sections.get('review');
  const profileSection = sections.get('profile'); profileSection.dataset.testid = 'agent-profile';
  let profileSignature = '';
  const reviewContent = el('div', 'aw-review-content'); reviewContent.dataset.testid = 'review-content';
  const reviewForm = el('div', 'aw-review-form'); reviewForm.hidden = true;
  const feedbackLabel = el('label', 'aw-field-label', 'Feedback'); feedbackLabel.htmlFor = 'aw-review-feedback';
  const feedback = el('textarea', 'aw-input'); feedback.id = 'aw-review-feedback'; feedback.rows = 3; feedback.maxLength = 4000; feedback.placeholder = 'Describe what you would like changed…'; feedback.dataset.testid = 'review-feedback';
  feedback.addEventListener('input', () => feedbackDrafts.set(feedbackKey, feedback.value));
  const reviewActions = el('div', 'aw-review-actions');
  const changesButton = button('Request changes', 'aw-button aw-secondary'); changesButton.dataset.testid = 'request-changes'; changesButton.addEventListener('click', () => decide('changes_requested'));
  const approveButton = button('Approve', 'aw-button aw-primary'); approveButton.dataset.testid = 'approve-review'; approveButton.addEventListener('click', () => decide('approved'));
  reviewActions.append(changesButton, approveButton);
  const approvalNote = el('p', 'aw-approval-note');
  reviewForm.append(feedbackLabel, feedback, el('p', 'aw-help', 'Feedback is required when requesting changes.'), reviewActions, approvalNote);
  reviewSection.append(reviewContent, reviewForm);
  mount.replaceChildren(header, connection, projectWork, storageWarning, error, nav, ...sections.values());

  function saveDraft() { if (composerKey) drafts.set(composerKey, composer.value); }
  function saveTaskDraft() { if (formAgent) taskDrafts.set(formAgent, { title: titleInput.value, brief: briefInput.value }); }
  function clearError() { error.hidden = true; error.textContent = ''; }
  function showError(message) { error.textContent = message; error.hidden = false; }
  async function mutate(action, after) {
    if (pending) return null;
    clearError();
    pending = true; render();
    try { const result = await action(); snapshot = store.getState(); after?.(result); return result; }
    catch (cause) { showError(cause instanceof Error ? cause.message : 'That could not be saved. Please try again.'); return null; }
    finally { pending = false; render(); }
  }
  function sendMessage() {
    const text = composer.value.trim(); if (!text || pending) return;
    const key = composerKey; const task = currentTask(); const owner = agentId;
    const questionId = currentExecution()?.question?.id;
    mutate(() => store.sendMessage({ agentId: owner, taskId: task?.id || null, text, ...(questionId ? { questionId } : {}) }), () => {
      drafts.delete(key);
      if (composerKey === key) { composer.value = ''; sendButton.disabled = true; composer.focus(); }
    });
  }
  function showTaskForm() { setTab('tasks'); taskForm.hidden = false; titleInput.focus(); }
  function startSample() {
    const owner = agentId;
    mutate(() => store.startSample(owner), id => { if (agentId === owner) saveDraft(); selectedTasks.set(owner, id); if (agentId === owner) setTab('chat'); });
  }
  function decide(decision) {
    if (!reviewTarget) return;
    const comment = feedback.value.trim();
    if (decision === 'changes_requested' && !comment) { showError('Add feedback so the requested changes are clear.'); feedback.focus(); return; }
    const { taskId, revision, digest } = reviewTarget; const key = feedbackKey;
    const input = { revision, decision, ...(comment ? { comment } : {}) };
    mutate(() => digest ? store.reviewRun(taskId, { ...input, digest }) : store.decideReview(taskId, input), () => { feedbackDrafts.delete(key); if (feedbackKey === key) feedback.value = ''; });
  }
  function setTab(next) {
    if (!TABS.includes(next)) return;
    tab = next; clearError(); render();
  }
  function emptyState(title, description, actions = []) {
    const empty = el('div', 'aw-empty');
    empty.append(el('span', 'aw-empty-mark', '✳'), el('h3', '', title), el('p', '', description));
    if (actions.length) { const controls = el('div', 'aw-empty-actions'); controls.append(...actions); empty.append(controls); }
    return empty;
  }
  function newTaskButton() { const control = button('Create a task', 'aw-button aw-secondary'); control.addEventListener('click', showTaskForm); return control; }
  function sampleButton() { const control = button('Try sample workflow →', 'aw-text-button'); control.dataset.testid = 'start-sample'; control.addEventListener('click', startSample); return control; }

  function renderMessages(task) {
    const messages = snapshot.messages.filter(message => message.agentId === agentId && (message.taskId || null) === (task?.id || null));
    const signature = JSON.stringify([agentId, task?.id, messages, snapshot.storageAvailable]);
    if (signature === logSignature) return;
    logSignature = signature;
    const wasNearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    log.replaceChildren();
    if (!messages.length) {
      const actions = [newTaskButton()]; if (agentId === 'sam' && !task) actions.push(sampleButton());
      log.append(emptyState(`A little context goes a long way.`, task
        ? 'Add a note or question for this assignment. Your message will be saved with the task.'
        : connectedAgent() ? 'Talk with Sam about this repository, or create a task when you want him to change code.' : `Give ${agent().name} an assignment, or leave a message for later. Nothing is sent to an AI agent yet.`, actions));
    }
    for (const message of messages) {
      const item = el('article', `aw-message aw-message--${message.role}`); item.dataset.messageId = message.id;
      const meta = el('div', 'aw-message-meta');
      const who = message.role === 'user' ? 'You' : message.role === 'agent' ? agent().name : 'Workspace';
      meta.append(el('strong', '', who));
      if (message.delivery === 'sample') meta.append(el('span', 'aw-sample-tag', 'Sample'));
      const time = el('time', '', stamp(message.createdAt)); time.dateTime = new Date(message.createdAt).toISOString(); time.title = stamp(message.createdAt, true); meta.append(time);
      const body = el('p', 'aw-message-text', message.text);
      item.append(meta, body);
      if (message.role === 'user' && message.delivery !== 'sample') item.append(el('span', 'aw-message-delivery', connectedAgent() && !task?.isSample ? 'Saved to Sam’s conversation' : 'Saved to cloud · not sent to an agent'));
      if (task) item.setAttribute('aria-label', `${who}, ${task.title}`);
      log.append(item);
    }
    if (wasNearBottom || messages.at(-1)?.role === 'user') log.scrollTop = log.scrollHeight;
  }
  function renderTasks(agentTasks) {
    const signature = JSON.stringify([agentId, selectedTasks.get(agentId), agentTasks, snapshot.storageAvailable]);
    if (signature === taskSignature) return;
    taskSignature = signature; taskList.replaceChildren();
    if (!agentTasks.length) {
      taskList.append(emptyState('Room for the next idea.', 'Assignments are saved in your private workspace, from the first brief to your final decision.', [newTaskButton()])); return;
    }
    for (const task of agentTasks) {
      const card = button('', `aw-task-card${task.id === selectedTasks.get(agentId) ? ' is-selected' : ''}`); card.dataset.taskId = task.id; card.dataset.testid = 'task-card';
      const cardTop = el('div', 'aw-task-top'); cardTop.append(badge(task.status, snapshot.storageAvailable)); if (task.isSample) cardTop.append(el('span', 'aw-sample-tag', 'Sample'));
      card.append(cardTop, el('strong', 'aw-task-name', task.title));
      if (task.brief) card.append(el('p', 'aw-task-brief', task.brief));
      card.append(el('span', 'aw-task-date', `Updated ${stamp(task.updatedAt, true)}`));
      card.addEventListener('click', () => { saveDraft(); selectedTasks.set(agentId, task.id); setTab('chat'); composer.focus(); });
      taskList.append(card);
    }
  }
  function renderReview(task) {
    const review = task?.review;
    const signature = JSON.stringify([agentId, task?.id, task?.status, review, snapshot.storageAvailable, tasks().filter(item => item.review).map(item => [item.id, item.status, item.review.revision, item.review.decision])]);
    if (signature === reviewSignature) return;
    reviewSignature = signature; reviewContent.replaceChildren(); reviewTarget = null; reviewForm.hidden = true;
    if (!review) {
      const pending = tasks().filter(candidate => candidate.review && candidate.id !== task?.id);
      if (pending.length) {
        reviewContent.append(el('h3', 'aw-review-heading', 'Choose a result to review'));
        pending.forEach(candidate => {
          const control = button('', 'aw-review-choice'); control.append(el('strong', '', candidate.title), badge(candidate.status, snapshot.storageAvailable));
          control.addEventListener('click', () => { saveDraft(); selectedTasks.set(agentId, candidate.id); render(); }); reviewContent.append(control);
        });
      } else reviewContent.append(emptyState('Good work deserves a look.', 'Code changes and checks will appear here when an agent is connected. There is no real result to review yet.', agentId === 'sam' && !task ? [sampleButton()] : []));
      return;
    }
    const top = el('div', 'aw-review-top'); top.append(badge(task.status, snapshot.storageAvailable), el('span', 'aw-revision', `Revision ${review.revision}`));
    reviewContent.append(top, el('h3', 'aw-review-heading', task.title));
    if (review.isSample || task.isSample) reviewContent.append(el('p', 'aw-sample-notice', 'Sample review · illustrative code, no project files changed.'));
    else {
      reviewContent.append(el('p', 'aw-live-notice', `Actual code changes · ${review.branch} · ${review.commit?.slice(0, 7) || ''}`));
      if (review.pullRequestUrl && /^https:\/\/github\.com\/priyanshp1859\/Virtual-Team\/pull\/\d+$/.test(review.pullRequestUrl)) {
        const link = el('a', 'aw-button aw-primary', 'Open pull request ↗'); link.href = review.pullRequestUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; reviewContent.append(link);
      }
    }
    reviewContent.append(el('p', 'aw-review-summary', review.summary));
    for (const file of review.files || []) {
      const fileBlock = el('section', 'aw-diff-file');
      const fileTitle = el('h4', 'aw-diff-title', file.path); fileBlock.append(fileTitle);
      const legend = el('div', 'aw-diff-legend'); legend.append(el('span', '', '− Before'), el('span', '', '+ After')); fileBlock.append(legend);
      const diff = el('div', 'aw-diff'); diff.tabIndex = 0; diff.setAttribute('role', 'region'); diff.setAttribute('aria-label', `Code diff for ${file.path}`);
      for (const line of diffLines(file.before, file.after)) {
        const row = el('div', `aw-code-line aw-code-line--${line.kind}`);
        const oldNumber = el('span', 'aw-line-number', line.beforeLine); const newNumber = el('span', 'aw-line-number', line.afterLine);
        oldNumber.setAttribute('aria-hidden', 'true'); newNumber.setAttribute('aria-hidden', 'true');
        row.append(oldNumber, newNumber, el('span', 'aw-line-sign', line.kind === 'removed' ? '−' : line.kind === 'added' ? '+' : ' '), el('code', '', line.text || ' ')); diff.append(row);
      }
      fileBlock.append(diff); reviewContent.append(fileBlock);
    }
    if (review.checks?.length) {
      const checks = el('section', 'aw-checks'); checks.append(el('h4', '', review.isSample ? 'Sample checks' : 'Checks'));
      if (review.isSample) checks.append(el('p', 'aw-help', 'Illustrative outcomes. These checks were not run against your project.'));
      for (const check of review.checks) { const row = el('div', 'aw-check'); row.append(el('strong', '', check.label), el('span', '', check.detail)); checks.append(row); }
      reviewContent.append(checks);
    }
    if (task.status === 'in_review' && !review.decision) {
      reviewTarget = { taskId: task.id, revision: review.revision, digest: review.digest }; reviewForm.hidden = false;
      const nextFeedbackKey = `${task.id}:${review.revision}`;
      if (feedbackKey !== nextFeedbackKey) { if (feedbackKey) feedbackDrafts.set(feedbackKey, feedback.value); feedbackKey = nextFeedbackKey; feedback.value = feedbackDrafts.get(feedbackKey) || ''; }
    } else {
      const receipt = el('section', 'aw-decision');
      const approved = review.decision === 'approved' || task.status === 'completed';
      receipt.append(el('strong', '', approved ? 'Approved' : review.decision === 'changes_requested' ? 'Changes requested' : 'Previous revision'));
      if (review.comment) receipt.append(el('p', '', review.comment));
      receipt.append(el('p', 'aw-help', review.isSample ? 'Your decision is saved to your workspace. No files were changed.' : approved ? 'Your exact approval is saved. The pull request requires a manual merge in GitHub.' : 'Sam will use your feedback for the next revision. The live site is unchanged.'));
      if (task.status === 'changes_requested' && task.isSample) {
        const revise = button('Preview revised result →', 'aw-button aw-primary'); revise.dataset.testid = 'revise-sample'; revise.addEventListener('click', () => mutate(() => store.advanceSample(task.id))); receipt.append(revise);
      }
      reviewContent.append(receipt);
    }
  }
  function renderPresence() {
    const person = presence?.agents?.find(item => item.id === agentId);
    const rooms = { coding: 'Coding room', head: 'Head’s cabin', design: 'Design studio', review: 'Review room', meeting: 'Meeting room', chill: 'Gaming lounge', hallway: 'Hallway' };
    const text = person ? `Office avatar · ${person.state === 'walking' ? 'walking' : rooms[person.room] || 'at their desk'}` : `${DEPARTMENTS.find(item => item.id === agent().department).name} · seat awaiting assignment`;
    if (presenceLabel.textContent !== text) presenceLabel.textContent = text;
  }
  function render() {
    if (disposed) return;
    const person = agent(); if (!person) return;
    const agentTasks = tasks(); const task = currentTask();
    name.textContent = person.name; role.textContent = person.role; avatar.textContent = person.name[0]; avatar.style.setProperty('--agent-color', person.color); renderPresence();
    offline.textContent = connectedAgent() ? snapshot.runtime.online ? 'Connected' : 'Worker offline' : 'Not connected';
    offline.dataset.online = String(Boolean(connectedAgent() && snapshot.runtime.online));
    connectionNote.textContent = connectedAgent() ? snapshot.runtime.online ? 'Codex on your computer · Virtual-Team repository' : 'Chats are saved. Sam runs while this computer’s worker is online.' : 'Profile and skills ready. Chats are saved; execution is not connected.';
    const projectRole = WORKFLOW_STEPS.some(d => d.agentId === agentId && projectState.runtime?.capabilities?.[d.kind]);
    projectWork.hidden = !projectRole;
    projectWork.textContent = 'Open project assignments and conversation ↗';
    if (projectRole && agentId !== 'sam') { offline.textContent = projectState.runtime.online ? 'Project worker' : 'Worker offline'; connectionNote.textContent = 'Works through project handoffs. Use Projects for live assignments, documents and questions.'; }
    taskQueueHelp.textContent = connectedAgent() ? 'Sam works in an isolated copy of Virtual-Team. Review the actual code before publishing.' : 'Saved to your workspace queue. No agent is connected to execute this task yet.';
    approvalNote.textContent = task?.review?.digest ? 'Approves this exact revision and creates a GitHub pull request. Merge it in GitHub to deploy.' : 'Saves this decision to your workspace. No files are changed.';
    approveButton.textContent = task?.review?.digest ? 'Approve & create PR' : 'Approve';
    storageWarning.hidden = !snapshot.persistenceError;
    storageWarning.textContent = snapshot.persistenceError || '';
    const counts = { chat: snapshot.messages.filter(message => message.agentId === agentId).length, tasks: agentTasks.length, review: agentTasks.filter(item => item.status === 'in_review').length, profile: person.skills.length };
    for (const key of TABS) {
      const active = key === tab; const control = tabButtons.get(key);
      control.setAttribute('aria-selected', String(active)); control.tabIndex = active ? 0 : -1;
      control.lastElementChild.textContent = counts[key]; sections.get(key).hidden = !active;
    }
    const nextContextSignature = JSON.stringify([agentId, agentTasks.map(item => [item.id, item.title, item.status])]);
    if (contextSignature !== nextContextSignature) {
      contextSignature = nextContextSignature; taskSelect.replaceChildren(new Option('General conversation', ''));
      for (const item of agentTasks) taskSelect.append(new Option(item.title, item.id));
    }
    taskSelect.value = task?.id || ''; contextMeta.replaceChildren();
    if (task) { contextMeta.append(badge(task.status, snapshot.storageAvailable)); if (task.review) contextMeta.append(viewReview); }
    else contextMeta.append(el('span', 'aw-help', 'Messages without an assignment'));
    if (briefTaskId !== task?.id) { briefTaskId = task?.id; contextBrief.open = false; }
    contextBrief.hidden = !task?.brief; briefBody.textContent = task?.brief || '';
    sampleBar.hidden = !task?.isSample;
    const execution = currentExecution();
    runBar.hidden = !connectedAgent() || task?.isSample || (!task && !execution);
    if (!runBar.hidden) {
      runTitle.textContent = execution?.question?.text || execution?.activity || STATUS_LABELS[execution?.status] || 'Ready for Sam';
      runDetail.textContent = execution?.error || (execution?.question ? 'Reply in the chat below to continue.' : execution?.status === 'in_review' ? 'Open Review to inspect the actual code changes.' : !snapshot.runtime.online ? 'The worker is offline. Saved work will wait here.' : task?.review?.decision === 'approved' ? 'The approved code will be shared as a pull request.' : 'Changes stay in an isolated branch until you review them.');
      runAction.textContent = ['queued', 'working', 'waiting_for_user', 'publishing'].includes(execution?.status) ? 'Stop' : ['failed', 'interrupted', 'cancelled'].includes(execution?.status) ? 'Retry' : 'Start Sam';
      runAction.hidden = ['in_review', 'completed', 'publishing'].includes(execution?.status);
      runAction.disabled = pending;
    }
    if (task?.isSample) {
      sampleCopy.replaceChildren(el('strong', '', 'Sample · no files change'));
      const descriptions = { working: 'Step through an illustrative agent workflow.', waiting_for_user: 'Reply below to continue the sample.', in_review: 'A sample result is ready for your decision.', changes_requested: 'Your feedback is saved. Preview a revision next.', completed: 'This sample workflow is complete.' };
      sampleCopy.append(el('span', '', descriptions[task.status] || 'This is an illustrative workflow.'));
      sampleAction.textContent = { working: 'Next: question', waiting_for_user: 'Reply below ↓', in_review: 'Open review', changes_requested: 'Preview revision', completed: 'View decision' }[task.status] || 'Continue';
    }
    const nextKey = draftKey();
    if (nextKey !== composerKey) { saveDraft(); composerKey = nextKey; composer.value = drafts.get(nextKey) || ''; }
    composerLabel.textContent = `Message ${person.name}`;
    composer.placeholder = task?.status === 'waiting_for_user' || execution?.question ? `Reply to ${person.name}’s question…` : `Message ${person.name}…`;
    sendButton.disabled = pending || !composer.value.trim();
    deliveryNote.textContent = pending ? 'Saving to workspace…' : snapshot.persistenceError ? 'Save needs attention · draft retained' : task?.isSample ? 'Sample conversation · cloud saved' : connectedAgent() ? snapshot.runtime.online ? 'Sam connected · cloud saved' : 'Worker offline · messages saved' : 'Cloud workspace · agent offline';
    if (formAgent !== agentId) {
      saveTaskDraft(); formAgent = agentId; const draft = taskDrafts.get(agentId) || {};
      titleInput.value = draft.title || ''; briefInput.value = draft.brief || ''; taskForm.hidden = true;
    }
    renderMessages(task); renderTasks(agentTasks); renderReview(task);
    const projectAgents = WORKFLOW_STEPS.filter(d => projectState.runtime?.capabilities?.[d.kind]).map(d => d.agentId);
    const nextProfileSignature = `${agentId}:${Boolean(snapshot.runtime?.enabled)}:${Boolean(snapshot.runtime?.online)}:${Boolean(projectState.runtime?.online)}:${projectAgents.join(',')}`;
    if (profileSignature !== nextProfileSignature) { profileSection.replaceChildren(renderAgentProfile(person, { ...snapshot.runtime, projectAgents, projectOnline: projectState.runtime?.online })); profileSignature = nextProfileSignature; }
    const cannotSave = pending || snapshot.connectionStatus === 'saving' || !snapshot.authenticated || snapshot.revision < 0;
    for (const control of [queueTask, approveButton, changesButton, sampleAction]) control.disabled = cannotSave;
    if (task?.review?.digest && !task.review.publishable) approveButton.disabled = true;
    for (const control of mount.querySelectorAll('[data-testid="start-sample"],[data-testid="revise-sample"]')) control.disabled = cannotSave;
    for (const control of [composer, titleInput, briefInput, feedback]) control.readOnly = pending;
    sendButton.disabled = cannotSave || !composer.value.trim();
    mount.setAttribute('aria-busy', String(pending));
  }
  function open(nextAgentId, { taskId, tab: nextTab, newTask = false, focus = true } = {}) {
    if (disposed || !AGENTS.some(item => item.id === nextAgentId)) return false;
    const activeElement = document.activeElement;
    if (focus && activeElement instanceof HTMLElement && !mount.contains(activeElement)
      && activeElement.matches('button, a[href], input, select, textarea, [tabindex]')) returnFocus = activeElement;
    saveDraft(); saveTaskDraft();
    agentId = nextAgentId;
    if (taskId !== undefined) selectedTasks.set(agentId, taskId || null);
    if (nextTab && TABS.includes(nextTab)) tab = nextTab;
    else if (!opened) tab = 'chat';
    opened = true; mount.hidden = false; clearError(); render(); if (focus) name.focus({ preventScroll: true });
    if (newTask) showTaskForm();
    return true;
  }
  function close(notify = false) {
    if (!opened || disposed) return;
    saveDraft(); saveTaskDraft(); opened = false; mount.hidden = true; if (notify) onClose();
    if (notify && returnFocus instanceof HTMLElement && returnFocus.isConnected && !mount.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
  }
  function handleKey(event) { if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); close(true); } }
  mount.addEventListener('keydown', handleKey);
  const unsubscribe = store.subscribe(state => { snapshot = state || store.getState(); render(); });
  render();
  return {
    open, close, isOpen: () => opened, getAgentId: () => agentId,
    reset() {
      close(); selectedTasks.clear(); drafts.clear(); taskDrafts.clear(); feedbackDrafts.clear();
      composer.value = ''; titleInput.value = ''; briefInput.value = ''; feedback.value = '';
      composerKey = ''; formAgent = ''; feedbackKey = ''; reviewTarget = null; returnFocus = null;
      logSignature = ''; taskSignature = ''; reviewSignature = ''; contextSignature = '';
      log.replaceChildren(); taskList.replaceChildren(); reviewContent.replaceChildren(); clearError();
      snapshot = store.getState(); render();
    },
    setProjects(state) { projectState = state; render(); },
    setPresence(state) { presence = state; renderPresence(); },
    dispose() { if (disposed) return; saveDraft(); disposed = true; unsubscribe?.(); mount.removeEventListener('keydown', handleKey); mount.replaceChildren(); mount.hidden = true; },
  };
}
