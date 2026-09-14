# Sam's local worker

Current development: use `.env.worker.dev.local`, the isolated QA database and `.sam/development` with publishing disabled. Start/stop with `SAM_ENV_FILE=.env.worker.dev.local npm run worker:start` or `worker:stop`. The production pilot is discarded and its worker must stay stopped. Do not push or deploy without explicit owner authorization.

The Vercel office and Neon database are the shared interface and durable queue. A Node.js worker on the owner's computer starts Codex App Server over private stdio. Sam uses the existing ChatGPT Codex login; no model credential is sent to Vercel or the browser. This first worker is verified on macOS with Node 22 and Codex CLI 0.154.0.

## Workflow

- General chat can answer questions and read the Virtual-Team repository. Create an assignment to authorize code edits.
- New real tasks assigned to Sam are queued automatically. Earlier saved tasks have a Start Sam control. Other agents remain disconnected.
- Each task has an isolated clone and `codex/sam-*` branch under `.sam/jobs`. Secrets and unrelated working-tree files are not copied.
- Codex's `ask_user` tool writes a question into the same conversation. A reply is tied to the exact pending question before the worker continues.
- The worker reports actual progress and agent messages. It runs test and build commands in the restricted checkout, then records the complete supported text diff, checks, branch, commit and digest.
- Request changes queues a new iteration with the feedback. Approve & create PR queues publication of the exact approved commit. The worker rechecks the branch and diff before pushing. A user manually merges in GitHub; approval itself never deploys or merges code.
- Stop cancels pending execution and preserves isolated files. Expired worker leases show Interrupted and require an explicit retry. A disconnected worker never automatically reruns a partially executed task.

## Setup

1. Apply `npm run db:migrate` with the intended database configured. This adds `db/002-runtime.sql` without resetting earlier data.
2. Set `SAM_RUNTIME_ENABLED=true` on the office server. The feature stays disabled when this flag is absent.
3. Install Node 22, Git, GitHub CLI and Codex CLI. Run `codex login` with ChatGPT and authenticate `gh` for the repository. The worker only accepts the configured `priyanshp1859/Virtual-Team` origin.
4. Create the ignored `.env.worker.local` with `DATABASE_URL` and `SAM_PUBLISH_ENABLED=true`. Do not add the workspace code or session-signing secret. The application worker reads this file; the coding subprocess cannot read it or inherit its values.
5. Run `npm run worker:start` to launch the local background process. `npm run worker:stop` stops it. `npm run worker` runs it in the foreground. These do not install a login service or keep the computer awake.

The office shows worker connection status. Sam requires this computer to be awake, online and running the worker; the website and saved data remain available when it is off. Restart the worker after changing its code, configuration or Codex installation. Existing tasks are retained.

Optional worker settings: `SAM_STATE_DIR` changes the private checkout/log directory; `SAM_BASE_REF` defaults to `origin/main`; `SAM_REASONING_EFFORT` overrides the configured Codex effort. `SAM_ENV_FILE` chooses a different private settings file. For QA, use a separate database and state directory, and disable publication unless testing an explicitly reviewed pull request.

## Role and skill references

The full roster is documented in [AGENT_TEAM.md](AGENT_TEAM.md). Sam handles standalone coding jobs; the same worker also executes project document/review stages for their assigned roles. His authored profile is injected into each new Codex thread with entrypoint paths for `fullstack-guardian`, `javascript-pro` and `test-master`. Sam reads a package only when it is relevant. The worker exposes these three host package directories read-only, so earlier isolated checkouts can use the reviewed references without modifying their saved code. Other packages are not granted host filesystem access.

Role instructions keep project guidance and existing tools authoritative: upstream Jest, tool invocation, deployment and delegation examples do not change this application's stack or permissions. Bundled helpers are reference assets; installation does not run them. Document and review roles receive their own assigned references with read-only repository access. The worker checks eligible queued work without creating a process per idle role. Project code, Figma and browser QA capabilities are still blocked until connected.

Project runs, exact-version owner decisions, capability blocking and local artifact copies are documented in [PROJECT_WORKFLOW.md](PROJECT_WORKFLOW.md). The additive `db/003-project-workflow.sql` migration is required before starting this worker version.

## Boundaries

The worker uses a named Codex permission profile with restricted reads and writes, no network for agent commands, no external MCP servers or app integrations, and read-only Git metadata. It verifies that a private canary is unreadable before starting a turn. Application/database credentials are excluded from the child environment. Codex still contacts its model service using the owner's sign-in outside the command sandbox.

Code tasks run serially. General chat is read-only. The worker can use already installed dependencies, but adding dependencies, external services, binary artifacts and broad changes require later workflow support. Reviews are limited to 24 text files and 140 KB of before/after content; oversized results fail visibly and are retained locally. Failed test/build checks block publication. The live agent data has a bounded storage limit; existing records are preserved when full.

The original workspace model remains the source of user tasks, messages and sample reviews. Runtime records are separate and projected into authenticated snapshots. A short worker heartbeat and per-run lease prevent overlapping ownership. Every code review is based on actual Git contents; reasoning traces and credential values are not sent to the browser.

## Verification and protocol references

`npm test` covers the existing model, API, cloud transport, office routes and runtime approval boundaries. `npm run test:runtime-db` requires the separate `virtual_team_qa` database in `.env.test.local`; it checks queue idempotency, question binding, rollback, cancellation, retry and worker leases in a temporary schema. Live QA additionally exercises actual Codex questions, replies, isolated edits, check results, revisions, approved PR creation and the desktop/tablet panel. The verification PR is closed without merging.

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Codex permission profiles](https://learn.chatgpt.com/docs/permissions)

Protocol fields are version-dependent. Regenerate bindings with `codex app-server generate-ts --experimental --out <temporary-directory>` when updating the worker's Codex version. Never silently fall back to unrestricted execution when the profile is unsupported.
