import { createHash, randomUUID } from 'node:crypto';
import { createWorkspaceStore } from '../src/office/workspace-store.js';
import { ApiError, invalid } from './errors.js';

const STORAGE_KEY = 'agent-office.workspace.v1';
export const EMPTY_STATE = Object.freeze({ version: 1, tasks: [], messages: [] });
export const MAX_STATE_BYTES = 2_000_000;
const ACTION_KEYS = {
  createTask: ['agentId', 'title', 'brief'],
  sendMessage: ['agentId', 'taskId', 'text', 'questionId'],
  startSample: ['agentId'],
  advanceSample: ['taskId'],
  decideReview: ['taskId', 'revision', 'decision', 'comment'],
  runTask: ['taskId'],
  cancelRun: ['taskId'],
  reviewRun: ['taskId', 'revision', 'digest', 'decision', 'comment'],
};

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function validateOperation(body) {
  if (!object(body) || Object.keys(body).some((key) => !['operationId', 'action', 'input'].includes(key))) invalid('Enter valid workspace action details.');
  const { operationId, action, input } = body;
  if (typeof operationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) invalid('This action needs a unique operation identifier.');
  if (typeof action !== 'string' || !Object.hasOwn(ACTION_KEYS, action)) invalid('This workspace action is not supported.');
  if (!object(input) || Object.keys(input).some((key) => !ACTION_KEYS[action].includes(key))) invalid('Enter valid details for this workspace action.');
  // Known fields must be scalar so an arbitrary nested payload cannot reach the model.
  for (const [key, value] of Object.entries(input)) {
    if (key === 'revision') {
      if (!Number.isSafeInteger(value) || value < 1 || value > 1000) invalid('Choose the exact revision you reviewed.');
    } else if (key === 'taskId' && value === null && action === 'sendMessage') {
      continue;
    } else if (typeof value !== 'string') invalid('Action details must be text.');
  }
  const fingerprint = createHash('sha256').update(canonical({ action, input })).digest('hex');
  return { operationId: operationId.toLowerCase(), action, input, fingerprint };
}

function model(state, options = {}) {
  let saved = JSON.stringify(state);
  if (Buffer.byteLength(saved) > MAX_STATE_BYTES) throw new ApiError(503, 'workspace_too_large', 'Saved workspace data is too large to load safely. It has been left unchanged.');
  const store = createWorkspaceStore({
    id: options.id ?? randomUUID,
    now: options.now ?? Date.now,
    storage: {
      getItem: (key) => key === STORAGE_KEY ? saved : null,
      setItem: (key, value) => { if (key === STORAGE_KEY) saved = value; },
    },
  });
  if (store.getState().persistenceError) {
    store.dispose();
    throw new ApiError(503, 'invalid_saved_workspace', 'Saved workspace data could not be loaded safely. It has been left unchanged.');
  }
  return store;
}

export function validateStoredState(state) {
  const store = model(state);
  try {
    const { version, tasks, messages } = store.getState();
    return { version, tasks, messages };
  } finally { store.dispose(); }
}

export function applyOperation(state, operation, options) {
  const store = model(state, options);
  try {
    const { action, input } = operation;
    let result;
    if (action === 'createTask') result = store.createTask(input);
    else if (action === 'sendMessage') result = store.sendMessage(input);
    else if (action === 'startSample') result = store.startSample(input.agentId);
    else if (action === 'advanceSample') result = store.advanceSample(input.taskId);
    else if (action === 'decideReview') {
      const { taskId, ...decision } = input;
      result = store.decideReview(taskId, decision);
    } else invalid('This workspace action is not supported.');
    const { version, tasks, messages } = store.getState();
    const nextState = { version, tasks, messages };
    if (Buffer.byteLength(JSON.stringify(nextState)) > MAX_STATE_BYTES) throw new ApiError(409, 'workspace_full', 'This workspace is full. No new records were saved.');
    return { state: nextState, result };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const conflict = /stale|no longer awaiting|cannot continue from|could not be found|workspace is full|revision limit/i.test(error.message);
    throw new ApiError(conflict ? 409 : 400, conflict ? 'state_conflict' : 'invalid_input', error.message);
  } finally { store.dispose(); }
}

// The existing model keeps its canonical local notice for deduplication. Public
// responses adapt only generated copy; user text and review feedback stay exact.
export function publicState(state) {
  const copy = structuredClone(state);
  for (const task of copy.tasks) {
    if (task.isSample && task.brief === 'A local, scripted walkthrough of a question, sample diff, feedback, and approval. No live agent, repository access, or code execution.') {
      task.brief = 'A scripted walkthrough of a question, sample diff, feedback, and approval. Saved in this workspace. No live agent, repository access, or code execution.';
    }
  }
  for (const message of copy.messages) {
    if (message.role === 'user') continue;
    if (message.text === 'No agent runtime is connected: messages are a local outbox, tasks remain queued, and no code is being changed.') {
      message.text = 'Saved to your private workspace. No agent runtime is connected: messages have not been sent to an agent, tasks remain queued, and no code is being changed.';
    } else if (message.delivery === 'sample' && message.role === 'system') {
      message.text = message.text.replace(/^(Sample review: approval of revision \d+) saved locally\./, '$1 saved to this workspace.')
        .replace(/^(Sample review: changes requested on revision \d+\. Feedback) saved locally:/, '$1 saved to this workspace:');
    }
  }
  return copy;
}

/** The repository owns the SQL transaction and row lock for this entire callback. */
export async function mutateWorkspace(repository, body, options) {
  const operation = validateOperation(body);
  return repository.transaction(async (tx) => {
    const current = await tx.lockWorkspace();
    const previous = await tx.findOperation(operation.operationId);
    if (previous) {
      if (previous.fingerprint !== operation.fingerprint) throw new ApiError(409, 'operation_conflict', 'This operation identifier was already used for a different action.');
      return { state: publicState(validateStoredState(current.state)), revision: current.revision, result: previous.result };
    }
    if (!Number.isSafeInteger(current.revision) || current.revision < 0 || current.revision >= Number.MAX_SAFE_INTEGER) throw new ApiError(503, 'invalid_revision', 'This workspace revision could not be loaded safely.');
    const next = options?.runtime && ['runTask', 'cancelRun', 'reviewRun'].includes(operation.action)
      ? { state: current.state, result: await options.runtime.command(tx.sql, current.state, operation) }
      : applyOperation(current.state, operation, options);
    if (options?.runtime) await options.runtime.afterOperation(tx.sql, next.state, operation, next.result);
    const revision = current.revision + 1;
    await tx.saveWorkspace(next.state, revision);
    await tx.saveOperation({ ...operation, result: next.result, revision });
    return { state: publicState(next.state), revision, result: next.result };
  });
}

export async function readWorkspace(repository) {
  const current = await repository.getWorkspace();
  if (!Number.isSafeInteger(current.revision) || current.revision < 0) throw new ApiError(503, 'invalid_revision', 'This workspace revision could not be loaded safely.');
  return { state: publicState(validateStoredState(current.state)), revision: current.revision };
}
