# agentille

> Personal AI coding orchestrator for Claude Code — opinionated dispatch + voice profile + a UI design wedge no other CLI orchestrator has.

**The wedge:** while every CLI orchestrator (Aider, Cline, Crew, Continue) reviews code, none of them reviews *design*. agentille's `design-reviewer` skill captures screenshots at 3 viewports, runs axe-core, and flags the generic AI-design patterns that make most AI-generated UIs feel cheap.

## Install (30 seconds)

```bash
# In Claude Code
/plugin marketplace add hasuwini77/agentille
/plugin install agentille
```

Then run the one-time setup inside Claude Code:

```
/agentille-init
```

That asks ~18 questions about your communication style and writes `~/.agentille/profile.json`. Every agentille skill reads it to match your voice.

## Use it

**Per repo, register once:**

```
cd ~/path/to/your/repo
# in Claude Code:
/agentille-project
```

Adds the repo to your profile and writes `./CLAUDE.md` with project context inheriting your global voice settings.

**Then dispatch work:**

```
/agentille "refactor the dashboard sidebar to be collapsible"
```

The master orchestrator classifies your task, picks the right roster of subagents (planner / executor / code-reviewer / design-reviewer), routes each to the appropriate Claude model (Opus for planning, Sonnet for execution), and applies your voice profile to every prompt.

## What's inside

| Skill | Role |
|---|---|
| `agentille` | Master orchestrator — reads profile, classifies task, picks roster |
| `agentille-init` | One-time global profile setup (18 questions) |
| `agentille-project` | Per-repo registration + writes `./CLAUDE.md` |
| `agentille-planner` | Goal-backward plan with parallelizable steps marked |
| `agentille-executor` | Implements one logical chunk in its own worktree, atomic commits, opens PR |
| `agentille-code-reviewer` | Read-only review for bugs / security / quality |
| `agentille-design-reviewer` | 6-pillar visual review + axe-core + AI-design-tell scan + persona walkthroughs |

Each skill is self-contained — no external dependencies on other Claude Code skills.

## Why this instead of [other orchestrator]

- **Voice-aware** — your profile shapes every subagent prompt. Tell agentille to be brutal; subagents are brutal. Tell it to be diplomatic; they soften.
- **Model-routed** — Opus for planning (where it shines), Sonnet for execution (where it's fastest). Not "one model does everything."
- **Design wedge** — the design-reviewer is unique. No other orchestrator catches the "indigo-gradient hero with three centered cards" AI tell before it ships.
- **Tight surface** — 7 skills, opinionated, no plugins-on-plugins-on-plugins.

## Philosophy

- Skills are **opinionated**, not generic — they encode how I actually want to work, not a TDD textbook.
- The `design-reviewer` exists because AI-generated UI is the new bottleneck. Catching "AI-design tells" is the wedge.
- The `agentille` namespace prefix is deliberate — avoids collisions with other skill packs (superpowers, gsd, etc.). You can install agentille alongside them.

## License

MIT. See [LICENSE](./LICENSE). Audit it. Fork it. Ship it.

## Author

[@hasuwini77](https://github.com/hasuwini77) — solo dev shipping opinionated tools.
