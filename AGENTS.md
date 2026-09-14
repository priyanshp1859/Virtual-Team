# Virtual Team project guidance

Read README.md, OFFICE.md, RUNTIME.md, PROJECT_WORKFLOW.md and AGENT_TEAM.md before changing architecture.

Current owner instruction: keep all changes local. Do not push code or deploy until the owner explicitly authorizes it. Use the isolated development database for local tests; the discarded production office pilot must not be restarted. This repository contains only the Virtual Team office. Other repositories on the host are out of scope.

- Keep the desktop interface usable on tablets from 768px. Do not introduce a phone layout unless requested.
- Preserve the procedural office, room partitions, side-door meeting routes and laptops. No wandering pet, walking conversations or playable arcade game.
- The core team is Nora, Maya, Sam, Ava, Theo and Noor. All other profiles are on-demand specialists; do not require them in every new project. Preserve legacy project workflow versions and approvals.
- Keep the 20-role roster and skill mappings in agent-library as the source of truth. Regenerate profiles with npm run agents:generate after changes. Preserve existing IDs and all saved conversations. Do not modify pinned vendor packages without updating their reviewed source version and integrity lock.
- Sam is the connected standalone coding agent. Nora, Theo, Eden, Maya, Milo, Ava and Alex execute project documents and independent document reviews through the shared local worker. Figma, project frontend execution and browser QA remain capability-blocked. Other avatars and meetings are illustrative; never imply unconnected execution or live voice.
- Keep sample workflows clearly labeled and separate from actual runtime records.
- Every workspace API read and write requires its signed session. Keep secrets in ignored local/server configuration, never browser code or Git.
- User commands are validated, transactional and idempotent. Worker events and user commands share the workspace row lock. Preserve data; do not reset it during migrations.
- Sam edits an isolated checkout. A code review covers an exact diff and commit. Only an explicit approval may publish that revision as a pull request; merging stays manual in GitHub.
- Keep Codex command access restricted to the isolated checkout, assigned read-only skill references and required runtimes. No external integrations, personal files or inherited credentials in agent tools.
- Run relevant checks and `npm run build`. Changes to task execution, authentication, retry, cancellation or approval require meaningful regression coverage.
