import { AGENTS } from './config.js';

export const STATUS_LABELS = Object.freeze({
  queued: 'Queued locally',
  working: 'Working',
  waiting_for_user: 'Needs your answer',
  in_review: 'Ready for review',
  changes_requested: 'Changes requested',
  completed: 'Completed',
});

const STORAGE_KEY = 'agent-office.workspace.v1';
const AGENT_IDS = new Set(AGENTS.map(({ id }) => id));
const LIMITS = { tasks: 500, messages: 5000, title: 120, brief: 8000, text: 8000, comment: 4000 };
const LOCAL_NOTICE = 'No agent runtime is connected: messages are a local outbox, tasks remain queued, and no code is being changed.';
const clone = (value) => JSON.parse(JSON.stringify(value));
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (message) => { throw new Error(message); };

function textValue(value, label, max, required = true) {
  if (typeof value !== 'string') fail(`${label} must be text.`);
  const result = value.trim();
  if (required && !result) fail(`${label} cannot be empty.`);
  if (result.length > max) fail(`${label} must be ${max} characters or fewer.`);
  return result;
}
function agentValue(value) {
  if (!AGENT_IDS.has(value)) fail('Choose an agent from this office.');
  return value;
}
function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) fail('Invalid record identifier.');
  return value;
}
function timestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(value)) return value;
  // Normalize dates saved by early local prototypes to milliseconds as well.
  if (typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value) return Date.parse(value);
  fail('Invalid record date.');
}
function sourceText(value) {
  if (typeof value !== 'string' || value.length > 20000) fail('Invalid saved source example.');
  return value;
}
function sampleReview(revision) {
  return {
    revision,
    isSample: true,
    summary: `Sample revision ${revision}: a predefined empty-state improvement. These are illustrative files and checks; no repository was accessed.`,
    files: [{
      path: 'sample/ReservationEmptyState.jsx',
      language: 'jsx',
      before: 'export function ReservationEmptyState() {\n  return <p>No reservations</p>;\n}\n',
      after: revision === 1
        ? 'export function ReservationEmptyState() {\n  return (\n    <section aria-label="Reservations">\n      <h2>No reservations yet</h2>\n      <p>Your next reservation will appear here.</p>\n    </section>\n  );\n}\n'
        : 'export function ReservationEmptyState() {\n  return (\n    <section aria-label="Reservations">\n      <h2>No matching reservations</h2>\n      <p>Clear your filters to see all reservations.</p>\n      <button type="button">Clear filters</button>\n    </section>\n  );\n}\n',
    }],
    checks: [
      { label: 'Sample component review', detail: 'Illustration only: a labelled empty state. No automated checks were run.' },
      { label: 'Sample interaction review', detail: 'Illustration only: copy and a possible action. No browser checks were run.' },
    ],
    decision: null,
    comment: null,
    decidedAt: null,
  };
}

function readReview(value) {
  if (!isObject(value) || value.isSample !== true || !Number.isInteger(value.revision) || value.revision < 1 || value.revision > 1000) fail('Invalid saved sample review.');
  if (!Array.isArray(value.files) || value.files.length < 1 || value.files.length > 20 || !Array.isArray(value.checks) || value.checks.length > 20) fail('Invalid saved review contents.');
  if (![null, 'approved', 'changes_requested'].includes(value.decision)) fail('Invalid saved review decision.');
  const comment = value.comment === null ? null : textValue(value.comment, 'Review feedback', LIMITS.comment, false);
  if (value.decision === 'changes_requested' && !comment) fail('Saved change requests need feedback.');
  const decidedAt = value.decidedAt === null ? null : timestamp(value.decidedAt);
  if ((value.decision === null) !== (decidedAt === null)) fail('Invalid saved review date.');
  return {
    revision: value.revision,
    isSample: true,
    summary: textValue(value.summary, 'Review summary', 2000),
    files: value.files.map((file) => {
      if (!isObject(file)) fail('Invalid saved review file.');
      return { path: textValue(file.path, 'File path', 260), language: textValue(file.language, 'File language', 40), before: sourceText(file.before), after: sourceText(file.after) };
    }),
    checks: value.checks.map((check) => {
      if (!isObject(check)) fail('Invalid saved review check.');
      return { label: textValue(check.label, 'Check label', 120), detail: textValue(check.detail, 'Check detail', 2000) };
    }),
    decision: value.decision, comment, decidedAt,
  };
}

function readSaved(value) {
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.tasks) || !Array.isArray(value.messages) || value.tasks.length > LIMITS.tasks || value.messages.length > LIMITS.messages) fail('Unsupported or invalid saved workspace.');
  const ids = new Set();
  const uniqueId = (id) => { identifier(id); if (ids.has(id)) fail('Duplicate saved record identifier.'); ids.add(id); return id; };
  const tasks = value.tasks.map((task) => {
    if (!isObject(task) || typeof task.isSample !== 'boolean' || !Object.hasOwn(STATUS_LABELS, task.status)) fail('Invalid saved task.');
    const review = task.review === null ? null : readReview(task.review);
    if (!task.isSample && (task.status !== 'queued' || review !== null)) fail('Local tasks cannot have runtime results.');
    if (task.isSample) {
      const expectedDecision = { in_review: null, changes_requested: 'changes_requested', completed: 'approved' };
      if (Object.hasOwn(expectedDecision, task.status)) {
        if (!review || review.decision !== expectedDecision[task.status]) fail('Saved review does not match its task.');
      } else if (!['working', 'waiting_for_user'].includes(task.status) || review !== null) fail('Invalid saved sample state.');
    }
    return { id: uniqueId(task.id), agentId: agentValue(task.agentId), title: textValue(task.title, 'Task title', LIMITS.title), brief: textValue(task.brief, 'Task brief', LIMITS.brief, false), status: task.status, isSample: task.isSample, createdAt: timestamp(task.createdAt), updatedAt: timestamp(task.updatedAt), review };
  });
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const messages = value.messages.map((message) => {
    if (!isObject(message) || !['user', 'agent', 'system'].includes(message.role) || !['local', 'sample'].includes(message.delivery)) fail('Invalid saved message.');
    const taskId = message.taskId === null ? null : identifier(message.taskId);
    const task = taskId === null ? null : byId.get(taskId);
    const agentId = agentValue(message.agentId);
    if (taskId !== null && (!task || task.agentId !== agentId)) fail('Saved message is assigned to the wrong task.');
    if ((message.role === 'agent' && message.delivery !== 'sample') || (message.delivery === 'sample' && !task?.isSample) || (message.role === 'user' && message.delivery !== 'local')) fail('Invalid saved message source.');
    return { id: uniqueId(message.id), agentId, taskId, role: message.role, text: textValue(message.text, 'Message', LIMITS.text), createdAt: timestamp(message.createdAt), delivery: message.delivery };
  });
  return { version: 1, tasks, messages };
}

/** Device-local task/outbox state plus an explicitly scripted review walkthrough. */
export function createWorkspaceStore({ storage, now = () => Date.now(), id = () => globalThis.crypto?.randomUUID?.() ?? `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` } = {}) {
  if (typeof now !== 'function' || typeof id !== 'function') fail('Clock and identifier options must be functions.');
  let data = { version: 1, tasks: [], messages: [] };
  let persistenceError = null;
  let storageAvailable = false;
  let writesBlocked = false;
  let disposed = false;
  const listeners = new Set();
  if (storage === undefined) {
    try { storage = globalThis.window?.localStorage ?? null; }
    catch { storage = null; }
  }
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    storage = null;
    writesBlocked = true;
    persistenceError = 'Device storage is unavailable. Changes will last only for this session.';
  } else {
    try {
      const saved = storage.getItem(STORAGE_KEY);
      if (saved !== null) {
        if (typeof saved !== 'string' || saved.length > 5_000_000) fail('Saved workspace is too large.');
        data = readSaved(JSON.parse(saved));
      }
      storageAvailable = true;
    } catch {
      writesBlocked = true;
      persistenceError = 'Saved workspace could not be read safely. It has been left untouched; new changes will last only for this session.';
    }
  }
  function getState() { return { ...clone(data), storageAvailable, persistenceError }; }
  function active() { if (disposed) fail('This workspace has been closed.'); }
  function time() {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) fail('The workspace clock returned an invalid date.');
    return timestamp(date.getTime());
  }
  function nextId(draft) {
    const result = identifier(id());
    if (draft.tasks.some((task) => task.id === result) || draft.messages.some((message) => message.id === result)) fail('The workspace generated a duplicate identifier.');
    return result;
  }
  function addMessage(draft, { agentId, taskId = null, role, text, delivery, createdAt }) {
    const messageId = nextId(draft);
    draft.messages.push({ id: messageId, agentId, taskId, role, text, createdAt, delivery });
    return messageId;
  }
  function noteLocal(draft, agentId, taskId, createdAt) {
    if (!draft.messages.some((message) => message.agentId === agentId && message.taskId === taskId && message.role === 'system' && message.delivery === 'local' && message.text === LOCAL_NOTICE)) addMessage(draft, { agentId, taskId, role: 'system', text: LOCAL_NOTICE, delivery: 'local', createdAt });
  }
  function taskFor(draft, taskId, sampleOnly = false) {
    identifier(taskId);
    const task = draft.tasks.find((candidate) => candidate.id === taskId);
    if (!task) fail('This task could not be found.');
    if (sampleOnly && !task.isSample) fail('Only the sample walkthrough can advance. Real tasks stay queued until a runtime is connected.');
    return task;
  }
  function commit(change) {
    active();
    const draft = clone(data);
    const result = change(draft, time());
    if (draft.tasks.length > LIMITS.tasks || draft.messages.length > LIMITS.messages) fail('This local workspace is full. No new records were added.');
    if (!writesBlocked) {
      try { storage.setItem(STORAGE_KEY, JSON.stringify(draft)); storageAvailable = true; persistenceError = null; }
      catch { storageAvailable = false; persistenceError = 'Changes could not be saved to device storage. They are available in this session; a later save will retry.'; }
    }
    data = draft;
    for (const listener of [...listeners]) listener(getState());
    return result;
  }
  function sampleMessage(draft, task, text, createdAt, role = 'agent') {
    return addMessage(draft, { agentId: task.agentId, taskId: task.id, role, text, createdAt, delivery: 'sample' });
  }
  function createTask(input) {
    if (!isObject(input)) fail('Enter the task details.');
    const agentId = agentValue(input.agentId);
    const title = textValue(input.title, 'Task title', LIMITS.title);
    const brief = textValue(input.brief ?? '', 'Task brief', LIMITS.brief, false);
    return commit((draft, createdAt) => {
      const taskId = nextId(draft);
      draft.tasks.push({ id: taskId, agentId, title, brief, status: 'queued', isSample: false, createdAt, updatedAt: createdAt, review: null });
      noteLocal(draft, agentId, taskId, createdAt);
      return taskId;
    });
  }
  function sendMessage(input) {
    if (!isObject(input)) fail('Enter a message.');
    const agentId = agentValue(input.agentId);
    const text = textValue(input.text, 'Message', LIMITS.text);
    const taskId = input.taskId == null ? null : identifier(input.taskId);
    return commit((draft, createdAt) => {
      const task = taskId === null ? null : taskFor(draft, taskId);
      if (task && task.agentId !== agentId) fail('Send this message to the agent assigned to that task.');
      const messageId = addMessage(draft, { agentId, taskId, role: 'user', text, createdAt, delivery: 'local' });
      if (task) task.updatedAt = createdAt;
      if (!task?.isSample) noteLocal(draft, agentId, taskId, createdAt);
      if (task?.isSample && task.status === 'waiting_for_user') {
        task.status = 'in_review';
        task.review = sampleReview(1);
        sampleMessage(draft, task, 'Sample walkthrough: your answer is saved. Here is a predefined example diff for review. It was not generated from your answer, and no files or checks were run.', createdAt);
      }
      return messageId;
    });
  }
  function startSample(agentId = 'sam') {
    agentValue(agentId);
    return commit((draft, createdAt) => {
      const taskId = nextId(draft);
      const task = { id: taskId, agentId, title: 'Sample: improve a reservation empty state', brief: 'A local, scripted walkthrough of a question, sample diff, feedback, and approval. No live agent, repository access, or code execution.', status: 'working', isSample: true, createdAt, updatedAt: createdAt, review: null };
      draft.tasks.push(task);
      sampleMessage(draft, task, 'Sample walkthrough started. “Working” is a demonstration state; no live agent is running. Continue the sample to see a clarification question.', createdAt);
      return taskId;
    });
  }
  function advanceSample(taskId) {
    return commit((draft, createdAt) => {
      const task = taskFor(draft, taskId, true);
      if (task.status === 'working') {
        task.status = 'waiting_for_user';
        sampleMessage(draft, task, 'Sample question: should an empty result say “No reservations yet” or “No matching reservations”? Reply on this sample task to continue the walkthrough.', createdAt);
      } else if (task.status === 'changes_requested') {
        if (task.review.revision >= 1000) fail('This sample has reached its revision limit. Start a new sample.');
        task.status = 'in_review';
        task.review = sampleReview(task.review.revision + 1);
        sampleMessage(draft, task, `Sample revision ${task.review.revision}: your feedback was recorded. This is the predefined revised fixture, not code generated from your feedback. No files were changed.`, createdAt);
      } else fail('This sample cannot continue from its current state. Answer its question or review the current revision.');
      task.updatedAt = createdAt;
      return task.id;
    });
  }
  function decideReview(taskId, input) {
    if (!isObject(input) || !['approved', 'changes_requested'].includes(input.decision)) fail('Choose approve or request changes.');
    if (!Number.isInteger(input.revision) || input.revision < 1) fail('Choose the exact revision you reviewed.');
    const comment = textValue(input.comment ?? '', 'Review feedback', LIMITS.comment, input.decision === 'changes_requested');
    return commit((draft, createdAt) => {
      const task = taskFor(draft, taskId, true);
      if (!task.review || task.review.revision !== input.revision) fail('This review revision is stale. Open the current revision before deciding.');
      if (task.status !== 'in_review') fail('This revision is no longer awaiting a review decision.');
      task.review.decision = input.decision;
      task.review.comment = comment || null;
      task.review.decidedAt = createdAt;
      task.updatedAt = createdAt;
      task.status = input.decision === 'approved' ? 'completed' : 'changes_requested';
      sampleMessage(draft, task, input.decision === 'approved'
        ? `Sample review: approval of revision ${input.revision} saved locally. No files were applied, committed, or merged.`
        : `Sample review: changes requested on revision ${input.revision}. Feedback saved locally: ${comment}`, createdAt, 'system');
      return task.id;
    });
  }
  return {
    getState, createTask, sendMessage, startSample, advanceSample, decideReview,
    subscribe(listener) { active(); if (typeof listener !== 'function') fail('A workspace listener must be a function.'); listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { disposed = true; listeners.clear(); },
  };
}
