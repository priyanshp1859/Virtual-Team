import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { AGENTS, DEPARTMENTS, AVATAR_AGENTS, SKILLS } from '../src/office/config.js';
import lock from '../agent-library/skills.lock.json' with { type: 'json' };
import { roleInstructions, profileMarkdown } from '../agent-library/profiles.js';
import { createWorkspaceStore } from '../src/office/workspace-store.js';

test('the accepted office structure covers all twenty roles with eight starter roles', () => {
  assert.equal(AGENTS.length, 20); assert.equal(DEPARTMENTS.length, 6);
  assert.equal(new Set(AGENTS.map(agent => agent.id)).size, 20);
  assert.equal(new Set(AGENTS.map(agent => agent.role)).size, 20);
  assert.deepEqual(DEPARTMENTS.map(dept => AGENTS.filter(agent => agent.department === dept.id).length), [1, 2, 5, 5, 4, 3]);
  assert.equal(AGENTS.filter(agent => agent.launchTeam).length, 8);
  for (const agent of AGENTS) {
    assert(agent.responsibilities.length >= 3); assert(agent.deliverables.length >= 3);
    assert(agent.boundaries.length >= 2); assert(agent.skills.length >= 1 && agent.skills.length <= 3);
  }
});
test('existing identities and six physical seats remain compatible without duplicate meeting positions', () => {
  assert.deepEqual(AVATAR_AGENTS.map(agent => agent.id).sort(), ['alex', 'jules', 'leo', 'maya', 'robin', 'sam']);
  assert.equal(new Set(AVATAR_AGENTS.map(agent => String(agent.seat))).size, 6);
  for (const agent of AVATAR_AGENTS) assert(AGENTS.some(item => item.id === agent.id));
});
test('every new profile can save a task and retain an isolated conversation across reload', () => {
  let saved = null;
  const storage = { getItem: () => saved, setItem: (_, value) => { saved = value; } };
  const store = createWorkspaceStore({ storage });
  for (const agent of AGENTS) {
    const taskId = store.createTask({ agentId: agent.id, title: `Brief for ${agent.name}`, brief: 'Roster persistence verification' });
    store.sendMessage({ agentId: agent.id, taskId, text: `${agent.id}-only context` });
  }
  const restored = createWorkspaceStore({ storage }).getState();
  assert.equal(restored.tasks.length, 20);
  for (const agent of AGENTS) {
    const task = restored.tasks.find(item => item.agentId === agent.id);
    assert.equal(task.status, 'queued');
    assert.deepEqual(restored.messages.filter(message => message.agentId === agent.id && message.role === 'user').map(message => message.text), [`${agent.id}-only context`]);
    assert.throws(() => store.sendMessage({ agentId: agent.id, taskId: restored.tasks.find(item => item.agentId !== agent.id).id, text: 'Wrong owner' }), /assigned/);
  }
});
test('all skill bindings resolve to versioned source packages and generated role briefs', async () => {
  assert.equal(SKILLS.length, 25); assert.equal(lock.skills.length, 25);
  const used = new Set(AGENTS.flatMap(agent => agent.skills.map(binding => binding.id)));
  assert.equal(used.size, SKILLS.length);
  for (const agent of AGENTS) {
    for (const binding of agent.skills) assert(SKILLS.some(skill => skill.id === binding.id));
    assert.equal(await readFile(new URL(`../agent-library/profiles/${agent.id}.md`, import.meta.url), 'utf8'), profileMarkdown(agent.id));
  }
  for (const skill of SKILLS) {
    assert.match(skill.commit, /^[a-f0-9]{40}$/);
    assert.match(skill.directoryUrl, /^https:\/\/www\.skills\.sh\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/);
    assert(skill.sourceUrl.includes(skill.commit)); assert(skill.requires); assert(skill.adaptation);
    assert((await readFile(new URL(`../${skill.licensePath}`, import.meta.url), 'utf8')).length > 500);
    const pinned = lock.skills.find(item => item.id === skill.id);
    assert.equal(pinned.commit, skill.commit);
    const root = new URL(`../agent-library/skills/${skill.id}/`, import.meta.url);
    const actual = (await readdir(root, { recursive: true, withFileTypes: true })).filter(item => item.isFile());
    assert.equal(actual.length, pinned.files.length, 'No unreviewed files may be added to a pinned skill.');
    for (const file of pinned.files) {
      assert(!file.path.includes('..') && !file.path.startsWith('/'));
      const bytes = await readFile(new URL(file.path, root));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `Upstream copy changed: ${skill.id}/${file.path}`);
    }
  }
});
test('Sam receives only his assigned skill references and explicit existing execution boundaries', () => {
  const instructions = roleInstructions('sam');
  for (const id of ['fullstack-guardian', 'javascript-pro', 'test-master']) assert(instructions.includes(`agent-library/skills/${id}/SKILL.md`));
  assert(!instructions.includes('agent-library/skills/deploy-to-vercel'));
  assert.match(instructions, /General chat is read-only/);
  assert.match(instructions, /Do not delegate/);
  assert.match(instructions, /node:test/);
  const workerInstructions = roleInstructions('sam', { referenceRoot: '/trusted/skills' });
  assert(workerInstructions.includes('/trusted/skills/fullstack-guardian/SKILL.md'));
  assert(!workerInstructions.includes('agent-library/skills/'));
  assert.throws(() => roleInstructions('../unknown'), /Unknown agent/);
});
