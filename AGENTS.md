# Virtual Team project guidance

Read README.md, OFFICE.md and RUNTIME.md before changing architecture. This repository contains only the Virtual Team office. Other repositories on the host are out of scope.

- Keep the desktop interface usable on tablets from 768px. Do not introduce a phone layout unless requested.
- Preserve the procedural office, room partitions, side-door meeting routes and laptops. No wandering pet, walking conversations or playable arcade game.
- Sam is the only connected coding agent. Other avatars and meetings are illustrative; do not imply that they execute tasks or use live voice.
- Keep sample workflows clearly labeled and separate from actual runtime records.
- Every workspace API read and write requires its signed session. Keep secrets in ignored local/server configuration, never browser code or Git.
- User commands are validated, transactional and idempotent. Worker events and user commands share the workspace row lock. Preserve data; do not reset it during migrations.
- Sam edits an isolated checkout. A code review covers an exact diff and commit. Only an explicit approval may publish that revision as a pull request; merging stays manual in GitHub.
- Keep Codex command access restricted to the isolated checkout and required runtimes. No external integrations, personal files or inherited credentials in agent tools.
- Run relevant checks and `npm run build`. Changes to task execution, authentication, retry, cancellation or approval require meaningful regression coverage.
