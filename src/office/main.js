import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ROOMS, AGENTS, AVATAR_AGENTS, DEPARTMENTS } from './config.js';
import { createTeamDirectory } from './team-directory.js';
import { createEnvironment } from './environment.js';
import { createPeople } from './people.js';
import './style.css';
import { createCloudStore, STATUS_LABELS } from './cloud-store.js';
import { createAgentPanel } from './agent-panel.js';
import { createWorkspaceOverview } from './workspace-overview.js';
import { createAuthView } from './auth-view.js';

const $ = (id) => document.getElementById(id);
const icons = {
  office: '<path d="m3 7 9-4 9 4v13H3Z"/><path d="M8 20V10h8v10M10 14h4M10 17h4M3 7l9 4 9-4"/>',
  coding: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16"/>',
  design: '<path d="m4 17 11-11 3 3L7 20H4Zm10-10 3 3M4 4h5M4 4v5m16 6v5h-5"/>',
  review: '<path d="M9 4H5v17h14V4h-4M9 3h6v4H9Zm-1 11 3 3 5-6"/>',
  head: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M8 5V3h8v2M3 11h18M10 11v3h4v-3"/>',
  meeting: '<circle cx="9" cy="6" r="2.5"/><path d="M4 16v-2a5 5 0 0 1 10 0v2m2-12a2.5 2.5 0 0 1 0 5m2 3c2 1 3 2 3 4M3 20h18"/>',
  chill: '<path d="M5 10V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v3M5 10a2 2 0 0 0-3 2v7h20v-7a2 2 0 0 0-3-2v5H5Zm-2 9v2m18-2v2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  home: '<path d="m3 11 9-8 9 8M5 10v11h14V10M9 21v-7h6v7"/>',
  move: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.office}</svg>`;
document.querySelectorAll('[data-icon]').forEach((el) => el.innerHTML = icon(el.dataset.icon));

$('rooms-list').innerHTML = ROOMS.map(room => `<button class="room-nav" data-room="${room.id}" style="--room-color:${room.color}" aria-label="Focus ${room.name}">${icon(room.id)}<span>${room.name}</span><span class="count">${AGENTS.filter(a => a.room === room.id).length.toString().padStart(2, '0')}</span></button>`).join('');
$('team-count').textContent = String(AGENTS.length).padStart(2, '0');
const teamButton = a => `<button class="team-member" data-agent="${a.id}" aria-label="Select ${a.name}, ${a.role}"><span class="person-icon" style="--person-color:${a.color}" aria-hidden="true"></span><span class="person-copy"><span class="person-name">${a.name}</span><span class="person-role">${a.role}</span></span><span class="person-presence disconnected" aria-label="Connection pending"></span></button>`;
$('team-list').innerHTML = DEPARTMENTS.map(department => {
  const members = AGENTS.filter(agent => agent.department === department.id);
  return `<details class="team-department" data-team-department="${department.id}" ${['leadership', 'engineering'].includes(department.id) ? 'open' : ''}><summary>${department.name}<span class="team-department-count">${members.length}</span></summary>${members.map(teamButton).join('')}</details>`;
}).join('');

function updateClock() {
  $('local-time').textContent = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date());
}
updateClock();
setInterval(updateClock, 60_000);

const container = $('office-canvas');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let renderer, controls, people, scene, camera;
let selectedAgent = null, selectedRoom = null, transition = null, autoFocusMeeting = false;
let currentState = { meeting: false, moving: false, agents: [] };
let pointerStart = null, lastFrame = performance.now(), elapsed = 0;
const selectionRing = new THREE.Group();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const homePosition = new THREE.Vector3(33, 35, 40);
const homeTarget = new THREE.Vector3(0, 0, 0);
const roomMap = new Map(ROOMS.map(r => [r.id, r]));
const workspace = createCloudStore();
createAuthView({ store: workspace });
const agentPanel = createAgentPanel({
  mount: $('agent-workspace'),
  store: workspace,
  onClose: clearSelection,
  onSelectAgent: (id, options) => selectAgent(id, false, options),
});
const teamDirectory = createTeamDirectory({ store: workspace, onSelect: id => selectAgent(id, false, { tab: 'profile' }) });
$('team-directory-button').addEventListener('click', () => teamDirectory.open());
createWorkspaceOverview({
  mount: $('work-summary'),
  store: workspace,
  onOpenTask: task => selectAgent(task.agentId, false, {
    taskId: task.id,
    tab: task.review ? 'review' : task.status === 'queued' ? 'tasks' : 'chat',
  }),
  onNewTask: () => selectAgent(selectedAgent || 'sam', false, { tab: 'tasks', newTask: true }),
});
workspace.subscribe(updateTeamTasks);
updateTeamTasks();

const cloudToolbar = document.createElement('div'); cloudToolbar.className = 'cloud-toolbar';
cloudToolbar.innerHTML = '<span class="cloud-save-status" role="status" data-testid="cloud-save-status"></span><button type="button" aria-label="Refresh workspace" title="Refresh workspace" data-testid="refresh-workspace"><span class="cloud-refresh-icon" aria-hidden="true">↻</span></button><button type="button" data-testid="sign-out">Sign out</button>';
document.querySelector('.topbar-right').append(cloudToolbar);
const cloudStatus = cloudToolbar.querySelector('.cloud-save-status');
const refreshButton = cloudToolbar.querySelector('[data-testid="refresh-workspace"]');
const signOutButton = cloudToolbar.querySelector('[data-testid="sign-out"]');
const cloudError = document.createElement('p'); cloudError.className = 'cloud-global-error'; cloudError.hidden = true; cloudError.setAttribute('role', 'alert');
$('work-summary').after(cloudError);
let openedWorkspace = false, initializedScene = false, refreshPending = false;
function showCloudState(state) {
  const ready = state.authenticated && state.revision >= 0;
  $('office-app').hidden = !ready;
  if (ready && !openedWorkspace) {
    openedWorkspace = true;
    if (!initializedScene) { initializedScene = true; init(); }
    else resize();
    selectAgent('sam', false, { focus: false });
  } else if (!ready && openedWorkspace) {
    openedWorkspace = false; teamDirectory.close(); clearSelection(); agentPanel.reset();
  }
  cloudToolbar.hidden = !ready;
  cloudStatus.textContent = { loading: 'Loading…', ready: 'Saved to cloud', saving: 'Saving…', error: 'Sync needs attention' }[state.connectionStatus];
  cloudStatus.dataset.state = state.connectionStatus;
  signOutButton.disabled = state.connectionStatus === 'saving';
  refreshButton.disabled = refreshPending || state.connectionStatus === 'saving';
  cloudError.textContent = state.persistenceError || '';
  cloudError.hidden = !ready || !state.persistenceError;
}
workspace.subscribe(showCloudState); showCloudState(workspace.getState());
async function refreshWorkspace() {
  if (refreshPending || !workspace.getState().authenticated || workspace.getState().connectionStatus === 'saving') return;
  refreshPending = true; refreshButton.disabled = true;
  try { await workspace.refresh(); } catch { /* Store exposes the failed sync without replacing saved data. */ }
  finally { refreshPending = false; showCloudState(workspace.getState()); }
}
refreshButton.addEventListener('click', refreshWorkspace);
signOutButton.addEventListener('click', async () => {
  if (signOutButton.disabled) return;
  signOutButton.disabled = true;
  try { await workspace.signOut(); } catch { /* Error remains visible and the session stays open. */ }
  finally { showCloudState(workspace.getState()); }
});
window.addEventListener('focus', refreshWorkspace);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshWorkspace(); });
// Poll only the visible, signed-in office. No animation loop performs API work.
setInterval(() => { if (!document.hidden && workspace.getState().runtime?.enabled) refreshWorkspace(); }, 3000);

function announce(text) { $('announcement').textContent = text; }

function navigate(target, zoom = 1, position = null) {
  if (!camera || !controls) return;
  const nextTarget = new THREE.Vector3(...target);
  const offset = position ? new THREE.Vector3(...position) : homePosition.clone().sub(homeTarget).add(nextTarget);
  transition = { start: performance.now(), duration: reducedMotion.matches ? 1 : 850, fromTarget: controls.target.clone(), target: nextTarget, fromPosition: camera.position.clone(), position: offset, fromZoom: camera.zoom, zoom };
}

function updateNavigation(roomId) {
  selectedRoom = roomId;
  document.querySelectorAll('[data-room]').forEach(el => {
    const active = el.dataset.room === roomId;
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', String(active));
  });
  $('overview-button').classList.toggle('active', !roomId);
  $('overview-button').setAttribute('aria-pressed', String(!roomId));
  const room = roomMap.get(roomId);
  $('view-kicker').textContent = room ? room.label : 'THE WHOLE PICTURE';
  $('view-title').textContent = room ? room.name : 'The Office';
  if (!room) $('view-title').insertAdjacentHTML('beforeend', '<span>01</span>');
}

function focusRoom(id) {
  const room = roomMap.get(id);
  if (!room) return;
  updateNavigation(id);
  navigate(room.target, 1.85);
  announce(`${room.name} view`);
}

function overview() {
  updateNavigation(null);
  clearSelection();
  navigate([0, 0, 0], 1, homePosition.toArray());
  announce('Office overview');
}

function updateTeamTasks() {
  const { tasks, runtime } = workspace.getState();
  const prototypeNote = document.querySelector('.prototype-note');
  if (prototypeNote) prototypeNote.textContent = runtime?.enabled ? `Sam ${runtime.online ? 'connected' : 'offline'} · 19 profiles ready · meetings are previews.` : 'Office preview · no live agents or microphone.';
  AGENTS.forEach(agent => {
    const button = document.querySelector(`#team-list [data-agent="${agent.id}"]`);
    const assigned = tasks.filter(task => task.agentId === agent.id && task.status !== 'completed');
    const needsAttention = assigned.some(task => ['waiting_for_user', 'in_review', 'changes_requested', 'failed', 'interrupted'].includes(task.status));
    let badge = button.querySelector('.agent-task-count');
    if (!badge) { badge = document.createElement('span'); button.insertBefore(badge, button.querySelector('.person-presence')); }
    badge.className = `agent-task-count${needsAttention ? ' needs-attention' : ''}`;
    badge.textContent = String(assigned.length);
    badge.hidden = !assigned.length;
    badge.setAttribute('aria-label', `${assigned.length} unfinished tasks${needsAttention ? ', needs your attention' : ''}`);
    const latest = assigned.toSorted((a, b) => b.updatedAt - a.updatedAt)[0];
    const presence = button.querySelector('.person-presence');
    const connected = agent.id === 'sam' && runtime?.online;
    const connection = connected ? 'Sam connected' : agent.id === 'sam' && runtime?.enabled ? 'Worker offline' : 'Agent not connected';
    presence.className = `person-presence ${connected ? 'connected' : 'disconnected'}`;
    presence.setAttribute('aria-label', connection);
    button.title = latest ? `${STATUS_LABELS[latest.status]}${latest.isSample ? ' · sample' : ''} · ${connection}` : connection;
  });
}

function selectAgent(id, focus = true, panelOptions = {}) {
  const a = AGENTS.find(a => a.id === id);
  if (!a) return;
  selectedAgent = id;
  document.querySelectorAll('[data-agent]').forEach(el => {
    el.classList.toggle('active', el.dataset.agent === id);
    el.setAttribute('aria-pressed', String(el.dataset.agent === id));
  });
  agentPanel.open(id, panelOptions);
  agentPanel.setPresence(currentState);
  $('office-app').classList.add('workspace-panel-open');
  selectionRing.visible = AVATAR_AGENTS.some(agent => agent.id === id);
  const departmentGroup = document.querySelector(`#team-list [data-agent="${id}"]`)?.closest('details');
  if (departmentGroup) departmentGroup.open = true;
  if (focus) {
    const person = people?.agents.find(p => p.id === id);
    const pos = person?.group.position;
    if (pos) navigate([pos.x, 0, pos.z], 2.05);
    updateNavigation(currentState.agents.find(s => s.id === id)?.room || a.room);
  }
  announce(`${a.name}, ${a.role}, selected`);
}

function clearSelection() {
  selectedAgent = null;
  agentPanel.close();
  $('office-app').classList.remove('workspace-panel-open');
  selectionRing.visible = false;
  document.querySelectorAll('[data-agent]').forEach(el => { el.classList.remove('active'); el.setAttribute('aria-pressed', 'false'); });
}

function onStateChange(state) {
  currentState = state || people?.getState() || currentState;
  const meeting = currentState.meeting;
  const arrived = currentState.agents.filter(a => a.state === 'meeting').length;
  $('meeting-button').classList.toggle('is-meeting', meeting);
  $('meeting-button').disabled = currentState.moving;
  $('meeting-button').querySelector('span:nth-child(2)').textContent = currentState.moving ? (meeting ? 'Gathering…' : 'Heading back…') : meeting ? 'End meeting' : 'Call a meeting';
  $('meeting-button').setAttribute('aria-pressed', String(meeting));
  $('meeting-banner').hidden = !meeting;
  $('meeting-number').textContent = `${arrived} / ${AVATAR_AGENTS.length}`;
  $('meeting-title').textContent = currentState.moving ? 'Let’s get everyone together.' : 'Everyone’s here.';
  $('meeting-description').textContent = currentState.moving ? 'The six seated office avatars are heading to the meeting room.' : currentState.agents.every(a => a.laptopState === 'open') ? 'Laptops open. Ready to think together.' : 'Getting settled and opening laptops.';
  $('world-status').textContent = meeting ? (currentState.moving ? 'A meeting is coming together.' : 'Everyone is ready at the table.') : currentState.moving ? 'Back to a little work. And a little life.' : 'A little work. A little life.';
  $('footer-status').textContent = meeting ? `${arrived} of ${AVATAR_AGENTS.length} office avatars at the table` : currentState.moving ? 'The team is heading back to their spaces' : `${AGENTS.length} agents · ${DEPARTMENTS.length} departments · ${AVATAR_AGENTS.length} office seats`;
  ROOMS.forEach(room => {
    const count = currentState.agents.filter(a => a.room === room.id && a.state !== 'walking').length;
    const el = document.querySelector(`[data-room="${room.id}"] .count`);
    if (el) el.textContent = count.toString().padStart(2, '0');
  });
  if (meeting && !currentState.moving && autoFocusMeeting) { autoFocusMeeting = false; focusRoom('meeting'); announce('Everyone has arrived in the meeting room.'); }
  agentPanel.setPresence(currentState);
}

function resize() {
  if (!renderer) return;
  const width = container.clientWidth, height = container.clientHeight;
  const aspect = width / height;
  const span = Math.max(31.5, 42 / aspect);
  camera.left = -span * aspect / 2; camera.right = span * aspect / 2;
  camera.top = span / 2; camera.bottom = -span / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function hitAt(event) {
  if (!people) return null;
  const rect = container.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const visible = object => {
    for (let node = object; node; node = node.parent) if (!node.visible) return false;
    return true;
  };
  const candidates = people.pickables.filter(visible);
  return raycaster.intersectObjects(candidates, false)[0]?.object.userData || null;
}

function init() {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor('#eae6dd');
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.13;
    container.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#eae6dd');
    camera = new THREE.OrthographicCamera(-22, 22, 16, -16, .1, 150);
    camera.position.copy(homePosition); camera.lookAt(homeTarget);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(homeTarget); controls.enableDamping = true; controls.dampingFactor = .09;
    controls.minPolarAngle = .25; controls.maxPolarAngle = Math.PI * .42;
    controls.minZoom = .65; controls.maxZoom = 3.8; controls.enablePan = true;
    controls.rotateSpeed = .55; controls.zoomSpeed = .7; controls.panSpeed = .7;
    controls.addEventListener('start', () => transition = null);
    scene.add(new THREE.HemisphereLight('#fff8e9', '#b4b09b', 2.1));
    const sun = new THREE.DirectionalLight('#fff3df', 3.5);
    sun.position.set(-16, 27, 14); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 75 });
    sun.shadow.bias = -.0003; sun.shadow.normalBias = .025; sun.shadow.radius = 4;
    scene.add(sun);
    const fill = new THREE.DirectionalLight('#e8edff', .85); fill.position.set(15, 12, -10); scene.add(fill);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(250, 250), new THREE.MeshStandardMaterial({ color: '#eae6dd', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.7; ground.receiveShadow = true; scene.add(ground);
    createEnvironment(scene);
    people = createPeople(scene, { onStateChange });
    const ring = new THREE.Mesh(new THREE.RingGeometry(.53, .6, 48), new THREE.MeshBasicMaterial({ color: '#90a170', transparent: true, opacity: .75, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .1;
    selectionRing.add(ring); selectionRing.visible = false; scene.add(selectionRing);
    resize(); new ResizeObserver(resize).observe(container);
    onStateChange(people.getState());
    $('loading').classList.add('finished');
    setTimeout(() => $('loading').hidden = true, 450);
    renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); $('loading').hidden = false; $('loading').className = 'loading error'; $('loading').textContent = 'The 3D view paused. Reload the page to reopen the office.'; });
    window.__officeDebug = {
      getState: () => people.getState(), getSelected: () => selectedAgent,
      getWorkspaceState: () => workspace.getState(),
      getCamera: () => ({ position: camera.position.toArray(), target: controls.target.toArray(), zoom: camera.zoom }),
      getRenderInfo: () => renderer.info,
      getAgentPositions: () => people.agents.map(a => ({ id: a.id, position: a.group.position.toArray() })),
      project: (position) => { const p = new THREE.Vector3(...position).project(camera); const r = container.getBoundingClientRect(); return { x: r.left + (p.x + 1) * r.width / 2, y: r.top + (1 - p.y) * r.height / 2 }; },
      ready: true,
    };
    requestAnimationFrame(frame);
  } catch (error) {
    console.error('Office could not open:', error);
    $('loading').className = 'loading error';
    $('loading').textContent = 'This office needs WebGL to open. Enable hardware acceleration in your browser and reload the page.';
    $('meeting-button').disabled = true;
    announce('The 3D office could not open.');
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastFrame) / 1000, .05); lastFrame = now;
  if (document.hidden || !openedWorkspace) return;
  elapsed += dt;
  if (transition) {
    const t = Math.min(1, (now - transition.start) / transition.duration);
    const eased = 1 - Math.pow(1 - t, 3);
    camera.position.lerpVectors(transition.fromPosition, transition.position, eased);
    controls.target.lerpVectors(transition.fromTarget, transition.target, eased);
    camera.zoom = THREE.MathUtils.lerp(transition.fromZoom, transition.zoom, eased);
    camera.updateProjectionMatrix();
    if (t === 1) transition = null;
  }
  controls.update(); people.update(dt, elapsed);
  if (selectedAgent) {
    const person = people.agents.find(a => a.id === selectedAgent);
    if (person) { selectionRing.position.x = person.group.position.x; selectionRing.position.z = person.group.position.z; }
  }
  renderer.render(scene, camera);
}

document.querySelectorAll('[data-room]').forEach(el => el.addEventListener('click', () => { clearSelection(); focusRoom(el.dataset.room); }));
document.querySelectorAll('[data-agent]').forEach(el => el.addEventListener('click', () => selectAgent(el.dataset.agent)));
$('overview-button').addEventListener('click', overview);
$('reset-camera').addEventListener('click', overview);
$('zoom-in').addEventListener('click', () => { if (camera) navigate(controls.target.toArray(), Math.min(3.8, camera.zoom * 1.25), camera.position.toArray()); });
$('zoom-out').addEventListener('click', () => { if (camera) navigate(controls.target.toArray(), Math.max(.65, camera.zoom / 1.25), camera.position.toArray()); });
$('meeting-button').addEventListener('click', () => {
  if (!people) return;
  clearSelection();
  if (currentState.meeting) { people.endMeeting(); overview(); announce('Meeting ended. Teammates are returning to their spaces.'); }
  else { autoFocusMeeting = true; overview(); people.callMeeting(); announce('Meeting called. Teammates are gathering.'); }
});
container.addEventListener('pointerdown', event => pointerStart = { x: event.clientX, y: event.clientY });
container.addEventListener('pointerup', event => {
  if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) < 6) {
    const hit = hitAt(event);
    if (hit?.agentId) selectAgent(hit.agentId, false);
    else clearSelection();
  }
  pointerStart = null;
});
container.addEventListener('pointermove', event => {
  if (event.buttons || event.pointerType === 'touch') { $('hover-tag').hidden = true; return; }
  const hit = hitAt(event);
  container.style.cursor = hit ? 'pointer' : 'grab';
  const tag = $('hover-tag'); tag.hidden = !hit;
  if (hit) {
    const a = AGENTS.find(a => a.id === hit.agentId);
    tag.textContent = `${a.name} · ${a.role}`;
    const rect = container.getBoundingClientRect();
    tag.style.left = `${Math.min(event.clientX - rect.left + 14, rect.width - 180)}px`;
    tag.style.top = `${Math.max(10, event.clientY - rect.top - 36)}px`;
  }
});
container.addEventListener('pointerleave', () => $('hover-tag').hidden = true);
document.addEventListener('keydown', event => {
  if (!openedWorkspace) return;
  if (event.defaultPrevented || event.target.matches('input,textarea,select') || event.target.isContentEditable) return;
  if (event.key === 'Escape') clearSelection();
  if (event.key.toLowerCase() === 'o' && !event.metaKey && !event.ctrlKey) overview();
});

workspace.initialize().catch(() => { /* The private gate displays connection errors and a retry action. */ });
