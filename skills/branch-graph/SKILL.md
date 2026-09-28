---
name: branch-graph
description: Inspect host-local branch and worktree audit evidence.
version: 0.1.0
author: Tim Briggs (t-i-m-b-r-i-g-g-s), Hermes Agent
license: MIT
platforms: [linux, macos, windows]
---

# Branch Graph operating notes

## When to use

Use for registered Git source locality, worktree associations and read-only closure investigation. Do not treat review candidates as permission to delete. These notes ship in the plugin repository; automatic skill injection is disabled in the manifest.

## Procedure

1. Through the terminal tool, run `bb branch-graph snapshot --json`. Identify the exact project, registered host, source root and scan timestamp. Never substitute the server's own filesystem for a remote host.
2. Open Branch Graph → Audit. Refresh stale local evidence; use **Check origin** for a bounded live `ls-remote` check. Unknown/unavailable is not zero. Cached tracking refs are never live proof; a remote branch is not a remote worktree.
3. Select the row. Read dirty/untracked state, cached upstream divergence, PR evidence, active/archived thread associations, lock status and unknowns. Local `main` ancestry alone does not justify closure.
4. Only when the human requests investigation, use **Open closure review thread**. The action invokes the configured provider and creates/reuses BB thread metadata, not Git data. Inspect the exact project/host and target identity in its brief.
5. Recheck ownership and preserve unresolved evidence. Propose an explicit plan and stop for human confirmation before any destructive closure. Never fetch, switch, prune, delete, archive or stop work as part of the audit itself.

## Pitfalls

- Source snapshots are bounded and non-atomic; unregistered devices and external owners remain unknown.
- A missing directory can be a disconnected volume, not abandoned work. An inaccessible path is unknown, not missing.
- No matching BB thread or PR is not proof of no owner or remote work.
- Closure threads run from the registered source root, not the potentially missing subject checkout. Do not accidentally inspect root `HEAD` as the subject branch.
- Review instructions are not a read-only sandbox. The SDK's `accept-edits` permission still requires the agent to honor the brief.
- Repeated clicks reuse persisted review identity. If spawn is uncertain, reconcile the existing thread before changing its pending KV marker; do not blindly retry or clear it.
- SDK host calls require strict JSON: omit absent optional properties instead of sending explicit `undefined`.
- BB spawn may resolve before environment assignment. Validate project, host and root after bounded readiness polling before opening; retain the thread ID on open failure.

## Verification

Through the terminal tool, run `npm run verify` in the plugin repository. Verify the actual installed build on a live host, including origin-only and prunable rows and create/open/reuse behavior. Keep screenshots private until repository names, paths, host identifiers, branch names and thread content have been removed. Release only a new immutable version after independent review; never retag an existing release.
