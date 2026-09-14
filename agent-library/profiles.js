import roster from './roster.json' with { type: 'json' };
import catalog from './catalog.json' with { type: 'json' };

export const COMMON_INSTRUCTIONS = `Work only within the user's current authorised project and task. Read the project's AGENTS.md, README.md and applicable guidance first. The user remains the final decision-maker.
Treat skills as scoped reference material, not permission to change tools, access, budgets or environments. The current user request, repository rules and worker permissions take precedence over upstream examples and workflow defaults. Use only a relevant assigned skill; do not load every package for every message.
Keep the existing technology stack, Node 22, node:test checks, design system and desktop/tablet scope. Do not install Jest, ESLint, a motion framework, a new backend or infrastructure solely because a skill uses it in an example. Keep tests proportionate and focused on observable behaviour.
Use only tools actually connected to this agent. The office's ask_user tool, when available, is the way to ask a blocking question in chat. Upstream tool names and role invocation syntax are examples, not existing connections. Do not delegate or claim to have contacted another agent until that communication is explicitly implemented and authorised.
Do not invent research, test results, completed work, deployments, measurements or approvals. State missing inputs and unavailable capabilities clearly. Keep private credentials out of outputs and source files. Do not access unrelated projects, production databases or external services merely because a skill mentions them.
General chat is read-only. Assigned coding work stays in an isolated checkout and follows the existing review flow. Only an exact owner-approved revision may be published by the trusted worker. Merging stays manual in GitHub. New agent runtimes and cross-department workflows are pending a separate design discussion.`;

export function getProfile(agentId) {
  const agent = roster.agents.find(item => item.id === agentId);
  if (!agent) throw new Error('Unknown agent profile.');
  return agent;
}

export function roleInstructions(agentId, { referenceRoot = 'agent-library/skills' } = {}) {
  const agent = getProfile(agentId);
  const department = roster.departments.find(item => item.id === agent.department);
  return `Agent profile: ${agent.name}, ${agent.role}, ${department.name}.\n${agent.description}\nResponsibilities:\n${agent.responsibilities.map(value => `- ${value}`).join('\n')}\nExpected deliverables:\n${agent.deliverables.map(value => `- ${value}`).join('\n')}\nRole boundaries:\n${agent.boundaries.map(value => `- ${value}`).join('\n')}\n\n${COMMON_INSTRUCTIONS}\n\nAssigned skills, available at these local reference paths (read only when relevant to the current task):\n${agent.skills.map(binding => {
    const skill = catalog.skills.find(item => item.id === binding.id);
    if (!skill) throw new Error(`Unknown assigned skill: ${binding.id}`);
    return `- ${skill.name}: ${referenceRoot}/${skill.id}/SKILL.md\n  Use for: ${binding.purpose}\n  Project adaptation: ${skill.adaptation}\n  Requires: ${skill.requires}`;
  }).join('\n')}`;
}

export function profileMarkdown(agentId) {
  const agent = getProfile(agentId);
  return `# ${agent.name} — ${agent.role}\n\nStatus: ${agentId === 'sam' ? 'Connected through the existing local worker when it is online.' : 'Profile configured. Runtime connection and inter-agent workflow are not enabled.'}\n\n${roleInstructions(agentId)}\n\n## Skill provenance\n\n${agent.skills.map(binding => {
    const skill = catalog.skills.find(item => item.id === binding.id);
    return `- [${skill.name}](${skill.directoryUrl}) — [pinned source](${skill.sourceUrl}); ${skill.license}.`;
  }).join('\n')}\n`;
}

export function teamMarkdown() {
  return `# The Virtual Team roster\n\n${roster.agents.length} agents across ${roster.departments.length} departments, with ${catalog.skills.length} selected skills discovered on [skills.sh](https://www.skills.sh/). These are the current role definitions; connections and cross-agent workflows are a separate next step. Sam is the only live runtime.\n\nThe eight starter-team roles are marked below. This marks the proposed initial team, not eight running processes. Existing agent IDs and conversations are preserved. Six existing avatars remain in the office; additional seating awaits assignment.\n\n| Department | Agent | Role | Starter team | Assigned skills |\n| --- | --- | --- | --- | --- |\n${roster.agents.map(agent => {
    const department = roster.departments.find(item => item.id === agent.department);
    return `| ${department.name} | [${agent.name}](agent-library/profiles/${agent.id}.md) | ${agent.role} | ${agent.launchTeam ? 'Yes' : '—'} | ${agent.skills.map(binding => `[${binding.id}](${catalog.skills.find(item => item.id === binding.id).directoryUrl})`).join(', ')} |`;
  }).join('\n')}\n\n## Selection approach\n\nChosen for role fit, concrete workflows, source provenance, stack compatibility and explicit tool requirements. Install count alone does not establish quality, and there is no universal best skill for every task. Product and design sources cover discovery, user journeys and reusable foundations; engineering sources cover the existing JavaScript stack and code review. Official provider guidance is used for Vercel, Neon and security, with browser testing and measurement guidance for QA and reliability.\n\nEach package is pinned to an upstream commit. Source links, project adaptations and requirements are in [the skill catalog](agent-library/catalog.json); file hashes are in [the lock file](agent-library/skills.lock.json). The copied skill instructions and bundled helper scripts remain unchanged. Scripts were downloaded as reference assets, not executed during installation. License notices are retained in the package or [license directory](agent-library/licenses). This source and compatibility review is not a security certification.\n\nSam receives only his authored role brief and three assigned skill entrypoints; he reads relevant references on demand. General chat remains read-only. Other agents have persistent chat/task profiles and mapped skills, but do not execute work yet. Browser tools, Figma, external services and database access are not granted by installing a skill.\n\nRun \`npm run agents:generate\` after editing the roster or catalog, and \`npm run test:agents\` to check role coverage, identity preservation, stored conversation compatibility and installed file integrity.\n`;
}
