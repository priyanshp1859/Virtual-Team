export const STATUS_LABELS = Object.freeze({ queued: 'Queued', working: 'Working', waiting_for_user: 'Needs your answer', in_review: 'Ready for review', changes_requested: 'Changes requested', completed: 'Completed' });

const clone = value => JSON.parse(JSON.stringify(value));
const empty = () => ({ version: 1, tasks: [], messages: [] });

/** Server-confirmed state only. Failed requests never become local records. */
export function createCloudStore({ fetch: fetcher = globalThis.fetch.bind(globalThis), id = () => crypto.randomUUID(), timeoutMs = 20000 } = {}) {
  let data = empty(), revision = -1, authenticated = false, configured = true;
  let connectionStatus = 'loading', persistenceError = null, disposed = false;
  let queue = Promise.resolve(), sessionEpoch = 0, pendingCount = 0;
  const listeners = new Set(), retries = new Map();
  function getState() { return { ...clone(data), revision, authenticated, configured, connectionStatus, storageKind: 'cloud', storageAvailable: authenticated && revision >= 0, persistenceError }; }
  function emit() { if (!disposed) for (const listener of listeners) listener(getState()); }
  function clearSession(message = null) {
    sessionEpoch++; data = empty(); revision = -1; authenticated = false;
    connectionStatus = message ? 'error' : 'ready'; persistenceError = message; retries.clear(); emit();
  }
  async function request(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(path, { method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(payload?.error || `Request failed (${response.status}). Please try again.`);
        error.status = response.status; error.code = payload?.code;
        throw error;
      }
      if (!payload || typeof payload !== 'object') throw new Error('The server returned an unreadable response. Please retry.');
      return payload;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The server took too long to respond. Your draft is still here; retry to confirm the save.');
      if (error instanceof TypeError) throw new Error('Cannot reach the workspace. Your draft is still here; reconnect and retry.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  function apply(payload, epoch) {
    if (disposed || epoch !== sessionEpoch) return false;
    if (!Number.isSafeInteger(payload.revision) || payload.revision < 0 || payload.state?.version !== 1 || !Array.isArray(payload.state.tasks) || !Array.isArray(payload.state.messages)) throw new Error('The workspace response could not be read safely. Please refresh.');
    if (payload.revision >= revision) { data = clone(payload.state); revision = payload.revision; }
    persistenceError = null; connectionStatus = pendingCount > 0 ? 'saving' : 'ready'; emit(); return true;
  }
  function report(error, epoch) {
    if (disposed || epoch !== sessionEpoch) return;
    if (error.status === 401) {
      clearSession(!authenticated && error.code === 'invalid_access_code'
        ? error.message
        : 'Your session has expired. Enter the access code to reopen your workspace.');
      return;
    }
    persistenceError = error.message; connectionStatus = 'error'; emit();
  }
  async function refresh() {
    if (!authenticated || disposed) return getState();
    const epoch = sessionEpoch;
    if (revision < 0) connectionStatus = 'loading';
    emit();
    try { const payload = await request('/api/workspace'); apply(payload, epoch); return getState(); }
    catch (error) { report(error, epoch); throw error; }
  }
  async function initialize() {
    connectionStatus = 'loading'; persistenceError = null; emit();
    const epoch = sessionEpoch;
    try {
      const session = await request('/api/session');
      if (epoch !== sessionEpoch || disposed) return getState();
      configured = session.configured !== false; authenticated = session.authenticated === true;
      if (authenticated) return await refresh();
      clearSession(); return getState();
    } catch (error) { report(error, epoch); throw error; }
  }
  async function signIn(code) {
    if (typeof code !== 'string' || !code.trim()) throw new Error('Enter your workspace access code.');
    connectionStatus = 'loading'; persistenceError = null; emit();
    const epoch = sessionEpoch;
    try {
      const session = await request('/api/session', { method: 'POST', body: { code } });
      if (disposed || epoch !== sessionEpoch) return getState();
      configured = session.configured !== false; authenticated = session.authenticated === true;
      if (!authenticated) throw new Error('This access code could not open the workspace.');
      return await refresh();
    } catch (error) { report(error, epoch); throw error; }
  }
  async function signOut() {
    if (pendingCount) throw new Error('Wait for the current save to finish before signing out.');
    const epoch = sessionEpoch;
    try { await request('/api/session', { method: 'DELETE' }); clearSession(); }
    catch (error) { report(error, epoch); throw error; }
  }
  function mutate(action, input) {
    if (disposed) return Promise.reject(new Error('This workspace has been closed.'));
    if (!authenticated || revision < 0) return Promise.reject(new Error('Open your workspace before saving changes.'));
    const epoch = sessionEpoch, frozenInput = clone(input), key = JSON.stringify([action, frozenInput]);
    // Keep the same id when a save may have reached the database but its reply
    // was lost. Retrying the original draft cannot create a duplicate record.
    const operationId = retries.get(key) || id(); retries.set(key, operationId);
    pendingCount++; connectionStatus = 'saving'; persistenceError = null; emit();
    const operation = queue.then(async () => {
      try {
        if (disposed || epoch !== sessionEpoch) throw new Error('The workspace session changed. Sign in and try again.');
        const payload = await request('/api/workspace', { method: 'POST', body: { operationId, action, input: frozenInput } });
        if (!apply(payload, epoch)) throw new Error('The workspace session changed while saving. Reopen it to check the result.');
        retries.delete(key); return payload.result;
      } catch (error) {
        if (error.status && error.status < 500 && ![408, 429].includes(error.status)) retries.delete(key);
        report(error, epoch); throw error;
      } finally {
        pendingCount--;
        if (epoch === sessionEpoch && connectionStatus !== 'error') connectionStatus = pendingCount ? 'saving' : 'ready';
        emit();
      }
    });
    queue = operation.catch(() => {}); return operation;
  }
  return {
    getState, initialize, signIn, signOut, refresh,
    createTask: input => mutate('createTask', input), sendMessage: input => mutate('sendMessage', input),
    startSample: (agentId = 'sam') => mutate('startSample', { agentId }),
    advanceSample: taskId => mutate('advanceSample', { taskId }),
    decideReview: (taskId, input) => mutate('decideReview', { taskId, ...input }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { disposed = true; sessionEpoch++; listeners.clear(); retries.clear(); data = empty(); },
  };
}
