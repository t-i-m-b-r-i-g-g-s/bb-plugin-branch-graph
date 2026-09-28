import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { definePluginApp, useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract, GraphProject, GraphTree, GraphThread, GraphInspection } from './contract';
import './graph.css';

type Snapshot = { projects: GraphProject[]; unplacedThreads: GraphThread[]; generatedAt: string };
type NodeKind = 'repo' | 'branch' | 'tree' | 'thread' | 'workspace';
type InspectTarget = { root: string; hostId: string; path?: string; branch?: string };
type Node = { id: string; kind: NodeKind; title: string; subtitle: string; detail: string; x: number; y: number; width: number; projectId: string; meta?: string; flag?: 'prunable' | 'detached' | 'branch-only' | 'archived' | 'active'; inspect?: InspectTarget };
type Edge = { from: string; to: string; kind: 'git' | 'thread' | 'scope' };
type Section = { id: string; title: string; y: number; height: number; trees: number };
type Layout = { nodes: Node[]; edges: Edge[]; sections: Section[]; width: number; height: number };
type View = { x: number; y: number; scale: number };
type FocusMode = 'all' | 'threads' | 'review' | 'branch-only';
const NODE_H = 66;
const X = { repo: 50, branch: 390, tree: 730, thread: 1070 };
const WIDTH = { repo: 272, branch: 268, tree: 285, thread: 275 };
const projectKey = (p: GraphProject) => p.id + ':' + p.root;
const shortPath = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;
const threadFlag = (thread: GraphThread): Node['flag'] => thread.archivedAt ? 'archived' : thread.status === 'active' ? 'active' : undefined;
const threadSubtitle = (thread: GraphThread) => `${thread.archivedAt ? 'archived' : thread.status} · ${thread.id}`;

export function makeLayout(projects: GraphProject[], unplacedThreads: GraphThread[] = []): Layout {
  const nodes: Node[] = [], edges: Edge[] = [], sections: Section[] = [];
  let y = 60;
  for (const project of projects) {
    const key = projectKey(project), top = y;
    const repoId = `repo:${key}`;
    nodes.push({ id: repoId, kind: 'repo', title: project.name, subtitle: `${project.trees.length} worktrees · ${project.threads.length} BB threads`, detail: project.root, x: X.repo, y: y + 64, width: WIDTH.repo, projectId: key, meta: project.error ?? undefined });
    let cursor = y + 160;
    const branches = new Map<string, GraphTree[]>();
    for (const tree of project.trees) { const branch = tree.branch ?? '(detached HEAD)'; branches.set(branch, [...(branches.get(branch) ?? []), tree]); }
    for (const branch of project.branches) if (!branches.has(branch)) branches.set(branch, []);
    const ordered = [...branches].sort(([a], [b]) => a === 'main' ? -1 : b === 'main' ? 1 : a.localeCompare(b));
    for (const [branch, trees] of ordered) {
      const branchStart = cursor, branchId = `branch:${key}:${branch}`;
      if (!trees.length) cursor += 86;
      for (const tree of trees) {
        const threads = project.threads.filter(t => t.path === tree.path);
        const span = Math.max(84, threads.length * 78);
        const treeY = cursor + (span - NODE_H) / 2;
        const treeId = `tree:${key}:${tree.path}`;
        nodes.push({ id: treeId, kind: 'tree', title: shortPath(tree.path), subtitle: `${tree.kind} · ${tree.sha.slice(0, 9)}${threads.length ? ` · ${threads.length} BB` : ''}`, detail: tree.path, x: X.tree, y: treeY, width: WIDTH.tree, projectId: key, meta: tree.note, flag: tree.kind === 'prunable' ? 'prunable' : tree.kind === 'detached' ? 'detached' : undefined, inspect: { root: project.root, hostId: project.hostId, path: tree.path, branch: tree.branch ?? undefined } });
        edges.push({ from: branchId, to: treeId, kind: 'git' });
        for (const [index, thread] of threads.entries()) {
          const threadId = `thread:${key}:${thread.id}`;
          nodes.push({ id: threadId, kind: 'thread', title: thread.title || thread.id, subtitle: threadSubtitle(thread), detail: thread.path ?? 'No checkout', x: X.thread, y: cursor + index * 78 + 8, width: WIDTH.thread, projectId: key, flag: threadFlag(thread) });
          edges.push({ from: treeId, to: threadId, kind: 'thread' });
        }
        cursor += span;
      }
      const middle = branchStart + (cursor - branchStart - NODE_H) / 2;
      nodes.push({ id: branchId, kind: 'branch', title: branch, subtitle: trees.length ? `${trees.length} checkout${trees.length === 1 ? '' : 's'}` : 'no checkout', detail: branch, x: X.branch, y: middle, width: WIDTH.branch, projectId: key, flag: trees.length ? undefined : 'branch-only', inspect: branch === '(detached HEAD)' ? undefined : { root: project.root, hostId: project.hostId, branch } });
      edges.push({ from: repoId, to: branchId, kind: 'git' });
      cursor += 12;
    }
    y = Math.max(cursor + 76, top + 310);
    sections.push({ id: key, title: project.name, y: top, height: y - top, trees: project.trees.length });
  }
  if (unplacedThreads.length) {
    const top = y, key = 'no-git-checkout', groupId = `workspace:${key}`;
    nodes.push({ id: groupId, kind: 'workspace', title: 'BB threads without Git checkout', subtitle: `${unplacedThreads.length} threads · not attached to repository worktrees`, detail: 'Personal workspaces and unmatched BB environments. This grouping is not a Git relationship.', x: X.repo, y: top + 64, width: WIDTH.repo, projectId: key });
    let cursor = top + 160;
    for (const thread of [...unplacedThreads].sort((a,b) => Number(!!a.archivedAt) - Number(!!b.archivedAt) || Number(b.status === 'active') - Number(a.status === 'active') || a.title.localeCompare(b.title))) {
      const id = `thread:unplaced:${thread.id}`;
      nodes.push({ id, kind: 'thread', title: thread.title, subtitle: `${thread.scope} · ${threadSubtitle(thread)}`, detail: thread.path ?? 'No environment path', x: X.branch, y: cursor, width: WIDTH.branch, projectId: key, flag: threadFlag(thread) });
      edges.push({ from: groupId, to: id, kind: 'scope' });
      cursor += 78;
    }
    y = cursor + 76;
    sections.push({ id: key, title: 'BB threads / no Git checkout', y: top, height: y - top, trees: 0 });
  }
  return { nodes, edges, sections, width: 1400, height: y + 30 };
}

function GraphPage() {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<FocusMode>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<{ id: string; loading: boolean; value?: GraphInspection; error?: string } | null>(null);
  const [view, setView] = useState<View>({ x: 16, y: 16, scale: .72 });
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const refresh = useCallback(() => {
    setBusy(true); setError('');
    rpc.call('graph_snapshot').then(value => { setData(value); setBusy(false); }, cause => { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); });
  }, [rpc]);
  useEffect(() => { refresh(); }, [refresh]);
  const layout = useMemo(() => makeLayout(data?.projects ?? [], data?.unplacedThreads ?? []), [data]);
  const byId = useMemo(() => new Map(layout.nodes.map(node => [node.id, node])), [layout]);
  const selected = selectedId ? byId.get(selectedId) : undefined;
  useEffect(() => {
    if (!selected?.inspect) { setEvidence(null); return; }
    const target = selected.inspect, id = selected.id;
    let cancelled = false;
    setEvidence({ id, loading: true });
    rpc.call('graph_inspect', target).then(value => { if (!cancelled) setEvidence({ id, loading: false, value }); }, cause => { if (!cancelled) setEvidence({ id, loading: false, error: cause instanceof Error ? cause.message : String(cause) }); });
    return () => { cancelled = true; };
  }, [selectedId, selected?.id, rpc]);
  const highlighted = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q && mode === 'all') return null;
    const direct = layout.nodes.filter(n => {
      const matchesText = !q || [n.title, n.subtitle, n.detail, n.meta ?? ''].some(s => s.toLowerCase().includes(q));
      const matchesFocus = mode === 'all' || (mode === 'threads' && n.kind === 'thread') || (mode === 'review' && ['prunable','detached','branch-only'].includes(n.flag ?? '')) || (mode === 'branch-only' && n.flag === 'branch-only');
      return matchesText && matchesFocus;
    });
    const ids = new Set(direct.map(n => n.id));
    const parents = new Map(layout.edges.map(edge => [edge.to, edge.from]));
    for (const id of [...ids]) { let parent = parents.get(id); while (parent) { ids.add(parent); parent = parents.get(parent); } }
    return ids;
  }, [layout, query, mode]);
  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const rect = stageRef.current?.getBoundingClientRect(); if (!rect) return;
    const ax = clientX === undefined ? rect.width / 2 : clientX - rect.left, ay = clientY === undefined ? rect.height / 2 : clientY - rect.top;
    setView(v => { const scale = Math.max(.08, Math.min(1.6, v.scale * factor)); return { scale, x: ax - (ax - v.x) * scale / v.scale, y: ay - (ay - v.y) * scale / v.scale }; });
  }, []);
  const focus = useCallback((section: Section) => {
    const rect = stageRef.current?.getBoundingClientRect(); if (!rect) return;
    const scale = Math.max(.45, Math.min(1, (rect.width - 50) / layout.width));
    setView({ scale, x: 18, y: 22 - section.y * scale });
  }, [layout.width]);
  const fitAll = () => {
    const rect = stageRef.current?.getBoundingClientRect(); if (!rect) return;
    const scale = Math.max(.08, Math.min(1, (rect.width - 44) / layout.width, (rect.height - 44) / layout.height));
    setView({ scale, x: (rect.width - layout.width * scale) / 2, y: (rect.height - layout.height * scale) / 2 });
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => { if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return; drag.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => { if (!drag.current) return; const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y; drag.current.x = event.clientX; drag.current.y = event.clientY; setView(v => ({ ...v, x: v.x + dx, y: v.y + dy })); };
  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => { event.preventDefault(); if (event.ctrlKey || event.metaKey) zoomAt(Math.exp(-event.deltaY * .006), event.clientX, event.clientY); else setView(v => ({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY })); };
  const counts = data ? { projects: data.projects.length, trees: data.projects.reduce((n,p)=>n+p.trees.length,0), branches: data.projects.reduce((n,p)=>n+p.branches.length,0), threads: data.projects.reduce((n,p)=>n+p.threads.length,0) + data.unplacedThreads.length, review: data.projects.reduce((n,p)=>n+p.branches.length+p.trees.filter(t=>t.kind==='detached'||t.kind==='prunable').length,0) } : null;
  return <div className="bgx-page">
    <header className="bgx-toolbar"><div className="bgx-heading"><span className="bgx-logo">⑂</span><div><strong>Branch Graph</strong><small>Repository → branch → worktree → BB thread</small></div></div><div className="bgx-search"><span>⌕</span><input aria-label="Search graph" placeholder="Highlight branch, worktree, thread…" value={query} onChange={event=>setQuery(event.target.value)} />{query && <button aria-label="Clear search" onClick={()=>setQuery('')}>×</button>}</div><button className="bgx-action" onClick={refresh} disabled={busy}>{busy ? 'Scanning…' : '↻ Refresh'}</button></header>
    <nav className="bgx-jumps" aria-label="Jump to graph section"><span>SECTIONS</span>{layout.sections.map(section=><button key={section.id} onClick={()=>focus(section)}>{section.title}<small>{section.id==='no-git-checkout' ? data?.unplacedThreads.length : section.trees}</small></button>)}<span className="bgx-jumps-note">All nodes remain on the canvas</span></nav>
    <div className="bgx-focus" role="group" aria-label="Highlight graph nodes"><span>FOCUS</span>{([['all','All'],['threads','Threads'],['review','Review signals'],['branch-only','Branch-only']] as const).map(([value,label])=><button key={value} aria-pressed={mode===value} onClick={()=>setMode(value)}>{label}{value==='review' && counts ? ` · ${counts.review}` : ''}</button>)}<small>Focus dims nodes; it never removes them.</small></div>
    {error && <div role="alert" className="bgx-error">{error}</div>}
    <div className="bgx-stage" ref={stageRef} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={()=>{ drag.current = null; }} onPointerCancel={()=>{ drag.current = null; }}>
      {!data && !error && <div className="bgx-loading">Scanning registered repositories and BB threads…</div>}
      {data && <div className="bgx-world" style={{ width: layout.width, height: layout.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        {layout.sections.map(section=><div className="bgx-section" key={section.id} style={{ top: section.y, height: section.height }}><div className="bgx-section-label">{section.title.toUpperCase()} <span>{section.id==='no-git-checkout' ? 'NO GIT ASSOCIATION' : `${section.trees} ${section.trees === 1 ? 'WORKTREE' : 'WORKTREES'}`}</span></div></div>)}
        <svg className="bgx-lines" width={layout.width} height={layout.height} aria-hidden="true">{layout.edges.map(edge=>{ const a = byId.get(edge.from), b = byId.get(edge.to); if (!a || !b) return null; const x1=a.x+a.width, y1=a.y+NODE_H/2, x2=b.x, y2=b.y+NODE_H/2, bend=Math.max(70,(x2-x1)*.55); const dim=highlighted && (!highlighted.has(edge.from)||!highlighted.has(edge.to)); return <path key={`${edge.from}>${edge.to}`} className={`bgx-edge bgx-edge-${edge.kind}${dim?' bgx-dim':''}`} d={`M ${x1} ${y1} C ${x1+bend} ${y1}, ${x2-bend} ${y2}, ${x2} ${y2}`} />; })}</svg>
        {layout.nodes.map(node=><button key={node.id} type="button" title={`${node.title}\n${node.detail}`} className={`bgx-node bgx-node-${node.kind}${node.flag?` bgx-flag-${node.flag}`:''}${selectedId===node.id?' bgx-selected':''}${highlighted && !highlighted.has(node.id)?' bgx-dim':''}`} style={{ left: node.x, top: node.y, width: node.width }} onClick={()=>setSelectedId(node.id)}><span className="bgx-node-icon">{node.kind==='repo'?'⌂':node.kind==='workspace'?'◫':node.kind==='branch'?'⑂':node.kind==='tree'?'▣':'◉'}</span><span className="bgx-node-text"><strong>{node.title}</strong><small>{node.subtitle}</small></span>{node.flag && <span className="bgx-node-flag" title={node.flag}>{node.flag==='branch-only'?'○':node.flag==='prunable'?'!':node.flag==='detached'?'◇':node.flag==='active'?'●':'◷'}</span>}<span className="bgx-port" /></button>)}
      </div>}
      {selected && <aside className="bgx-inspector"><button className="bgx-close" aria-label="Close details" onClick={()=>setSelectedId(null)}>×</button><span className={`bgx-inspector-kind bgx-${selected.kind}`}>{selected.kind.toUpperCase()}{selected.flag ? ` · ${selected.flag.toUpperCase()}` : ''}</span><h2>{selected.title}</h2><p>{selected.subtitle}</p><div className="bgx-inspector-detail">{selected.detail}</div>{selected.meta && <small>{selected.meta}</small>}{selected.inspect && <div className="bgx-evidence"><h3>On-demand Git evidence</h3>{evidence?.id!==selected.id || evidence.loading ? <p>Inspecting checkout, history and PR…</p> : evidence.error ? <p>{evidence.error}</p> : evidence.value ? <>{evidence.value.error && <p>{evidence.value.error}</p>}{!evidence.value.error && <><dl><dt>Working tree</dt><dd>{evidence.value.dirty===null?'not applicable':evidence.value.dirty?'Changed (includes untracked)':'Clean'}</dd><dt>Upstream</dt><dd>{evidence.value.upstream ?? 'None'}</dd><dt>Ahead / behind</dt><dd>{evidence.value.ahead===null?'Unavailable':`${evidence.value.ahead} / ${evidence.value.behind}`}</dd><dt>Last commit</dt><dd>{evidence.value.lastCommitAt ? new Date(evidence.value.lastCommitAt).toLocaleString() : 'Unavailable'}</dd><dt>Locally merged into main</dt><dd>{evidence.value.mergedIntoMain===null?'Unavailable':evidence.value.mergedIntoMain?'Yes':'No'}</dd><dt>Pull request</dt><dd>{evidence.value.pr ? <a href={evidence.value.pr.url} target="_blank" rel="noopener noreferrer">{evidence.value.pr.state}: {evidence.value.pr.title}</a> : evidence.value.prStatus==='none'?'None found': 'Unavailable'}</dd></dl>{evidence.value.lastCommitSubject && <small>“{evidence.value.lastCommitSubject}”</small>}</>}</> : null}<small>Read-only, inspected on selection. “No PR found” is not proof of no remote work.</small></div>}</aside>}
      <div className="bgx-legend"><div><i className="bgx-swatch bgx-repo" /> Repository <i className="bgx-swatch bgx-branch" /> Branch <i className="bgx-swatch bgx-tree" /> Worktree <i className="bgx-swatch bgx-thread" /> BB thread <i className="bgx-swatch bgx-workspace" /> No Git checkout</div><small>Solid lines: checkout / thread association. Dashed lines: non-Git grouping. Not Git ancestry. Drag to pan · scroll to pan · ⌘/Ctrl+scroll to zoom.</small></div>
      <div className="bgx-zoom"><button onClick={()=>zoomAt(1.25)} aria-label="Zoom in">+</button><span>{Math.round(view.scale*100)}%</span><button onClick={()=>zoomAt(.8)} aria-label="Zoom out">−</button><button onClick={fitAll} aria-label="Fit whole graph" title="Fit whole graph">◇</button></div>
    </div>
    <div className="bgx-status">{counts ? `${counts.projects} repositories · ${counts.trees} worktrees · ${counts.branches} branch-only · ${counts.threads} BB threads (${data?.unplacedThreads.length} without Git checkout)` : 'Loading graph'}{highlighted && ` · ${highlighted.size} highlighted nodes`}<span>{data ? `Snapshot ${new Date(data.generatedAt).toLocaleString()} · Read only · Local branches only` : ''}</span></div>
  </div>;
}
export default definePluginApp(app => { app.slots.navPanel({ id: 'branch-graph', title: 'Branch Graph', icon: 'GitBranch', path: 'graph', component: GraphPage }); });
