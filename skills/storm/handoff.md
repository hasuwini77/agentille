# Hand-off — cards, the storm doc, the agt task line

## Shortlist card (after pick, before the doc)

```
storm <id> · <project> · <n> candidates from <k> lenses · adversary dropped <d>
 1. <title> — <score> · <effort> · <value-axis> <0–3>
 2. …
runner-ups: <m> · doc: docs/storm/<date>.md (writing)
```

`--ask` stops here. "go" continues; "1 3 4" replaces the picks.

## Storm doc — `docs/storm/<YYYY-MM-DD>.md`

```
# Storm <date> — <project>

focus: <text|none> · lenses: <8|4> · run: storm-<id> · value axis: <revenue|retention|time-saved>

## Picks (build now)

### 1. <title> — score <s> (user <u> · value <v> · fit <f> · effort <S|M|L> · risk <r>)
<pitch>
Evidence: <link or file:line>, <link>
Scope:
- <≤5 bullets, each one thing the executor builds>
Acceptance:
1. <observable, testable>
2. …
Touches: <paths>

### 2. …

## Runner-ups (with agentille, queue one with `/agt next "<title>"`)

| # | title | score | effort | why not now |
|---|---|---|---|---|

## Dropped (adversary)

- <title> — <reason>

## Excluded (shipped or dropped by past storms)

- <title> — <storm date>
```

Acceptance criteria are what `/agt`'s planner turns into its own ACCEPTANCE list: observable behaviour, not implementation. Three to five per pick.

## agt task line

```
/agt heavy "Build the <k> picks in docs/storm/<date>.md, one slice per pick, in this order: 1) <title> 2) <title> 3) <title>. Scope and acceptance criteria are in the doc under each pick; do not widen them. Merge each slice on green."
```

`quick` → `/agt medium "…"`. The line goes into `open_sessions` → `tasks[0]` verbatim, and is printed under the final card as the paste fallback.

`--next` → instead append per pick to `.agentille/backlog.md`:

```
- [ ] <title> (spec: docs/storm/<date>.md §<n>)
```

## Plain build (no agentille)

Same picks, built with what every Claude Code has. The storm session is the lead; it writes no code itself.

Executor dispatch (one `general-purpose` Sonnet per pick, at most 3 at once, one message, background):

```
Build pick <n> from docs/storm/<date>.md in this worktree only: <root>/.worktrees/storm-<date>-<slug> on branch storm/<date>-<slug> (create both with git worktree add -b). Scope and Acceptance under the pick are the contract: build every acceptance line, nothing outside Scope. Copy .env* from the root. Run the repo's test and build commands; fix until green. Commit in small logical steps. Reply with: VERIFICATION: <commands run and results>, then FILES: <paths>, then OPEN: <anything you could not do>.
```

Then one `general-purpose` Sonnet reviewer per finished pick (read-only, foreground): the diff against the acceptance list, `VERDICT: PASS|FAIL` plus `FIX:` lines. A FAIL goes back to the same executor once via SendMessage; still failing → `⚑` on the card, branch kept.

Integrate: `git push -u origin storm/<date>-<slug>` and `gh pr create --title "<title>" --body "Storm pick <n> — spec: docs/storm/<date>.md"` when a remote exists; otherwise leave the branch and say so. The skill never merges a plain build: the reviewer is one Sonnet pass, not agentille's review fan-out. Remove each worktree after its PR exists; the branch stays.

Plain build prompt (what the tmux window's `claude` receives, one line, no newlines):

```
Build the <k> picks in docs/storm/<date>.md, one at a time in this order: 1) <title> 2) <title>. For each: a worktree at .worktrees/storm-<date>-<slug> on branch storm/<date>-<slug>, build every Acceptance line under the pick and nothing outside its Scope, run the repo's tests and build until green, commit in small steps, push and open a PR titled "<title>" with the doc path in the body, then remove the worktree. Never merge. End with one line per pick: PR URL or what blocked it.
```

## Final card (≤8 lines, the only end-of-run output)

```
storm <id> · <project> · <agents> agents · <n> candidates → <k> picks
 1. <title> — <score> · <effort>
 2. …
doc: docs/storm/<date>.md (committed <sha>)
build: session opened → /agt heavy running beside you  |  paste the line below  |  queued <k> in .agentille/backlog.md → /agt next  |  tmux window → plain build running  |  plain build here → <k> PRs open, none merged  |  skipped (--no-build)
⚑ <one line per real problem: a lens that returned nothing, a risk-2 runner-up that needs the user>
```

Then, when an agentille build was requested, the paste fallback on its own line:

```
/agt heavy "…"
```
