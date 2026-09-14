# Project-first workspace

Owner-approved local UX iteration. Do not push or deploy until explicitly requested. The project-common chat redesign is parked; the existing workspace conversations and task selectors remain intact.

## Screens

- **Projects** is the default landing screen after the private access gate. It shows the active team assignment, questions/reviews needing attention, searchable/filterable project cards and creation entrypoint.
- A project's **Overview** shows its current phase, next action, team, resources and activity. Breadcrumbs identify the selected project. Opening another project changes only what the owner is viewing.
- **Resources** shows the brief, files and Figma/design-system reference links. Uploaded text is readable by agents; binary and external-file access limitations are explicit.
- **Work & reviews** lists the existing versioned workflow and opens the existing document, question and exact-approval controls. No preview content can approve actual work.
- **Project settings** exposes project scope/connections and an archive action that preserves saved history.
- **Settings** contains General, Departments & skills, Connections and Access. The full existing roster/skill browser is embedded in the settings page. Navigation motion is a device preference; system reduced-motion preferences are respected.
- **Office** retains the procedural scene, meeting routes and laptops. The renderer initializes on first entry and pauses off-screen. No mobile layout, pet, walking conversation or playable arcade was added.

## Draft and kickoff behavior

The form retains its unsaved draft in the current tab across navigation/reload. Explicit Save draft persists it to the authenticated project API without scheduling an agent. A title is required; an incomplete brief is allowed. Signed-out/session-expired state clears the tab draft. Once work starts, the kickoff brief cannot be silently edited; changes go through the existing review flow.

Create & brief Nora saves the draft and presents the explicit start/team-assignment action. If another project is assigned, its saved work is retained and it is paused when the switch succeeds. An unanswered question survives a pause. An unfinished active stage becomes interrupted and requires an explicit retry. The server serializes switches, so concurrent tabs leave one unfinished project assigned. Project reading, filtering and switching the viewed project do not write execution state.

Each project supports five TXT, Markdown, PDF, PNG or JPEG files, 150 KB each and 250 KB total. Text references are limited to 16,000 characters total. The larger request limit applies only to the authenticated project endpoint. Files remain covered by the existing per-project/global storage caps. File types, signatures, lengths and fields are validated on the server. Binary references are preserved for the owner but are not claimed as readable by agents. Figma links are references, not access grants. The configured code repository remains Virtual-Team.

## Screen preview

**Explore sample screens** opens explicitly labelled ABC, XYZ and Atlas sample projects. Preview project actions operate in browser memory and never call project mutation APIs or schedule workers. Preview approvals are explanatory sample documents, not actionable owner gates. Exit preview returns to the real saved projects. The existing workspace chats remain real, separately labelled conversations.

Direct preview link: `http://localhost:5180/#page=projects&preview=1`.

## Verification

Node tests cover inert/editable drafts, source validation, pause/question preservation and presentation state. The project database integration check verifies resource persistence, atomic and concurrent team switches, late-result rejection, existing records and explicit recovery in a disposable QA schema. Browser checks exercise real draft/file saves and downloads, validation/retry, reload persistence, explicit switches and archive with the worker stopped. Separate preview checks cover navigation, settings/search, desktop/tablet, lazy office rendering, unchanged chats and signout cleanup.

Idle refreshes reuse the last confirmed project data when the shared workspace revision and worker connection have not changed, avoiding repeated attachment downloads. A manual refresh still fetches both stores.
