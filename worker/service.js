import { spawn, execFile } from 'node:child_process';
import { promisify, parseEnv } from 'node:util';
import { readFile, mkdir, open } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanEnvironment } from './codex-client.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(process.env.SAM_ENV_FILE || join(root, '.env.worker.local'));
const settings = parseEnv(await readFile(envFile, 'utf8'));
const stateDir = resolve(settings.SAM_STATE_DIR || join(root, '.sam'));
const command = process.argv[2];
const exec = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let old;
try { old = JSON.parse(await readFile(join(stateDir, 'worker.json'), 'utf8')); } catch { /* First start. */ }
async function running() {
  if (!Number.isInteger(old?.pid) || old.repository !== root || old.envFile !== envFile) return false;
  try {
    const { stdout } = await exec('/bin/ps', ['-p', String(old.pid), '-o', 'command=']);
    return stdout.includes(join(root, 'worker/run.js')) || /\bnode worker\/run\.js\s*$/.test(stdout.trim());
  } catch { return false; }
}
if (command === 'stop') {
  if (!await running()) console.log('Sam worker is already stopped.');
  else {
    process.kill(old.pid, 'SIGTERM');
    for (let i = 0; i < 20 && await running(); i++) await pause(500);
    if (await running()) throw new Error('Sam is still shutting down. Wait before starting it again.');
    console.log('Sam worker stopped. Queued tasks remain saved.');
  }
} else if (command === 'start') {
  if (await running()) console.log('Sam worker is already running.');
  else {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    const log = await open(join(stateDir, 'worker.log'), 'a', 0o600);
    const child = spawn(process.execPath, [join(root, 'worker/run.js')], { cwd: root, detached: true,
      env: { ...cleanEnvironment(), SAM_ENV_FILE: envFile }, stdio: ['ignore', log.fd, log.fd] });
    child.unref(); await log.close();
    console.log('Sam worker launched. The office shows Connected after it reaches the database.');
  }
} else throw new Error('Use npm run worker:start or npm run worker:stop.');
