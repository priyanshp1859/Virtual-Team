# The Office

An interactive Three.js office inspired by the supplied isometric cutaway reference. This standalone Virtual-Team repository serves the office at `/`, with private access-code authentication and PostgreSQL persistence. See `README.md` for local setup and Vercel deployment.

## What works

- Six furnished spaces: coding room, design studio, review room, head's cabin, meeting room, and gaming lounge. The lounge has a real partition and doorway, a television, console, controllers, and two arcade cabinets.
- Framed glass walls enclose the coding and meeting rooms. The meeting entrances sit on either side of the board; the coding-room doors line up with the walking aisles.
- Six procedural human characters with distinct appearances, seated poses, small work/idle gestures, and articulated walking cycles.
- Drag to orbit; scroll or use the camera buttons to zoom. Room navigation focuses the camera. **O** returns to the overview.
- Sam's workspace opens first. Select another character in the scene or team list to open their **Chat**, **Tasks**, and **Review** panel. The panel docks on wide desktops and overlays the office on tablets. **Escape** closes the selection.
- Save messages and queue tasks for each agent, with separate conversations for each task. Sam's local Codex worker handles real assignments against Virtual-Team, asks questions in chat, edits an isolated branch, runs checks and prepares code for review. The queue and team presence show actual worker activity. Other agents remain disconnected. Records persist in PostgreSQL through authenticated Vercel API handlers. Only confirmed responses count as saved; failures retain the draft and provide retry controls. The visible office synchronizes worker updates automatically.
- **Try sample workflow** explicitly starts a scripted walkthrough with Sam. Continue to the sample question, reply, inspect an illustrative code diff, request changes with feedback, preview the revised sample, and approve its exact revision. Sample messages, checks, and decisions are labeled throughout. The example is predefined, does not generate code from your feedback, and never changes files.
- **Call a meeting** sends everyone directly through the hall, carrying closed laptops. They use the side entrances, clear the board, and follow the table's side aisles to their seats. Attendance updates as characters arrive; each person places and opens their laptop. **End meeting** closes and packs the laptops before everyone returns through those entrances to their original places.
- The gaming lounge's television and arcade cabinets are decorative; no playable game or game controls are loaded.
- Reduced-motion preference skips travel choreography and removes idle animation. The scene stops updating while the tab is hidden.
- One desktop-style interface for computers and tablets, with a persistent sidebar and keyboard-accessible room, agent, meeting, and camera controls. The workspace has a 768px minimum width; there is no separate phone layout.

## Scope

This is the office and interaction layer with real cloud persistence and one live coding worker, Sam. Sam's general chat is read-only; assignments authorize isolated code editing. His availability depends on the owner's computer and worker. Names, other agent roles, desk displays, room occupancy and meeting attendance remain illustrative local animation. No microphone or voice meeting runtime is connected. See RUNTIME.md for worker setup and boundaries.

Completed sample reviews are saved decisions, not merges or deployments. Actual reviews show the exact code and checks; approval creates a pull request, with manual merging in GitHub. Everyone who knows the access code uses the same private workspace and may assign work to Sam. Chats and tasks survive clearing browser data, although signing in again is required. Unsaved composer drafts are retained while switching agents and tabs in the current page and are cleared on signout or session expiry. This is not a multi-user permissions system. Earlier browser-local prototype records are not automatically uploaded.

The architectural geometry, furniture, characters, and textures are generated locally in code. Google Fonts are optional; system and Georgia fallbacks work if unavailable. The office does not require remote models or image assets.

## Source

- `src/office/config.js`: rooms, characters, stations, and meeting seats.
- `src/office/layout.js`: shared wall boundaries, door openings, board footprint, and meeting entry coordinates.
- `src/office/environment.js`: office architecture, furniture, materials, and canvas textures.
- `src/office/people.js`: human rigs, local animation, route choreography, and attendance state.
- `src/office/main.js`: rendering, lighting, camera, picking, navigation, and interface state.
- `src/office/workspace-store.js`: shared validation and the explicit sample state machine, reused on the server with an in-memory adapter.
- `src/office/cloud-store.js`: authenticated API transport, server-confirmed snapshots, safe retries, and synchronization.
- `src/office/auth-view.js` and `auth-view.css`: private access-code gate and cloud status controls.
- `api/session.js` and `api/workspace.js`: Vercel Function endpoints.
- `server/`: signed sessions, HTTP validation, PostgreSQL transactions, and workspace commands.
- `db/001-workspace.sql`: additive database schema.
- `db/002-runtime.sql`, `server/runtime.js` and `worker/`: durable queue, live event projection, local Codex execution, isolated Git reviews and approved pull requests.
- `src/office/agent-panel.js` and `agent-panel.css`: per-agent chat, task history, and review controls.
- `src/office/workspace-overview.js` and `workspace-overview.css`: office task counts and filtered work queue.
- `src/office/style.css` and `responsive.css`: desktop interface and compact spacing for tablets.
- `index.html`: accessible application shell, initially hidden until authentication.

The choreography exposes `getState()` and `onStateChange` so a later integration can replace simulated activity with events from real workers. Room presence and task execution should remain separate concepts when that integration is added.

## Verification

`npm run build` builds the office. `npm test` runs model, API, cloud transport, and meeting-route checks. `npm run test:office` checks repeated routes against walls and the board, teammate separation, laptop states, and reduced motion. Browser verification also covers private sign-in, chat/task/review flows, cross-browser database persistence, network retry, room focus, character selection, and desktop/tablet viewports.
