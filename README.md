# agentille

One command. Type `/agt "task"` in Claude Code and it plans, builds and reviews the work with the right model for each step. Small tasks stay cheap: it steps aside and just does them.

Install (about 30 seconds, no profile or config needed):

```
/plugin marketplace add hasuwini77/agentille
/plugin install agentille@hasuwini77-agentille
```

Try it in any repo:

```
/agt "add a dark mode toggle to settings, persisted per user, with tests"
```

What happens: it reads your repo and picks a level: low (it just does it, or one builder), medium (2–3 builders in parallel) or heavy (one Herdr or tmux pane per part). It hardens risky changes (auth, payments, data) with a red-team pass, leaves one reviewed PR per part for you to merge (merging on green is opt-in, see "What it touches"), closes every pane it opened, and ends on one short card:

```
✓ dark mode toggle on /settings  ·  low  ·  4 files  ·  PR #12 ready  ·  6m
verify: npm test → 48 passed
review: PASS — code-reviewer design-reviewer
Open: ~/.agentille/state/run-a1b2/report.md
Next: gh pr merge 12 --merge
```

Everything else (plan, findings, each agent's full report) is in that `report.md`. A plain prompt never starts `/agt`: the skill runs only when you type it. The mod adds text to a prompt in exactly two cases, both under `display.highlight` (see Options): a short ask for paste-ready text gets a one-line "answer in plain text" note, and under `all` every typed question gets the answer-shape note. `highlight: off` adds nothing to any prompt. A one-sentence task with no risk words (the typo, the rename) runs solo: no agents, no card, no extra tokens.

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
| Unsure of the scope | `/agt "plan the migration of the auth pages to the app router"` |
| Work through a queue | `/agt next "add a 404 page"` to queue it · `/agt next` to build the next item |

What you get over a plain prompt: a separate reviewer checks the work instead of the model that wrote it, each step runs on the model that fits it, independent parts build at the same time, a finished part's reviewers run together rather than one after another, and risky diffs get a red-team pass.

Skip it for one-file edits, typos, renames and questions: a plain prompt is cheaper. Any run that is not solo costs more tokens than a plain prompt. What you buy is fewer wrong or unreviewed changes, not a lower bill.

## Options

| You type | You get |
|---|---|
| `/agt "task"` | The level is detected: low (solo or one builder), medium (2–3 builders in parallel as subagents) or heavy (one Herdr/tmux pane per part) |
| `/agt low\|medium\|heavy "task"` | Force the level for one run |
| `/agt next ["task"]` | Build the next item in `.agentille/backlog.md`, integrate it (PR by default) or escalate, then keep going · with a task: queue it |
| `/agt --fable "task"` | The top model tier on judgment roles for one run |
| `/agt-info [routing\|ledger\|squads\|route <role>]` | Settings in effect, last run's routing and ledger, active squads · or one view: routing decisions, tokens per role, the squad rescan · or a dry-run of what a role would route to, escalation rungs included |
| `/agt-spawn "task" [--model …]` | One extra routed Claude pane (Herdr or tmux); it closes itself once its answer is saved |
| `/agt-clean` | Tidy up now: close finished agt panes, remove merged and clean `agt/*` worktrees and branches. Anything still working, unmerged or with changes stays. It also runs on its own when a run ends and at session start |
| `/agt-tell <worker> <message>` | Message a worker pane over the wire |
| `/storm [quick] [N] ["focus"] [--ask\|--no-build\|--next]` | Decide what to build next: 11 research agents on your repo and its market, 10–15 scored candidates, the best 2–5 picked and specced in `docs/storm/<date>.md`, then a fresh session beside you that types `/agt heavy` |
| `/agt-deck [auto\|off]` | A side pane with the run's cast, routing timeline, wire log and token bars · open it on every `/agt` · stop |
| `/agentille-project` · `/agentille-claude-md` | Seed a repo's CLAUDE.md · tune an existing one |

### Settings

Everything lives in `~/.agentille/profile.json`. Every key is optional; a missing or invalid one falls back to the value an older command left behind, then to the default. `/agt-info` shows what is in effect and where each value came from.

```json
{
  "integration": "pr",
  "routing": { "autoFable": false, "maxFablePerRun": 1, "fableWeeklyCeiling": 60 },
  "display": { "deck": "off", "focus": true, "highlight": "on" }
}
```

- `integration`: what a finished slice becomes. `pr` (default) pushes a branch and opens a PR per slice; `auto` merges each PR on green with a merge commit, deletes the branch and pushes a version tag; `push` pushes the branch only; `local` merges locally and pushes nothing. A repo's `.agentille/config.json` `{"integration": "auto"}` overrides the profile for that repo; a repo CLAUDE.md or AGENTS.md saying `no-mistakes` forces `pr`, `local-only` forces `local`. In every mode a diff that touches auth, payments, deploy, migrations, dependencies or a business assumption stops at the PR and the card says `⚑ escalated`.
- `routing.autoFable`: `true` lets the escalation ladder reach Fable (about twice the cost of Opus) after two plan REVISEs or three failed fixes, at most `maxFablePerRun` times and only under `fableWeeklyCeiling` percent of your weekly plan. Default `false`: Fable only when you type `--fable`. The mod holds the model to that: a dispatch header claiming `fable=forced` in a session where you did not type `--fable` is rewritten to `fable=auto`, with a toast.

- `deck`: `auto` opens the deck on every `/agt`, `off` only when you type `/agt-deck`.
- `focus`: agent flags (a REVISE, a FAIL, a blocked pane) above the prompt.
- `highlight`: `on` lights `/agt` replies, `all` every reply, `off` none. The answer that ends a lit turn draws between two rules (`╭─ ◆ agentille · time ─╮` above, `╰─╯` below) with nothing beside the text, so a selection copies no border or indent: its first line as the headline, the bullets as • rows with paths, versions and refs lit, and your steps numbered under an amber **── your move ──** divider (or "✓ nothing needed from you"). Under `all`, each question you type also asks Claude for that shape: a one-line answer, at most 6 short bullets, and numbered steps only when you have something to do. Ask for text to paste ("no formatting", "plain text", "copy-paste", or start with `raw:`, in a short prompt or in the short first or last sentence of a long one) and the answer skips the panel, comes back as plain text and lands on your clipboard, under `on` or `all`. `off` adds nothing to any prompt and copies nothing.

`/agt-routing`, `/agt-ledger` and `/agt-squads` were removed in v3.14.0: use `/agt-info routing|ledger|squads`. `/agt-focus` and `/agt-highlight` still work and write this block.

## Storm

`/agt` builds what you tell it. `/storm` tells it what to build.

```
/storm
```

Two Haiku scouts map the code (what exists, what is half-built). Eight Sonnet lenses research in parallel: user complaints, competitors, what people pay for, cheap wins in the code, activation loops, distribution hooks, new platform capability, quality users notice. A judge merges and scores them (`2·user + 2·value + fit − effort − risk`), an adversary red-teams the top 8, and the auto-pick keeps 2–5 that fit one heavy run. The spec lands in `docs/storm/<date>.md` with acceptance criteria per pick, committed. Then a fresh Claude session opens beside you and types `/agt heavy "Build the picks in docs/storm/<date>.md …"`. Without Herdr or tmux it prints that line to paste. Without agentille at all ([storm-skill](https://github.com/hasuwini77/storm-skill), a mirror of `skills/storm/`), the build still runs: a tmux window when one is live, else built-in Sonnet subagents in worktrees, one PR per pick, never merged for you.

Past storm docs are the exclusion list: a feature shipped or dropped once is never proposed again. `/storm 3` forces three picks, `/storm "onboarding"` biases every lens, `--ask` pauses once at the shortlist, `--no-build` stops at the doc, `--next` queues the picks for `/agt next` instead, `quick` runs four lenses and hands off at medium.

## Sessions

Ask in a plain prompt: "open three sessions", "open a codex session", "open two shells in ../api". The mod opens real Herdr or tmux panes beside yours, unfocused, up to 8 at once. Each one is yours, like a pane opened by hand: no worker role, no reports, no `/agt`.

- **Kinds**: Claude (default, on your default model unless you name one), Codex (Herdr only) or a plain shell. Give each one a first prompt in the same sentence if you like.
- **Follow-ups**: on Herdr, your session can prompt one (`herdr agent prompt <name> "…"`) or read its screen (`herdr agent read <name>`). "Close both sessions" closes them.
- **Auto-close**: a Herdr Claude or Codex session closes after 10 minutes idle and unfocused, and when your session exits. One with an answer you have not looked at yet stays open.
- **Never auto-closed**: shells, a session whose agent has exited, and every tmux session. They close when you ask or when you close the pane.
- **Got one closed too early?** `claude --resume` in that directory brings the conversation back.

## How it decides

- **Solo** for a small, one-sentence task. **Subagents** for sequential work. **Panes** (Herdr or tmux) only when 2+ slices can build at once; each worker pane shows a small mascot that says hi, walks while it works and waves bye. The pick is always printed with a one-line reason.
- **The switchboard**: a framed dispatch tree above your prompt, rooted at your session, under one swarm line that holds every agent of the run by phase (`plan ✓ · build ◆◇ · review ◆◆◆ · 2/6 done`), however many there are. Each subagent (`◇`) and pane session (`▣`) gets a row with its model pill, the tool it is running, elapsed time and tokens; `↑` marks an escalated route. Reviewers nest under the agent that spawned them, the agent you are viewing is highlighted, and a waiting or failed agent says so. Drawn by the mod, zero model tokens.
- **In the transcript and under the prompt**: each `Agent` call in the conversation becomes a live row (role, model · effort, current tool, elapsed, tokens), and a pinned status line under the prompt keeps `◇ working · done · tokens · $ session` in view when the band is collapsed. Dollar figures are the measured session cost only; per-agent numbers are tokens.
- **Never loses a worker's answer**: a pane is closed only once its answer is saved or read, a pane that finishes silently is flagged to you, and `/agt` refuses to open panes when the session runs an older agentille than the one installed (restart first).
- **Type less**: `/agt --` completes its flags and their values.
- **The wire**: pane workers report to your session when they finish, so it wakes on its own; their live status reaches your band through a shared store.
- **Best with Herdr**: workers are labeled in Herdr's sidebar and a row's `↗` jumps to its pane. A run with 3+ pane workers gets its own tab, so your tab stays whole. Ask for Codex in the task ("codex builds the API slice") and that slice runs as a Codex pane on your own Codex config. tmux works with the same band; without a multiplexer you get the subagent tree.
- **Fewer stuck runs**: shared files (lockfiles, schema, shared types, registries) land first in one contract step before slices split; a builder that stops early is resumed once; cheap Haiku scouts map unfamiliar code before the planner.
- **Routing**: planners and judgment reviewers on Opus, the executor on Sonnet (never Haiku), effort set per role by the bundled mod. Fable only after observed failures at Opus max, or when you type `--fable`.
- **Review is a gate**: P0/P1 findings get fixed before the card says ✓.
- **Squads**: in a saas, ecommerce, content or immersive repo, payments, SEO and performance specialists join the review when the diff touches their area.

## Requirements

| Need | For | Without it |
|---|---|---|
| Claude Code 2.1.294+ | the mod: switchboard, routing, the wire, pane tools, deck | the skill still runs, with explicit models |
| `git` | every level | nothing works |
| `gh` (GitHub CLI, logged in) | PRs, issues, `auto` merges | `integration` falls back to `push` or `local` |
| [Herdr](https://github.com/hasuwini77/herdr) or tmux | the heavy level (one pane per slice), `/agt-spawn`, sessions | heavy runs as a workflow or subagent waves |
| Herdr | Codex worker panes, auto-closing idle sessions | tmux panes stay open until you close them |
| Codex CLI, logged in | "codex builds the API slice" | the slice runs on Claude |
| Playwright MCP plugin (`mcp__plugin_playwright_playwright__*`) and a running dev server | the design reviewer's screenshots and axe scan | the design reviewer reads code only and says so |
| `jq` or `node` | the session-end pane sweep | the sweep does nothing |

No profile file is needed. macOS and Linux; the shell hooks are bash.

## Releases

One tag a day at most, fixes batched into the next minor, nothing removed outside a major that deprecated it first. What each version number promises and how to pin one: `docs/releasing.md`.

## What it touches

Nothing runs until you type `/agt`, `/storm` or ask for a session. When you do:

- **Your repo:** a branch per slice (`feat/<slug>`, `fix/<slug>`, or `agt/<slug>` off a feature branch), atomic commits, one PR per slice, and with `auto` a merge commit plus a version tag. `/agt next` and `/storm --next` keep `.agentille/backlog.md` (gitignored on first use). `/storm` commits `docs/storm/<date>.md`.
- **On GitHub:** with `gh`, one issue per slice and one PR per slice; with `auto`, merged PRs and pushed tags.
- **Beside your repo:** each parallel executor works in a sibling worktree `../<project>-<slug>` with your `.env*` files copied in and `node_modules` copied (never linked). The worktree is removed once its commits are pushed; `/agt-clean` removes merged ones.
- **In your home:** `~/.agentille/state/run-<id>/` (plan, checkpoints, every agent's report, `report.md`), `~/.agentille/profile.json` when you save a setting, and `~/.agentille/.update-check.json`.
- **Network:** once a day at session start the hook fetches this repo's `plugin.json` from GitHub to compare versions (3 s timeout, nothing sent). `AGENTILLE_UPDATE_CHECK=0` turns it off. Research agents (`/storm`) read the web; nothing else does.
- **Panes:** the mod registers `spawn_pane` and `open_sessions` in every lead session, but each one refuses unless you typed for it: `spawn_pane` needs a typed `/agt` in this session, `open_sessions` a typed ask for sessions, panes or terminals on that same turn. A worker pane opened in the repo you are already in answers Claude's "trust this folder?" prompt for you; any other folder must be opened by hand once. Worker panes close when harvested; your own sessions close only when idle (Herdr) or when you close them (tmux).
- **Models and cost:** every non-solo run costs more than a plain prompt. Planners and judgment reviewers run on Opus, executors on Sonnet, scouts on Haiku. Fable never, unless `--fable` or `routing.autoFable: true`.

## Glossary

- **Level:** how big the crew is. low (solo or one builder), medium (parallel subagents), heavy (panes).
- **Slice / piece:** one file-disjoint part of the task, built by one executor on its own branch.
- **Executor, planner, reviewers, adversary:** the agent roles in `agents/`. Reviewers read and run tests; they never edit. The adversary writes tests that try to break a slice.
- **Pane / worker:** a real Claude (or Codex) session in a Herdr or tmux pane, named `agt-<run>-<role>`, doing one slice. **Session:** a pane that is yours, opened with "open two sessions".
- **The mod:** the JavaScript in `hooks/` that Claude Code loads beside the skill. It draws the band, routes models, carries the wire, opens and closes panes. The skill works without it.
- **The band / switchboard:** the live dispatch tree above your prompt. **Deck:** the fuller side pane (`/agt-deck`). **Focus flags:** the `⚑` lines above the prompt (a REVISE, a FAIL, a blocked pane); they clear when the run's card prints.
- **The wire:** how pane workers report back to your session when they finish.
- **Run card:** the ≤8-line summary that ends every non-solo run. **Run dir:** `~/.agentille/state/run-<id>/`.
- **Squad:** extra reviewers (payments, SEO, perf) a repo type adds. **Formation:** a run shape (duel, gauntlet, relay) that reshapes the workers.
- **Recon line:** the first line of a run, `recon: <level> · <transport> · <reason>`.

## Acknowledgments

The executor's debugging, test-first and verification discipline is informed by [Jesse Vincent's superpowers](https://github.com/obra/superpowers) (MIT), internalized, not bundled.

MIT, see [LICENSE](./LICENSE). By [Systown AI Lab](https://systown.ai).
