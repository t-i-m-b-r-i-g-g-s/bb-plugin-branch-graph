import { JSDOM } from 'jsdom';
import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement });
const { render, fireEvent, waitFor, cleanup } = await import('@testing-library/react');

test('Audit shows scoped evidence, checks origin explicitly and guards closure clicks/errors', async () => {
  const module = await import('../audit-panel.tsx').catch(() => ({}));
  assert.equal(typeof module.AuditPanel, 'function');
  const { AuditPanel } = module;
  const data = { generatedAt: new Date().toISOString(), unplacedThreads: [], projects: [{ id: 'example', name: 'Example repository', hostId: 'example-host', hostName: 'Example host', root: '/example', scannedAt: new Date().toISOString(), truncated: false, error: null, trees: [], branches: ['merged-only'], mergedBranches: ['merged-only'], cachedOriginBranches: ['stale-only'], threads: [] }] };
  let checks = 0, reviews = 0, release: (value: unknown) => void;
  const ui = render(<AuditPanel data={data} onOrigin={async () => { checks++; return { status: 'available', branches: ['remote-only'], checkedAt: new Date().toISOString(), error: null }; }} onInspect={async () => ({ dirty: null, upstream: null, ahead: null, behind: null, lastCommitAt: null, lastCommitSubject: null, mergedIntoMain: true, pr: null, prStatus: 'unavailable', error: null })} onReview={() => { reviews++; return new Promise(resolve => { release = resolve; }); }} />);
  try {
    assert.match(ui.container.textContent!, /Example host/);
    assert.match(ui.container.textContent!, /remote branch is not a remote worktree/);
    assert.equal(checks, 0);
    fireEvent.click(ui.getByRole('button', { name: 'Check origin' }));
    await waitFor(() => assert.equal(checks, 1));
    await waitFor(() => assert.match(ui.container.textContent!, /remote-only/));
    const button = ui.getByRole('button', { name: 'Open closure review thread' });
    fireEvent.click(button); fireEvent.click(button);
    assert.equal(reviews, 1);
    assert.equal((button as HTMLButtonElement).disabled, true);
    release!({ threadId: 'review', reused: false, error: 'Window unavailable' });
    await waitFor(() => assert.match(ui.getByRole('alert').textContent!, /Window unavailable/));
    let revealed = false;
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
    HTMLElement.prototype.scrollIntoView = function () { revealed = this.getAttribute('aria-label') === 'Audit selection evidence'; };
    fireEvent.click(ui.getAllByRole('button', { name: /Inspect merged-only/ })[0]);
    await waitFor(() => assert.match(ui.container.textContent!, /Unpushed commits unknown/));
    assert.equal(revealed, true);
  } finally { cleanup(); }
});
