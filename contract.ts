import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

export const treeSchema = z.object({ path: z.string(), sha: z.string(), branch: z.string().nullable(), kind: z.enum(['primary', 'linked', 'detached', 'prunable']), note: z.string(), pathStatus: z.enum(['present', 'missing', 'unknown']), locked: z.boolean(), detached: z.boolean() });
export const scanSchema = z.object({ trees: z.array(treeSchema), branches: z.array(z.string()), error: z.string().nullable(), hostName: z.string(), scannedAt: z.string(), truncated: z.boolean(), mergedBranches: z.array(z.string()).nullable(), cachedOriginBranches: z.array(z.string()).nullable() });
export const inspectionSchema = z.object({ dirty: z.boolean().nullable(), upstream: z.string().nullable(), ahead: z.number().nullable(), behind: z.number().nullable(), lastCommitAt: z.string().nullable(), lastCommitSubject: z.string().nullable(), mergedIntoMain: z.boolean().nullable(), pr: z.object({ title: z.string(), state: z.string(), url: z.string() }).nullable(), prStatus: z.enum(['found', 'none', 'unavailable']), error: z.string().nullable() });
export const inspectionInput = z.object({ root: z.string().min(1), path: z.string().min(1).optional(), branch: z.string().min(1).optional() });
export const originSchema = z.object({ status: z.enum(['available', 'unavailable']), checkedAt: z.string(), branches: z.array(z.string()), error: z.string().nullable() });
export const closureInput = inspectionInput.extend({ projectId: z.string().min(1), hostId: z.string().min(1) });
export const closureResult = z.object({ threadId: z.string().nullable(), reused: z.boolean(), error: z.string().nullable() });
export const hostContract = defineRpcContract({
  origin: { input: z.object({ root: z.string().min(1) }), output: originSchema },
  scan: { input: z.object({ root: z.string().min(1) }), output: scanSchema },
  inspect: { input: inspectionInput, output: inspectionSchema },
});
export const threadSchema = z.object({ id: z.string(), title: z.string(), status: z.string(), path: z.string().nullable(), archivedAt: z.number().nullable(), scope: z.enum(['checkout', 'personal', 'unmatched']) });
export const projectSchema = scanSchema.extend({ id: z.string(), name: z.string(), root: z.string(), hostId: z.string(), threads: z.array(threadSchema) });
export const rpcContract = defineRpcContract({
  graph_closure_review: { input: closureInput, output: closureResult },
  graph_origin: { input: z.object({ root: z.string().min(1), hostId: z.string().min(1) }), output: originSchema },
  graph_snapshot: { input: z.null(), output: z.object({ projects: z.array(projectSchema), unplacedThreads: z.array(threadSchema), generatedAt: z.string() }) },
  graph_inspect: { input: inspectionInput.extend({ hostId: z.string().min(1) }), output: inspectionSchema },
});
export type GraphProject = z.infer<typeof projectSchema>;
export type GraphTree = z.infer<typeof treeSchema>;
export type GraphThread = z.infer<typeof threadSchema>;
export type GraphInspection = z.infer<typeof inspectionSchema>;
export type OriginEvidence = z.infer<typeof originSchema>;
export type ClosureTarget = z.infer<typeof closureInput>;
export type ClosureResult = z.infer<typeof closureResult>;
