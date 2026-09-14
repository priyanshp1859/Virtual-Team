import { randomUUID } from 'node:crypto';
import { ApiError } from './errors.js';
import { EMPTY_STATE, validateStoredState } from './workspace.js';

export const LEASE_MS = 60_000;
export const ACTIVE = new Set(['working', 'waiting_for_user', 'publishing']);
export const runKey = taskId => taskId || 'sam:general';
const conflict = message => { throw new ApiError(409, 'runtime_conflict', message); };
export const runtimeEnabled = env => env.SAM_RUNTIME_ENABLED === 'true';

export function newRun(taskId, now = Date.now()) {
  return { taskId, status: 'queued', attempt: 0, revision: 0, createdAt: now, updatedAt: now,
    messages: [], question: null, answer: null, review: null, error: null,
    owner: null, leaseUntil: 0, cancelRequested: false, pendingInput: false, mode: 'code' };
}
export function addRunMessage(run, text, role = 'system', id = randomUUID()) {
  if (!text?.trim() || run.messages.some(message => message.id === id)) return;
  if (run.messages.length >= 160) conflict('This conversation has reached its activity limit. Start a new task.');
  run.messages.push({ id, agentId: 'sam', taskId: run.taskId, role, delivery: 'live', text: text.slice(0, 8000), createdAt: Date.now() });
}
export function effectiveStatus(run, now = Date.now()) {
  return ACTIVE.has(run.status) && run.leaseUntil < now ? 'interrupted' : run.status;
}
export async function getRun(sql, id) {
  const rows = await sql`SELECT data FROM virtual_team_runs WHERE id = ${runKey(id)}`;
  return rows[0]?.data || null;
}
export async function saveRun(sql, run) {
  const serialized = JSON.stringify(run);
  if (Buffer.byteLength(serialized) > 300_000) conflict('This task has reached its saved activity limit. Its existing records are preserved.');
  const [{ size }] = await sql`SELECT COALESCE(sum(octet_length(data::text)), 0)::integer AS size FROM virtual_team_runs WHERE id <> ${runKey(run.taskId)}`;
  if (size + Buffer.byteLength(serialized) > 1_500_000) conflict('The agent workspace is full. Existing work has been preserved.');
  run.updatedAt = Date.now();
  await sql`INSERT INTO virtual_team_runs (id, data) VALUES (${runKey(run.taskId)}, ${sql.json(run)})
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
}
function requireTask(state, taskId) {
  const task = state.tasks.find(task => task.id === taskId);
  if (!task || task.agentId !== 'sam' || task.isSample) conflict('Choose a real task assigned to Sam.');
  return task;
}
export function decideRun(run, input) {
  if (run.status !== 'in_review' || !run.review || run.review.revision !== input.revision || run.review.digest !== input.digest || run.review.decision) {
    conflict('This review changed. Open its current revision before deciding.');
  }
  if (!['approved', 'changes_requested'].includes(input.decision)) conflict('Choose approve or request changes.');
  const comment = (input.comment || '').trim();
  if (comment.length > 4000 || (input.decision === 'changes_requested' && !comment)) conflict('Provide feedback of up to 4,000 characters.');
  if (input.decision === 'approved' && !run.review.publishable) conflict('This result cannot be published yet. Request changes to resolve the failed checks or unsupported files.');
  run.review.decision = input.decision; run.review.comment = comment || null; run.review.decidedAt = Date.now();
  run.question = null; run.answer = null; run.error = null;
  run.status = 'queued'; run.mode = input.decision === 'approved' ? 'publish' : 'code';
  addRunMessage(run, input.decision === 'approved'
    ? `You approved revision ${input.revision}. Sam will publish this exact revision as a pull request for manual merging.`
    : `Changes requested on revision ${input.revision}: ${comment}`);
}

export const runtimeHooks = {
  async command(sql, state, { action, input }) {
    const taskId = input.taskId === 'sam:general' ? null : input.taskId;
    if (taskId !== null) requireTask(state, taskId);
    let run = await getRun(sql, taskId);
    if (action === 'runTask') {
      if (run && ['queued', ...ACTIVE].includes(effectiveStatus(run))) conflict('Sam already has this work queued or in progress.');
      if (run?.status === 'in_review') conflict('Review this revision or request changes before running it again.');
      if (run?.status === 'completed' && run.review?.pullRequestUrl) conflict('This approved work already has a pull request. Create a new task.');
      run ||= newRun(taskId); run.status = 'queued'; run.error = null; run.question = null; run.answer = null;
      run.cancelRequested = false; run.owner = null; run.leaseUntil = 0;
      // A failed publish retries the already approved, immutable revision.
      if (run.review?.decision !== 'approved') run.mode = 'code';
      addRunMessage(run, 'Queued for Sam. Work starts when this computer’s worker is available.');
    } else if (action === 'cancelRun') {
      if (run?.status === 'publishing') conflict('The approved pull request is already being published. Wait for its result before taking another action.');
      if (!run || !['queued', ...ACTIVE].includes(effectiveStatus(run))) conflict('There is no running or queued work to stop.');
      run.cancelRequested = true; run.status = 'cancelled'; run.question = null; run.answer = null;
      addRunMessage(run, 'Stop requested. The worker will end this run at its next check. Isolated changes are retained; the live site is unchanged.');
    } else if (action === 'reviewRun') {
      if (!run || !taskId) conflict('No live result is ready for review.');
      decideRun(run, input);
    } else conflict('Unsupported agent action.');
    await saveRun(sql, run); return taskId || 'sam:general';
  },
  async afterOperation(sql, state, operation, result) {
    const { action, input } = operation;
    if (!['createTask', 'sendMessage'].includes(action) || input.agentId !== 'sam') return;
    const taskId = action === 'createTask' ? result : input.taskId || null;
    if (taskId && state.tasks.find(task => task.id === taskId)?.isSample) return;
    let run = await getRun(sql, taskId);
    if (action === 'createTask') {
      run = newRun(taskId); addRunMessage(run, 'Assigned to Sam · Virtual-Team repository. Code changes will wait for your review.');
    } else if (run?.status === 'waiting_for_user' && run.question && !run.answer && run.leaseUntil >= Date.now()) {
      if (input.questionId !== run.question.id) conflict('Sam’s question changed. Refresh the chat before answering.');
      run.answer = { text: input.text, messageId: result, questionId: run.question.id };
    } else if (!taskId) {
      run ||= newRun(null);
      if (ACTIVE.has(effectiveStatus(run))) run.pendingInput = true;
      else if (effectiveStatus(run) !== 'interrupted') { run.status = 'queued'; run.error = null; run.cancelRequested = false; }
    } else if (run && ['queued', 'working'].includes(effectiveStatus(run))) {
      run.pendingInput = true;
    }
    // Messages on a reviewed task never silently invalidate an approval or run code.
    if (run) await saveRun(sql, run);
  },
};

export async function runtimeSnapshot(sql, response) {
  const [rows, workers] = await Promise.all([
    sql`SELECT data FROM virtual_team_runs ORDER BY updated_at`,
    sql`SELECT status, extract(epoch from heartbeat_at) * 1000 AS heartbeat FROM virtual_team_worker WHERE id = 'sam'`,
  ]);
  const now = Date.now(), heartbeat = Number(workers[0]?.heartbeat || 0);
  const online = workers[0]?.status === 'online' && now - heartbeat < LEASE_MS;
  const copy = structuredClone(response), runs = rows.map(row => row.data);
  copy.state.runtime = { enabled: true, agentId: 'sam', online, lastSeen: heartbeat || null, repository: 'priyanshp1859/Virtual-Team', general: null };
  // Only the canonical generated outbox notice changes. Never rewrite user text.
  copy.state.messages = copy.state.messages.filter(message => !(message.agentId === 'sam' && message.role === 'system' && message.delivery === 'local'
    && message.text === 'Saved to your private workspace. No agent runtime is connected: messages have not been sent to an agent, tasks remain queued, and no code is being changed.'));
  for (const run of runs) {
    const status = effectiveStatus(run, now);
    const details = { status, question: run.question ? { id: run.question.id, text: run.question.text } : null,
      error: status === 'interrupted' ? 'The worker disconnected. Partial changes were preserved. Retry when it is online.' : run.error,
      activity: run.activity || null, attempt: run.attempt };
    if (run.taskId === null) copy.state.runtime.general = details;
    else {
      const task = copy.state.tasks.find(task => task.id === run.taskId);
      if (!task) continue;
      Object.assign(task, { status, execution: details, updatedAt: Math.max(task.updatedAt, run.updatedAt), review: run.review });
    }
    copy.state.messages.push(...run.messages);
  }
  copy.state.messages.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return copy;
}

/** Every worker mutation shares the same lock order as user commands. */
export async function runtimeTransaction(sql, callback) {
  return sql.begin(async tx => {
    await tx`INSERT INTO virtual_team_workspaces (id, state) VALUES ('default', ${tx.json(EMPTY_STATE)}) ON CONFLICT (id) DO NOTHING`;
    const [workspace] = await tx`SELECT state, revision FROM virtual_team_workspaces WHERE id = 'default' FOR UPDATE`;
    const result = await callback(tx, validateStoredState(workspace.state));
    if (result?.changed) await tx`UPDATE virtual_team_workspaces SET revision = revision + 1, updated_at = now() WHERE id = 'default'`;
    return result?.value;
  });
}

export async function workerHeartbeat(sql, owner, status = 'online') {
  const rows = await sql`INSERT INTO virtual_team_worker (id, instance_id, heartbeat_at, status) VALUES ('sam', ${owner}::uuid, now(), ${status})
    ON CONFLICT (id) DO UPDATE SET instance_id = EXCLUDED.instance_id, heartbeat_at = now(), status = EXCLUDED.status
    WHERE virtual_team_worker.instance_id = EXCLUDED.instance_id OR virtual_team_worker.status = 'offline' OR virtual_team_worker.heartbeat_at < now() - interval '60 seconds'
    RETURNING id`;
  if (!rows.length) conflict('Another Sam worker is already connected. Stop it before starting a second worker.');
}
export async function claimRun(sql, owner) {
  return runtimeTransaction(sql, async (tx, state) => {
    const [worker] = await tx`SELECT instance_id, heartbeat_at FROM virtual_team_worker WHERE id = 'sam' FOR UPDATE`;
    if (worker?.instance_id !== owner) conflict('This worker no longer owns Sam’s connection.');
    const rows = await tx`SELECT data FROM virtual_team_runs ORDER BY updated_at`;
    const run = rows.map(row => row.data).find(run => run.status === 'queued');
    if (!run) return { value: null };
    run.owner = owner; run.leaseUntil = Date.now() + LEASE_MS; run.cancelRequested = false;
    run.status = run.mode === 'publish' ? 'publishing' : 'working';
    run.attempt++; run.question = null; run.answer = null; run.error = null; run.pendingInput = false;
    run.inputMessages = state.messages.filter(message => message.agentId === 'sam' && message.taskId === run.taskId && message.role === 'user').map(message => message.id);
    addRunMessage(run, run.mode === 'publish' ? 'Publishing the approved revision as a pull request.' : 'Sam started working.');
    await saveRun(tx, run);
    return { changed: true, value: { run, task: state.tasks.find(task => task.id === run.taskId) || null, messages: state.messages.filter(message => message.agentId === 'sam' && message.taskId === run.taskId && message.role === 'user') } };
  });
}
export async function updateOwnedRun(sql, taskId, owner, attempt, mutate, { heartbeat = false } = {}) {
  return runtimeTransaction(sql, async tx => {
    const run = await getRun(tx, taskId);
    if (!run || run.owner !== owner || run.attempt !== attempt || run.cancelRequested || run.leaseUntil < Date.now()) conflict('This run was stopped, disconnected, or replaced.');
    run.leaseUntil = Date.now() + LEASE_MS;
    await mutate(run);
    await saveRun(tx, run);
    return { changed: !heartbeat, value: run };
  });
}
