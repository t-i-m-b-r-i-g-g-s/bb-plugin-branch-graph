Trace the relationship between your registered Git projects and the BB threads working in them, without changing any checkout.

## What you get

- One pannable canvas for repositories, local branches, worktrees, and attached BB threads, with search and focus controls that dim rather than hide the rest.
- A separate group for personal or unmatched BB threads without a registered Git checkout. The graph does not invent repository links or Git branch ancestry.
- Active and archived thread markers, plus branch-only, detached, and prunable review signals. These are prompts to inspect, not instructions to delete.
- On-demand, read-only Git evidence for a selected branch or worktree: working-tree changes, upstream divergence, last commit, and local merge status. A best-effort GitHub PR lookup is available when `gh` is installed and authenticated.
- A separate host-scoped Audit view for present checkouts, local branch-only entries, missing/prunable registrations and on-demand live-origin branch evidence. Cached refs never substitute for a successful origin check, and a remote branch is not a remote worktree.
- An explicit **Open closure review thread** action on review candidates. It creates/reuses a BB investigation thread with the correct project/host, current evidence and unknowns, and a brief requiring a plan and human confirmation before destructive closure. It never requests branch switching, deletion or pruning.

## Requirements and limits

Install Branch Graph separately in BB. It scans registered Git project sources on their BB hosts; no external service is required for the graph itself. GitHub PR lookup needs the optional `gh` CLI and GitHub authentication. Origin checks need the source host's existing Git credentials/network; failures stay unknown. A worktree without a BB thread is not necessarily unused. Refresh requests a new snapshot; the page is not a live agent-activity feed. The plugin never creates, switches, fetches, prunes, or removes branches or worktrees. The review action invokes your configured agent and writes BB thread metadata; its non-destructive brief is an instruction, not a hard sandbox. No closure is authorized by opening a review.
