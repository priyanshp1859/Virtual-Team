import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, access, symlink, readFile, writeFile, realpath, lstat, readdir, unlink } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { cleanEnvironment } from './codex-client.js';

const exec = promisify(execFile);
export const REMOTE = 'https://github.com/priyanshp1859/Virtual-Team.git';
export const REPO_NAME = 'priyanshp1859/Virtual-Team';
const gitArgs = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false'];
export async function git(cwd, args, options = {}) {
  const result = await exec('git', [...gitArgs, ...args], { cwd, env: cleanEnvironment(), maxBuffer: 3_000_000, timeout: 60_000, ...options });
  return result.stdout;
}
export function checkoutPath(stateDir, taskId) {
  return join(resolve(stateDir), 'jobs', createHash('sha256').update(taskId || 'sam:general').digest('hex').slice(0, 24), 'repo');
}
async function ignoreWorkerFiles(cwd, repository) {
  await writeFile(join(cwd, '.git', 'info', 'exclude'), '\nnode_modules\ndist/\n.npm-cache/\n.sam-tmp/\n', { flag: 'a' });
  if ((await lstat(join(cwd, 'node_modules')).catch(() => null))?.isSymbolicLink()) {
    if (await realpath(join(cwd, 'node_modules')) !== await realpath(join(repository, 'node_modules'))) throw new Error('The dependency link changed outside this worker.');
    await git(cwd, ['rm', '--cached', '--ignore-unmatch', '--', 'node_modules']);
    await unlink(join(cwd, 'node_modules'));
  }
  await mkdir(join(cwd, 'node_modules'), { recursive: true });
  for (const entry of await readdir(join(repository, 'node_modules'))) {
    if (['.vite-temp', '.vite', '.cache'].includes(entry)) continue;
    const destination = join(cwd, 'node_modules', entry);
    if (!await lstat(destination).catch(() => null)) await symlink(join(repository, 'node_modules', entry), destination);
  }
  await mkdir(join(cwd, 'node_modules', '.vite-temp'), { recursive: true });
}
export async function prepareRepository({ repository, stateDir, run, baseRef = 'origin/main' }) {
  if ((await git(repository, ['remote', 'get-url', 'origin'])).trim().replace(/\.git$/, '') !== REMOTE.replace(/\.git$/, '')) {
    throw new Error('Sam is configured only for the Virtual-Team repository.');
  }
  const cwd = checkoutPath(stateDir, run.taskId);
  await mkdir(join(cwd, '..'), { recursive: true, mode: 0o700 });
  if (run.checkout) {
    if (run.checkout !== cwd || await realpath(cwd) !== cwd) throw new Error('The saved checkout path is invalid.');
    const branch = (await git(cwd, ['branch', '--show-current'])).trim();
    if (branch !== run.branch) throw new Error('The isolated branch changed outside this run.');
    await ignoreWorkerFiles(cwd, repository);
    return { cwd, base: run.base, branch: run.branch };
  }
  try { await access(join(cwd, '.git')); throw new Error('An earlier checkout exists without matching run metadata. It has been preserved for inspection.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (baseRef === 'origin/main') await git(repository, ['fetch', 'origin', 'main']);
  const base = (await git(repository, ['rev-parse', '--verify', `${baseRef}^{commit}`])).trim();
  if (!/^[0-9a-f]{40}$/.test(base)) throw new Error('The repository base could not be verified.');
  await git(repository, ['clone', '--no-hardlinks', '--no-checkout', '--', repository, cwd]);
  const branch = `codex/sam-${createHash('sha256').update(run.taskId || 'general').digest('hex').slice(0, 12)}-${Date.now().toString(36)}`;
  await git(cwd, ['checkout', '-b', branch, base]);
  await git(cwd, ['remote', 'set-url', 'origin', REMOTE]);
  await git(cwd, ['config', 'user.name', 'Sam via Virtual Team']);
  await git(cwd, ['config', 'user.email', 'sam@virtual-team.local']);
  await ignoreWorkerFiles(cwd, repository);
  await mkdir(join(cwd, '.sam-tmp'), { recursive: true });
  return { cwd, base, branch };
}
export async function collectReview(cwd, base) {
  await git(cwd, ['add', '--all']);
  const paths = (await git(cwd, ['diff', '--cached', '--name-only', '-z', base])).split('\0').filter(Boolean);
  if (paths.length > 24) throw new Error('This change has more than 24 files. Split it into smaller reviewable tasks.');
  const files = [];
  for (const path of paths) {
    if (path.length > 260 || /(^|\/)(\.env(?:\.|$)|\.sam|\.vercel|\.git|\.codex|\.agents|credentials|auth\.json)(\/|$|\.)/i.test(path)) throw new Error('The changes contain a private or runtime configuration file. It will not be published.');
    const modes = await git(cwd, ['ls-files', '--stage', '--', path]);
    if (/^120000 /m.test(modes)) throw new Error('Symlink changes cannot be reviewed by this version.');
    let before = '', after = '';
    try { before = await git(cwd, ['show', `${base}:${path}`]); } catch (error) { if (error.code !== 128) throw error; }
    try { after = await git(cwd, ['show', `:${path}`]); } catch (error) { if (error.code !== 128) throw error; }
    if (before.includes('\0') || after.includes('\0') || before.length + after.length > 50_000) throw new Error('A binary or oversized file needs a separate review workflow. No changes were published.');
    if (/(?:postgres(?:ql)?:\/\/[^\s]+:[^\s]+@|sk-(?:proj-)?[A-Za-z0-9_-]{30,}|vt_[A-Za-z0-9_-]{24,})/.test(after)) throw new Error('A possible secret was detected in the code changes. No changes were published.');
    files.push({ path, language: extname(path).slice(1) || 'text', before, after });
  }
  if (JSON.stringify(files).length > 140_000) throw new Error('The diff is too large for this review panel. Split it into smaller tasks.');
  const patch = await git(cwd, ['diff', '--cached', '--binary', '--no-ext-diff', base]);
  const digest = createHash('sha256').update(patch).digest('hex');
  return { files, patch, digest };
}
export async function commitReview(cwd, title) {
  let changed = false;
  try { await git(cwd, ['diff', '--cached', '--quiet']); } catch (error) { if (error.code !== 1) throw error; changed = true; }
  if (changed) await git(cwd, ['commit', '-m', `Sam: ${title.slice(0, 110)}`]);
  return (await git(cwd, ['rev-parse', 'HEAD'])).trim();
}
export async function publishReview({ cwd, run, title, stateDir }) {
  const review = run.review;
  if (review?.decision !== 'approved' || !review.publishable || !/^[0-9a-f]{40}$/.test(review.commit || '')) throw new Error('An exact, approved revision is required before publishing.');
  if ((await git(cwd, ['rev-parse', 'HEAD'])).trim() !== review.commit || (await git(cwd, ['status', '--porcelain'])).trim()) throw new Error('The branch changed after review. It must be reviewed again.');
  const patch = await git(cwd, ['diff', '--binary', '--no-ext-diff', run.base, review.commit]);
  if (createHash('sha256').update(patch).digest('hex') !== review.digest) throw new Error('The reviewed diff no longer matches this branch.');
  await git(cwd, ['push', 'origin', `${review.commit}:refs/heads/${run.branch}`]);
  const env = cleanEnvironment();
  const existing = await exec('gh', ['pr', 'list', '--repo', REPO_NAME, '--head', run.branch, '--state', 'all', '--json', 'url,headRefOid'], { env, cwd, timeout: 60_000 });
  const matches = JSON.parse(existing.stdout);
  if (matches.length) {
    if (matches[0].headRefOid !== review.commit) throw new Error('The existing pull request changed. Check it before continuing.');
    return matches[0].url;
  }
  const bodyFile = join(stateDir, `pr-${review.commit}.md`);
  await writeFile(bodyFile, `${review.summary}\n\nThis exact revision was approved in the private Virtual Team workspace.\n\nValidation:\n${review.checks.map(check => `- ${check.label}: ${check.detail}`).join('\n')}\n\nReady for a final GitHub review and manual merge.\n`, { mode: 0o600 });
  const result = await exec('gh', ['pr', 'create', '--repo', REPO_NAME, '--base', 'main', '--head', run.branch, '--title', title.slice(0, 180), '--body-file', bodyFile], { env, cwd, timeout: 60_000 });
  const url = result.stdout.trim();
  if (!/^https:\/\/github\.com\/priyanshp1859\/Virtual-Team\/pull\/\d+$/.test(url)) throw new Error('GitHub did not return a verifiable pull request URL.');
  return url;
}
