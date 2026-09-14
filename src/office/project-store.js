export function createProjectStore({ fetch: fetcher = globalThis.fetch.bind(globalThis), id = () => crypto.randomUUID(), timeoutMs = 20000, onUnauthorized = () => {} } = {}) {
  let data = { projects: [], runtime: null, revision: -1 }, authenticated = false, epoch = 0, pending = 0, error = null, disposed = false, loading = false, tail = Promise.resolve();
  const listeners = new Set(), retries = new Map();
  const state = () => ({ ...structuredClone(data), authenticated, pending, error, loading });
  const emit = () => { if (!disposed) listeners.forEach(fn => fn(state())); };
  async function request(method, body) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher('/api/projects', { method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      const payload = await response.json();
      if (!response.ok) { const e = new Error(payload.error || 'Project request failed. Please retry.'); e.status = response.status; throw e; }
      if (!Array.isArray(payload.projects) || !Number.isSafeInteger(payload.revision)) throw new Error('The project response could not be read. Please refresh.');
      return payload;
    } catch (e) { if (e.name === 'AbortError') throw new Error('The save took too long. Your draft is retained; retry to confirm it.'); throw e; }
    finally { clearTimeout(timer); }
  }
  function apply(payload, started) { if (disposed || started !== epoch || !authenticated) return false; if (payload.revision >= data.revision) data = { projects: payload.projects, runtime: payload.runtime, revision: payload.revision }; error = null; emit(); return true; }
  function report(e, started) { if (disposed || started !== epoch) return; error = e.message || 'Cannot reach projects. Reconnect and retry.'; if (e.status === 401) { setAuthenticated(false); onUnauthorized(); } emit(); }
  function setAuthenticated(value) { if (value === authenticated) return; epoch++; authenticated = value; data = { projects: [], runtime: null, revision: -1 }; error = null; retries.clear(); emit(); }
  async function refresh() {
    if (!authenticated || disposed || loading) return state();
    const started = epoch; loading = true; emit();
    try { apply(await request('GET'), started); } catch (e) { report(e, started); throw e; } finally { loading = false; emit(); }
    return state();
  }
  function command(action, input) {
    if (!authenticated || disposed) return Promise.reject(new Error('Sign in to use projects.'));
    const started = epoch, copy = structuredClone(input), key = JSON.stringify([action, copy]);
    const operationId = retries.get(key) || id(); retries.set(key, operationId); pending++; error = null; emit();
    const run = tail.then(async () => {
      try {
        if (started !== epoch) throw new Error('The signed-in session changed.');
        const payload = await request('POST', { operationId, action, input: copy });
        if (!apply(payload, started)) throw new Error('The session changed while saving. Sign in and check your projects.');
        retries.delete(key); return payload.result;
      } catch (e) { if (e.status && e.status < 500 && ![408, 429].includes(e.status)) retries.delete(key); report(e, started); throw e; }
      finally { pending--; emit(); }
    }); tail = run.catch(() => {}); return run;
  }
  return { getState: state, setAuthenticated, refresh, command, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, dispose() { disposed = true; epoch++; listeners.clear(); retries.clear(); data = { projects: [], runtime: null, revision: -1 }; } };
}
