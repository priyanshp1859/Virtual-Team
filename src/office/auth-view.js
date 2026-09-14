import './auth-view.css';

export function createAuthView({ store }) {
  const gate = document.createElement('main'); gate.className = 'workspace-gate'; gate.dataset.testid = 'workspace-login';
  gate.innerHTML = `<div class="gate-brand"><span class="gate-mark" aria-hidden="true">▤</span> the office<span>.</span></div><section class="gate-card" aria-labelledby="gate-title"><div class="gate-illustration" aria-hidden="true"><span class="gate-window"></span><span class="gate-desk"></span><span class="gate-monitor"></span><span class="gate-plant">✳</span><span class="gate-note">a place for good work.</span></div><div class="gate-content"><span class="gate-eyebrow">YOUR PRIVATE WORKSPACE</span><h1 id="gate-title">Your team.<br>Your space.</h1><p class="gate-intro">A little office for your next big idea. Enter your access code to step inside.</p><form class="gate-form"><label for="workspace-code">Workspace access code</label><input id="workspace-code" name="code" type="password" autocomplete="current-password" required maxlength="256" placeholder="Enter your access code" data-testid="access-code"><button type="submit" data-testid="open-workspace">Open workspace <span aria-hidden="true">↗</span></button></form><p class="gate-status" role="status"></p><p class="gate-error" role="alert" hidden></p><button class="gate-retry" type="button" hidden data-testid="retry-workspace">Retry connection</button><p class="gate-footnote">Private chats and tasks, saved in your workspace.<br>Live agents are not connected yet.</p></div></section><p class="gate-caption">A WORKSPACE WITH A LITTLE LIFE</p>`;
  document.body.append(gate);
  const form = gate.querySelector('form'), input = gate.querySelector('input'), submit = form.querySelector('button');
  const status = gate.querySelector('.gate-status'), error = gate.querySelector('.gate-error'), retry = gate.querySelector('.gate-retry');
  const intro = gate.querySelector('.gate-intro');
  let pending = false, priorAuthenticated = false;
  function render(state = store.getState()) {
    const ready = state.authenticated && state.revision >= 0;
    gate.hidden = ready;
    if (ready) { input.value = ''; error.textContent = ''; error.hidden = true; }
    const checking = pending || state.connectionStatus === 'loading';
    form.hidden = state.authenticated;
    input.disabled = checking; submit.disabled = checking;
    submit.firstChild.textContent = checking ? 'Opening workspace… ' : 'Open workspace ';
    intro.textContent = state.authenticated ? 'Opening your saved chats and tasks.' : 'A little office for your next big idea. Enter your access code to step inside.';
    status.textContent = checking ? state.authenticated ? 'Loading your private workspace…' : 'Checking workspace access…' : '';
    error.textContent = state.persistenceError || (!state.configured ? 'This workspace is still being configured. Please try again shortly.' : '');
    error.hidden = !error.textContent;
    retry.hidden = checking || (!state.persistenceError && state.configured);
    if (priorAuthenticated && !state.authenticated && !checking) input.focus({ preventScroll: true });
    priorAuthenticated = state.authenticated;
  }
  async function run(action) {
    if (pending) return;
    pending = true; render();
    try { await action(); }
    catch (cause) { error.textContent = cause.message || 'The workspace could not open. Please retry.'; error.hidden = false; }
    finally { pending = false; render(); }
  }
  form.addEventListener('submit', event => { event.preventDefault(); if (input.value.trim()) run(() => store.signIn(input.value)); });
  retry.addEventListener('click', () => run(() => store.getState().authenticated ? store.refresh() : store.initialize()));
  const unsubscribe = store.subscribe(render); render();
  return { dispose() { unsubscribe(); gate.remove(); } };
}
