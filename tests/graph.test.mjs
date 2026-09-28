import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWorktrees, inspectCheckout } from '../dist/host.js';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = '/tmp/branch-graph-fixture-not-present';
test('parses Git porcelain worktrees and preserves branch association', () => {
  const rows = parseWorktrees(`worktree ${root}\nHEAD abcdef0123456789\nbranch refs/heads/main\n\nworktree /tmp/branch-graph-prunable\nHEAD 1234567890abcdef\nbranch refs/heads/feature/test\nprunable gitdir file points to non-existent location\n\nworktree /tmp/branch-graph-detached\nHEAD deadbeef01234567\ndetached\n`, root);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.branch), ['main', 'feature/test', null]);
  assert.equal(rows[0].sha, 'abcdef01');
  assert.equal(rows[1].kind, 'prunable');
  assert.match(rows[1].note, /non-existent/);
  assert.equal(rows[2].kind, 'prunable'); // missing checkout takes precedence over detached
});

test('empty worktree list stays empty', () => {
  assert.deepEqual(parseWorktrees('', root), []);
});

test('on-demand inspection is read-only, rejects unknown paths and reports local evidence', () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'bb-branch-graph-')));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    writeFileSync(join(repo, 'README.md'), 'fixture\n');
    git('add', 'README.md'); git('commit', '-m', 'fixture');
    const clean = inspectCheckout(repo, repo, 'main');
    assert.equal(clean.error, null);
    assert.equal(clean.dirty, false);
    assert.equal(clean.mergedIntoMain, true);
    assert.match(clean.lastCommitSubject, /fixture/);
    assert.equal(clean.prStatus === 'found', false);
    assert.match(inspectCheckout(repo, '/tmp/unregistered-checkout', 'main').error, /not a registered/);
    assert.match(inspectCheckout(repo, repo, 'not-a-branch').error, /not a local branch/);
    writeFileSync(join(repo, 'untracked.txt'), 'not committed\n');
    assert.equal(inspectCheckout(repo, repo, 'main').dirty, true);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
