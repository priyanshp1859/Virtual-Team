import { mkdir, writeFile } from 'node:fs/promises';
import roster from '../agent-library/roster.json' with { type: 'json' };
import { profileMarkdown, teamMarkdown } from '../agent-library/profiles.js';

await mkdir(new URL('../agent-library/profiles/', import.meta.url), { recursive: true });
for (const agent of roster.agents) await writeFile(new URL(`../agent-library/profiles/${agent.id}.md`, import.meta.url), profileMarkdown(agent.id));
await writeFile(new URL('../AGENT_TEAM.md', import.meta.url), teamMarkdown());
console.log(`Generated ${roster.agents.length} agent role briefs and the department/skill map.`);
