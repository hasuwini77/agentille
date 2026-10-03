```
 █████╗  ██████╗ ███████╗███╗   ██╗████████╗██╗██╗     ██╗     ███████╗
██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██║██║     ██║     ██╔════╝
███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██║██║     ██║     █████╗
██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██║██║     ██║     ██╔══╝
██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ██║███████╗███████╗███████╗
╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝╚══════╝╚══════╝╚══════╝
```

> A personal AI coding orchestrator for Claude Code. Type **`/agt "task"`** and it classifies the work, picks solo, subagents, parallel panes or workflows, routes the right model and effort per role, and runs it in your own voice.
>
> Powered by **[Systown AI Lab](https://systown.ai)**.

---

## Quickstart

```bash
# 1. Install (inside Claude Code)
/plugin marketplace add hasuwini77/agentille
/plugin install agentille

# 2. One-time setup: teaches agentille your voice (writes ~/.agentille/profile.json)
/agentille-init

# 3. Dispatch work
cd ~/your/repo
/agentille-project          # optional: seeds ./CLAUDE.md with project context
/agt "refactor the dashboard sidebar to be collapsible"
```

`/agt` fires only when you type it. It does the rest: classify, plan, implement, review, summarize.

---

## What you see

- **Live band** above the prompt while agents exist: one row per agent with role, model and effort (model colored: haiku grey, sonnet blue, opus amber, fable violet; effort as a bar from low to max), state, elapsed time, tokens, and `↑ <reason>` when escalated. It covers in-process subagents and Herdr or tmux `agt-*` panes, and hides itself when nothing has run.
- **Focus**, at the top of the band: what needs you, so you can skip the rest. `⚑` flags come straight off agent results (a revised plan, a FAIL or CONCERNS review, a failed or skipped check, an adversary that broke cases, a pane waiting on you) and also toast. After a long answer a Haiku pass adds `→` the next action, `✓` what got done, `⚑` what needs you. It clears on your next prompt. `/agt-focus all` briefs every long answer, `agt` (default) only /agt runs, `off` none.
- **The deck** opens on its own when the run's first agent spawns (a solo run never opens it): a pane with a pixel mini-Claude per agent. Hat shape is the role, hat color is the model, working agents bob. Terminals draw pixels; the desktop app gets a text fallback. Close it and it stays closed for that run. `/agt-nodeck` turns auto-open off for good; `/agt-deck` opens it by hand and turns it back on.
- **Ledger.** Tokens per agent and per role. `/agt-ledger` prints it, and the Debrief shows a per-role table read from `~/.agentille/state/run-<id>/ledger.json`.

```yaml
# DEBRIEF ▸ /agt · add a search filter to the dashboard
build:    ✓ SearchFilter component · 3 files · agt/search-filter
gate:     ✓ code-review clean · design-review PASS
tokens:   planner 1 · executor 1 · reviewer 2 · total 302k in · 37k out
result:   ✓ 3 files · branch agt/search-filter · 3m 12s
```

The transcript keeps the Transit Rail (mission brief, thin pings, diff-fence verdicts, Debrief) as the permanent record.

## Routing

Each role gets a model and an effort, enforced per dispatch by the mod (without the mod, `/agt` passes explicit models instead).

| Role | Default |
|---|---|
| planner, ui-prototyper | opus · high |
| plan-reviewer, code-reviewer | sonnet · medium (opus · high on large or risky work) |
| executor | sonnet · medium (never changes model, only effort) |
| design-reviewer, security-reviewer | opus · high (security opus · max on auth or money) |

**Escalation ladder.** The mod observes evidence: a first plan REVISE re-runs the planner at opus · max, repeated fix attempts raise executor effort, and only a second failure at max makes a role a Fable candidate. Fable is rare by construction: gated by `routing.autoFable`, `maxFablePerRun` and a weekly usage ceiling (see `skills/agentille-init/profile-schema.md`). `/agt --fable` forces it for one run. `/agt-routing` lists every routing decision.

## Squads and specialists

The mod detects your project type (saas, ecommerce, content, immersive) and adds specialist reviewers, such as payments, SEO and performance, to the roster. See [`skills/agt/squads.md`](./skills/agt/squads.md).

## Modes

`/agt` auto-picks and prints the pick with a one-line reason. Subagents are the default.

| What you type | What you get |
|---|---|
| `/agt "task"` | Solo if trivial; subagents for sequential or single-slice work; parallel panes (Herdr or tmux) or a workflow when there are 2+ disjoint slices |
| `/agt "review ..."` / `/agt "debug ..."` | Subagent reviewers / debug loop |
| `/agt --mode subagent "task"` | Force subagents for one run |
| `/agt --team <feature-team\|review-team\|incident-team> "task"` | **Deprecated, removed in v3.0.** Re-resolves to panes on ≥2 disjoint slices, else subagent; runs as a team only when no pane transport exists |
| `/agt --plan "task"` | Dry run: plan and cost, then stop for your go |

**Formations** reshape a run when it pays: **duel** (two executors build one slice two ways; tests, then a judge, pick one; only when you ask), **gauntlet** (a new adversary agent writes tests to break the build, the executor fixes, at most two rounds; auto on auth/money/data changes), **relay** (a contract leg first, then slices that share an interface build in parallel). `--formation duel|gauntlet|relay` forces one; the brief states its cost. Details: [`skills/agt/formations.md`](./skills/agt/formations.md).

Pane workers open and close through the mod's own tools (`spawn_pane`, `close_pane`), the same validated path `/agt-spawn` uses: owned `agt-<run>-<role>` names, never focused, only your own `agt-` panes closable, and no Fable outside the routing guard.

Panes are not a token saving: in a measured two-slice test, two Claude workers in panes used 1.12x the fresh tokens of the same two as subagents (1.55x counting cache reads), because a pane opens as a full session. The savings come from model routing and handing each worker only its slice. Small sample: one task, two runs per arm. Team mode's ~4x is an estimate.

Agent teams are never auto-picked, and forcing one with `--team` is deprecated (removed in v3.0): it re-resolves to panes wherever Herdr or tmux is available. The legacy team path needs Claude Code 2.1.178+ and `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `~/.claude/settings.json` under `env`; split panes need tmux or iTerm2 (`teammateMode`). Details: [`skills/agt/team-mode.md`](./skills/agt/team-mode.md).

## Commands

| Command | Does |
|---|---|
| `/agt` | The orchestrator |
| `/agt-spawn "task" [--model …]` | Open one extra pane (Herdr or tmux) running one Claude session on the model you pick. Typed only, never reaped |
| `/agt-deck` | Open the pixel deck (also turns auto-open back on) |
| `/agt-nodeck` | Stop the deck from opening on its own |
| `/agt-ledger` | Tokens per agent and per role |
| `/agt-focus [all\|agt\|off]` | What needs you: agent flags and a brief of long answers |
| `/agt-routing` | Routing decisions for this session |
| `/agentille-init` | One-time global setup |
| `/agentille-project` | Per-repo registration |
| `/agentille-claude-md` | Tune an existing CLAUDE.md |

## Agents

Dispatched as `agentille:agentille-*`: planner, plan-reviewer, ui-prototyper, executor, code-reviewer, design-reviewer, security-reviewer, plus squad specialists. Every prompt carries your voice profile. UI work gets a Prototype Blueprint up front and a design review (WCAG 2.2) at the gate.

agentille bundles no third-party skills: it reaches for design, framework and accessibility skills you have installed and falls back to its own judgment when they are absent.

## Shipped log

Each completed run appends one line to `./docs/agentille-log.md` in the target project. Commit it as history or gitignore it.

## Requirements

- Claude Code **2.1.287+** for the mod (band, auto-open deck, ledger, squads, reaper, routing enforcement). The skills still work without it: routing falls back to explicit models.
- Claude Code 2.1.178+ for the deprecated team mode (only reached with no pane transport).
- A `~/.agentille/profile.json`, created by `/agentille-init`.

## Philosophy

- **Opinionated, not generic.** Every prompt runs through your voice profile.
- **Right model for the right task.** Tokens go where they earn the most.
- **Parallel only when real.** Disjoint slices, isolated worktrees, atomic commits.

## Acknowledgments

The executor's debugging, test-first and verification discipline is informed by [Jesse Vincent's superpowers](https://github.com/obra/superpowers) (MIT), internalized in agentille's own voice, not bundled.

## License

MIT, see [LICENSE](./LICENSE).

## Author

[Systown AI Lab](https://systown.ai), the AI tooling lab behind agentille.
