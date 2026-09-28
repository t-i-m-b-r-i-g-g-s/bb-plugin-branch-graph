# Branch Graph

A read-only BB navigation page for registered Git project sources, local branches, worktrees, and BB threads. The plugin does **not** switch, prune, remove, or create Git data.

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

## Build and verify

```sh
npm install
npx tsc --noEmit -p tsconfig.json
bb plugin build .
node --test tests/graph.test.mjs
bb plugin install . --yes # initial installation only
bb plugin reload branch-graph --json # after changes
bb branch-graph snapshot --json
```

The CLI snapshot is a JSON representation of the same graph. The page is **Branch Graph** in BB’s sidebar. `bb.skills` is empty; the scaffold example-todos skill is not registered.
