# agentille

One command. Type `/agt "task"` in Claude Code and it plans, builds and reviews the work with the right model for each step. Small tasks stay cheap: it steps aside and just does them.

Install (about 30 seconds, no setup):

```
/plugin marketplace add hasuwini77/agentille
/plugin install agentille@hasuwini77-agentille
```

Try it in any repo:

```
/agt "add a dark mode toggle to the settings page"
```

What happens: it reads your repo, picks the lightest setup that works (one agent for small jobs, parallel agents only when the work really splits), hardens risky changes (auth, payments, data) with a red-team pass, and ends on one short card:

```
✓ dark mode toggle on /settings  ·  4 files  ·  PR #12  ·  6m
verify: npm test → 48 passed
review: PASS — code-reviewer design-reviewer
Open: ~/.agentille/state/run-a1b2/report.md
Next: merge PR #12
```

Everything else (plan, findings, each agent's full report) is in that `report.md`. Plain prompts are untouched: `/agt` only runs when you type it.

Make it sound like you (optional, 1 minute): `/agentille-init`. Powered by [Systown AI Lab](https://systown.ai).

## When to use it

Plain Claude is one developer. `/agt` is that developer plus a planner and a reviewer, brought in only when the task is big or risky enough to pay for them.

| Good fit | Example |
|---|---|
| A multi-step feature | `/agt "add a dark mode toggle to settings, persisted per user, with tests"` |
| Two independent parts | `/agt "add a CSV export endpoint and a download button on the reports page"` |
| A risky change (auth, payments, data) | `/agt "add webhook handling for subscription cancellations"` |
| A review before merge | `/agt "review the changes on this branch"` |
| A bug across several files | `/agt "debug why checkout totals are off by one cent"` |
| Unsure of the scope | `/agt --plan "migrate the auth pages to the app router"` |

What you get over a plain prompt: a separate reviewer checks the work instead of the model that wrote it, each step runs on the model that fits it, independent parts build at the same time, a finished part's reviewers run together rather than one after another, and risky diffs get a red-team pass.

Skip it for one-file edits, typos, renames and questions: a plain prompt is cheaper. Any run that is not solo costs more tokens than a plain prompt. What you buy is fewer wrong or unreviewed changes, not a lower bill.

## Options

| You type | You get |
|---|---|
| `/agt --plan "task"` | The plan and roster first; say "go" to build it |
| `/agt --mode panes\|subagent\|solo "task"` | Force a mode for one run |
| `/agt --fable "task"` | The top model tier on judgment roles for one run |
| `/agt --formation duel\|gauntlet\|relay "task"` | Two builds and a judge, an adversary pass, or a contract-first parallel build |
| `/agt-spawn "task" [--model …]` | One extra routed Claude pane (Herdr or tmux), yours to keep |
| `/agt-deck [auto\|off]` | A side pane with the run's cast, routing timeline, wire log and token bars · open it on every `/agt` · stop |
| `/agt-tell <worker> <message>` | Message a worker pane over the wire |
| `/agt-routing` · `/agt-ledger` | Routing decisions · tokens per role this session |
| `/agt-highlight on\|all\|off` | Essentials card and lit paths on `/agt` replies · on every long reply · off |
| `/agentille-project` · `/agentille-claude-md` | Seed a repo's CLAUDE.md · tune an existing one |

## How it decides

- **Solo** for a small, one-sentence task. **Subagents** for sequential work. **Panes** (Herdr or tmux) only when 2+ slices can build at once; each worker pane shows a small mascot that says hi, walks while it works and waves bye. The pick is always printed with a one-line reason.
- **The switchboard**: a framed dispatch tree above your prompt, rooted at your session, under one swarm line that holds every agent of the run by phase (`plan ✓ · build ◆◇ · review ◆◆◆ · 2/6 done`), however many there are. Each subagent (`◇`) and pane session (`▣`) gets a row with its model pill, the tool it is running, elapsed time and tokens; `↑` marks an escalated route. Reviewers nest under the agent that spawned them, the agent you are viewing is highlighted, and a waiting or failed agent says so. Drawn by the mod, zero model tokens.
- **In the transcript and under the prompt**: each `Agent` call in the conversation becomes a live row (role, model · effort, current tool, elapsed, tokens), and a pinned status line under the prompt keeps `◇ working · done · tokens · $ session` in view when the band is collapsed. Dollar figures are the measured session cost only; per-agent numbers are tokens.
- **Never loses a worker's answer**: a pane is closed only once its answer is saved or read, a pane that finishes silently wakes your session, and `/agt` refuses to open panes when the session runs an older agentille than the one installed (restart first).
- **Type less**: `/agt --` completes its flags and their values.
- **The wire**: pane workers report to your session when they finish, so it wakes on its own; their live status reaches your band through a shared store.
- **Best with Herdr**: workers are labeled in Herdr's sidebar and a row's `↗` jumps to its pane. tmux works with the same band; without a multiplexer you get the subagent tree.
- **Routing**: planners and judgment reviewers on Opus, the executor on Sonnet (never Haiku), effort set per role by the bundled mod. Fable only after observed failures at Opus max, or when you type `--fable`.
- **Review is a gate**: P0/P1 findings get fixed before the card says ✓.
- **Squads**: in a saas, ecommerce, content or immersive repo, payments, SEO and performance specialists join the review when the diff touches their area.

## Requirements

Claude Code 2.1.294+ for the mod (switchboard, routing, the wire, pane tools, deck). Without it the skill still runs, with explicit models. No profile file needed.

## Acknowledgments

The executor's debugging, test-first and verification discipline is informed by [Jesse Vincent's superpowers](https://github.com/obra/superpowers) (MIT), internalized, not bundled.

MIT, see [LICENSE](./LICENSE). By [Systown AI Lab](https://systown.ai).
