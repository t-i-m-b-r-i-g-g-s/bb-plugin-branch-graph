import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import plugin from '../dist/server.js';

const target = { projectId: 'project', hostId: 'host', root: '/fixture', branch: 'merged-only' };
const scan = { trees: [{ path: '/fixture', branch: 'main', kind: 'primary', sha: 'abc', note: '', pathStatus: 'present', locked: false, detached: false }], branches: ['merged-only'], error: null, hostName: 'Example host', scannedAt: new Date().toISOString(), truncated: false, mergedBranches: ['merged-only'], cachedOriginBranches: [] };
const inspection = { dirty: null, upstream: null, ahead: null, behind: null, lastCommitAt: null, lastCommitSubject: null, mergedIntoMain: true, pr: null, prStatus: 'unavailable', error: null };

async function setup({ openFails = false, spawnFails = false, delayedReady = false } = {}) {
  let spawns = [], opens = [], thread, offline = false, reads = 0;
  const { bb, harness } = createFakePluginHost({ pluginId: 'branch-graph', sdk: {
    projects: { list: async () => [{ id: 'project', kind: 'standard', name: 'Example', sources: [{ path: '/fixture', hostId: 'host' }] }] },
    environments: { list: async () => [], get: async () => ({ id: 'env', projectId: 'project', hostId: 'host', path: '/fixture', status: 'ready', lifecycle: { phase: 'active' } }) },
    threads: {
      list: async () => [],
      spawn: async args => { spawns.push(args); if (spawnFails) throw new Error('connection lost'); thread = makeThreadResponse({ id: 'review-thread', projectId: 'project', environmentId: 'env' }); return thread; },
      get: async () => delayedReady && reads++ === 0 ? { ...thread, environmentId: null } : thread,
      open: async args => { opens.push(args); if (openFails) throw new Error('no connected window'); return { ok: true }; },
    },
  }, experimental_callHostRpc: async ({ method }) => { if (offline) throw new Error('Host offline'); return method === 'scan' ? scan : method === 'origin' ? { status: 'unavailable', checkedAt: new Date().toISOString(), branches: [], error: 'offline' } : inspection; } });
  await plugin(bb);
  return { bb, harness, spawns, opens, goOffline: () => { offline = true; } };
}

test('closure review validates source, uses explicit host without Git provisioning, and reuses concurrent clicks', async () => {
  const f = await setup();
  try {
    const results = await Promise.all([f.harness.behavior.callRpc('graph_closure_review', target), f.harness.behavior.callRpc('graph_closure_review', target)]);
    assert.equal(f.spawns.length, 1);
    assert.equal(results[0].threadId, 'review-thread');
    assert.deepEqual(results[0], results[1]);
    const args = f.spawns[0];
    assert.equal(args.projectId, target.projectId);
    assert.deepEqual(args.environment, { type: 'host', hostId: 'host', workspace: { type: 'unmanaged', path: '/fixture' } });
    assert.equal(args.permissionMode, 'accept-edits');
    assert.match(args.prompt, /Do not delete, prune, close, switch, fetch, commit, push/);
    assert.match(args.prompt, /explicit confirmation from the human/);
    assert.match(args.prompt, /dirty|unpushed/);
    assert.match(args.prompt, /ownership/);
    assert.match(args.prompt, /merged-only/);
    assert.match(args.prompt, /unknown/i);
    f.harness = (await f.harness.lifecycle.reload(plugin)).harness;
    await f.harness.behavior.callRpc('graph_closure_review', target);
    assert.equal(f.spawns.length, 1);
    await assert.rejects(f.harness.behavior.callRpc('graph_closure_review', { ...target, hostId: 'other' }), /registered/);
    await assert.rejects(f.harness.behavior.callRpc('graph_closure_review', { ...target, branch: 'invented' }), /candidate/);
    assert.equal(f.spawns.length, 1);
  } finally { await f.harness.lifecycle.dispose(); }
});

test('an open failure preserves the existing review and surfaces an actionable error', async () => {
  const f = await setup({ openFails: true });
  try {
    const result = await f.harness.behavior.callRpc('graph_closure_review', target);
    assert.equal(result.threadId, 'review-thread');
    assert.match(result.error, /could not.*opened/);
    await f.harness.behavior.callRpc('graph_closure_review', target);
    assert.equal(f.spawns.length, 1);
  } finally { await f.harness.lifecycle.dispose(); }
});

test('empty target identifiers cannot bypass the persistent idempotency key', async () => {
  const f = await setup();
  try {
    await f.harness.behavior.callRpc('graph_closure_review', target);
    await assert.rejects(f.harness.behavior.callRpc('graph_closure_review', { ...target, path: '' }));
    assert.equal(f.spawns.length, 1);
  } finally { await f.harness.lifecycle.dispose(); }
});

test('an existing verified review can reopen even when Git evidence is offline', async () => {
  const f = await setup();
  try {
    await f.harness.behavior.callRpc('graph_closure_review', target);
    f.goOffline();
    const result = await f.harness.behavior.callRpc('graph_closure_review', target);
    assert.equal(result.error, null);
    assert.equal(result.reused, true);
    assert.equal(f.spawns.length, 1);
  } finally { await f.harness.lifecycle.dispose(); }
});

test('initial open waits for asynchronous environment assignment without spawning again', async () => {
  const f = await setup({ delayedReady: true });
  try {
    const result = await f.harness.behavior.callRpc('graph_closure_review', target);
    assert.equal(result.error, null);
    assert.equal(f.spawns.length, 1);
    assert.equal(f.opens.length, 1);
  } finally { await f.harness.lifecycle.dispose(); }
});

test('uncertain spawn is not retried across a reload', async () => {
  const f = await setup({ spawnFails: true });
  try {
    assert.match((await f.harness.behavior.callRpc('graph_closure_review', target)).error, /could not be confirmed/);
    f.harness = (await f.harness.lifecycle.reload(plugin)).harness;
    assert.match((await f.harness.behavior.callRpc('graph_closure_review', target)).error, /uncertain/);
    assert.equal(f.spawns.length, 1);
  } finally { await f.harness.lifecycle.dispose(); }
});
