import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import postgres from 'postgres';
import { CodexClient, clientConfiguration } from './codex-client.js';
import { prepareRepository, collectReview, commitReview, publishReview, checkoutPath } from './repository.js';
import { workerHeartbeat, claimRun, updateOwnedRun, getRun, addRunMessage } from '../server/runtime.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(process.env.SAM_ENV_FILE || join(repository, '.env.worker.local'));
const settings = parseEnv(await readFile(envFile, 'utf8'));
const databaseUrl = settings.DATABASE_URL || settings.POSTGRES_URL;
if (!databaseUrl?.startsWith('postgres')) throw new Error('Configure the database in .env.worker.local before starting Sam.');
const stateDir = resolve(settings.SAM_STATE_DIR || join(repository, '.sam'));
const baseRef = settings.SAM_BASE_REF || 'origin/main';
const owner = randomUUID();
const sql = postgres(databaseUrl, { max: 3, prepare: false, connect_timeout: 10, idle_timeout: 20, connection: { application_name: 'virtual-team-sam', statement_timeout: 15000 } });
let stopped = false, activeClient = null;
process.on('SIGINT', () => { stopped = true; activeClient?.close(); });
process.on('SIGTERM', () => { stopped = true; activeClient?.close(); });
await mkdir(stateDir, { recursive: true, mode: 0o700 });
await writeFile(join(stateDir, 'private-canary.txt'), 'This file must never be readable by the coding agent.', { mode: 0o600 });

const instructions = `You are Sam, the developer in the user's Virtual Team office. Work only on the connected Virtual-Team repository in the current directory. Read README.md, OFFICE.md and any applicable AGENTS.md before changing code. Keep the existing desktop and tablet interface, sample labels, cloud persistence, and authentication. Do not add a mobile layout unless asked. Do not reintroduce the removed pet, walking conversations, or playable arcade game.
The conversation below comes from the user in your own chat. Answer naturally and report concrete progress. If a material detail is missing, invoke ask_user with one concise question and wait for its result. Do not merely place a blocking question in a final message. In a general conversation, discuss or inspect code, and ask the user to create a task before edits. For an assigned task, perform the authorized changes and run relevant checks. Do not fabricate code, test outcomes, or task completion.
Only this isolated checkout is available. Do not access another project, credential, integration, database, production service, or network resource. Do not delegate to other agents. Do not commit, push, merge, deploy, or open a pull request: the worker handles exact code snapshots and the user approves them separately. Do not run background processes. Do not change repository permissions or runtime configuration. If a required dependency or capability is unavailable, explain the specific limitation. Finish with a concise summary of the actual changes and checks.`;

function safeError(error) {
  const message = String(error?.message || 'The run could not finish.');
  if (/rate.limit|usage.limit|quota|limit.*reached/i.test(message)) return 'Codex usage is currently limited. Retry after the account limit resets.';
  if (/auth|log.?in|unauthorized/i.test(message)) return 'Codex needs sign-in on this computer. Run codex login, then retry.';
  if (/stop|disconnect|replaced|connection closed/i.test(message)) return 'The worker disconnected or the run was stopped. Its isolated changes were preserved.';
  // Avoid leaking raw command arguments, credentials, provider errors, or SQL.
  if (error?.code || /postgres|https?:|Command failed|\n/.test(message)) return 'The worker could not complete this step. The current changes are preserved; retry or inspect the local worker.';
  return message.slice(0, 600);
}

async function runJob(job) {
  const { run, task, messages } = job;
  const update = (mutate, options) => updateOwnedRun(sql, run.taskId, owner, run.attempt, mutate, options);
  let alive = true, leaseBusy = false, eventQueue = Promise.resolve(), threadId = null, heartbeat;
  let finalText = '', client, waitTurn;
  const enqueue = action => { eventQueue = eventQueue.then(action).catch(error => { alive = false; client?.close(); throw error; }); eventQueue.catch(() => {}); };
  heartbeat = setInterval(async () => {
    if (leaseBusy || !alive) return;
    leaseBusy = true;
    try { await workerHeartbeat(sql, owner); await update(() => {}, { heartbeat: true }); }
    catch { alive = false; client?.close(); }
    finally { leaseBusy = false; }
  }, 12_000);
  try {
    if (run.mode === 'publish') {
      if (settings.SAM_PUBLISH_ENABLED !== 'true') throw new Error('Publishing is disabled for this worker. Enable it in the private worker settings to publish an approved revision.');
      const url = await publishReview({ cwd: checkoutPath(stateDir, run.taskId), run, title: task.title, stateDir });
      await update(current => { current.review.pullRequestUrl = url; current.status = 'completed'; current.activity = null; addRunMessage(current, `Your approved changes are ready: ${url}\nMerge the pull request in GitHub when you are ready to update the live site.`); });
      return;
    }
    const checkout = await prepareRepository({ repository, stateDir, run, baseRef });
    await update(current => { Object.assign(current, { checkout: checkout.cwd, base: checkout.base, branch: checkout.branch, activity: 'Reading the repository' }); });
    const args = await clientConfiguration(checkout.cwd, join(repository, 'node_modules'), { readonly: !task });
    const completion = new Promise((resolve, reject) => { waitTurn = { resolve, reject }; });
    completion.catch(() => {});
    const agentMessages = new Map();
    client = new CodexClient({ cwd: checkout.cwd, args,
      onEvent: event => {
        const { method, params } = event;
        if (method === 'worker/disconnected') { waitTurn.reject(new Error(params.error)); return; }
        if (params?.threadId && threadId && params.threadId !== threadId) return;
        if (method === 'item/completed' && params.item?.type === 'agentMessage') {
          const item = params.item;
          if (item.phase === 'final_answer' || !item.phase) finalText = item.text;
          const id = agentMessages.get(item.id) || randomUUID(); agentMessages.set(item.id, id);
          enqueue(() => update(current => {
            const existing = current.messages.find(message => message.id === id);
            if (existing) existing.text = item.text.slice(0, 8000);
            else addRunMessage(current, item.text, 'agent', id);
          }));
        } else if (method === 'item/started' && ['commandExecution', 'fileChange'].includes(params.item?.type)) {
          const label = params.item.type === 'fileChange' ? 'Editing project files' : `Running ${String(params.item.command || 'a command').slice(0, 180)}`;
          enqueue(() => update(current => { current.activity = label; }));
        } else if (method === 'turn/completed') {
          if (params.turn.status === 'completed') waitTurn.resolve();
          else waitTurn.reject(new Error(params.turn.error?.message || `Codex turn ${params.turn.status}.`));
        }
      },
      onRequest: async request => {
        if (request.method === 'item/tool/call' && request.params.tool === 'ask_user') {
          const text = request.params.arguments?.question;
          if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('Ask one question of up to 2,000 characters.');
          await eventQueue;
          const questionId = randomUUID();
          await update(current => { current.status = 'waiting_for_user'; current.question = { id: questionId, text }; current.answer = null; current.activity = 'Waiting for your answer'; addRunMessage(current, text, 'agent'); });
          while (alive && !stopped) {
            const current = await getRun(sql, run.taskId);
            if (current?.owner !== owner || current.attempt !== run.attempt || current.cancelRequested) throw new Error('This run was stopped.');
            if (current.answer?.questionId === questionId) {
              const answer = current.answer.text;
              await update(value => { value.status = 'working'; value.question = null; value.answer = null; value.activity = 'Continuing with your answer'; });
              return { success: true, contentItems: [{ type: 'inputText', text: answer }] };
            }
            await sleep(1500);
          }
          throw new Error('The worker disconnected while waiting.');
        }
        // Keep file/network capability expansion outside the coding agent.
        if (request.method.endsWith('/requestApproval')) return request.method.includes('/permissions/') ? { permissions: {}, scope: 'turn' } : { decision: 'decline' };
        throw new Error('Unsupported tool or permission request.');
      },
    });
    activeClient = client;
    const authType = await client.initialize();
    if (authType !== 'chatgpt') throw new Error('This worker requires the existing ChatGPT Codex sign-in.');
    // Fail closed if the installed runtime does not enforce restricted reads.
    const canary = await client.request('command/exec', {
      command: [process.execPath, '-e', `try { require('fs').readFileSync(${JSON.stringify(join(stateDir, 'private-canary.txt'))}); process.exit(9); } catch(e) { process.exit(['EPERM','EACCES'].includes(e.code) ? 0 : 8); }`],
      cwd: checkout.cwd, permissionProfile: 'sam', timeoutMs: 5000,
    });
    if (canary.exitCode !== 0) throw new Error('The installed Codex runtime could not enforce the workspace boundary. Sam was not started.');
    const started = await client.request('thread/start', { cwd: checkout.cwd, runtimeWorkspaceRoots: [checkout.cwd], permissions: 'sam', approvalPolicy: 'never', ephemeral: true,
      serviceName: 'virtual-team', developerInstructions: instructions, selectedCapabilityRoots: [],
      dynamicTools: [{ type: 'function', name: 'ask_user', description: 'Ask the workspace owner a necessary question in this chat and wait for their answer.', inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'], additionalProperties: false } }],
    });
    threadId = started.thread.id;
    const latestRun = await getRun(sql, run.taskId);
    const transcript = [...messages, ...latestRun.messages.filter(message => message.role === 'agent')].sort((a, b) => a.createdAt - b.createdAt).slice(-35).map(message => `${message.role === 'user' ? 'User' : 'Sam'}: ${message.text}`).join('\n\n');
    const brief = task ? `Assigned task: ${task.title}\nTask brief: ${task.brief}\n${run.review?.comment ? `Requested revision: ${run.review.comment}\n` : ''}` : 'General conversation: answer or inspect the repository; do not change files. The user creates an assignment in Tasks to authorize implementation.';
    await client.request('turn/start', { threadId, cwd: checkout.cwd, runtimeWorkspaceRoots: [checkout.cwd], permissions: 'sam', approvalPolicy: 'never',
      input: [{ type: 'text', text: `${brief}\n\nConversation:\n${transcript || '(No additional messages.)'}` }],
      ...(settings.SAM_REASONING_EFFORT ? { effort: settings.SAM_REASONING_EFFORT } : {}),
    });
    let executionSeconds = 0;
    const deadline = setInterval(async () => {
      const current = await getRun(sql, run.taskId).catch(() => null);
      if (current?.status !== 'waiting_for_user') executionSeconds += 10;
      if (stopped || !alive || executionSeconds >= 1200) { client.close(); }
    }, 10_000);
    try { await completion; await eventQueue; } finally { clearInterval(deadline); }
    if (!task) {
      await update(current => { current.status = current.pendingInput ? 'queued' : 'completed'; current.activity = null; }); return;
    }
    let current = await getRun(sql, run.taskId);
    if (current.pendingInput) {
      await update(value => { value.status = 'queued'; value.activity = null; addRunMessage(value, 'I received your additional note and will include it before preparing the review.'); }); return;
    }
    await update(value => { value.activity = 'Checking the code changes'; });
    const initial = await collectReview(checkout.cwd, checkout.base);
    if (!initial.files.length) {
      await update(value => { value.status = 'completed'; value.activity = null; value.review = null; addRunMessage(value, 'This task finished without file changes. See Sam’s response above.'); }); return;
    }
    const checks = [];
    const packageJson = JSON.parse(await readFile(join(checkout.cwd, 'package.json'), 'utf8'));
    for (const script of ['test', 'build']) {
      if (!packageJson.scripts?.[script]) { checks.push({ label: `npm run ${script}`, detail: 'Not configured in this repository.', passed: false }); continue; }
      await update(value => { value.activity = `Running ${script}`; });
      const result = await client.request('command/exec', { command: [join(dirname(process.execPath), 'npm'), 'run', script], cwd: checkout.cwd, permissionProfile: 'sam', timeoutMs: 120_000, outputBytesCap: 5000, env: { TMPDIR: join(checkout.cwd, '.sam-tmp') } }, 130_000);
      checks.push({ label: `npm run ${script}`, detail: result.exitCode === 0 ? 'Passed in the isolated checkout.' : `Failed (exit ${result.exitCode}). ${String(result.stderr || result.stdout).slice(-1800)}`, passed: result.exitCode === 0 });
    }
    const artifact = await collectReview(checkout.cwd, checkout.base);
    if (artifact.digest !== initial.digest) checks.push({ label: 'Files changed during checks', detail: 'The checked code changed during verification. Request changes before approving.', passed: false });
    const commit = await commitReview(checkout.cwd, task.title);
    await update(value => {
      const revision = ++value.revision;
      value.review = { revision, isSample: false, summary: (finalText || 'Sam prepared these code changes for your review.').slice(0, 3000), files: artifact.files,
        checks, digest: artifact.digest, commit, branch: checkout.branch, base: checkout.base,
        publishable: checks.length > 0 && checks.every(check => check.passed), decision: null, comment: null, decidedAt: null, pullRequestUrl: null };
      value.status = 'in_review'; value.activity = null;
      addRunMessage(value, `Revision ${revision} is ready for review. ${checks.every(check => check.passed) ? 'The test and build checks passed.' : 'Some checks need attention.'} The live site is unchanged.`);
    });
  } catch (error) {
    await eventQueue.catch(() => {});
    try {
      await update(current => { current.status = stopped ? 'interrupted' : 'failed'; current.activity = null; current.error = safeError(error); current.question = null; current.answer = null; addRunMessage(current, current.error); });
    } catch { /* A newer worker, cancellation or expired lease owns this record. */ }
    console.error('Sam run needs attention. Check the workspace for its status.');
  } finally {
    alive = false; clearInterval(heartbeat); client?.close(); activeClient = null;
  }
}

try {
  await workerHeartbeat(sql, owner);
  await writeFile(join(stateDir, 'worker.json'), JSON.stringify({ pid: process.pid, instance: owner, repository, envFile, startedAt: new Date().toISOString() }), { mode: 0o600 });
  console.log('Sam worker connected. Waiting for Virtual-Team assignments.');
  while (!stopped) {
    await workerHeartbeat(sql, owner);
    const job = await claimRun(sql, owner);
    if (job) await runJob(job);
    else await sleep(3000);
  }
} catch (error) {
  console.error(`Sam worker stopped: ${safeError(error)}`); process.exitCode = 1;
} finally {
  activeClient?.close();
  await sql`UPDATE virtual_team_worker SET status = 'offline' WHERE id = 'sam' AND instance_id = ${owner}::uuid`.catch(() => {});
  await sql.end();
}
