```
 █████╗  ██████╗ ███████╗███╗   ██╗████████╗██╗██╗     ██╗     ███████╗
██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██║██║     ██║     ██╔════╝
███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██║██║     ██║     █████╗
██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██║██║     ██║     ██╔══╝
██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ██║███████╗███████╗███████╗
╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝╚══════╝╚══════╝╚══════╝
```

> A personal AI coding orchestrator for Claude Code. Type **`/agt "task"`** and it classifies the work, dispatches a tailored team of agents, routes the right Claude model to each, and applies *your* voice to every prompt.

One command instead of manually chaining skills. Planning runs on Opus, execution on Sonnet, and code + design review are built in. Optionally fan the work out across a real Claude Code **agent team**, one teammate per pane.

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
- **Right model for the job.** Opus for planning, Sonnet for execution and review, Haiku for cheap classification. Tokens go where they earn the most.
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
| `agentille-executor` | Headless implementation — atomic commits, opens a PR | Sonnet |
| `agentille-code-reviewer` | Read-only review for bugs, security, quality | Sonnet |
| `agentille-design-reviewer` | 6-pillar visual review, axe-core, AI-design-tell scan | Sonnet |
| `agentille-security-reviewer` | Severity-classified security review | Sonnet |

## Team mode (optional)

Instead of in-session subagents, agentille can drive a real Claude Code **agent team**: each role becomes an independent Claude session with its own context window that messages peers and shares a task list. Best when parallel perspectives genuinely help — multi-pillar review, cross-layer features, or competing-hypothesis debugging.

**Enable it** (requires Claude Code 2.1.32+):

```jsonc
// ~/.claude/settings.json
{ "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" } }
```

**Trigger it** per command (overrides your profile's `team.defaultMode`):

```bash
/agt --team review-team "review the latest PR"
/agt --team incident-team "debug the auth race"
```

Starter templates:

| Template | When to use | Roster |
|---|---|---|
| `feature-team` | Cross-layer feature with design review | planner + 2 executors + code + design reviewers |
| `review-team` | Parallel multi-pillar review | code + design + security reviewers |
| `incident-team` | Hard bug with several possible causes | 3 executors testing competing hypotheses |

**Split panes (the "wow"):** one pane per teammate is *your* Claude Code setting, not agentille's. Set `"teammateMode": "tmux"` in `~/.claude/settings.json` and install tmux (or iTerm2). Otherwise teammates run in-process (Shift+Down to cycle). The smoothest experience is **iTerm2 + `tmux -CC`**; split panes aren't supported in VS Code's integrated terminal, Windows Terminal, or Ghostty.

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

## License

MIT — see [LICENSE](./LICENSE). Audit it, fork it, ship it.

## Author

[@hasuwini77](https://github.com/hasuwini77) — solo dev shipping opinionated tools.
