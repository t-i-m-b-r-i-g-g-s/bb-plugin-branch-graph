import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { createClosureReviewer } from './closure.js';
import { hostContract, rpcContract, type GraphProject, type GraphThread } from './contract.js';

export default async function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  async function snapshot() {
    const [projects, threads] = await Promise.all([bb.sdk.projects.list(), bb.sdk.threads.list({ limit: 10000 })]);
    const results: GraphProject[] = [];
    const placed = new Set<string>();
    const asThread = (thread: typeof threads[number], scope: GraphThread['scope']): GraphThread => ({
      id: thread.id, title: thread.title ?? thread.titleFallback ?? thread.id,
      status: thread.status, path: thread.environmentPath ?? null, archivedAt: thread.archivedAt ?? null, scope,
    });
    for (const project of projects) {
      if (project.kind !== 'standard') continue;
      for (const source of project.sources) {
        let scan: Omit<GraphProject, 'id' | 'name' | 'root' | 'hostId' | 'threads'>;
        try { scan = await host.call('scan', { root: source.path }, { hostId: source.hostId }); }
        catch { scan = { trees: [], branches: [], error: 'Host unavailable; local inventory is unknown.', hostName: source.hostId, scannedAt: new Date().toISOString(), truncated: false, mergedBranches: null, cachedOriginBranches: null }; }
        const paths = new Set(scan.trees.map(tree => tree.path));
        const related = threads.filter(thread => thread.projectId === project.id && thread.environmentHostId === source.hostId && !!thread.environmentPath && paths.has(thread.environmentPath));
        for (const thread of related) placed.add(thread.id);
        results.push({ id: project.id, name: project.name, root: source.path, hostId: source.hostId, ...scan, threads: related.map(thread => asThread(thread, 'checkout')) });
      }
    }
    const unplacedThreads = threads.filter(thread => !placed.has(thread.id)).map(thread => asThread(thread, thread.projectId === 'proj_personal' ? 'personal' : 'unmatched'));
    return { projects: results, unplacedThreads, generatedAt: new Date().toISOString() };
  }
  bb.rpc.register(rpcContract, {
    graph_closure_review: createClosureReviewer(bb),
    graph_origin: async ({ root, hostId }) => {
      const projects = await bb.sdk.projects.list();
      if (!projects.some(project => project.kind === 'standard' && project.sources.some(source => source.path === root && source.hostId === hostId))) throw new Error('Source is not a registered project checkout.');
      try { return await host.call('origin', { root }, { hostId }); }
      catch { return { status: 'unavailable' as const, checkedAt: new Date().toISOString(), branches: [], error: 'Host unavailable; origin branches are unknown.' }; }
    },
    graph_snapshot: snapshot,
    graph_inspect: async ({ root, path, branch, hostId }) => {
      const projects = await bb.sdk.projects.list();
      if (!projects.some(project => project.kind === 'standard' && project.sources.some(source => source.path === root && source.hostId === hostId))) throw new Error('Source is not a registered project checkout.');
      return host.call('inspect', { root, ...(path ? { path } : {}), ...(branch ? { branch } : {}) }, { hostId });
    },
  });
  bb.cli.register({ name: 'branch-graph', summary: 'Read the local Git worktree graph', commands: [{ name: 'snapshot', summary: 'Print graph snapshot as JSON', usage: 'bb branch-graph snapshot --json' }], async run(argv) {
    if (argv[0] === 'snapshot') return { exitCode: 0, stdout: JSON.stringify(await snapshot()) };
    return { exitCode: 0, stdout: 'Usage: bb branch-graph snapshot --json' };
  } });
}
