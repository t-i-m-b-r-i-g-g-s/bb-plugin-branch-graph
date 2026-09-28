import { experimental_defineHostEntry } from '@get-bb/plugin-sdk/host';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, resolve } from 'node:path';
import { statSync } from 'node:fs';
import { hostname } from 'node:os';
import { hostContract, type GraphInspection, type OriginEvidence } from './contract.js';

export async function checkOrigin(root: string): Promise<OriginEvidence> {
  try {
    if (!isAbsolute(root) || resolve(root) !== root || !safeExists(root)) throw new Error('Unavailable checkout');
    const { stdout } = await promisify(execFile)('git', ['--no-optional-locks', '-C', root, 'ls-remote', '--heads', 'origin'], {
      encoding: 'utf8', timeout: 10_000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_SSH_COMMAND: 'ssh -oBatchMode=yes -oConnectTimeout=5' },
    });
    const branches = stdout.split('\n').filter(Boolean).map(line => {
      const match = /^[a-f0-9]{40,64}\trefs\/heads\/(.+)$/.exec(line);
      if (!match) throw new Error('Incomplete origin response');
      return match[1];
    });
    if (branches.length > 10000) throw new Error('Origin inventory exceeds limit');
    return { status: 'available', checkedAt: new Date().toISOString(), branches: [...new Set(branches)].sort(), error: null };
  } catch {
    return { status: 'unavailable', checkedAt: new Date().toISOString(), branches: [], error: 'Origin unavailable (authentication, network, checkout or response limit); remote branches are unknown. Cached refs are not live proof.' };
  }
}

export function parseWorktrees(raw: string, root: string) {
  const separator = raw.includes('\0') ? '\0' : '\n';
  return raw.split(separator + separator).filter(Boolean).map(block => {
    const fields = new Map(block.split(separator).map(line => { const at = line.indexOf(' '); return [at < 0 ? line : line.slice(0, at), at < 0 ? '' : line.slice(at + 1)] as const; }));
    const path = fields.get('worktree') ?? '';
    const branch = fields.get('branch')?.replace(/^refs\/heads\//, '') ?? null;
    const pathStatus = directoryStatus(path);
    const kind = fields.has('prunable') || pathStatus === 'missing' ? 'prunable' as const : path === root ? 'primary' as const : branch === null ? 'detached' as const : 'linked' as const;
    return { path, branch, kind, sha: (fields.get('HEAD') ?? '').slice(0, 8), note: fields.get('prunable') ?? '', pathStatus, locked: fields.has('locked'), detached: fields.has('detached') };
  }).filter(tree => tree.path);
}
function directoryStatus(path: string): 'present' | 'missing' | 'unknown' { try { return statSync(path).isDirectory() ? 'present' : 'missing'; } catch (cause) { return ['ENOENT', 'ENOTDIR'].includes((cause as NodeJS.ErrnoException).code ?? '') ? 'missing' : 'unknown'; } }
function safeExists(path: string): boolean { return directoryStatus(path) === 'present'; }
function run(root: string, ...args: string[]): string { return execFileSync('git', ['--no-optional-locks', '-C', root, ...args], { encoding: 'utf8', timeout: 15_000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
const unavailable = (error: string): GraphInspection => ({ dirty: null, upstream: null, ahead: null, behind: null, lastCommitAt: null, lastCommitSubject: null, mergedIntoMain: null, pr: null, prStatus: 'unavailable', error });
export function inspectCheckout(root: string, path?: string, branch?: string): GraphInspection {
  if (!isAbsolute(root) || resolve(root) !== root || !safeExists(root)) return unavailable('Project checkout is unavailable.');
  const trees = parseWorktrees(run(root, 'worktree', 'list', '--porcelain', '-z'), root);
  const names = run(root, 'for-each-ref', '--format=%(refname:strip=2)', 'refs/heads').split('\n').filter(Boolean);
  if (path && !trees.some(tree => tree.path === path)) return unavailable('Path is not a registered Git worktree.');
  if (branch && !names.includes(branch)) return unavailable('Branch is not a local branch in this repository.');
  if (!path && !branch) return unavailable('Select a branch or worktree to inspect.');
  const selected = path ? trees.find(tree => tree.path === path)! : null;
  if (selected?.kind === 'prunable' || (path && !safeExists(path))) return unavailable('Worktree is prunable or its directory is missing; no checkout was inspected.');
  if (branch && selected && branch !== selected.branch) return unavailable('Branch does not match the selected worktree.');
  const ref = branch ? `refs/heads/${branch}` : 'HEAD';
  const cwd = path ?? root;
  try {
    const dirty = path ? run(cwd, 'status', '--porcelain=v1', '--untracked-files=normal').trim().length > 0 : null;
    const upstream = branch ? run(root, 'for-each-ref', '--format=%(upstream:short)', ref).trim() || null : null;
    let ahead: number | null = null, behind: number | null = null;
    if (upstream) { try { const counts = run(root, 'rev-list', '--left-right', '--count', `${ref}...${upstream}`).trim().split(/\s+/).map(Number); [ahead, behind] = counts; } catch { /* upstream not locally available */ } }
    // HEAD is checkout-local; explicit branch refs remain repository-scoped.
    const [lastCommitAt, lastCommitSubject] = run(branch ? root : cwd, 'log', '-1', '--format=%cI%x00%s', ref).trim().split('\0');
    let mergedIntoMain: boolean | null = null;
    if (branch && names.includes('main')) {
      try { execFileSync('git', ['-C', root, 'merge-base', '--is-ancestor', ref, 'refs/heads/main'], { timeout: 10_000, stdio: 'ignore' }); mergedIntoMain = true; }
      catch (cause) { mergedIntoMain = (cause as { status?: number }).status === 1 ? false : null; }
    }
    let pr: GraphInspection['pr'] = null, prStatus: GraphInspection['prStatus'] = 'unavailable';
    if (branch) {
      try {
        const output = execFileSync('gh', ['pr', 'list', '--state', 'all', '--head', branch, '--json', 'title,state,url,mergedAt', '--limit', '20'], { cwd: root, encoding: 'utf8', timeout: 7000, maxBuffer: 128 * 1024, stdio: ['ignore','pipe','pipe'] });
        const rows = JSON.parse(output) as { title: string; state: string; url: string; mergedAt: string | null }[];
        const match = rows.find(row => row.state === 'OPEN') ?? rows.find(row => row.mergedAt) ?? rows[0];
        if (match) { pr = { title: match.title, state: match.mergedAt ? 'MERGED' : match.state, url: match.url }; prStatus = 'found'; }
        else prStatus = 'none';
      } catch { prStatus = 'unavailable'; }
    }
    return { dirty, upstream, ahead, behind, lastCommitAt: lastCommitAt || null, lastCommitSubject: lastCommitSubject || null, mergedIntoMain, pr, prStatus, error: null };
  } catch (cause) { return unavailable(cause instanceof Error ? cause.message.slice(0, 240) : 'Inspection failed.'); }
}
export default experimental_defineHostEntry({ contract: hostContract, handlers: {
  origin: async ({ root }) => checkOrigin(root),
  scan: async ({ root }) => {
    const empty = { trees: [], branches: [], hostName: hostname(), scannedAt: new Date().toISOString(), truncated: false, mergedBranches: null, cachedOriginBranches: null };
    if (!isAbsolute(root) || resolve(root) !== root || !safeExists(root)) return { ...empty, error: 'Project checkout is unavailable on this host.' };
    try {
      const allTrees = parseWorktrees(run(root, 'worktree', 'list', '--porcelain', '-z'), root);
      const trees = allTrees.slice(0, 1000);
      const occupied = new Set(trees.map(tree => tree.branch).filter(Boolean));
      const allBranches = run(root, 'for-each-ref', '--format=%(refname:strip=2)', 'refs/heads').split('\n').filter(Boolean).filter(branch => !occupied.has(branch));
      let mergedBranches: string[] | null = null, cachedOriginBranches: string[] | null = null;
      try { mergedBranches = run(root, 'for-each-ref', '--merged=refs/heads/main', '--format=%(refname:strip=2)', 'refs/heads').split('\n').filter(Boolean).slice(0, 3000); } catch { /* No local main or unreadable history. */ }
      try { cachedOriginBranches = run(root, 'for-each-ref', '--format=%(refname:strip=3)', 'refs/remotes/origin').split('\n').filter(name => name && name !== 'HEAD').slice(0, 3000); } catch { /* Cached evidence is optional. */ }
      return { ...empty, trees, branches: allBranches.slice(0, 2000), mergedBranches, cachedOriginBranches, truncated: allTrees.length > 1000 || allBranches.length > 2000, error: null };
    } catch { return { ...empty, error: 'Git scan failed; local inventory is unknown.' }; }
  },
  inspect: async ({ root, path, branch }) => inspectCheckout(root, path, branch),
} });
