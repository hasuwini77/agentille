# Factory — backlog, fix rounds, gate, integrate

What turns one `/agt` run into a small software factory: queued work, cheap fix loops, and a merge decision that needs a human only when it should.

## /agt next

- **Queue:** `.agentille/backlog.md` in the repo root, one `- [ ] <task>` per line. It is local state: on first creation add `.agentille/backlog.md` to `.gitignore`.
- `/agt next <task>` appends `- [ ] <task>` and stops: `queued: <task> · <n> open`.
- `/agt next` alone takes the first `- [ ]` line and claims it with ONE Edit to `- [x] <task> → run <id>`. A failed Edit means another session claimed it: re-read and take the next. None left → `backlog empty` and stop.
- Run the item exactly like `/agt <task>` (level detected per item), one card per item.
- An item that escalates or fails becomes `- [!] <task> → run <id>: <one-line reason>` and the loop stops there.
- After a merged item, take the next one. Stop when the backlog is empty, an item escalates, or 5 items ran in this session (start a fresh session for more).

## Fix rounds — resume, don't respawn

The executor already holds the slice in context; a fresh one would re-read the repo.

- **Subagent executor:** keep its agent id. Send the P0/P1 `FIX:` lines with `SendMessage`, starting with the `[agt … mode=fix …]` header: "fix these in the same worktree, commit, re-verify, reply in your output format". Fallback when the agent is gone: a fresh `mode=fix` executor seeded with its checkpoint, branch and the findings.
- **Pane executor:** its pane closed on harvest. Open a fresh pane executor with the branch, its answer file path and the findings.
- At most 2 fix rounds per piece; still blocking → `⚑` on the card, branch kept.

## Early stop — resume once

An executor stopped early when its handoff has no `VERIFICATION:` block, or ends on a question, or its pane went `done` mid-slice. `CONTEXT …` is not an early stop (a successor takes over, `SKILL.md` → "Hard rules"), and `BLOCKED: <need>` is not resumed: it goes on the card as `⚑ <piece> blocked: <need>`.

- Resume once per piece. Its header says `mode=build`, never `mode=fix`: a resume is not a fix round and does not count toward the 2 or the escalation ladder.
- **Subagent executor:** `SendMessage` to the same agent id: "RESUME: finish the slice from your checkpoint and `git log $BASE..HEAD`, keep landed commits, reply in your output format."
- **Pane executor:** `close_pane`, then `spawn_pane` the same role and cwd with the slice, `RESUME:`, the checkpoint path and the answer file path (the same path as a pane fix round).
- A second early stop → `⚑ <piece> stopped early twice`, branch kept.

## Gate — merge or escalate

Runs after review passes (no P0/P1) and every ACCEPTANCE criterion has evidence (a criterion without evidence is a P1). The lead applies it from `git diff --stat`, the diff and the plan's ASSUMPTIONS; no extra agent. **Escalate** (PR or branch left open, `⚑ escalated: <reason>` on the card) when the diff:

- touches auth, sessions, permissions or security rules
- touches payments, pricing, billing or webhooks
- changes deploy, CI, hosting, build scripts or env config
- migrates a schema, sends email or writes production data
- adds or upgrades a dependency
- rests on a product or business assumption (pricing, public copy, free vs paid)

Otherwise **merge**.

## Integrate

`$BASE` is the branch the run started on. Mode, by precedence: repo `.agentille/config.json` `{"integration": …}` → profile `projects[].integration` → profile top-level `integration` → **`pr`**. A repo CLAUDE.md/AGENTS.md saying `no-mistakes` means `pr`; `local-only` means `local`. `auto` (merge and tag with no human step) is never the default: the user turns it on per repo or in the profile.

- **auto, `$BASE` is main/master, GitHub remote + `gh`:** before the first dispatch, `gh issue create` per slice. Each executor gets `branch: feat/<slug>` (`fix/<slug>` for a bugfix) and `issue: <n>`, pushes, and opens a PR into `$BASE` with `Closes #<n>`. After the gate, merge the PRs one at a time in dependency order: `gh pr merge <n> --merge --delete-branch` (never squash). After the last merge, if the repo already has `vX.Y.Z` tags, tag main (feature → minor, fix → patch) and push the tag.
- **auto, `$BASE` is a feature branch:** executors work on throwaway `agt/<slug>` branches; the lead merges each into `$BASE` with `git merge --no-ff`, deletes `agt/<slug>` (never pushed), then pushes `$BASE`.
- **pr** (default): as auto on main, but stop after the PRs: `⚑ PR #n ready`. On a feature branch: as auto, but push each `agt/<slug>` branch and open a PR into `$BASE` instead of merging.
- **push:** push `$BASE` only. **local:** merge into `$BASE` locally, push nothing.

Before each merge, check ownership: `git diff --name-only $BASE...<branch>` stays inside the slice's files from the CONTEXT-PACK; a stray file blocks the merge until it is reverted or explained. A later slice that trails `$BASE` merges `$BASE` first and re-verifies.
