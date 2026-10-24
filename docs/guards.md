# Guards: what a run may do to your repo and your panes

The README's Settings and "What it touches" sections give the short version. This page holds the detail of the two things the mod refuses on your behalf: integration steps above your `integration` setting, and pane tools you did not type for.

## Merge, tag and push guards

`integration` sets the most a run may do (`auto` → `pr` → `push` → `local`; the README's Settings section says how your profile and the repo decide it).

- **Below `auto`** the mod refuses merges, tags, releases and API merges from a run.
  - It catches them however they are spelled: `gh`, `git`, `gh api` or `curl`, and wrapped in `env`, `timeout`, `xargs`, `bash -c` or `eval` alike.
  - It judges each line by what it does in the repo it targets (`cd`, `git -C`, `gh -R`), not in the directory the session started in.
  - It lets through only a push of the run's own branch: never the base branch, a tag, a force push or a ref it cannot read.
  - Write branch names and directories out in a push line: a variable the guard cannot expand is refused with a retry hint.
- **Under `local`** it refuses pushes and PRs too.
- **Under every setting** a diff that touches auth, payments, deploy, migrations, dependencies or a business assumption stops at the PR, and the card says `⚑ escalated`.

## Pane tools

A plain session has no pane tools.

### Unlocked by what you type

- The mod registers `spawn_pane` and `close_pane` on a turn where you typed `/agt`.
- It registers `open_sessions` (with `close_pane`) on a turn whose typed prompt asked for sessions, panes or terminals.
- Each tool still checks that proof when called, so a task notification, plugin or peer message never opens a pane.

### Lapses after the run

- `spawn_pane` stays unlocked while that run is in flight: a worker pane or subagent still working, or fewer than three later typed prompts. Then it lapses.
- It opens panes only for the run the typed `/agt` started, never for a second run id.
- A pane parked at a permission prompt for 15 minutes stops counting.
- 60 minutes after the typed `/agt` the run is over, whatever is still listed.

### Shells and trust

- A shell session's first command must be one you quoted right after the ask, in the same sentence ("open a shell and run `npm test`"). A command quoted after "why" or "explain" is not a task.
- A worker pane opened in your own checkout answers Claude's "trust this folder?" prompt for you. So does one opened in an `agt/` worktree this session's runs recorded, when its `.mcp.json`, `.claude` settings, agents and commands match your checkout's.
- Any other folder must be opened by hand once.

### Closing

- Worker panes close when harvested.
- When your session ends (never on `/clear`), the sweep closes only the worker panes this session opened (listed in `~/.agentille/state/lead-<pane>.panes`), and of those only the idle or done ones whose answer is saved. A session that opened none closes nothing.
- Your own sessions close only when idle (Herdr) or when you close them (tmux): [sessions.md](./sessions.md).
