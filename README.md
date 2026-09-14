# Virtual Team

A private, desktop-and-tablet workspace for an AI team, presented as an interactive 3D office. Sam's chat opens first after sign-in. The application includes per-agent conversations, task history, a shared work queue, and an explicitly labeled sample code-review workflow.

The frontend is Vite and Three.js. Vercel Functions provide the API, and PostgreSQL provisioned through Vercel Marketplace stores the workspace. Real coding agents and voice meetings are not connected yet; genuine assignments remain queued.

## Run locally

Use Node.js 22, then install dependencies:

```sh
npm ci
```

Copy `.env.example` to `.env.local`. Set the database connection string and two separate random secrets: `WORKSPACE_ACCESS_CODE` for signing in and `SESSION_SECRET` for signing session cookies. Use at least 32 characters for each secret. Keep this file private; it is excluded from Git.

Run the additive schema migration against a development database, then start the app:

```sh
npm run db:migrate
npm run dev
```

Vite serves the same API handlers used by Vercel Functions during local development. Restart the dev server after changing backend modules or environment variables.

## Deploy on Vercel

1. Import this GitHub repository into a Vercel project. The project uses the Vite framework preset, `npm run build`, and the `dist` output directory.
2. Add Neon Postgres through Vercel Marketplace and connect it to the project. The API accepts `DATABASE_URL` or `POSTGRES_URL`.
3. Add `WORKSPACE_ACCESS_CODE` and `SESSION_SECRET` as server environment variables. Do not prefix them with `VITE_`.
4. Apply `db/001-workspace.sql` through `npm run db:migrate` with the intended database connection configured.
5. Deploy, sign in, create a task, and confirm that another signed-in browser can read it. `/office.html` redirects to `/`.

Use a separate database or Neon branch for preview/test deployments. Provisioning a database alone does not create the application tables; the migration must succeed before sign-in and saving can work.

## Data and access

- One private workspace is shared by everyone who knows its access code. This is not a multi-user permissions system.
- A signed, HTTP-only session cookie protects every workspace read and write. Mutations require the same origin; login attempts are rate limited.
- Commands are validated on the server and saved in a transaction. Idempotency identifiers prevent repeated requests from creating duplicate work.
- Only confirmed database responses count as saved. Failed requests retain the current draft for retry and display an error.
- Refreshing or returning to the browser synchronizes the latest workspace. Chats, tasks, and review decisions survive closing the browser. Unsent drafts last only for the current page session.
- Browser-local records from the earlier prototype are not automatically uploaded. Sample workflows stay visibly labeled and never apply, commit, merge, or deploy code.
- Database credentials and workspace access secrets stay on the server. Rotate `SESSION_SECRET` to invalidate existing sessions, and set a new access code when access needs to change.

## Checks

```sh
npm test
npm run build
```

The tests cover task validation and sample transitions, meeting routes and laptop states, API authentication and command handling, and cloud-store retry behavior. Deployment verification also checks actual database persistence and access control.

The office geometry, furniture, and characters are generated in code. There are no remote 3D models, playable arcade games, wandering pets, or walking conversations. The layout has a desktop minimum width with tablet spacing; it has no separate mobile interface.
