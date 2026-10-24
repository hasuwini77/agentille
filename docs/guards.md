# Guards: what a run may do to your repo and your panes

The README's Settings and "What it touches" sections give the short version. This page holds the detail of the two things the mod refuses on your behalf: integration steps above your `integration` setting, and pane tools you did not type for.

## Merge, tag and push guards

`integration` sets the most a run may do (`auto` → `pr` → `push` → `local`; the README's Settings section says how your profile and the repo decide it). The mode is snapshotted at the typed `/agt`, so a profile a run edits mid-run can lower the ceiling but never raise it. With no profile (or one that does not parse) the snapshot is the default, `pr`, so a profile the run writes itself does not lift it.

### When it is on

- A session where you never typed `/agt` is not judged at all.
- An agentille subagent and a worker pane are judged for their whole life. A pane you open with `/agt-spawn` is your own task and is not judged.
- The lead is judged from your typed `/agt` until that run's ✓ or ✗ card. This holds whether or not the run names an id, so a solo or inline run counts too. No clock and no number of typed replies ends it.

### What the guard reads

It reads each **Bash** line the way the shell would: words, quotes, `$( )`, backticks, heredocs and here-strings, redirections, the wrappers in front of a command (`env`, `timeout`, `xargs`, `sudo`, `nice`, `script`, `flock`, `caffeinate`, `stdbuf`, `arch`, `coproc`, `ssh`, `parallel`, `find -exec`), `bash -c`, `fish -c`, `eval`, a shell alias defined earlier on the same line, and the variables the line sets. It also reads:

- an interpreter's inline code (`python -c`, `node -e`, `perl -e`, and the like);
- a script file, with the variables that file sets expanded, and a sourced file;
- a make target's recipe, and a `just`, `task` or `rake` recipe file;
- a package script: `npm`, `pnpm`, `yarn` or `bun run x`, the `prex` and `postx` scripts beside it, `npm test` and `npm start` (and the same for pnpm and yarn), and `pnpm`, `yarn` or `bun <name>` when the word is not one of the manager's own commands and a script of that name exists, all from the nearest `package.json`;
- a `python -m pkg.mod` module, looked for in the command's folder and then each `PYTHONPATH` entry, with its parent packages' `__init__.py`;
- a `node` (or `bun`) file and the files it imports with a relative static import, one level deep;
- a git alias from your git config, for any word after `git` that is not one of git's own commands, looked up in the repo the command targets and with the config variables the line sets (`HOME`, `XDG_CONFIG_HOME`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `GIT_CONFIG_NOSYSTEM`, `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`/`KEY_<n>`/`VALUE_<n>`);
- the line `git submodule foreach` runs.

It follows what a script runs one hop at a time, five hops deep: a package script that runs `npm run y`, `sh tools/x.sh`, `node tools/x.mjs` or `python -m tools.x` has that step read in turn, and so on.

The guard never runs the command it judges. To place a command it asks git about the repo (its remotes, branches and config, `git config --get alias.<word>` included), reads files through the mod, and, for a `python -m` module it cannot find in the folder or on `PYTHONPATH`, asks the interpreter named on the line where that module lives. That runs the interpreter the line names, a virtualenv's `python` inside the repo included, with `-I`, so the folder and `PYTHONPATH` are not on its path.

### What it refuses below `auto`, from a run

- A merge, tag, release or GitHub API merge: `gh`, `hub`, `git`, `gh api`, `curl` or `wget` (REST or GraphQL), git and gh aliases, `send-pack`, `http-push`, `subtree push`, or `update-ref` and `symbolic-ref` on a tag or the base branch.
- A change to what guards the base on GitHub: a write to branch protection or rulesets, a repo write that sets `default_branch` (or whose body it cannot read), `gh repo edit --default-branch`, and a workflow run, enable or disable (`gh workflow`, or the API's `dispatches`, `enable` and `disable`).
- A local `git merge`, `reset --hard`, `rebase` or `branch -f`/`-M` onto the base branch.
- A push of anything but the run's own branch (`agt/*`, `feat/*`, `fix/*`, `storm/*` or the one checked out): never the base branch, a tag, a force push, a remote branch deletion, every branch, or a bare push whose configured `remote.<name>.push` refspec (or `push.default = matching`) reaches the base or a tag. A `checkout`, `switch`, `branch -m/-M/-f`, `reset`, `gh pr checkout`, or an alias that does one of these, earlier on the same line makes HEAD unreadable. So `git checkout main && git push origin HEAD` is refused.
- A write to the trust root (`~/.agentille`, also via `$HOME` or `$GIT_DIR`, and a `.agentille/profile.json` or `.agentille/state/` however the folder above it is spelled), Claude Code settings (`.claude/settings.json` and `.claude/settings.local.json`, in your home or any repo), your git config (`~/.gitconfig`, `$XDG_CONFIG_HOME/git/config` and `attributes`), gh's `config.yml` and `hosts.yml`, `.git/config`, `.git/config.worktree`, `.git/HEAD`, `.git/hooks`, `.git/info`, `.git/refs`, `.git/packed-refs`, a linked worktree's `HEAD`, `config.worktree`, `commondir` and `gitdir` under `.git/worktrees/`, the worktree's `.git` file, or a submodule's `.git/modules/<name>/` config, hooks and refs at any depth. That covers a redirect, a `tee`, `cp`, `mv`, `ln`, `sed -i`, `truncate` or `dd` target, interpreter code that names the path (a link or symlink call included), and a `ln`, `mv` or linking `cp` (`-l`, `-s`, `--link`, `--symbolic-link`) whose source is one of these paths. Each target is judged as written and again after every link is followed, so a link made on an earlier line still lands on the protected path. Case does not matter, so `.GIT/CONFIG` counts. A write through a link that leads nowhere is refused. The same paths are refused through the **Write, Edit, MultiEdit and NotebookEdit** tools, judged the same way.
- A git config write, with `git config` (any scope: `--global`, `--system`, `-f`), `-c`, `--config-env`, `GIT_CONFIG_KEY_<n>` or `GIT_CONFIG_PARAMETERS`, of `alias.*`, a key whose value is a command git runs on its own (`core.hooksPath`, `core.fsmonitor`, `core.sshCommand`, `core.askpass`, `core.gitProxy`, `filter.*`, `diff.external`, `diff.<x>.textconv` and `.command`, `merge.<x>.driver`, `core.pager`, `pager.*`, `core.editor`, `sequence.editor`, `gpg.program`, `credential.helper`, `difftool`/`mergetool` commands), `core.attributesFile`, `include.path` and `includeIf.*.path`, `push.default`, a remote's push URL or refspec, URL rewriting or `receive.*`. A pager or editor set to `cat`, `true`, `false`, `less` or `more` (as in `git -c core.pager=cat log`) is allowed.
- A variable on a git line that makes git run a program or read another config: `GIT_EXTERNAL_DIFF`, `GIT_SSH`, `GIT_SSH_COMMAND`, `GIT_ASKPASS`, `SSH_ASKPASS`, `GIT_EDITOR`, `GIT_SEQUENCE_EDITOR`, `GIT_PAGER`, `PAGER`, `EDITOR`, `VISUAL`, `GIT_PROXY_COMMAND`, `GIT_EXEC_PATH`, `GIT_TEMPLATE_DIR`, `GIT_CONFIG`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `HOME` or `XDG_CONFIG_HOME`. A pager or editor set to a harmless program, a config set to `/dev/null`, and `GIT_SSH_COMMAND` that is plain `ssh` with options are allowed.
- A write to a `.gitattributes` file in any folder (it names the filters and diff drivers git runs), by Bash or the Write and Edit tools.
- A Write or Edit the guard cannot judge (the judgement itself fails): refused, naming the path.

It judges each line by the repo the write lands in (`cd`, `git -C`, `--git-dir`, `--work-tree`, `GIT_DIR`, `gh -R`, `GH_REPO`/`GITHUB_REPOSITORY`, `gh repo set-default`, and for a push the URL git would push to: pushurl, insteadOf, a URL or a path), not the directory the session started in. An alias is looked up in that same repo. A profile entry with only a name never grants `auto` to a repo that has a remote.

### When it cannot read something

It fails closed and refuses. That covers:

- a word it cannot read: a subcommand from `$( )` or an unexpandable variable;
- a source it cannot read: code piped into a shell, `sh -s` or `python3 -`, a tool fed by `xargs`, or an opener it cannot look into such as `npx`, `pnpm dlx` or `docker`;
- a package script run pointed at another package folder (`--prefix`, `--filter`, `-w`, `-r`, `--workspaces`), since it cannot tell which `package.json` is read;
- a `package.json` that does not parse, or a `run x` with no script `x`;
- inside a package script's own text, a step it cannot place, find or read, or a chain more than five hops deep;
- inside a package script or a script file, a git or gh subcommand built from a variable or a substitution (`git pu${X:-sh}`), or a program word built that way with a git or gh word after it (`c=$(printf gi)t; $c push`): it does not run `$( )` to learn the word, so it refuses the step;
- a relative import of a `node` file that it cannot find (in a file a shell script runs, it is skipped);
- a `python -m` module found nowhere, or a `PYTHONPATH` entry it cannot read before the module is found;
- a git alias it cannot look up, one in a repo it cannot place, or one whose config the line names with a relative path or a variable;
- a line nested deeper than it reads (see the depth limits below), or one it cannot parse at all;
- the repo itself, when git cannot be asked.

- **Under `local`** it refuses pushes and PRs too.
- **Under every setting** the lead is asked to stop a diff that touches auth, payments, deploy, migrations, dependencies or a business assumption at the PR, with `⚑ escalated` on the card. This rests on the lead model following the factory checklist; no code inspects the diff.

### What the guard is, and is not

The guard is a seatbelt against a cooperative model's honest mistakes, not a sandbox against a model that sets out to evade it. It judges the **Bash** tool and the **Write/Edit/MultiEdit/NotebookEdit** tools; any other tool, such as a GitHub MCP server's merge, is not seen. A Codex worker pane runs on your own Codex config, outside the mod, so the guard does not reach it. What constrains a model that is actually trying to get around the guard is your Claude Code permission rules, your remote's branch protection and Codex's own sandbox.

What it reads has limits, and these are the known ones:

- Inside a shell script file it follows each step it can place and read, and skips a script file named through a variable, one after a `cd` it cannot follow, or one whose file is not there. A program named through a variable is judged only by the words after it: `"$@"` or `"$NODE" x.js` runs unread, `$c push` is refused. A script file the Bash line names that is not there, or is not text, is not judged: the shell fails on it.
- It checks a script's text for a push, merge, tag or GitHub call by pattern. A make recipe is checked the same way. It does not refuse an opener such as `npx` inside a script.
- It does not read installed code: anything under `node_modules`, a bare package import, or a module in the standard library or site-packages.
- It reads a node file's relative static imports one level deep. An import built at run time is not followed, and neither are a Python file's imports.
- A git word that is an external `git-<name>` program on your PATH runs that program, which the guard does not read. gh aliases from gh's own config are not looked up.
- `git submodule foreach` runs its line in a repo the guard cannot place, so a push of HEAD there is refused and only a push with the branch written out can pass.
- It reads `$( )`, backticks and `<( )` four levels inside one another, and a line run by `eval`, `bash -c`, a wrapper, `find -exec` or `git submodule foreach` three levels inside another. Past either depth it does not read the rest of that part, so it refuses the whole line below `auto` rather than let it through. A command after the deep part on the same line is still read.

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
