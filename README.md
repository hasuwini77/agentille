```
 █████╗  ██████╗ ███████╗███╗   ██╗████████╗██╗██╗     ██╗     ███████╗
██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██║██║     ██║     ██╔════╝
███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██║██║     ██║     █████╗
██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██║██║     ██║     ██╔══╝
██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ██║███████╗███████╗███████╗
╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝╚══════╝╚══════╝╚══════╝
```

> A personal AI coding orchestrator for Claude Code. Type **`/agt "task"`** and it classifies the work, dispatches a tailored team of agents, routes the right Claude model to each, and applies *your* voice to every prompt.

One command instead of manually chaining skills. Planning and review run on Opus, execution on Sonnet, and code + design review are built in. Optionally fan the work out across a real Claude Code **agent team**, one teammate per pane.

---

## Quickstart

```bash
# 1. Install (inside Claude Code)
/plugin marketplace add hasuwini77/agentille
/plugin install agentille

# 2. One-time setup — teaches agentille your voice (writes ~/.agentille/profile.json)
/agentille-init

# 3. Register a repo, then dispatch work
cd ~/your/repo
/agentille-project          # writes ./CLAUDE.md with project context
/agt "refactor the dashboard sidebar to be collapsible"
```

That's it. `/agt` does the rest: classify → plan (if needed) → implement → review → summarize.

---

## What you get

- **One-command orchestration.** `/agt "task"` routes work through planner, executor, and reviewers automatically — no manual skill-chaining.
- **Right model for the job.** Opus plans and reviews, Sonnet writes the code, Haiku runs the cheap edges (task classification + the final summary). Tokens go where they earn the most.
- **Parallel-safe by default.** Each chunk of work runs in its own git worktree (branched off your *current* branch — never assumed `main`) with atomic commits, then integrates adaptively: a PR where the repo supports it, otherwise a pushed or handed-off branch. Works whether you're solo on main or stuck on a locked-down team branch.
- **Voice-aware.** Your profile shapes every prompt. Ask for brutal feedback once, and every agent is brutal.
- **Review built in.** Code review (bugs/security/quality) on every change, plus a design review (screenshots at 3 viewports, axe-core, and a scan for the generic AI-design tells that make most AI UIs feel cheap) whenever UI is touched.

## How it works

When you run `/agt "task"`, the orchestrator:

1. **Reads your profile** (`~/.agentille/profile.json`) for communication style, tone, and rules.
2. **Classifies the task** — feature, bugfix, refactor, design, review, debug, research, or planning.
3. **Picks a roster** — only the agents that task needs (e.g. no design reviewer on a backend change).
4. **Routes a model per role** and **applies your voice** to every dispatched prompt.
5. **Runs in dependency order**, parallelizing independent work (max 3 executors at once), then returns one summary.

## What's inside

**Skills** — you invoke these:

| Skill | Role |
|---|---|
| `/agt` | Master orchestrator — reads profile, classifies the task, picks and dispatches the roster |
| `/agentille-init` | One-time global setup; captures your voice into `~/.agentille/profile.json` |
| `/agentille-project` | Per-repo registration; writes a `./CLAUDE.md` that inherits your global voice |

**Agents** — the orchestrator dispatches these (as `agentille:agentille-*`); they also work as agent-team teammates:

| Agent | Role | Model |
|---|---|---|
| `agentille-planner` | Goal-backward plan with parallelizable steps marked | Opus |
| `agentille-plan-reviewer` | Critiques the plan before execution — goal, coverage, parallel-safety, real verification | Opus |
| `agentille-executor` | Headless implementation — atomic commits, integrates adaptively (PR / push / local branch) | Sonnet |
| `agentille-code-reviewer` | Read-only review for bugs, security, quality | Opus |
| `agentille-design-reviewer` | 6-pillar visual review, axe-core, AI-design-tell scan | Opus |
| `agentille-security-reviewer` | Severity-classified security review | Opus |

> **Where Haiku runs:** two steps happen *inline* in the orchestrator, not as dispatched agents — **task classification** (picks which roster to run) and the **final summary**. Both are cheap, so they go to Haiku.

## Team mode (optional)

Instead of in-session subagents, agentille can drive a real Claude Code **agent team**: each role becomes an independent Claude session with its own context window that messages peers and shares a task list. Best when parallel perspectives genuinely help — multi-pillar review, cross-layer features, or competing-hypothesis debugging.

### The teams

| Team | When to use | Teammates spawned |
|---|---|---|
| 🟩 `feature-team` | Build a feature across UI + API — reviewed as it ships | 2 × executor + code-reviewer + design-reviewer (4) |
| 🟦 `review-team` | Get a change fully checked before you merge | code-reviewer + design-reviewer + security-reviewer (3) |
| 🟥 `incident-team` | Crack a bug that has several possible causes | 3 × executor testing competing hypotheses (3) |

> Colors are auto-assigned by Claude Code — each teammate spawns in its own color (you'll see e.g. one green, one blue) and it can differ run to run. The badges above are just README labels; agentille doesn't pin a color per team. You (the orchestrator) are always the lead — the planner is not a spawned teammate.

### 1 · Enable it (both platforms)

Requires Claude Code **2.1.32+**. Add the experimental flag:

```jsonc
// ~/.claude/settings.json
{ "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" } }
```

### 2 · Turn on split panes (the "wow")

**Two ways to drive a team:** one agent **per pane** (live — needs tmux or iTerm2), or **in-process** (no panes; teammates share one pane, Shift+Down to cycle). Same team either way — panes are just the view.

**macOS**

```bash
brew install tmux            # or use iTerm2 for native panes
tmux                         # start a session, then launch `claude` inside it
```
```jsonc
// ~/.claude/settings.json
{ "teammateMode": "tmux" }   // or "auto"
```

On Warp (and any non-iTerm2 terminal) you must be **inside** a tmux session before launching Claude — that's what the panes attach to. Smoothest native panes: **iTerm2 + `tmux -CC`** (it manages the session for you).

**Windows — WSL2 (Ubuntu 22)**

Windows Terminal can't host Claude's split panes directly, so run inside tmux *in WSL*:

```bash
sudo apt install tmux
tmux                         # start a session, then launch `claude` inside it
```
```jsonc
// ~/.claude/settings.json   (the one inside WSL: ~/.claude, not the Windows one)
{ "teammateMode": "auto" }   // auto-detects the tmux session → panes
```

Keep your repo on the **WSL filesystem** (`~/projects/…`), not `/mnt/c/…` — the Windows mount is slow and makes git worktrees janky.

> No split-pane support (falls back to in-process): VS Code's integrated terminal, standalone Windows Terminal, Ghostty.

> Heads-up: your agentille profile's `team.displayMode` does **not** drive panes — the `teammateMode` setting above is the one that matters. `/agt` also detects a missing/mismatched `teammateMode` at launch and tells you how to fix it.

### 3 · Run it

```bash
/agt --team feature-team  "add Stripe checkout: pricing page + API route + success email"  # build it all, code & design reviewed
/agt --team review-team   "audit PR #42 before we merge"                                   # code + design + security, in parallel
/agt --team incident-team "users get randomly logged out — find why"                       # race 3 competing theories
```

`--team` overrides your profile's `team.defaultMode` for that one run.

**Cost:** team mode uses ~4× the tokens of subagent mode (each teammate is a full session). agentille warns once per session if you pass the daily soft cap (default 10, set in your profile).

## Shipped log

Every completed `/agt` run appends one line to `./docs/agentille-log.md` in the target project — a lightweight, reverse-chronological record:

```
## 2026-05-23
- **feat:** user profile wizard — `feature-team (4 teammates · 12m)`
  - PR: #42
```

It's documentation, so it's committed by default. To opt out, add `docs/agentille-log.md` to that project's `.gitignore`.

## Requirements

- Claude Code (any recent version for subagent mode; **2.1.32+** for team mode).
- A `~/.agentille/profile.json` — created by `/agentille-init`.

## Philosophy

- **Opinionated, not generic.** The agents encode how I actually want to work.
- **Right model for the right task.** Tokens go where they earn the most.
- **Parallel by default.** Worktrees keep features isolated, history clean, and reviews focused.

## Acknowledgments

The executor's debugging, test-first, and verification discipline is informed by [Jesse Vincent's superpowers](https://github.com/obra/superpowers) (MIT) — internalized in agentille's own voice, not bundled as a dependency. agentille is the *dispatch* layer; superpowers is a great *session*-layer companion, and the two stack cleanly.

## License

MIT — see [LICENSE](./LICENSE). Audit it, fork it, ship it.

## Author

[@hasuwini77](https://github.com/hasuwini77) — solo dev shipping opinionated tools.
