# Guards: what a run may do to your repo and your panes

The README's Settings and "What it touches" sections give the short version. This page holds the detail of the two things the mod refuses on your behalf: integration steps above your `integration` setting, and pane tools you did not type for.

## Merge, tag and push guards

`integration` sets the most a run may do (`auto` → `pr` → `push` → `local`; the README's Settings section says how your profile and the repo decide it). The mode is snapshotted at the typed `/agt`, so a profile a run edits mid-run can lower the ceiling but never raise it.

### What the guard reads

It reads each **Bash** line the way the shell would — words, quotes, `$( )`, backticks, heredocs and here-strings, redirections, the wrappers in front of a command (`env`, `timeout`, `xargs`, `sudo`, `nice`, `script`, `flock`, `caffeinate`, `stdbuf`, `arch`, `coproc`, `ssh`, `parallel`, `find -exec`), `bash -c`/`fish -c`/`eval`, a shell alias defined earlier on the same line, and the variables the line sets. Where it can, it also reads an interpreter's inline code (`python -c`, `node -e`, `perl -e`, …), a script file (with the variables that file sets expanded), a sourced file, a make target, and an `npm`/`pnpm`/`yarn`/`bun run` package script. It never runs the command.

### What it refuses below `auto`, from a run

- A merge, tag, release or GitHub API merge — `gh`, `hub`, `git`, `gh api`/`curl`/`wget` (REST or GraphQL), and git/gh aliases, `send-pack`, `http-push`, `subtree push`, or `update-ref`/`symbolic-ref` on a tag or the base branch.
- A local `git merge`, `reset --hard`, `rebase` or `branch -f`/`-M` onto the base branch.
- A push of anything but the run's own branch (`agt/*`, `feat/*`, `fix/*`, `storm/*` or the one checked out): never the base branch, a tag, a force push, a remote branch deletion, every branch, or a bare push whose configured `remote.<name>.push` refspec (or `push.default = matching`) reaches the base or a tag. A `checkout`, `switch`, `branch -m/-M/-f`, `reset` or `gh pr checkout` earlier on the same line makes HEAD unreadable, so `git checkout main && git push origin HEAD` is refused.
- A write to the trust root (`~/.agentille`, also via `$HOME` or `$GIT_DIR`), `.git/config`, `.git/hooks`, `.git/info`, `.git/refs`, `.git/packed-refs` or the worktree's `.git` file — by a redirect, a `tee`/`cp`/`mv`/`ln`/`sed -i`/`truncate`/`dd` target, interpreter code that names the path, or a `git config` of `alias.*`, `core.hooksPath`, a remote's push URL or refspec, URL rewriting or `receive.*`. The same paths are refused through the **Write, Edit, MultiEdit and NotebookEdit** tools, not just Bash.

It judges each line by the repo the write lands in (`cd`, `git -C`, `gh -R`, `GH_REPO`/`GITHUB_REPOSITORY`, `gh repo set-default`, and for a push the URL git would push to — pushurl, insteadOf, a URL or a path), not the directory the session started in. A profile entry with only a name never grants `auto` to a repo that has a remote.

When it cannot read a word (a subcommand from `$( )` or an unexpandable variable), a source (code piped into a shell, `sh -s`/`python3 -`, a tool fed by `xargs`, or an opener it cannot introspect such as `npx`, `pnpm dlx` or `docker`), or the repo at all, it fails closed and refuses. The lead stays guarded from the moment its run names an id until the run's ✓/✗ card, with no time or typed-reply cutoff.

- **Under `local`** it refuses pushes and PRs too.
- **Under every setting** the lead is asked to stop a diff that touches auth, payments, deploy, migrations, dependencies or a business assumption at the PR, with `⚑ escalated` on the card. This rests on the lead model following the factory checklist; no code inspects the diff.

### What the guard is, and is not

The guard is a seatbelt against a cooperative model's honest mistakes, not a sandbox against a model that sets out to evade it. It judges the **Bash** tool and the **Write/Edit/MultiEdit/NotebookEdit** tools; any other tool — a GitHub MCP server's merge, say — is not seen. A Codex worker pane runs on your own Codex config, outside the mod, so the guard does not reach it. What constrains a model that is actually trying to get around the guard is your Claude Code permission rules, your remote's branch protection and Codex's own sandbox.

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
