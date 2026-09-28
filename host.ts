import { experimental_defineHostEntry } from '@get-bb/plugin-sdk/host';
import { execFileSync } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { statSync } from 'node:fs';
import { hostContract, type GraphInspection } from './contract.js';

export function parseWorktrees(raw: string, root: string) {
  return raw.trim().split(/\n\n/).filter(Boolean).map(block => {
    const fields = new Map(block.split('\n').map(line => { const at = line.indexOf(' '); return [at < 0 ? line : line.slice(0, at), at < 0 ? '' : line.slice(at + 1)] as const; }));
    const path = fields.get('worktree') ?? '';
    const branch = fields.get('branch')?.replace(/^refs\/heads\//, '') ?? null;
    const kind = fields.has('prunable') || !safeExists(path) ? 'prunable' as const : path === root ? 'primary' as const : branch === null ? 'detached' as const : 'linked' as const;
    return { path, branch, kind, sha: (fields.get('HEAD') ?? '').slice(0, 8), note: fields.get('prunable') ?? '' };
  }).filter(tree => tree.path);
}
function safeExists(path: string): boolean { try { return statSync(path).isDirectory(); } catch { return false; } }
function run(root: string, ...args: string[]): string { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 15_000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
const unavailable = (error: string): GraphInspection => ({ dirty: null, upstream: null, ahead: null, behind: null, lastCommitAt: null, lastCommitSubject: null, mergedIntoMain: null, pr: null, prStatus: 'unavailable', error });
export function inspectCheckout(root: string, path?: string, branch?: string): GraphInspection {
  if (!isAbsolute(root) || resolve(root) !== root || !safeExists(root)) return unavailable('Project checkout is unavailable.');
  const trees = parseWorktrees(run(root, 'worktree', 'list', '--porcelain'), root);
  const names = run(root, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').filter(Boolean);
  if (path && !trees.some(tree => tree.path === path)) return unavailable('Path is not a registered Git worktree.');
  if (branch && !names.includes(branch)) return unavailable('Branch is not a local branch in this repository.');
  if (!path && !branch) return unavailable('Select a branch or worktree to inspect.');
  const selected = path ? trees.find(tree => tree.path === path)! : null;
  if (selected?.kind === 'prunable' || (path && !safeExists(path))) return unavailable('Worktree is prunable or its directory is missing; no checkout was inspected.');
  if (branch && selected?.branch && branch !== selected.branch) return unavailable('Branch does not match the selected worktree.');
  const ref = branch ? `refs/heads/${branch}` : 'HEAD';
  const cwd = path ?? root;
  try {
    const dirty = path ? run(cwd, 'status', '--porcelain=v1', '--untracked-files=normal').trim().length > 0 : null;
    const upstream = branch ? run(root, 'for-each-ref', '--format=%(upstream:short)', ref).trim() || null : null;
    let ahead: number | null = null, behind: number | null = null;
    if (upstream) { try { const counts = run(root, 'rev-list', '--left-right', '--count', `${ref}...${upstream}`).trim().split(/\s+/).map(Number); [ahead, behind] = counts; } catch { /* upstream not locally available */ } }
    const [lastCommitAt, lastCommitSubject] = run(root, 'log', '-1', '--format=%cI%x00%s', ref).trim().split('\0');
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
  scan: async ({ root }) => {
    if (!isAbsolute(root) || resolve(root) !== root || !safeExists(root)) return { trees: [], branches: [], error: 'Project checkout is unavailable on this host.' };
    try {
      const trees = parseWorktrees(run(root, 'worktree', 'list', '--porcelain'), root).slice(0, 1000);
      const occupied = new Set(trees.map(tree => tree.branch).filter(Boolean));
      const branches = run(root, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').filter(Boolean).filter(branch => !occupied.has(branch)).slice(0, 2000);
      return { trees, branches, error: null };
    } catch (cause) { return { trees: [], branches: [], error: cause instanceof Error ? cause.message.slice(0, 250) : 'Git scan failed.' }; }
  },
  inspect: async ({ root, path, branch }) => inspectCheckout(root, path, branch),
} });
