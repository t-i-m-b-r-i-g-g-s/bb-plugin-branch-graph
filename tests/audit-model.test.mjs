import test from 'node:test';
import assert from 'node:assert/strict';
import * as audit from '../graph.ts';

const now = Date.parse('2026-09-28T01:00:00Z');
const project = {
  id: 'project', name: 'Example', root: '/fixture', hostId: 'host', hostName: 'Example host',
  scannedAt: new Date(now).toISOString(), error: null, truncated: false,
  branches: ['merged-only', 'unmerged-only'], mergedBranches: ['main', 'merged-only'], cachedOriginBranches: ['stale-only'],
  trees: [
    { path: '/fixture', branch: 'main', sha: 'abcd', kind: 'primary', pathStatus: 'present', locked: false, detached: false, note: '' },
    { path: '/missing', branch: 'missing', sha: 'abcd', kind: 'prunable', pathStatus: 'missing', locked: false, detached: false, note: 'missing directory' },
    { path: '/detached', branch: null, sha: 'abcd', kind: 'detached', pathStatus: 'present', locked: true, detached: true, note: '' },
  ],
  threads: [{ id: 'thread', path: '/detached', title: 'Example review', status: 'active', archivedAt: null, scope: 'checkout' }],
};

test('classifies host-scoped local, missing and live remote-only rows with review reasons', () => {
  assert.equal(typeof audit.auditRows, 'function');
  const rows = audit.auditRows(project, { status: 'available', branches: ['main', 'remote-only', 'missing'], checkedAt: project.scannedAt, error: null }, now);
  assert.deepEqual(rows.map(r => r.locality), ['checkout', 'missing', 'checkout', 'branch-only', 'branch-only', 'remote-only']);
  assert.equal(rows[0].reasons.length, 0);
  assert.match(rows[1].reasons.join(' '), /missing|prunable/i);
  assert.match(rows[2].reasons.join(' '), /detached/i);
  assert.match(rows[2].cautions.join(' '), /locked/i);
  assert.match(rows[2].cautions.join(' '), /active/i);
  assert.match(rows[3].reasons.join(' '), /merged into local main/i);
  assert.match(rows[4].cautions.join(' '), /not merged/i);
  assert.equal(rows[5].reasons.length, 0);
  assert.ok(!rows.some(r => r.branch === 'stale-only'));
});

test('unavailable, stale or incomplete inventories never infer remote-only absence', () => {
  assert.equal(typeof audit.originState, 'function');
  const good = { status: 'available', branches: ['remote-only'], checkedAt: project.scannedAt, error: null };
  assert.equal(audit.originState(undefined, now), 'not-checked');
  assert.equal(audit.originState({ ...good, status: 'unavailable' }, now), 'unavailable');
  assert.equal(audit.originState(good, now + 300001), 'stale');
  for (const [p, remote, time] of [[project, undefined, now], [project, { ...good, status: 'unavailable' }, now], [project, good, now + 300001], [{ ...project, truncated: true }, good, now], [{ ...project, error: 'offline' }, good, now], [{ ...project, scannedAt: 'invalid' }, good, now]]) {
    assert.equal(audit.auditRows(p, remote, time).filter(r => r.locality === 'remote-only').length, 0);
  }
  assert.match(audit.AUDIT_SAFETY, /not deletion recommendations/);
  assert.match(audit.AUDIT_SAFETY, /explicit human confirmation/);
  assert.match(audit.REMOTE_EXPLANATION, /not a remote worktree/);
  assert.match(audit.REMOTE_EXPLANATION, /not live remote proof/);
  assert.notEqual(audit.sourceKey(project), audit.sourceKey({ ...project, hostId: 'other-host' }));
});
