# Guards: what a run may do to your repo and your panes

The README's Settings and "What it touches" sections give the short version. This page holds the detail of the two things the mod refuses on your behalf: integration steps above your `integration` setting, and pane tools you did not type for.

## Merge, tag and push guards

`integration` sets the most a run may do (`auto` → `pr` → `push` → `local`; the README's Settings section says how your profile and the repo decide it).

- **Below `auto`** the mod refuses merges, tags, releases and API merges from a run.
  - It catches them however they are spelled: `gh`, `hub`, `git`, `gh api` (REST or GraphQL, from a file too) or `curl`/`wget`, and wrapped in `env`, `timeout`, `xargs`, `sudo`, `script`, `watch`, `flock`, `caffeinate`, `stdbuf`, `arch`, `coproc`, `ssh`, `parallel`, `find -exec`, `bash -c`, `fish -c` or `eval` alike. Below `auto` it also refuses interpreter code (`python -c`, `node -e`, `perl -e`, …) that calls git, gh or curl, and reads a script, a sourced file or a make target before it runs, refusing it when it pushes, merges, tags or releases.
  - Git and gh aliases defined on the line, `send-pack`, `http-push`, `subtree push`, and `update-ref`/`symbolic-ref` on a tag or the base branch are refused below `auto`.
  - It judges each line by the repo the write lands in: `cd`, `git -C`, `gh -R`, `GH_REPO`/`GITHUB_REPOSITORY`, `gh repo set-default`, and for a push the URL git would push to (pushurl, insteadOf, a URL or a path), not the directory the session started in. A profile entry with only a name never grants `auto` to a repo that has a remote.
  - It lets through only a push of the run's own branch: never the base branch, a tag, a force push, a remote branch deletion or a ref it cannot read. A `checkout`, `switch`, `branch -m/-M/-f`, `reset` or `gh pr checkout` earlier on the same line makes HEAD unreadable, so `git checkout main && git push origin HEAD` is refused.
  - Write branch names and directories out in a push line: a variable the guard cannot expand is refused with a retry hint. When the guard cannot read the repo at all, it refuses rather than letting the command run.
  - The lead stays guarded from the moment its run names an id until the run's ✓/✗ card, with no time or typed-reply cutoff.
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

- A session's first prompt, whatever its kind, must be your own words from the prompt that asked for it: for a shell, a command quoted right after the ask, in the same sentence ("open a shell and run `npm test`"); a command quoted after "why" or "explain", prose, or a task the model wrote itself is dropped, the session opens empty and the tool result says why. `/storm`'s hand-off line is the one exception.
- A worker pane opened at the root of your own checkout answers Claude's "trust this folder?" prompt for you. So does one opened at the root of an `agt/` worktree this session's runs recorded by exact path, when its `.mcp.json` (server scripts included), `.claude` settings and the hook, status-line and helper scripts they run, agents, commands, skills, hooks, `CLAUDE.md` and `AGENTS.md` are absent on both sides or identical to your checkout's. What those commands run without naming it must match too: an `npm`/`pnpm`/`yarn`/`bun` script (its `pre`/`post` scripts, the files it runs and the local bin it calls), an `npx`/`pnpm dlx`/`bunx` package's lockfile entry and `package.json` spec, a `python -m` module (its parent packages and `__main__.py` included), the files `CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md` pull in with `@path` imports (5 hops deep), and the commands a skill's or agent's own hooks, a `.claude/hooks/hooks.json` or a command's `` !`…` `` line runs. A command the mod cannot follow to files (an `npx` package no lockfile pins, a script run with `--filter` or `--prefix`, an import outside the checkout) is never trusted for you: one toast names it, and you open the folder once by hand.
- Any other folder, a subfolder included, must be opened by hand once.

### Closing

- Worker panes close when harvested.
- When your session ends (never on `/clear`), the sweep closes only the worker panes this session opened (listed in `~/.agentille/state/lead-<pane>.panes`), and of those only the idle or done ones whose answer is saved. A session that opened none closes nothing.
- Your own sessions close only when idle (Herdr) or when you close them (tmux): [sessions.md](./sessions.md).

## The run's own branch

The push guard lets a run push only its own branch: a branch named `agt/…`, `feat/…`, `fix/…` or `storm/…`, or the one checked out in the repo the push lands in. It refuses the base branch, a tag, every branch at once (`--all`, `--branches`, `--mirror`, `--tags`), a force push and a ref it cannot read.
