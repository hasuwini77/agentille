```
 █████╗  ██████╗ ███████╗███╗   ██╗████████╗██╗██╗     ██╗     ███████╗
██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██║██║     ██║     ██╔════╝
███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██║██║     ██║     █████╗
██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██║██║     ██║     ██╔══╝
██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ██║███████╗███████╗███████╗
╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝╚══════╝╚══════╝╚══════╝
```

# AGENTILLE

A complete orchestration plugin for Claude Code. Seven skills that route the right Claude model to each task, run parallel work in isolated git worktrees, and review both code and design before shipping.

## What you get

- **True multi-skill orchestration.** One command, `/agentille "task"`, routes work through planner, executor, reviewers, and design checks.
- **Token-efficient.** Opus for planning where it shines, Sonnet for execution where it's fastest. Tokens go where they earn the most.
- **Parallel-safe.** Each task runs in its own git worktree with atomic commits and an auto-opened PR. Ship multiple features in parallel without history conflicts.
- **Voice-aware.** Your profile shapes every prompt. Tell agentille you want brutal feedback, every subagent is brutal.
- **Design review built in.** Screenshots at three viewports, axe-core, and a scan for the generic AI-design patterns that make most AI-generated UIs feel cheap. No other orchestrator does this.

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
/agentille "refactor the dashboard sidebar to be collapsible"
```

The master orchestrator classifies the task, picks the right subagents, routes each to the appropriate Claude model, and applies your voice to every prompt.

## What's inside

| Skill | Role |
|---|---|
| `agentille` | Master orchestrator, reads profile, classifies task, picks roster |
| `agentille-init` | One-time global profile setup (18 questions) |
| `agentille-project` | Per-repo registration, writes `./CLAUDE.md` |
| `agentille-planner` | Goal-backward plan with parallelizable steps marked |
| `agentille-executor` | Implements one logical chunk in its own worktree, atomic commits, opens PR |
| `agentille-code-reviewer` | Read-only review for bugs, security, quality |
| `agentille-design-reviewer` | 6-pillar visual review, axe-core, AI-design-tell scan, persona walkthroughs |

Each skill is self-contained, no dependencies on other skill packs.

## Philosophy

- Opinionated, not generic. The skills encode how I actually want to work.
- Right model for right task. Tokens go where they earn the most.
- Parallel by default. Worktrees keep features isolated, history clean, reviews focused.

## License

MIT. See [LICENSE](./LICENSE). Audit it, fork it, ship it.

## Author

[@hasuwini77](https://github.com/hasuwini77), solo dev shipping opinionated tools.
