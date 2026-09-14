# Project workflow implementation

## Local rebuild — awaiting owner review

Do not push or deploy until the owner explicitly authorizes it. The previous production office pilot was discarded and its production worker stopped. Local UI runs at `http://localhost:5180` against the separate `virtual_team_qa` database. `.env.development.local` and `DEVELOPMENT_DATABASE_NAME` guard this separation.

New projects use workflow version 2 with six core roles: Nora coordinates requirements, Maya owns UX/design, Sam implements, Ava reviews design, Theo reviews engineering and Noor tests. Select Milo, Eden or Alex explicitly at kickoff to add motion planning, design-system assessment or delivery oversight. Other specialists retain profiles and skills; dedicated code/security/performance execution remains future work. Legacy project definitions and exact-version decisions are preserved.

The default planning sequence is Nora PRD → Theo review → owner scope approval → Maya UX/foundations → Ava review → owner direction approval. Milo and Eden add their requested deliverables; no specialist work is silently marked complete. Figma screens and implementation remain separate approval gates with missing execution tools clearly blocked. New project coding is assigned to Sam, reviewed by Theo, followed by Maya design QA and Noor functional QA, Nora acceptance and owner delivery approval. Alex participates only when selected.

The UI groups stages into five phases, shows current work and progress, renders safe Markdown tables/lists/links, retains kickoff drafts, puts owner decisions above their versioned documents and allows discarding a project. Discard stops future claims, invalidates active work and removes the project from the active list while retaining its audit records.

Local worker: `SAM_ENV_FILE=.env.worker.dev.local npm run worker:start`. It uses `.sam/development`, the isolated QA database, the local Git HEAD and publication disabled. Make a local commit before testing agent reads of changed source; no push is needed. Stop with the same environment file and `npm run worker:stop`.

## Earlier production foundation

The production office at `https://virtual-team-lilac.vercel.app` is the interface for projects, handoffs, questions and approvals. Records are saved in Neon through authenticated Vercel Functions. Execution remains on the owner's computer using the existing Codex sign-in. This is one shared private workspace; it is not a per-user role/permission system.

## Connected in this release

- Project kickoff from an idea or pasted reference document, with optional Figma/design-system links. The permitted repository is Virtual-Team; adding another repository requires explicit configuration.
- Nora's real PRD production and Theo's separate, read-only feasibility review.
- An exact-version owner PRD approval. Only approval unlocks design planning.
- Eden's written design-system assessment, Maya's written UX/screen plan, Milo's motion specification, and Ava's independent concept review.
- A separate owner decision on that written design direction. This never counts as approval of unseen Figma screens.
- Durable dependencies for the remaining design, engineering, parallel QA, PM, COO and owner-review stages. A missing capability is visibly blocked; blocked steps cannot be approved away or treated as completed.
- Project conversation, necessary agent questions, question-bound answers, progress history, immutable artifact versions, downloads, changes requested, pause/resume and explicit retry.
- The worker executes queued document/review stages serially. Waiting for an owner answer releases that run; the later answer queues a fresh run with the conversation. There are no model processes for idle profiles.

These assignments use actual Codex runs with the assigned role instructions and relevant local skill references. Agent chat text is not a completion signal: the role must submit an artifact through its restricted tool, and the worker persists it only after a successful turn.

## Required connections before the later stages can run

Figma editing and Figma review require an authorized connection to a particular file. Project frontend implementation requires a versioned approved-design handoff to an isolated code checkout. Visual/functional QA require the matching design, implementation preview and connected browser environment. These capabilities are intentionally false in `WORKFLOW_CAPABILITIES`; do not turn a flag on without implementing and verifying its executor.

Sam's earlier standalone coding tasks remain available in his agent panel with their existing exact-diff PR approval and manual GitHub merge flow. They do not silently satisfy a project implementation, QA or release gate.

The earlier expansion pilot is discarded. The six physical office characters now represent the core team; all twenty profiles and saved conversations remain available.

## Reviews and changes

Every handoff includes upstream artifact IDs and content digests. Review actors come from the server's stage definition, never from a browser-supplied identity. An author cannot independently review the direct artifact they created. Owner decisions require an authenticated session, same-origin request, the ready owner stage and its current approval token.

Requesting changes creates a revision for the responsible author and invalidates dependent approvals/claims. Earlier artifacts and decisions remain in history. Two unsuccessful internal review rounds block for owner attention and an explicit retry. Notes do not approve scope or satisfy pending questions. A stopped/expired run cannot submit into a later generation, another project or a newer worker's claim.

Accepting a document/design direction/delivery does not merge or deploy code. The existing manual merge rule remains in effect. The full intended workflow is in [PROJECT_WORKFLOW_PLAN.md](PROJECT_WORKFLOW_PLAN.md).

## Persistence and local visibility

Apply `npm run db:migrate` with the intended database configured. `003-project-workflow.sql` adds project records, action receipts and a capability column on the existing worker heartbeat. It does not reset chats, tasks, earlier runs or reviews.

Project actions and worker results use the same workspace lock as the earlier runtime. Action IDs are idempotent, with conflicting reuse rejected. Each project has separate context, history and an isolated repository clone. Worker leases and input-version checks reject stale results. The browser accepts only confirmed server revisions and discards late responses after signout.

The repository clone is under `.sam/jobs/`. Submitted documents are mirrored locally under `.sam/project-artifacts/<project-id>/<step>-v<version>.md`; these files and settings stay ignored by Git. The authenticated office contains the canonical saved artifacts and downloads. Agent edits do not appear in the main local checkout or deployed site until the appropriate review/publication process.

The first release bounds storage to 12 unarchived projects, 800 KB per project and 4 MB total including archived records. Capacity errors preserve existing records. Source text and artifacts are rendered as text, not executable agent HTML. Credentials stay outside agent environments and repository clones.

## Verification

- `npm test` includes project transitions, approval versions, independent authorship, questions, stale claims, interruption, capability gates and browser-store retry/session behavior.
- `node --env-file=.env.test.local scripts/test-projects-database.mjs` checks real SQL locking, idempotency, rollback, handoffs, approval and existing-task preservation in a disposable schema of the separate QA database.
- `npm run test:runtime-db` also exercises the original Sam runtime against the new schema.
- Browser QA exercises real Nora question/answer and PRD submission, Theo's independent review, the owner approval and next handoff, persistence, pause, signout and desktop/tablet viewports.

## Project-first workspace screens

See [WORKSPACE_UX.md](WORKSPACE_UX.md). Drafts have `draft: true`, remain paused and cannot be claimed. A draft can be edited through `updateDraft` until explicitly started. Starting or resuming a project pauses every other unfinished project in the same workspace transaction. Browsing never changes this assignment. Pausing retains unanswered questions and saved artifacts; active unfinished steps become interrupted and need an explicit retry. Late worker callbacks are rejected.

Kickoff accepts up to five validated TXT/Markdown/PDF/PNG/JPEG references, 150 KB each and 250 KB total. Text content is limited to 16,000 characters and passed as reference data to the assigned project role. Binary files are stored/downloadable, but agents receive only their names and an explicit unreadable status. Reference links do not grant access. These additive JSON fields require no schema reset. Only the authenticated projects endpoint allows the larger bounded request body; other endpoints retain their existing limits.
