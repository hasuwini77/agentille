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

One slice, one sibling worktree `../<project>-<slug>` on its slice branch, from first build to the gate's decision. This is the one definition; the executor, `routing.md` and `panes-mode.md` point here.

- **Who creates it.** Subagent mode: the executor (`isolated: true`), with the recipe below. Panes mode: the lead, before `spawn_pane` (its `cwd` must already exist), with the same recipe run from the main checkout; the pane executor then gets `isolated: false` and works in the tree it was started in.
- **It stays** through every build, resume, fix round and design review of the slice, until the gate decides: merged, PR left ready (`pr`), branch pushed (`push`), or escalated.
- **The executor never removes it.** On every exit it deletes only its `.env*` copies (`git clean -fqx -- '.env*'`, the executor's step 8), then reports the path and branch.
- **The lead removes it** once the gate has decided, or when it abandons the slice: `git -C <path> status --porcelain` empty (commit or flag anything left), then `git worktree remove --force <path>` (`herdr worktree remove --workspace <id> --force` for a Herdr-made one). The branch stays, so a later round re-attaches from it. The mod's run-end tidy and `/agt-clean` also remove merged, clean `agt/*` worktrees; `feat/` and `fix/` ones are the lead's to remove.
- **Re-attach, never re-create.** A fix round, a resume or a design-reviewer dev server reuses the slice's tree: the directory if it exists, else the branch, else a fresh branch. Run it from the main checkout or any of its worktrees (`ROOT` resolves the main checkout either way):

```bash
SLUG="<kebab-slice>"; [[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]{0,50}$ ]] || SLUG="agt-task"
ROOT=$(cd "$(git rev-parse --git-common-dir)/.." && pwd); PROJECT=$(basename "$ROOT"); WT="$(dirname "$ROOT")/$PROJECT-$SLUG"
BASE="${BASE_INPUT:-$(git symbolic-ref --short HEAD)}"; BRANCH="${BRANCH_INPUT:-agt/$SLUG}"
git worktree prune
if [ -d "$WT" ]; then cd "$WT"
elif git show-ref --verify --quiet "refs/heads/$BRANCH"; then git worktree add "$WT" "$BRANCH" && cd "$WT"
else git worktree add "$WT" -b "$BRANCH" "$BASE" && cd "$WT"; fi
cp "$ROOT"/.env* . 2>/dev/null || true
[ -d node_modules ] || [ ! -d "$ROOT/node_modules" ] || { cp -c -R "$ROOT/node_modules" . 2>/dev/null \
  || cp --reflink=auto -a "$ROOT/node_modules" . 2>/dev/null \
  || cp -R "$ROOT/node_modules" . 2>/dev/null; }   # copy-on-write when the filesystem has it, else a plain copy; never a symlink or hardlink
```

On a fix round or resume, pass the same `base:` and `branch:` again: `BASE` from `HEAD` is right only on the first build, from the checkout the run started in. The lead runs it with `BASE_INPUT` set to the run's `$BASE` and `BRANCH_INPUT` to the slice branch, inside a subshell `( … )`, so its own shell stays in the main checkout: otherwise the next slice forks from the previous slice's branch, and the gate's diffs and merges run inside a slice tree.

## Fix rounds — resume, don't respawn

The executor already holds the slice in context; a fresh one would re-read the repo.

- **Subagent executor:** keep its agent id. Send the P0/P1 `FIX:` lines with `SendMessage`, starting with the `[agt … mode=fix …]` header: "fix these in the slice's worktree, commit, re-verify, reply in your output format". Fallback when the agent is gone: a fresh `mode=fix` executor (`isolated: true`) seeded with its checkpoint, `branch:`, `base:` and the findings; it re-attaches ("Worktree lifecycle").
- **Pane executor:** its pane closed on harvest. Open a fresh pane executor (`isolated: false`) with `cwd` = the slice's worktree (re-attach it first if it is gone), the branch, its answer file path and the findings.
- **One definition.** A fix attempt is one `mode=fix` executor dispatch for a slice (a `SendMessage` round or a fresh fix executor), counted per `slice=`; a solo run counts its own review-fix rounds the same way. Retries inside one dispatch (the three-miss stop of the executor and of solo), a resume and a `mode=diagnose` planner are not attempts.
- **Limit: 2 per slice.** Still blocking after the 2nd → a bugfix or debug slice gets one `mode=diagnose` planner (read-only root cause) and a 3rd attempt that implements it; any other slice, or a failed 3rd, → `⚑` on the card, branch kept. The effort ladder reads this same counter (`routing.md` → "Escalation ladder").
- **`STUCK:` takes the diagnose path, on any slice.** An executor whose first line is `STUCK: <assumption or check>` is never resumed with a plain `RESUME:`: the lead sends the slice, that line and the executor's body to one `mode=diagnose` planner, then one `mode=fix` dispatch that implements its root cause (it counts as an attempt). One diagnose per slice, whichever asks first: a second `STUCK:`, or a `STUCK:` after the diagnose is spent, → `⚑ <slice> stuck: <line>` on the card, branch kept.

## Early stop — resume once

An executor stopped early when its handoff has no `VERIFICATION:` block and no stop line, or ends on a question, or its pane went `done` mid-slice. A stop line is not an early stop and is never resumed: `CONTEXT …` gets a successor (`SKILL.md` → "Hard rules"); `BLOCKED: <need>` goes on the card as `⚑ <slice> blocked: <need>`; `STUCK: <assumption or check>` goes to the diagnose planner ("Fix rounds" above); `CONTRACT: <what and why>` goes on the card as `⚑ <slice> contract: <what>`, branch kept, since the contract is frozen (`formations.md` → "relay — contract first, then parallel").

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

`$BASE` is the branch the run started on. **The profile decides the mode:** this repo's `projects[].integration` entry, else the top-level `integration`, else **`pr`**. The repo can only lower it, never raise it, on the ladder `auto` → `pr` → `push` → `local`: its `.agentille/config.json` `{"integration": …}`, a CLAUDE.md/AGENTS.md saying `no-mistakes` (at most `pr`) or `local-only` (`local`). The mode is the lowest of the profile's and each repo cap, so `no-mistakes` never lifts `push` or `local` up to `pr`, and a cloned repo cannot turn itself `auto`. `auto` (merge and tag with no human step) is never the default: the person turns it on in their own profile. The mod enforces the ceiling: it refuses `gh pr merge`, `git tag` and tag pushes from agents unless the profile says `auto` for this repo.

- **auto, `$BASE` is main/master, GitHub remote + `gh`:** before the first dispatch, `gh issue create` per slice. Each executor gets `branch: feat/<slug>` (`fix/<slug>` for a bugfix) and `issue: <n>`, pushes, and opens a PR into `$BASE` with `Closes #<n>`. After the gate, merge the PRs one at a time in dependency order: `gh pr merge <n> --merge --delete-branch` (never squash). After the last merge, if the repo already has `vX.Y.Z` tags, tag main (feature → minor, fix → patch) and push the tag.
- **auto, `$BASE` is a feature branch:** executors get `integration: local` and work on throwaway `agt/<slug>` branches; the lead merges each into `$BASE` with `git merge --no-ff`, removes its worktree, deletes `agt/<slug>` (never pushed), then pushes `$BASE`.
- **pr** (default): as auto on main, but stop after the PRs: `⚑ PR #n ready`. On a feature branch: as auto, but push each `agt/<slug>` branch and open a PR into `$BASE` instead of merging. Without `gh`, `pr` behaves as `push` and the card says so.
- **push:** push each slice branch (`feat/<slug>`, `fix/<slug>`, or `agt/<slug>` off a feature branch), no PR, no merge; the card lists the branches. This is the one definition of `push`; the README and the executor repeat it.
- **local:** merge each slice into `$BASE` locally, push nothing.

Before each merge, check ownership: `git diff --name-only $BASE...<branch>` stays inside the slice's files from the CONTEXT-PACK; a stray file blocks the merge until it is reverted or explained. A later slice that trails `$BASE` merges `$BASE` first and re-verifies. After each slice's outcome, remove its worktree ("Worktree lifecycle").
