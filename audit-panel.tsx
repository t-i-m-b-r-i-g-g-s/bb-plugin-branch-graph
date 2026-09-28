import React, { useEffect, useRef, useState } from 'react';
import type { ClosureResult, ClosureTarget, GraphInspection, GraphProject, GraphThread, OriginEvidence } from './contract';
import { AUDIT_SAFETY, REMOTE_EXPLANATION, auditRows, isFresh, originState, sourceKey, type AuditRow } from './graph';

type Snapshot = { projects: GraphProject[]; unplacedThreads: GraphThread[]; generatedAt: string };
type InspectTarget = { root: string; hostId: string; path?: string; branch?: string };
type Props = {
  data: Snapshot;
  onOrigin: (target: { root: string; hostId: string }) => Promise<OriginEvidence>;
  onInspect: (target: InspectTarget) => Promise<GraphInspection>;
  onReview: (target: ClosureTarget) => Promise<ClosureResult>;
};
const time = (value: string) => new Date(value).toLocaleString();
const identity = (row: AuditRow) => row.branch ?? `Detached · ${row.tree?.sha}`;
const targetFor = (project: GraphProject, row: AuditRow): ClosureTarget => ({ projectId: project.id, root: project.root, hostId: project.hostId, ...(row.tree ? { path: row.tree.path } : {}), ...(row.branch ? { branch: row.branch } : {}) });

export function AuditPanel({ data, onOrigin, onInspect, onReview }: Props) {
  const [now, setNow] = useState(Date.now());
  const [origins, setOrigins] = useState<Record<string, OriginEvidence>>({});
  const [checking, setChecking] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ project: GraphProject; row: AuditRow } | null>(null);
  const [evidence, setEvidence] = useState<{ value?: GraphInspection; error?: string; at?: string } | null>(null);
  const [reviews, setReviews] = useState<Record<string, { busy: boolean; result?: ClosureResult; error?: string }>>({});
  const originLock = useRef(false), reviewLocks = useRef(new Set<string>());
  const selectionEpoch = useRef(0);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => { if (selected && window.innerWidth <= 1000) panelRef.current?.scrollIntoView({ block: 'start' }); }, [selected]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => { clearInterval(timer); selectionEpoch.current++; }; }, []);
  async function check(project: GraphProject) {
    if (originLock.current) return;
    originLock.current = true;
    const key = sourceKey(project);
    setChecking(key);
    try {
      const value = await onOrigin({ root: project.root, hostId: project.hostId });
      setOrigins(previous => ({ ...previous, [key]: value }));
    } catch {
      setOrigins(previous => ({ ...previous, [key]: { status: 'unavailable', branches: [], checkedAt: new Date().toISOString(), error: 'Origin unavailable; remote branches unknown.' } }));
    } finally { originLock.current = false; setChecking(null); setNow(Date.now()); }
  }
  async function inspect(project: GraphProject, row: AuditRow) {
    const epoch = ++selectionEpoch.current;
    setSelected({ project, row }); setEvidence(null);
    if (row.locality === 'remote-only') { setEvidence({ error: 'No local branch to inspect. Remote worktree and unpushed state unknown.' }); return; }
    try { const value = await onInspect(targetFor(project, row)); if (epoch === selectionEpoch.current) setEvidence({ value, at: new Date().toISOString() }); }
    catch { if (epoch === selectionEpoch.current) setEvidence({ error: 'Inspection unavailable. Dirty, unpushed and PR evidence remain unknown.' }); }
  }
  async function review(project: GraphProject, row: AuditRow) {
    const key = sourceKey(project) + row.id;
    if (reviewLocks.current.has(key)) return;
    reviewLocks.current.add(key); setReviews(previous => ({ ...previous, [key]: { busy: true } }));
    try { const result = await onReview(targetFor(project, row)); setReviews(previous => ({ ...previous, [key]: { busy: false, result } })); }
    catch { setReviews(previous => ({ ...previous, [key]: { busy: false, error: 'Could not open closure review. Refresh the audit and retry; uncertain creation will not be duplicated.' } })); }
    finally { reviewLocks.current.delete(key); }
  }
  function renderRow(project: GraphProject, row: AuditRow, candidate = false) {
    const state = candidate ? reviews[sourceKey(project) + row.id] : undefined;
    return <li key={row.id} className={`bgx-audit-row${candidate ? ' bgx-audit-candidate' : ''}`}>
      <div className="bgx-audit-row-main"><button className="bgx-audit-select" aria-label={`Inspect ${identity(row)}`} onClick={() => inspect(project, row)}><strong>{identity(row)}</strong><small>{row.tree?.path ?? (row.locality === 'remote-only' ? 'origin · no local branch' : 'local branch · no checkout')}</small></button><span className="bgx-audit-kind">{row.locality}</span></div>
      {candidate && <><p className="bgx-audit-reason">{row.reasons.join(' · ')}</p><p className="bgx-audit-caution">{row.cautions.join(' · ')}</p><button className="bgx-action" disabled={!!state?.busy} onClick={() => review(project, row)}>{state?.busy ? 'Opening review…' : 'Open closure review thread'}</button><small className="bgx-audit-review-note">Opens an agent review brief. No cleanup is authorized.</small></>}
      {(state?.error || state?.result?.error) && <p role="alert" className="bgx-audit-warning">{state.error ?? state.result?.error}{state.result?.threadId && ` Thread: ${state.result.threadId}`}</p>}
      {state?.result?.threadId && !state.result.error && <p role="status">{state.result.reused ? 'Reopened' : 'Opened'} review thread · {state.result.threadId}</p>}
    </li>;
  }
  return <section className="bgx-audit" aria-label="Branch locality and closure audit">
    <div className="bgx-audit-intro"><div><span className="bgx-audit-eyebrow">READ-ONLY GIT EVIDENCE</span><h2>Locality & closure review</h2><p>{AUDIT_SAFETY}</p><p>{REMOTE_EXPLANATION}</p></div><small>Snapshot {time(data.generatedAt)}<br />{isFresh(data.generatedAt, now) ? 'Recent snapshot' : 'Stale snapshot — Refresh required'}<br />Origin checks expire after 5 minutes.</small></div>
    <div className={`bgx-audit-body${selected ? ' bgx-audit-has-selection' : ''}`}><div className="bgx-audit-sources">
      {data.projects.map(project => {
        const key = sourceKey(project), origin = origins[key], state = originState(origin, now), fresh = isFresh(project.scannedAt, now);
        const rows = auditRows(project, origin, now), candidates = rows.filter(row => row.reasons.length), remoteRows = rows.filter(row => row.locality === 'remote-only');
        const remoteKnown = state === 'available' && fresh && !project.error && !project.truncated;
        return <section className="bgx-audit-source" key={key}>
          <header><div><h3>{project.name}</h3><p>Host: {project.hostName} <span>· {project.hostId}</span></p><small className="bgx-audit-path">{project.root}</small></div><button className="bgx-action" disabled={checking !== null} onClick={() => check(project)}>{checking === key ? 'Checking origin…' : 'Check origin'}</button></header>
          <p className="bgx-audit-stamp">Local scan {time(project.scannedAt)} · {fresh ? 'recent' : 'stale — Refresh required'} · Origin {state}{origin && ` · checked ${time(origin.checkedAt)}`}</p>
          {project.error && <p className="bgx-audit-warning">{project.error}</p>}{project.truncated && <p className="bgx-audit-warning">Local inventory reached its limit; absence and remote-only classification are unknown.</p>}
          {origin?.error && <p className="bgx-audit-warning">{origin.error}</p>}
          <div className="bgx-audit-metrics"><div><strong>{project.error ? '?' : project.trees.filter(t => t.pathStatus === 'present').length}</strong><span>worktree paths present</span></div><div><strong>{project.error ? '?' : project.branches.length}</strong><span>local without checkout</span></div><div><strong>{remoteKnown ? remoteRows.length : '?'}</strong><span>origin-only branches</span></div><div><strong>{project.error ? '?' : project.trees.filter(t => t.kind === 'prunable').length}</strong><span>missing / prunable</span></div></div>
          <p className="bgx-audit-cache">Cached origin refs: {project.cachedOriginBranches?.length ?? 'unknown'} (bounded). Not live proof. Origin-only compares separate local and remote snapshots, not other hosts.</p>
          <h4>Review candidates <span>{candidates.length}</span></h4>
          <ul className="bgx-audit-rows">{candidates.map(row => renderRow(project, row, true))}</ul>
          {!candidates.length && <p className="bgx-audit-empty">{project.error ? 'Candidates unknown while source is unavailable.' : 'No candidates from these signals. This is not a safety verdict.'}</p>}
          <details><summary>All registered worktrees · {project.trees.length}</summary><ul className="bgx-audit-rows">{rows.filter(row => row.tree).map(row => renderRow(project, row))}</ul></details>
          <details><summary>Local branches without checkout · {project.branches.length}</summary><ul className="bgx-audit-rows">{rows.filter(row => row.locality === 'branch-only').map(row => renderRow(project, row))}</ul></details>
          <details><summary>Origin-only branches · {remoteKnown ? remoteRows.length : 'unknown'}</summary>{remoteKnown ? <ul className="bgx-audit-rows">{remoteRows.map(row => renderRow(project, row))}</ul> : <p>Check origin and refresh stale local evidence to establish absence on this host. Cached refs are never substituted.</p>}</details>
        </section>;
      })}
      <p className="bgx-audit-empty">{data.unplacedThreads.length} BB threads have no matched Git checkout in this snapshot. Their ownership is unresolved, not evidence of abandoned work.</p>
    </div>{selected && <aside ref={panelRef} className="bgx-audit-inspection" aria-label="Audit selection evidence"><button className="bgx-close" aria-label="Close audit details" onClick={() => { selectionEpoch.current++; setSelected(null); }}>×</button><span className="bgx-audit-eyebrow">SELECTION EVIDENCE</span><h3>{identity(selected.row)}</h3><p>Host: {selected.project.hostName}</p><p className="bgx-audit-path">{selected.row.tree?.path ?? selected.project.root}</p><p>{selected.row.reasons.join(' · ')}</p><ul>{selected.row.cautions.map(text => <li key={text}>{text}</li>)}</ul><h4>BB thread association</h4>{selected.row.threads.length ? <ul>{selected.row.threads.map(thread => <li key={thread.id}>{thread.title} · {thread.archivedAt ? 'archived' : thread.status} · {thread.id}</li>)}</ul> : <p>No matching thread in snapshot; ownership unknown.</p>}
      <div className="bgx-evidence"><h4>On-demand Git & PR evidence</h4>{!evidence ? <p>Inspecting…</p> : evidence.error ? <p>{evidence.error}</p> : evidence.value && <><small>Inspected {evidence.at && time(evidence.at)}</small>{evidence.value.error && <p>{evidence.value.error}</p>}<dl><dt>Working tree</dt><dd>{evidence.value.dirty === null ? 'Unknown / no checkout inspected' : evidence.value.dirty ? 'Changed — preserve local work' : 'Clean at inspection time'}</dd><dt>Upstream (cached)</dt><dd>{evidence.value.upstream ?? 'None / unknown'}</dd><dt>Ahead / behind</dt><dd>{evidence.value.ahead === null ? 'Unpushed commits unknown' : `${evidence.value.ahead} / ${evidence.value.behind} vs cached upstream; not live push proof`}</dd><dt>Local main</dt><dd>{evidence.value.mergedIntoMain === null ? 'Unknown' : evidence.value.mergedIntoMain ? 'Contains this tip locally' : 'Does not contain this tip'}</dd><dt>Pull request</dt><dd>{evidence.value.pr ? <a href={evidence.value.pr.url} target="_blank" rel="noopener noreferrer">{evidence.value.pr.state}: {evidence.value.pr.title}</a> : evidence.value.prStatus === 'none' ? 'None found in bounded lookup; not proof of none' : 'Unavailable / unknown'}</dd><dt>Last commit</dt><dd>{evidence.value.lastCommitAt ? time(evidence.value.lastCommitAt) : 'Unknown'}</dd></dl></>}</div><p className="bgx-audit-caution">{AUDIT_SAFETY}</p></aside>}</div>
  </section>;
}
