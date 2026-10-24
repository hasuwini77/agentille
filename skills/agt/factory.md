# Factory — backlog, worktrees, fix rounds, gate, integrate

What turns one `/agt` run into a small software factory: queued work, cheap fix loops, and a merge decision that needs a human only when it should.

## /agt next

- **Queue:** `.agentille/backlog.md` in the repo root, one `- [ ] <task>` per line. It is local state: on first creation add `.agentille/backlog.md` to `.gitignore`.
- `/agt next <task>` appends `- [ ] <task>` and stops: `queued: <task> · <n> open`.
- `/agt next` alone takes the first `- [ ]` line and claims it with ONE Edit to `- [x] <task> → run <id>`. A failed Edit means another session claimed it: re-read and take the next. None left → `backlog empty` and stop.
- Run the item exactly like `/agt <task>` (level detected per item), one card per item.
- An item that escalates or fails becomes `- [!] <task> → run <id>: <one-line reason>` and the loop stops there.
- After a merged item, take the next one. Stop when the backlog is empty, an item escalates, or 5 items ran in this session (start a fresh session for more).

## Worktree lifecycle

One slice, one sibling worktree `../<project>-<slug>` on its slice branch, from first build to the gate's decision. This is the one definition: `routing.md` and `panes-mode.md` point here, and the executor carries the facts it needs in its own file.

- **Who creates it.** Subagent mode: the executor (`isolated: true`), with the script below. Panes mode: the lead, before `spawn_pane` (its `cwd` must already exist), with the same script run from the main checkout; the pane executor then gets `isolated: false` and works in the tree it was started in.
- **It stays** through every build, resume, fix round and design review of the slice, until the gate decides: merged, PR left ready (`pr`), branch pushed (`push`), or escalated.
- **The executor never removes it.** On every exit it deletes only its `.env*` copies (`git clean -fqX -- '.env*'`, the executor's step 8), then reports the path and branch.
- **The lead removes it** once the gate has decided, or when it abandons the slice: `git -C <path> status --porcelain` empty (commit or flag anything left), then `git worktree remove --force <path>` (`herdr worktree remove --workspace <id> --force` for a Herdr-made one). The branch stays, so a later round re-attaches from it.
  The mod's run-end tidy and `/agt-clean` also remove merged, clean `agt/*` worktrees; `feat/` and `fix/` ones are the lead's to remove. At a run's end the mod also deletes the ignored `.env*` copies in every tree the run recorded (each one the script printed), whatever its branch.
- **Re-attach, never re-create.** A fix round, a resume or a design-reviewer dev server reuses the slice's tree: the directory if it exists, else the branch, else a fresh branch. One script does all of it: `scripts/agt-worktree.sh` at the plugin root, two levels above this skill's base directory (where `display.md` reads the version).
  Write its absolute path out (this file is read, not loaded, so no variable names it for you) and run it from the main checkout or any of its worktrees. The executor runs its own plugin copy; `worktree_script: <that path>` in a dispatch overrides it:

```bash
bash <plugin root>/scripts/agt-worktree.sh <kebab-slice> --base <the run's $BASE> --branch <slice branch>
```

It prunes stale trees, re-attaches or creates `../<project>-<slug>`, copies the main checkout's `.env*` files that git ignores in the tree, and copies `node_modules` copy-on-write where the filesystem has it, else plainly (never a symlink or hardlink).
It prints exactly two lines, `path=<absolute path>` and `branch=<name>`, and refuses (nonzero exit, nothing printed) a slug that is not kebab-case, a directory there that is not a worktree of this repo, or a tree on another branch. The mod records the printed tree as the run's own, so the run-end sweep reaches it.
Every later command names that printed path written out (`cd <path> && …`, `git -C <path> …`): the guard refuses a variable it cannot expand. Being a script, it never moves the caller's shell, so the lead stays in the main checkout. Leave `--base` out only on a slice's first build, where the checked-out branch is the base; on a fix round or resume pass the same `--base` and `--branch` again.

## Fix rounds — resume, don't respawn

The executor already holds the slice in context; a fresh one would re-read the repo.

- **Subagent executor:** keep its agent id. Send the P0/P1 `FIX:` lines with `SendMessage`, starting with the `[agt … mode=fix …]` header: "fix these in the slice's worktree, commit, re-verify, reply in your output format".
  Fallback when the agent is gone: a fresh `mode=fix` executor (`isolated: true`) seeded with its checkpoint, `branch:`, `base:` and the findings; it re-attaches ("Worktree lifecycle").
- **Pane executor:** its pane closed on harvest. Open a fresh pane executor (`isolated: false`) with `cwd` = the slice's worktree (re-attach it first if it is gone), the branch, its answer file path and the findings.
- **One definition.** A fix attempt is one `mode=fix` executor dispatch for a slice: a `SendMessage` round or a fresh fix executor. It is counted per `slice=`. A solo run counts its own review-fix rounds the same way. Retries inside one dispatch (the three-miss stop of the executor and of solo), a resume and a `mode=diagnose` planner are not attempts.
- **Limit: 2 per slice.** Still blocking after the 2nd → a bugfix or debug slice gets one `mode=diagnose` planner (read-only root cause) and a 3rd attempt that implements it. Any other slice, or a failed 3rd, → `⚑` on the card, branch kept. The effort ladder reads this same counter (`routing.md` → "Escalation ladder").
- **`STUCK:` takes the diagnose path, on any slice.** An executor whose first line is `STUCK: <assumption or check>` is never resumed with a plain `RESUME:`. Send the slice, that line and the executor's body to one `mode=diagnose` planner. Then send one `mode=fix` dispatch that implements its root cause; it counts as an attempt.
  One diagnose per slice, whichever asks first. A second `STUCK:`, or a `STUCK:` after the diagnose is spent, → `⚑ <slice> stuck: <line>` on the card, branch kept. This path may take any slice to a 3rd attempt. Once a slice's diagnose is spent, the 2-attempt limit above ends in `⚑`, whatever the slice's category.

## Early stop — resume once

An executor stopped early when its handoff has no `VERIFICATION:` block and no stop line, or ends on a question, or its pane went `done` mid-slice. A stop line is not an early stop and is never resumed:

- `CONTEXT …` gets a successor (`SKILL.md` → "Hard rules").
- `BLOCKED: <need>` goes on the card as `⚑ <slice> blocked: <need>`.
- `STUCK: <assumption or check>` goes to the diagnose planner ("Fix rounds" above).
- `CONTRACT: <what and why>` goes on the card as `⚑ <slice> contract: <what>`, branch kept, since the contract is frozen (`formations.md` → "relay — contract first, then parallel").

For an early stop:

- Resume once per slice. Its header says `mode=build`, never `mode=fix`: a resume is not a fix round and does not count toward the 2 or the escalation ladder.
- **Subagent executor:** `SendMessage` to the same agent id: "RESUME: finish the slice from your checkpoint and `git log $BASE..HEAD`, keep landed commits, reply in your output format."
- **Pane executor:** `close_pane`, then `spawn_pane` the same role and cwd (the slice's worktree, `isolated: false`) with the slice, `RESUME:`, the checkpoint path and the answer file path (the same path as a pane fix round).
- A second early stop → `⚑ <slice> stopped early twice`, branch kept.

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

`$BASE` is the branch the run started on. The integration mode is the lowest of the profile's mode and every repo cap, on the ladder `auto` → `pr` → `push` → `local`:

- **The profile:** this repo's `projects[].integration` entry, else the top-level `integration`, else **`pr`**. An entry matches by `url` (the `origin` remote) or `path`; one with only an `id` counts for a repo with no remote and only lowers.
- **Each repo cap only lowers it:** its `.agentille/config.json` `{"integration": …}`, a CLAUDE.md/AGENTS.md saying `no-mistakes` (at most `pr`) or `local-only` (`local`). So `no-mistakes` never lifts `push` or `local` up to `pr`, and a cloned repo cannot turn itself `auto`.
- **`auto`** (merge and tag with no human step) is never the default: the person turns it on in their own profile.
- **The mod enforces it** in the repo each command targets: below `auto` only a push of the run's own branch goes through, and under `local` no push or PR. Write branch names and directories out in a push line: a variable the guard cannot expand is refused with a retry hint. How the guard reads a command: `docs/guards.md` at the plugin root.

**The slice branch** is the lead's to name, and every executor dispatch carries it as `branch:` (the executor pushes exactly that name, written out): `feat/<slug>` (`fix/<slug>` for a bugfix) when `$BASE` is main/master, `agt/<slug>` when `$BASE` is a feature branch. An executor handed no `branch:` falls back to `agt/<slug>`.
Pass the same `branch:` and `base:` on every fix round, resume and post-formation push.

- **auto, `$BASE` is main/master, GitHub remote + `gh`:** before the first dispatch, `gh issue create` per slice. Each executor gets `branch: feat/<slug>` (`fix/<slug>` for a bugfix) and `issue: <n>`, pushes, and opens a PR into `$BASE` with `Closes #<n>`. After the gate, merge the PRs one at a time in dependency order: `gh pr merge <n> --merge --delete-branch` (never squash).
  After the last merge, if the repo already has `vX.Y.Z` tags, tag main (feature → minor, fix → patch) and push the tag.
- **auto, `$BASE` is a feature branch:** executors get `integration: local` and `branch: agt/<slug>`, a throwaway branch; the lead merges each into `$BASE` with `git merge --no-ff`, removes its worktree, deletes `agt/<slug>` (never pushed), then pushes `$BASE`.
- **pr** (default): as auto on main, but stop after the PRs: `⚑ PR #n ready`. On a feature branch: executors get `integration: pr` and `branch: agt/<slug>`, push it and open a PR into `$BASE`; the lead merges nothing. Without `gh`, `pr` behaves as `push` and the card says so.
- **push:** push each slice branch (`feat/<slug>`, `fix/<slug>`, or `agt/<slug>` off a feature branch), no PR, no merge; the card lists the branches. This is the one definition of `push`; the README and the executor repeat it.
- **local:** merge each slice into `$BASE` locally, push nothing.
- **After a formation held the slice at `integration: local`** (a cleared gauntlet, a duel's winner): the lead re-dispatches the kept executor, never pushes for it. Subagent: `SendMessage` to the same agent id; pane: a fresh `isolated: false` pane executor with `cwd` = the slice's worktree, as in a pane fix round.
  The message starts with the `[agt … mode=build …]` header, then `INTEGRATE:` with the run's real `integration:` and the same `branch:` and `base:`; the executor pushes and opens the PR as in its step 7 and changes no code. It is neither a fix attempt nor a resume and counts toward neither. When the run's real mode is `local`, there is nothing to send: merge as above.

Before each merge, check ownership: `git diff --name-only $BASE...<branch>` stays inside the slice's files from the CONTEXT-PACK; a stray file blocks the merge until it is reverted or explained. A later slice that trails `$BASE` merges `$BASE` first and re-verifies. After each slice's outcome, remove its worktree ("Worktree lifecycle").
