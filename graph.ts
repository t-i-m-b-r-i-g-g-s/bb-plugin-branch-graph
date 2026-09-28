import type { GraphProject, GraphThread, GraphTree, OriginEvidence } from './contract';

export type AuditRow = {
  id: string;
  branch?: string;
  tree?: GraphTree;
  locality: 'checkout' | 'missing' | 'path-unknown' | 'branch-only' | 'remote-only';
  reasons: string[];
  cautions: string[];
  threads: GraphThread[];
};
export const sourceKey = (project: Pick<GraphProject, 'id' | 'hostId' | 'root'>) => JSON.stringify([project.id, project.hostId, project.root]);
export const AUDIT_SAFETY = 'Review candidates, not deletion recommendations. No single signal establishes safety. Confirm ownership and obtain explicit human confirmation before any destructive closure.';
export const REMOTE_EXPLANATION = 'A remote branch is not a remote worktree. Cached remote-tracking refs are not live remote proof. Locality applies only to this registered host and source, not every device.';

export function isFresh(timestamp: string, now = Date.now()): boolean {
  const age = now - Date.parse(timestamp);
  return Number.isFinite(age) && age >= -30_000 && age <= 300_000;
}
export function originState(origin?: OriginEvidence, now = Date.now()) {
  return !origin ? 'not-checked' : origin.status === 'unavailable' ? 'unavailable' : isFresh(origin.checkedAt, now) ? 'available' : 'stale';
}

export function auditRows(project: GraphProject, origin?: OriginEvidence, now = Date.now()): AuditRow[] {
  const rows: AuditRow[] = project.trees.map(tree => {
    const threads = project.threads.filter(thread => thread.path === tree.path);
    const reasons = [], cautions = [];
    if (tree.kind === 'prunable') reasons.push('Registered worktree is missing or prunable');
    if (tree.detached) reasons.push('Detached HEAD needs ownership and commit review');
    if (tree.kind === 'primary') cautions.push('Primary checkout; retain unless explicitly planned otherwise');
    if (tree.locked) cautions.push('Locked worktree; ownership must be resolved');
    if (tree.pathStatus !== 'present') cautions.push('Checkout contents unavailable; dirty and unpushed work unknown');
    if (threads.some(thread => !thread.archivedAt && thread.status === 'active')) cautions.push('Active BB thread associated; do not interrupt its work');
    if (threads.some(thread => !thread.archivedAt)) cautions.push('Unarchived BB thread ownership needs confirmation');
    if (!threads.length) cautions.push('No matching BB thread in this snapshot; external ownership unknown');
    cautions.push('Dirty, upstream and PR evidence require selection; other devices remain unknown');
    return { id: `tree:${tree.path}`, branch: tree.branch ?? undefined, tree, threads, reasons, cautions,
      locality: tree.pathStatus === 'missing' ? 'missing' : tree.pathStatus === 'unknown' ? 'path-unknown' : 'checkout' };
  });
  for (const branch of project.branches) {
    const merged = project.mergedBranches?.includes(branch);
    rows.push({ id: `branch:${branch}`, branch, locality: 'branch-only', threads: [],
      reasons: branch !== 'main' && branch !== 'master' && merged ? ['No checkout; branch tip merged into local main'] : [],
      cautions: [merged === undefined ? 'Local main merge evidence unknown' : merged ? 'Local merge is not proof of remote integration or safe closure' : 'Not merged into local main', 'No checkout on this source; working-tree state not applicable, ownership on other devices unknown', 'Unpushed and PR evidence require selection'] });
  }
  if (!project.error && !project.truncated && isFresh(project.scannedAt, now) && origin && originState(origin, now) === 'available') {
    const local = new Set([...project.branches, ...project.trees.map(tree => tree.branch).filter(Boolean)]);
    for (const branch of origin.branches) if (!local.has(branch)) rows.push({ id: `remote:${branch}`, branch, locality: 'remote-only', threads: [], reasons: [], cautions: ['Present on origin at check time, absent from this local branch snapshot', 'Remote worktree, ownership, dirty state and PR status unknown'] });
  }
  return rows;
}
