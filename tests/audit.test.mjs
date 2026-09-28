import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import host from '../dist/host.js';
import { experimental_createHostEntryHarness } from '@get-bb/plugin-sdk/testing/host';

export function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'branch-audit-')));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(root, 'file'), 'fixture'); git('add', 'file'); git('commit', '-m', 'fixture');
  return { root, git, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

test('scan records host, freshness, local merge and cached origin evidence without hiding missing paths', async () => {
  const f = fixture(), harness = experimental_createHostEntryHarness(host);
  try {
    f.git('branch', 'merged-only');
    f.git('update-ref', 'refs/remotes/origin/stale-only', 'HEAD');
    f.git('worktree', 'add', '--detach', join(f.root, 'detached'));
    f.git('worktree', 'add', '-b', 'missing', join(f.root, 'missing'));
    rmSync(join(f.root, 'missing'), { recursive: true });
    const result = await harness.experimental_call('scan', { root: f.root });
    assert.equal(result.error, null);
    assert.ok(result.hostName);
    assert.ok(Number.isFinite(Date.parse(result.scannedAt)));
    assert.equal(result.truncated, false);
    assert.deepEqual(result.branches, ['merged-only']);
    assert.ok(result.mergedBranches.includes('merged-only'));
    assert.deepEqual(result.cachedOriginBranches, ['stale-only']);
    assert.equal(result.trees.find(t => t.branch === 'missing').pathStatus, 'missing');
    assert.equal(result.trees.find(t => t.path.endsWith('/detached')).detached, true);
  } finally { await harness.experimental_dispose(); f.dispose(); }
});

test('origin is explicit live evidence, never replaced by stale remote-tracking refs', async () => {
  const f = fixture(), remote = fixture(), harness = experimental_createHostEntryHarness(host);
  try {
    remote.git('branch', 'remote-only');
    f.git('remote', 'add', 'origin', remote.root);
    f.git('update-ref', 'refs/remotes/origin/stale-only', 'HEAD');
    const before = f.git('show-ref');
    const result = await harness.experimental_call('origin', { root: f.root });
    assert.equal(result.status, 'available');
    assert.deepEqual(result.branches, ['main', 'remote-only']);
    assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
    assert.equal(f.git('show-ref'), before);
    f.git('remote', 'set-url', 'origin', join(remote.root, 'does-not-exist'));
    const failed = await harness.experimental_call('origin', { root: f.root });
    assert.equal(failed.status, 'unavailable');
    assert.deepEqual(failed.branches, []);
    assert.match(failed.error, /unknown/i);
    assert.equal(f.git('show-ref'), before);
  } finally { await harness.experimental_dispose(); f.dispose(); remote.dispose(); }
});

test('inspection resolves selected checkout HEAD while explicit branches remain repository-scoped', async () => {
  const f = fixture(), harness = experimental_createHostEntryHarness(host);
  try {
    const path = join(f.root, 'detached');
    f.git('worktree', 'add', '--detach', path);
    const commit = (cwd, subject, date) => execFileSync('git', ['-C', cwd, 'commit', '--allow-empty', '-m', subject], {
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const rootDate = '2025-01-01T12:00:00+00:00', detachedDate = '2025-02-01T12:00:00+00:00';
    commit(f.root, 'ROOT_ONLY_COMMIT', rootDate);
    commit(path, 'DETACHED_ONLY_COMMIT', detachedDate);
    const cases = [
      [{ root: f.root, path: f.root }, 'ROOT_ONLY_COMMIT', rootDate],
      [{ root: f.root, path: f.root, branch: 'main' }, 'ROOT_ONLY_COMMIT', rootDate],
      [{ root: path, branch: 'main' }, 'ROOT_ONLY_COMMIT', rootDate],
      [{ root: f.root, path }, 'DETACHED_ONLY_COMMIT', detachedDate],
    ];
    for (const [input, subject, date] of cases) {
      const result = await harness.experimental_call('inspect', input);
      assert.equal(result.error, null);
      assert.equal(result.lastCommitSubject, subject);
      assert.equal(Date.parse(result.lastCommitAt), Date.parse(date));
    }
  } finally { await harness.experimental_dispose(); f.dispose(); }
});

test('NUL-delimited inventory preserves unusual paths and detached inspection rejects a forged branch', async () => {
  const f = fixture(), harness = experimental_createHostEntryHarness(host);
  try {
    const path = join(f.root, 'detached é\ncheckout');
    f.git('worktree', 'add', '--detach', path);
    const result = await harness.experimental_call('scan', { root: f.root });
    const tree = result.trees.find(t => t.detached);
    assert.equal(tree.path, path);
    assert.equal(tree.pathStatus, 'present');
    const invalid = await harness.experimental_call('inspect', { root: f.root, path, branch: 'main' });
    assert.match(invalid.error, /does not match/);
    const valid = await harness.experimental_call('inspect', { root: f.root, path });
    assert.equal(valid.error, null);
    assert.equal(valid.dirty, false);
  } finally { await harness.experimental_dispose(); f.dispose(); }
});
