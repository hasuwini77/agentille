```
 █████╗  ██████╗ ███████╗███╗   ██╗████████╗██╗██╗     ██╗     ███████╗
██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██║██║     ██║     ██╔════╝
███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██║██║     ██║     █████╗
██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██║██║     ██║     ██╔══╝
██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ██║███████╗███████╗███████╗
╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝╚══════╝╚══════╝╚══════╝
```

A complete orchestration plugin for Claude Code. Three skills + five worker agents that route the right Claude model to each task, run parallel work in isolated git worktrees, and review both code and design before shipping.

## What you get

- **True multi-agent orchestration.** One command, `/agt "task"`, routes work through planner, executor, reviewers, and design checks.
- **Token-efficient.** Opus for planning where it shines, Sonnet for execution where it's fastest. Tokens go where they earn the most.
- **Parallel-safe.** Each task runs in its own git worktree with atomic commits and an auto-opened PR. Ship multiple features in parallel without history conflicts.
- **Voice-aware.** Your profile shapes every prompt. Tell agentille you want brutal feedback, every subagent is brutal.
- **Design review built in.** Screenshots at three viewports, axe-core, and a scan for the generic AI-design patterns that make most AI-generated UIs feel cheap. No other orchestrator does this.

## Team mode

Optionally use Claude Code's Agent Teams primitive instead of subagent dispatch. Each role becomes an independent Claude Code session (its own context window) that can message peers and coordinate via a shared task list — teammates are spawned from the same `agents/agentille-*` definitions. Best where multiple perspectives help — parallel code review, cross-layer features, competing-hypothesis debugging.

**Opt in** by enabling the env var (requires Claude Code 2.1.32+):

```
# In ~/.claude/settings.json:
{
  "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }
}
```

Then trigger it per command (this overrides your profile's `team.defaultMode`):
- Named template: `/agt --team incident-team "debug the auth race"`
- Force mode: `/agt --mode team "review the latest PR"`

Three starter templates ship:

| Template | When to use | Roster |
|---|---|---|
| `feature-team` | Cross-layer feature with design review | 1 planner + 2 executor + 1 code-reviewer + 1 design-reviewer |
| `review-team` | Parallel multi-pillar review | code + design + security reviewers in parallel |
| `incident-team` | Hard-to-debug issue, multiple possible root causes | 3 executor instances with adversarial framing |

**Cost note:** team mode uses ~4× tokens of subagent mode. agentille warns once per session if you cross the daily soft cap (default 10 team-mode runs, configurable in profile).

**Split panes (the "wow"):** whether each teammate gets its own pane is *your* Claude Code setting, not agentille's — set `teammateMode: "tmux"` (or `"auto"` while inside a tmux session) in `~/.claude/settings.json` and install tmux or iTerm2. Otherwise teammates run in-process in one terminal (Shift+Down to cycle). Split panes are unsupported in VS Code's integrated terminal, Windows Terminal, and Ghostty.

## Shipped log

Every completed `/agt` run (subagent or team mode) appends one line to `./docs/agentille-log.md` in your project. Reverse-chronological by date heading, format:

```
## 2026-05-23

- **feat:** User profile wizard — `feature-team` (4 teammates · 12m)
  - Files: src/wizard/ src/profile/
  - PR: #42
```

Committed by default (it's documentation). Disable per-project by adding `docs/agentille-log.md` to your `.gitignore`.

## Install

```bash
/plugin marketplace add hasuwini77/agentille
/plugin install agentille
```

Then run the one-time setup inside Claude Code:

```
/agentille-init
```

Eighteen questions about how you communicate. Writes `~/.agentille/profile.json`, which every other agentille skill reads.

## Use it

Register the current repo once:

```bash
cd ~/path/to/your/repo
# in Claude Code:
/agentille-project
```

Adds the repo to your profile and writes `./CLAUDE.md` with project context inheriting your global voice.

Then dispatch work:

```
/agt "refactor the dashboard sidebar to be collapsible"
```

The master orchestrator classifies the task, picks the right agents, routes each to the appropriate Claude model, and applies your voice to every prompt.

## What's inside

**Skills** (you invoke these):

| Skill | Role |
|---|---|
| `/agt` | Master orchestrator — reads profile, classifies task, picks + dispatches the roster |
| `agentille-init` | One-time global profile setup |
| `agentille-project` | Per-repo registration, writes `./CLAUDE.md` |

**Agents** (the orchestrator dispatches these as `agentille:agentille-*`; also usable as agent-team teammates):

| Agent | Role |
|---|---|
| `agentille-planner` | Goal-backward plan with parallelizable steps marked (Opus) |
| `agentille-executor` | Headless implementation — atomic commits, opens PR (Sonnet) |
| `agentille-code-reviewer` | Read-only review for bugs, security, quality (Sonnet) |
| `agentille-design-reviewer` | 6-pillar visual review, axe-core, AI-design-tell scan (Sonnet) |
| `agentille-security-reviewer` | Severity-classified security review (Sonnet) |

## Philosophy

- Opinionated, not generic. The skills encode how I actually want to work.
- Right model for right task. Tokens go where they earn the most.
- Parallel by default. Worktrees keep features isolated, history clean, reviews focused.

## License

MIT. See [LICENSE](./LICENSE). Audit it, fork it, ship it.

## Author

[@hasuwini77](https://github.com/hasuwini77), solo dev shipping opinionated tools.
