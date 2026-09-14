import { createHash } from 'node:crypto';
import { ApiError } from './errors.js';
import { runtimeTransaction, LEASE_MS } from './runtime.js';
import { WORKFLOW_CAPABILITIES, WORKFLOW_STEPS } from '../src/office/workflow-config.js';
import { createProject, ownerCommand, publicProject, claimStep, requireClaim, PROJECT_LEASE_MS } from './project-model.js';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const keys = { create: ['title', 'brief', 'sourceText', 'figmaUrl', 'designSystemUrl'], decide: ['projectId', 'stepId', 'token', 'decision', 'comment'], answer: ['projectId', 'stepId', 'questionId', 'text'], note: ['projectId', 'stepId', 'text'], retry: ['projectId', 'stepId'], pause: ['projectId'], resume: ['projectId'] };
export function validateProjectOperation(body) {
  const invalid = () => { throw new ApiError(400, 'invalid_input', 'Enter valid project action details.'); };
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['operationId', 'action', 'input'].includes(k)) || !uuid(body.operationId) || !Object.hasOwn(keys, body.action)) invalid();
  const input = body.input;
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.entries(input).some(([key, value]) => !keys[body.action].includes(key) || typeof value !== 'string')) invalid();
  if (body.action !== 'create' && !uuid(input.projectId)) invalid();
  if (['decide', 'answer', 'retry'].includes(body.action) && !WORKFLOW_STEPS.some(s => s.id === input.stepId)) invalid();
  const canonical = Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)));
  return { ...body, operationId: body.operationId.toLowerCase(), fingerprint: createHash('sha256').update(JSON.stringify([body.action, canonical])).digest('hex') };
}
export async function loadProject(sql, id) {
  if (!uuid(id)) throw new ApiError(400, 'invalid_input', 'Choose a project.');
  const rows = await sql`SELECT data FROM virtual_team_projects WHERE id = ${id}::uuid`;
  const project = rows[0]?.data;
  if (!project) throw new ApiError(404, 'project_missing', 'This project could not be found.');
  if (project.version !== 1 || !Array.isArray(project.artifacts) || !project.steps || WORKFLOW_STEPS.some(s => !project.steps[s.id])) throw new ApiError(503, 'invalid_project', 'The project could not be loaded safely. Its data was preserved.');
  return project;
}
export async function saveProject(sql, project) {
  project.updatedAt = Date.now(); project.revision++;
  const bytes = Buffer.byteLength(JSON.stringify(project));
  if (bytes > 800000) throw new ApiError(409, 'project_full', 'This project has reached its history limit. Existing work was preserved.');
  const [{ size }] = await sql`SELECT COALESCE(sum(octet_length(data::text)), 0)::integer AS size FROM virtual_team_projects WHERE id <> ${project.id}::uuid`;
  if (size + bytes > 4000000) throw new ApiError(409, 'projects_full', 'Project storage is full. Existing projects were preserved.');
  await sql`INSERT INTO virtual_team_projects (id, data) VALUES (${project.id}::uuid, ${sql.json(project)}) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
}
export async function mutateProject(sql, body) {
  const operation = validateProjectOperation(body);
  return runtimeTransaction(sql, async tx => {
    const previous = await tx`SELECT fingerprint, result FROM virtual_team_project_operations WHERE operation_id = ${operation.operationId}::uuid`;
    if (previous.length) {
      if (previous[0].fingerprint !== operation.fingerprint) throw new ApiError(409, 'operation_conflict', 'This action identifier was already used for different details.');
      return { value: previous[0].result };
    }
    let project;
    if (operation.action === 'create') {
      const [{ count }] = await tx`SELECT count(*)::integer AS count FROM virtual_team_projects`;
      if (count >= 12) throw new ApiError(409, 'projects_full', 'This first version supports up to 12 projects. Existing projects are preserved.');
      project = createProject(operation.input);
    } else { project = await loadProject(tx, operation.input.projectId); ownerCommand(project, operation.action, operation.input); }
    await saveProject(tx, project);
    const result = { projectId: project.id };
    await tx`INSERT INTO virtual_team_project_operations (operation_id, fingerprint, result) VALUES (${operation.operationId}::uuid, ${operation.fingerprint}, ${tx.json(result)})`;
    return { changed: true, value: result };
  });
}
export async function projectSnapshot(sql, enabled = true) {
  return sql.begin('isolation level repeatable read', async tx => {
    const rows = await tx`SELECT data FROM virtual_team_projects ORDER BY updated_at DESC`;
    const revisions = await tx`SELECT revision FROM virtual_team_workspaces WHERE id = 'default'`;
    const workers = await tx`SELECT instance_id, heartbeat_at, status, capabilities FROM virtual_team_worker WHERE id = 'sam'`;
    const worker = workers[0], lastSeen = worker ? new Date(worker.heartbeat_at).getTime() : null;
    return { revision: Number(revisions[0]?.revision || 0), projects: rows.map(row => publicProject(row.data)), runtime: { enabled, online: enabled && worker?.capabilities?.includes('project_documents') && worker?.status === 'online' && Date.now() - lastSeen < LEASE_MS, lastSeen, capabilities: WORKFLOW_CAPABILITIES } };
  });
}
export async function claimProjectStep(sql, owner) {
  return runtimeTransaction(sql, async tx => {
    const workers = await tx`SELECT instance_id FROM virtual_team_worker WHERE id = 'sam' FOR UPDATE`;
    if (workers[0]?.instance_id !== owner) throw new ApiError(409, 'worker_replaced', 'Another worker owns this connection.');
    const rows = await tx`SELECT data FROM virtual_team_projects ORDER BY updated_at`;
    for (const { data: project } of rows) {
      const claim = claimStep(project, owner);
      if (claim) { await saveProject(tx, project); return { changed: true, value: { project, claim } }; }
    }
    return { value: null };
  });
}
export async function updateProjectClaim(sql, claim, callback, { heartbeat = false } = {}) {
  return runtimeTransaction(sql, async tx => {
    const workers = await tx`SELECT instance_id FROM virtual_team_worker WHERE id = 'sam' FOR UPDATE`;
    if (workers[0]?.instance_id !== claim.owner) throw new ApiError(409, 'worker_replaced', 'This worker no longer owns the connection.');
    const project = await loadProject(tx, claim.projectId);
    const step = requireClaim(project, claim);
    step.leaseUntil = Date.now() + PROJECT_LEASE_MS;
    const value = await callback(project, step);
    if (heartbeat) await tx`UPDATE virtual_team_projects SET data = ${tx.json(project)} WHERE id = ${project.id}::uuid`;
    else await saveProject(tx, project);
    return { changed: !heartbeat, value };
  });
}
