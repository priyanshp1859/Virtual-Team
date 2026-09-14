import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, realpath, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { realpathSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const toml = value => typeof value === 'string' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(toml).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}=${toml(v)}`).join(',')}}` : String(value);

/** No workspace/database credentials are inherited by Codex or its commands. */
export function cleanEnvironment(environment = process.env) {
  const keys = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'SYSTEMROOT', 'CODEX_HOME'];
  return Object.fromEntries(keys.filter(key => environment[key]).map(key => [key, environment[key]]));
}
export async function clientConfiguration(cwd, dependencyRoot, { readonly = false, skillRoots = [] } = {}) {
  const nodeRoot = dirname(dirname(await realpath(process.execPath)));
  const gitBinary = process.platform === 'darwin' ? (await promisify(execFile)('/usr/bin/xcrun', ['--find', 'git'])).stdout.trim() : '/usr/bin/git';
  const gitRuntime = dirname(dirname(await realpath(gitBinary)));
  let codexPath = process.env.SAM_CODEX_BIN;
  if (!codexPath) for (const directory of (process.env.PATH || '').split(':')) {
    try { await access(join(directory, 'codex')); codexPath = join(directory, 'codex'); break; } catch { /* Next executable directory. */ }
  }
  if (!codexPath) throw new Error('The Codex executable was not found.');
  const codexRuntime = dirname(dirname(await realpath(codexPath)));
  const configPath = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml');
  let source = '';
  try { source = await readFile(configPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const overrides = {
    'default_permissions': 'sam',
    'mcp_servers': {}, 'features.apps': false, 'features.plugins': false, 'features.multi_agent': false, 'features.memories': false,
    'features.codex_hooks': false, 'web_search': 'disabled', 'shell_environment_policy.inherit': 'none',
    'shell_environment_policy.set': { PATH: `${dirname(process.execPath)}:${dirname(gitBinary)}:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin`, LANG: 'en_US.UTF-8', npm_config_cache: join(cwd, '.npm-cache') },
    'permissions.sam': {
      description: 'Virtual-Team only. No network or access to other project files.', extends: readonly ? ':read-only' : ':workspace',
      filesystem: { ':root': 'deny', ':minimal': 'read', ':tmpdir': 'deny', ':slash_tmp': 'deny',
        [cwd]: readonly ? 'read' : 'write', [join(cwd, '.git')]: 'read', [join(cwd, '.codex')]: 'deny',
        [join(cwd, '.agents')]: 'deny', ...Object.fromEntries(skillRoots.map(root => [root, 'read'])), [dependencyRoot]: 'read', [nodeRoot]: 'read', [gitRuntime]: 'read', [dirname(codexPath)]: 'read', [codexRuntime]: 'read', '/System/Library/OpenSSL': 'read' }, network: { enabled: false },
    },
  };
  for (const match of source.matchAll(/^\[(mcp_servers\.([A-Za-z0-9_-]+)|plugins\."[^"]+")\]\s*$/gm)) {
    if (match[1].startsWith('plugins.')) overrides[`${match[1]}.enabled`] = false;
  }
  return Object.entries(overrides).flatMap(([key, value]) => ['-c', `${key}=${toml(value)}`]);
}

export class CodexClient {
  constructor({ cwd, args = [], binary = process.env.SAM_CODEX_BIN || 'codex', onEvent = () => {}, onRequest = async () => { throw new Error('Unsupported request'); } }) {
    this.pending = new Map(); this.counter = 0; this.onEvent = onEvent; this.onRequest = onRequest; this.closed = false;
    const executable = binary.includes('/') ? realpathSync(binary) : (process.env.PATH || '').split(':').map(directory => join(directory, binary)).filter(existsSync).map(path => realpathSync(path))[0] || binary;
    this.process = spawn(executable, ['app-server', '--stdio', ...args], { cwd, env: cleanEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] });
    // Account and tool details never enter application logs. Safe errors go to the UI.
    this.startupError = '';
    this.process.stderr.on('data', data => { this.startupError = (this.startupError + data.toString()).slice(-4000); });
    this.process.on('error', () => this.fail(new Error('Codex could not start. Check the local installation.')));
    this.process.on('exit', () => this.fail(new Error('The Codex worker connection closed.')));
    this.lines = createInterface({ input: this.process.stdout });
    this.lines.on('line', line => {
      if (line.length > 4_000_000) return this.fail(new Error('Codex returned an oversized event.'));
      let message; try { message = JSON.parse(line); } catch { return; }
      if (message.id !== undefined && message.method) {
        Promise.resolve(this.onRequest(message)).then(result => this.send({ id: message.id, result }),
          () => this.send({ id: message.id, error: { code: -32603, message: 'This request was not approved or could not be completed.' } }));
      } else if (message.id !== undefined) {
        const request = this.pending.get(message.id); if (!request) return;
        this.pending.delete(message.id); clearTimeout(request.timer);
        if (message.error) request.reject(new Error(`Codex ${request.method} failed: ${String(message.error.message).slice(0, 500)}`));
        else request.resolve(message.result);
      } else if (message.method) this.onEvent(message);
    });
  }
  send(message) { if (!this.closed && this.process.stdin.writable) this.process.stdin.write(`${JSON.stringify(message)}\n`); }
  request(method, params = {}, timeout = 60_000) {
    if (this.closed) return Promise.reject(new Error('Codex is disconnected.'));
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} timed out.`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer, method }); this.send({ id, method, params });
    });
  }
  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'virtual_team', title: 'Virtual Team', version: '0.2.0' }, capabilities: { experimentalApi: true } });
    this.send({ method: 'initialized', params: {} });
    const auth = await this.request('account/read', { refreshToken: false });
    if (!auth.account) throw new Error('Sign in with codex login on this computer before starting Sam.');
    return auth.account.type;
  }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear(); this.onEvent({ method: 'worker/disconnected', params: { error: error.message } });
  }
  close() { this.fail(new Error('Codex stopped.')); this.lines.close(); this.process.kill('SIGTERM'); }
}
