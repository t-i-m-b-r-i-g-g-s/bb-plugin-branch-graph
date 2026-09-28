# Branch Graph

A Git-read-only BB navigation page for registered project sources, local branches, worktrees, and BB threads. The plugin does **not** switch, fetch, prune, remove, or create Git data. The explicit closure-review action creates BB thread metadata and starts an investigation, not a cleanup operation.

## Install

```sh
bb plugin install git:https://github.com/t-i-m-b-r-i-g-g-s/bb-plugin-branch-graph.git@^0.1.0
```

BB will show the resolved source and ask for confirmation before running third-party plugin code. The optional GitHub PR lookup requires `gh` and GitHub authentication; the graph itself does not. See [LICENSE](LICENSE) for the MIT license.

## What the graph means

- Solid connections show repository → local branch → checked-out worktree → BB thread whose registered environment path matches that worktree.
- Dashed connections group BB threads without a registered Git checkout. They do **not** imply Git ancestry or repository ownership.
- Branches with no checkout, detached worktrees, and prunable worktrees stay visible. “Review signals” only highlights them; it does not assert they are safe to delete.
- Archived and active BB threads have separate node markers. The status bar counts all listed threads, including archived ones.
- All nodes remain rendered. Search and focus controls dim nonmatches; repository/section buttons pan to their positions. Drag or scroll to pan, Ctrl/Cmd+scroll to zoom, or use the zoom controls.
- The graph scans local branches, not remotes or branch ancestry. Snapshot data updates on **Refresh**, not continuously.

## On-demand evidence

Click a worktree or named branch to inspect it on its registered host. A worktree inspection reports clean/changed status (including untracked files), local upstream ahead/behind where available, last commit, and whether the branch tip is an ancestor of local `main`. A best-effort `gh pr list` lookup reports an open/merged/closed PR or “none found”; authentication, network, repository configuration, or a missing `gh` may make PR status **unavailable**. A local merge indication is not proof of a merged PR. Branch-only nodes cannot report working-tree cleanliness. Prunable/missing worktrees are not inspected.

The server verifies the project source before dispatch; the host independently checks that the requested worktree or branch belongs to the repository. Git and GitHub commands are bounded and read-only. No cleanup operation is exposed.

## Audit view

**Audit** is a separate view in the same public plugin, not a machine-specific script. The graph keeps every node; there is no repository dropdown or repository hiding. Each audit section identifies its registered host, source and local snapshot time, and distinguishes:

- registered worktree directories present on that host;
- local branches without a registered checkout;
- branch names verified on **origin** without a local branch in that source snapshot;
- missing/prunable registrations, with inaccessible paths marked unknown rather than missing.

**Check origin** runs `git ls-remote --heads origin` on that source's host, only on demand. It disables interactive prompts, has a 10-second process timeout and a 2 MiB / 10,000-head bound, and never fetches or prunes. Auth, network, host, parse or limit failures mean **unknown**, not zero branches. Local scans cap at 1,000 worktrees and 2,000 branch-only entries and label truncation. Origin-only classification requires complete, successful local inventory and local/remote evidence no older than five minutes. The timestamps are separate observations, not an atomic repository snapshot.

A remote branch is **not** a remote worktree. Cached remote-tracking refs are **not** live remote proof. The plugin does not discover unregistered hosts, checkouts on other devices, or external owners. Refresh updates local evidence and clears old origin checks.

Review candidates are missing/prunable registrations, detached HEADs, and branch-only tips contained by **local** `main` (excluding `main`/`master` themselves). Each row explains its reason and counterevidence/unknowns. Locked or active work is not labeled disposable. Select a row for dirty, unpushed/upstream, local merge and bounded PR evidence; upstream divergence uses cached refs and is explicitly not live push proof. No single signal establishes safe closure.

### Open closure review thread

Each candidate offers **Open closure review thread**. This is an explicit agent invocation and may consume your configured provider's usage. The server revalidates project/host/source, rescans the candidate, and puts fresh evidence, thread associations, identity and unknowns in the brief. It uses a verified ready environment at the registered source root, or an unmanaged host/path environment with **no branch-switch or worktree-provisioning request**. Missing worktrees are reviewed from that root, never recreated.

The brief requires a read-only investigation of dirty/untracked files, unpushed commits, upstream/PR state and active ownership, then an explicit plan and human confirmation before any destructive closure. The plugin requests `accept-edits`, not full access; the SDK does not offer a read-only spawn permission mode. These are agent instructions, **not a hard read-only sandbox guarantee**. Review the proposed plan yourself; opening the thread grants no cleanup approval.

Repeat clicks share one in-flight request. A persisted target→thread mapping survives reloads; existing reviews reopen without spawning again or sending another prompt. Uncertain spawn results retain a pending marker and show an error rather than retrying blindly. An open failure retains the created thread ID. If creation is uncertain, inspect BB's thread list and reconcile the plugin's `closure:<sha256>` KV entry with the found thread before retrying; do not clear pending markers without checking for an existing thread. No automatic destructive action or closure endpoint exists.

## Build and verify

```sh
npm ci
bb plugin types
npm run verify
bb plugin install . --yes # initial installation only
bb plugin reload branch-graph --json # after changes
bb branch-graph snapshot --json
```

Tests use Node 22.18+ and the current SDK host/server harnesses, temporary Git fixtures, pure classification checks and React DOM interaction tests. Live verification must additionally exercise an actual host snapshot, origin-only and prunable rows, and closure-thread creation/open/reuse.

The CLI snapshot is a JSON representation of the same graph, including host-local audit evidence. The page is **Branch Graph** in BB’s sidebar. `bb.skills` remains empty; the operating notes in `skills/branch-graph/` and the scaffold example are not injected into unrelated agent threads.

Release gate: this feature must ship under a **new immutable semver tag after review and merge**, never by moving `v0.1.0`. The release owner updates the existing marketplace listing's source range to that release. This feature branch does not publish a release or change the marketplace listing.
