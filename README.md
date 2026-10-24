# agentille

One typed command runs the work. Type `/agt "task"` in Claude Code and that one prompt becomes a planned, built and reviewed change, each step on the model that fits it and, if you want, in your own voice (`/agentille-init`, optional, 1 minute). A few `/agt-*` commands read or tidy what a run left (`/agt-info`, `/agt-clean`).

## Quick start

1. Install (no profile or config needed):
   ```
   /plugin marketplace add hasuwini77/agentille
   /plugin install agentille@hasuwini77-agentille
   ```
2. Start a new Claude Code session. Nothing prints on load. Type `/agt-info`: its first line reads `display (profile.json → display):`. If Claude Code does not know `/agt-info`, the mod did not load.
3. Smoke test: `/agt "fix the typo in the footer"` prints `recon: low · solo · <reason>`, then Claude makes the fix itself, with no agents and no card. The fix lands on a new `fix/<slug>` branch, and under the default `integration: "pr"` that branch is pushed and a PR is opened. To keep it local, put `{"integration": "local"}` in `~/.agentille/profile.json` before you run it.
4. Settings live in `~/.agentille/profile.json`. Every key is optional ([Settings](#settings)).

Small tasks stay cheap: a one-sentence task with no risk words (the typo, the rename) runs solo, with no agents and no card. A plain prompt never starts `/agt`: the skill runs only when you type it. Powered by [Systown AI Lab](https://systown.ai).

Also in the box, each covered below: `/storm` researches what to build next and hands the picks to `/agt heavy`; "open two sessions" opens real Claude, Codex or shell panes beside yours; `/agentille-project` writes a repo's CLAUDE.md and `/agentille-claude-md` trims one (your global `~/.claude/CLAUDE.md` unless you give it a path). The band, the deck and the wire belong to the mod. The words this README uses (level, slice, band, transport, mode): [docs/glossary.md](./docs/glossary.md).

## Contents

- [Quick start](#quick-start) · [First 15 minutes](#first-15-minutes) · [When to use it](#when-to-use-it) · [Options](#options) · [Settings](#settings)
- [Storm](#storm) · [Sessions](#sessions) · [How it decides](#how-it-decides)
- [When something goes wrong](#when-something-goes-wrong) · [Requirements](#requirements) · [Releases](#releases) · [What it touches](#what-it-touches) · [Routing](#routing)
- Reference pages: [glossary](./docs/glossary.md) · [guards](./docs/guards.md) · [sessions](./docs/sessions.md) · [what you see](./docs/display.md) · [settings detail](./docs/settings.md) · [routing cost](./docs/routing-cost.md) · [releasing](./docs/releasing.md)

## First 15 minutes

1. **Install** with the two lines above, then start a new Claude Code session so the plugin and its mod load.
2. **Check that the mod loaded:** type `/agt-info`. It prints the display settings in effect and the last run's routing. Every `/agt-*` command comes from the module `hooks/hooks.json` loads, so if Claude Code does not know `/agt-info`, the mod did not load.
   - `/agt` still works without the mod; its recon line then ends in `[agentille v<version>]`, and you get the plain subagent tree instead of the band.
3. **Run a small task:** `/agt "fix the typo in the footer"` prints `recon: low · solo · <reason>`, then Claude does it on a new `fix/<slug>` branch: no agents, no card. Under the default `integration: "pr"` it opens a PR; under `local` it pushes nothing.
4. **Run a bigger one:** `/agt "add a CSV export endpoint and a download button on the reports page"`. It reads your repo and picks a level: low (it just does it, or one builder), medium (2–3 builders in parallel) or heavy (one Herdr or tmux pane per part). The recon line names the level it picked (`medium · subagent`, say), and the band above your prompt fills with the planner, executors and reviewers. Risky changes (auth, payments, data) get a red-team pass, you get one reviewed PR per part to merge (merging on green is opt-in, see "What it touches"), and every pane it opened is closed.
5. **Read the card** it ends on. Everything else (plan, findings, each agent's full report) is in that `report.md`. A one-part feature's card looks like this:
   ```
   ✓ dark mode toggle on /settings  ·  low  ·  4 files  ·  feat/dark-mode-toggle  ·  6m
   verify: npm test → 48 passed
   review: PASS — code-reviewer design-reviewer
   ⚑ PR #12 ready
   Open: ~/.agentille/state/run-a1b2/report.md
   Next: gh pr merge 12 --merge
   ```
6. **Find your settings** in `~/.agentille/profile.json`. Every key is optional ([Settings](#settings)). `/agentille-init` adds your voice; `/agentille-project` adds a repo's entry.
7. **Turn a surface off** in the profile's `display` block, or the version check in your environment:
   - the band above the prompt (the run's tree, its flags, a worker's own band): `display.band: "off"`;
   - the status line pinned under the prompt: `display.statusLine: "off"`;
   - the mascot figure in worker panes and the deck: `display.mascot: "off"`;
   - the deck side pane on every `/agt`: `display.deck: "off"` (the default);
   - the `⚑` flags in the band: `display.focus: false`;
   - reply highlighting: `display.highlight: "off"` (the default);
   - the daily version check: `AGENTILLE_UPDATE_CHECK=0`.

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
| `/agt next ["task"]` | Build the next item in `.agentille/backlog.md` and integrate it (PR by default) or escalate; after a merged item it takes the next one, and stops on the first escalation · with a task: queue it |
| `/agt --fable "task"` | The top model tier on judgment roles for one run |
| `/agt-info [routing\|ledger\|squads\|route <role>]` | Display settings in effect, last run's routing and ledger, active squads · or one view: routing decisions, tokens per role, the squad rescan · or a dry-run of what a role would route to, escalation rungs included |
| `/agt-spawn "task" [--model …]` | One extra routed Claude pane (Herdr or tmux); it closes itself once its answer is saved |
| `/agt-clean` | Tidy up now: close finished agt panes, remove merged and clean `agt/*` worktrees and branches, drop run folders untouched for 14 days. Anything still working, unmerged or with changes stays. When a run ends the pane and worktree part runs on its own; at session start only finished panes a dead lead left behind are closed |
| `/agt-tell <worker> <message>` | Message a worker pane over the wire |
| `/storm [quick] [N] ["focus"] [--ask\|--no-build\|--next]` | Decide what to build next: 11 research agents on your repo and its market, 10–15 scored candidates, the best 2–5 picked and specced in `docs/storm/<date>.md`, then a fresh session beside you that types `/agt heavy` |
| `/agt-deck [auto\|off]` | A side pane with the run's cast, routing timeline, wire log and token bars · open it on every `/agt` · stop |
| `/agentille-project` · `/agentille-claude-md [path]` | Seed a repo's CLAUDE.md · tune a CLAUDE.md: your global `~/.claude/CLAUDE.md`, or the file at `path` (a repo's own `./CLAUDE.md`, say) |

Two older commands still work but are deprecated and go away in v4: `/agt-focus` and `/agt-highlight` ([docs/settings.md](./docs/settings.md#older-commands)).

### Settings

Everything lives in `~/.agentille/profile.json`. Every key is optional, and a missing one takes its default.

- **What is checked:** an invalid `display.*` value is ignored and falls back to the value an older command left behind, then to the default. An invalid `integration` value is ignored too, and the next rule below decides.
- **What is not:** `thinkingDepth` and `routing.*` are read as written. A mistyped value is not replaced by its default, so a `thinkingDepth` other than `quick` routes as the default table, and the escalation ladder reaches Fable only when `routing.autoFable` is exactly `true` (`--fable` works either way).
- **See it:** `/agt-info` shows the `display` values in effect and where each came from; `/agt-info route <role>` shows what your `thinkingDepth` and `routing.*` do to that role's route.

```json
{
  "integration": "pr",
  "thinkingDepth": "complex-only",
  "projects": [{ "url": "https://github.com/you/my-app", "integration": "auto" }],
  "routing": { "autoFable": false, "maxFablePerRun": 1, "fableWeeklyCeiling": 60, "advisorOnOpus": true, "maxRunUsd": 15 },
  "display": { "deck": "off", "focus": true, "highlight": "off", "band": "on", "statusLine": "on", "mascot": "on" }
}
```

- `integration`: what a finished slice becomes.
  - **Values:**
    - `pr` (default) pushes a branch and opens a PR per slice.
    - `auto` merges each PR on green with a merge commit, deletes the branch and pushes a version tag.
    - `push` pushes each slice branch, no PR, no merge.
    - `local` merges locally and pushes nothing.
    - Without `gh`, `pr` behaves as `push`.
  - **Your profile decides:** that repo's `projects[].integration` entry (matched by `url`, the `origin` remote, or `path`; `/agentille-project` writes both), then the top-level `integration`, then `pr`.
    - An entry with only an `id` matches a repo with no remote and can only lower the integration mode, so a clone of someone else's repo with the same folder name never inherits `auto`.
  - **A repo can only lower it** (auto → pr → push → local): its `.agentille/config.json` `{"integration": …}` (`/agentille-project` writes it), a CLAUDE.md or AGENTS.md saying `no-mistakes` (at most `pr`) or `local-only` (`local`).
  - **Guards:** below `auto` the mod refuses merges, tags, releases and API merges from a run, and lets through only a push of the run's own branch. Under `local` it refuses pushes and PRs too. How it reads a command: [docs/guards.md](./docs/guards.md).
  - **Risky diffs stop at the PR** under every setting: a diff that touches auth, payments, deploy, migrations, dependencies or a business assumption, and the card says `⚑ escalated`.
- `thinkingDepth` (default `complex-only`; set it by hand): `complex-only` and `always` route by the table in Routing, and `always` also asks the planner for a reasoning note per step.
  `quick` trades depth for cost: the planner, ui-prototyper, code- and perf-reviewer and the adversary run sonnet · medium, the security, payments and design reviewers sonnet · high, the SEO reviewer sonnet · low, the plan-reviewer and formations are skipped and the plan stays at 5 steps or fewer.
  The design-reviewer keeps opus · high under `complex-only` and `always`, and the executor stays on Sonnet either way.
- `routing.autoFable`: `true` lets the escalation ladder reach Fable (about twice the cost of Opus) after two plan REVISEs, or for the diagnose planner after two failed fixes, at most `maxFablePerRun` times and only under `fableWeeklyCeiling` percent of your weekly plan. Default `false`: Fable only when you type `--fable`.
  The mod holds the model to that: a dispatch header claiming `fable=forced` in a session where you did not type `--fable` is rewritten to `fable=auto`, with a toast.
- `routing.advisorOnOpus` (default `true`): `false` starts Opus and Fable pane workers without Claude Code's advisor tool; Sonnet workers keep it.
- `routing.maxRunUsd` (default `15`; `null` turns it off): a per-run cost ceiling in US dollars, estimated from tokens and pane minutes. Past it, every later role but the executor that would run Opus runs Sonnet, with one toast and a band flag. How the estimate works and what it demotes: [docs/routing-cost.md](./docs/routing-cost.md) and [Routing](#routing).
- `display.band` (default `on`): `off` draws nothing above the prompt, the run's tree, its `⚑` flags and a worker's own band included.
- `display.statusLine` (default `on`): `off` pins no status line under the prompt.
- `display.mascot` (default `on`): `off` drops the figure from worker panes and the deck; a worker keeps its one-line caption.
- `display.deck`: `auto` opens the deck on every `/agt`, `off` only when you type `/agt-deck`.
- `display.focus`: agent flags (a REVISE, a FAIL, a blocked pane) in the band.
- `display.highlight` (default `off`): `on` lights `/agt` replies, `all` every reply, `off` none. The mod adds text to a prompt only under `all` and for text to paste; the answer frame, the answer-shape note, plain-text answers and the older commands that write this block: [docs/settings.md](./docs/settings.md).
- Every switch off leaves `/agt` working the same: it only stops drawing.

## Storm

`/agt` builds what you tell it. `/storm` tells it what to build.

```
/storm
```

- **Map:** two Haiku scouts map the code (what exists, what is half-built).
- **Research:** eight Sonnet lenses research in parallel: user complaints, competitors, what people pay for, cheap wins in the code, activation loops, distribution hooks, new platform capability, quality users notice.
- **Pick:** a judge merges and scores them (`2·user + 2·value + fit − effort − risk`), an adversary red-teams the top 8, and the auto-pick keeps 2–5 that fit one heavy run.
- **Spec:** it writes `docs/storm/<date>.md`, with acceptance criteria per pick, and commits it on a feature branch; on main, master or a detached HEAD it leaves the file uncommitted.
- **Build:** then a fresh Claude session opens beside you and types `/agt heavy "Build the picks in docs/storm/<date>.md …"`. Without Herdr or tmux it prints that line to paste.
- **Without agentille at all** ([storm-skill](https://github.com/hasuwini77/storm-skill), a mirror of `skills/storm/`), the build still runs: a tmux window when one is live, else built-in Sonnet subagents in worktrees, one PR per pick, never merged for you.

Past storm docs are the exclusion list: a feature shipped or dropped once is never proposed again. `/storm 3` forces three picks, `/storm "onboarding"` biases every lens, `--ask` pauses once at the shortlist, `--no-build` stops at the doc, `--next` queues the picks for `/agt next` instead, `quick` runs four lenses and hands off at medium.

## Sessions

Ask in a plain prompt: "open three sessions", "open a codex session", "open two shells in ../api". The mod opens real Herdr or tmux panes beside yours, unfocused, up to 8 at once, and each one is yours, like a pane opened by hand: no worker role, no reports, no `/agt` run unless one is typed into it.

Kinds, follow-ups, which ones close on their own and how to get one back: [docs/sessions.md](./docs/sessions.md).

## How it decides

- **Solo** (low) for a small, one-sentence task with no risk words.
- **Subagents** for one slice or sequential work (low), and for 2–3 small file-disjoint slices built in parallel (medium).
- **Panes** (heavy, Herdr or tmux) for 2+ file-disjoint slices that are big enough to pay for a pane: any slice of about 30 minutes or more, one that needs its own dev server, simulator or browser, or more than 3 slices. Without a pane transport heavy runs as a workflow or subagent waves.
- **The pick is always printed** with a one-line reason.
- **Fewer stuck runs**: shared files (lockfiles, schema, shared types, registries) land first in one contract step before slices split; a builder that stops early is resumed once; cheap Haiku scouts map unfamiliar code before the planner.
- **Review is a gate**: P0/P1 findings get fixed before the card says ✓.
- **Squads**: in a saas, ecommerce, content or immersive repo, payments, SEO and performance specialists join the review when the diff touches their area.
- **Type less**: the first word after `/agt` completes to a level (`low`, `medium`, `heavy`, `next`), and a dash completes to `--fable`.
- **What you see:** the switchboard (a live dispatch tree above your prompt), a live row per `Agent` call in the transcript, a pinned status line under the prompt, and a small mascot in each worker pane, all drawn by the mod for zero model tokens: [docs/display.md](./docs/display.md). Each has its own switch in Settings.
- **Pane workers report back over the wire**, and a pane is closed only once its answer is saved or read.
- **Best with Herdr:** workers are labeled in its sidebar and a run with 3+ pane workers gets its own tab; ask for Codex in the task ("codex builds the API slice") and that slice runs as a Codex pane. tmux works with the same band; without a multiplexer you get the subagent tree.

## When something goes wrong

- **See what is in effect:** `/agt-info` prints the `display` settings in effect and where each came from, the last run's routing and ledger, and the active squads. `/agt-info route <role>` dry-runs one route under your `thinkingDepth` and `routing.*`.
- **Read the run:** every non-solo run writes `~/.agentille/state/run-<id>/report.md` (plan, findings, each agent's full report); the card's `Open:` line names it. A real failure starts the card with `✗ <what failed + where>`, and its `Next:` line is the fix.
- **A version toast is not a failed run:**
  - `agt ⚑ agentille vX is installed but this session runs vY — restart Claude Code before opening panes` means the plugin updated under a running session, and `/agt` refuses to open panes until you restart.
  - `agt ⚑ Claude Code vX is older than the vY agentille needs` means pane tools stay off until you update Claude Code.
  - `AGENTILLE_UPDATE_CHECK=0` turns the version check off (see Network).
- **No panes is not a failed run either:** without Herdr or tmux, heavy runs as a workflow or subagent waves, and the recon line (`recon: <level> · <transport> · <reason>`) says `workflow` or `subagent` instead of `panes`.

## Requirements

| Need | For | Without it |
|---|---|---|
| Claude Code 2.1.294+ | the mod's pane tools: heavy panes, `/agt-spawn`, sessions | the mod still draws the band and routes models; pane tools stay off (a toast says so) and heavy runs as a workflow or subagent waves |
| `git` | every level | nothing works |
| `gh` (GitHub CLI, logged in) | PRs, issues, `auto` merges | `integration` falls back to `push` or `local` |
| [Herdr](https://github.com/hasuwini77/herdr) (install from its repo) or tmux 3.3+ (`brew install tmux`, `apt install tmux`; an older tmux works but a worker may rename its pane) | the heavy level (one pane per slice), `/agt-spawn`, sessions | heavy runs as a workflow or subagent waves |
| Herdr | Codex worker panes, auto-closing idle sessions | tmux panes stay open until you close them |
| Codex CLI, logged in | "codex builds the API slice" | the slice runs on Claude |
| Playwright MCP plugin (`mcp__plugin_playwright_playwright__*`) and a running dev server | the design reviewer's screenshots and axe scan | the design reviewer reads code only and says so |
| `jq` or `node` | the session-end pane sweep | the sweep does nothing |

No profile file is needed. macOS and Linux; the shell hooks are bash.

## Releases

One tag a day at most and fixes batched into the next minor. From v3.23.0 (2026-10-23) on, nothing is removed outside a major that deprecated it first; before that, v3.14.0 removed `/agt-routing`, `/agt-ledger` and `/agt-squads` in a minor. What each version number promises and how to pin one: `docs/releasing.md`.

## What it touches

Before you type anything the mod does four small things:

- it draws its band above the prompt (unless `display.band` is `off`) and, under `display.highlight: on` or `all`, lights replies;
- at session start and after a compaction its hook runs the version check, which fetches at most once a day (see Network);
- at session start it closes finished `agt-*` panes a dead lead left behind;
- and it registers its pane tools only on a turn where you typed for them (see Panes).

Everything else waits for a typed `/agt`, `/storm` or a session ask. When you do:

- **Your repo:** a branch per slice (`feat/<slug>`, `fix/<slug>`, or `agt/<slug>` off a feature branch), atomic commits, one PR per slice, and with `auto` a merge commit plus a version tag. `/agt next` and `/storm --next` keep `.agentille/backlog.md` (gitignored on first use).
  `/storm` writes `docs/storm/<date>.md` and commits it on a feature branch; on main, master or a detached HEAD it leaves the file uncommitted.
- **On GitHub:** with `gh`, one issue per slice and one PR per slice; with `auto`, merged PRs and pushed tags.
- **Beside your repo:** each parallel executor works in a sibling worktree `../<project>-<slug>` with your `.env*` files copied in and `node_modules` copied (never linked).
  - The worktree stays until the slice is merged or escalated, then the lead removes it (the branch stays).
  - The run-end tidy and `/agt-clean` remove only merged, clean `agt/*` worktrees this session's runs made, and never one made under 10 minutes ago or with no commits of its own.
  - Copied `.env*` files are deleted from every worktree the run made when it ends, whatever the branch; only untracked copies git ignores go, a tracked or un-ignored `.env.example` stays.
- **In your home:** `~/.agentille/state/run-<id>/` (plan, checkpoints, every agent's report, `report.md`), `~/.agentille/profile.json` when you save a setting, and `~/.agentille/.update-check.json`.
- **Network:** the hook runs at session start and after a compaction, and at most once a day it fetches this repo's `plugin.json` from GitHub to compare versions (3 s timeout, nothing sent). `AGENTILLE_UPDATE_CHECK=0` turns it off.
  - Research agents (`/storm`) read the web.
  - An executor whose worktree has no `node_modules` to copy runs the project's own install, and the security reviewer runs `npm audit`; both reach the package registry.
  - Nothing else goes out.
- **Panes:** a plain session has no pane tools.
  - The mod registers them only on a turn where you typed `/agt` or asked for sessions, panes or terminals, and each tool checks that proof again when called.
  - Worker panes close when harvested; at session end the sweep closes only the idle or done worker panes this session opened whose answer is saved.
  - When the proof lapses, and how shells and folder trust work: [docs/guards.md](./docs/guards.md#pane-tools).
- **Models and cost:** every non-solo run costs more than a plain prompt. Opus runs the judgment roles, Sonnet the executor and the cheaper reviews, Haiku only classifies and scouts, and Fable runs only with `--fable` or `routing.autoFable: true`. `routing.maxRunUsd` (default $15) moves later Opus roles to Sonnet once a run passes it. Every cell: [Routing](#routing).

## Routing

Each role gets a model and an effort. The mod picks them from the dispatch header's `size` and `risk` and the profile's `thinkingDepth` (`hooks/routing.js`); without the mod the lead passes the same models as a fallback. The first column that applies wins, in this order: `thinkingDepth=quick`, then `risk` auth or money, then `size=large`, then the default.
A `—` means that column changes nothing for the role, and `risk=data` changes no route. This table is a copy of `skills/agt/routing.md` → "Default routing":

| role | default | size=large | risk auth/money | thinkingDepth=quick |
|---|---|---|---|---|
| planner | opus · high | opus · xhigh | — | sonnet · medium |
| plan-reviewer | sonnet · medium | opus · high | — | sonnet · medium |
| ui-prototyper | opus · high | opus · high | — | sonnet · medium |
| executor | sonnet · medium | sonnet · high | sonnet · high | sonnet · medium |
| code-reviewer | sonnet · medium | opus · high | opus · high | sonnet · medium |
| design-reviewer | opus · high | opus · high | opus · high | sonnet · high |
| security-reviewer | opus · high | opus · high | opus · max | sonnet · high |
| payments-reviewer | opus · high | opus · high | opus · max | sonnet · high |
| seo-reviewer | sonnet · medium | sonnet · high | — | sonnet · low |
| perf-reviewer | sonnet · high | opus · high | — | sonnet · medium |
| adversary | sonnet · high | sonnet · high | opus · high | sonnet · medium |

- **Small UI work stays cheap:** a one-screen UI feature or fix with `size=small` and `risk=none` gets one executor and the Sonnet code-reviewer. The ui-prototyper and design-reviewer join when the change spans more than one screen, at `size=large`, or when you ask for design work (`routing.md` → "Roster").
- **The plan-reviewer under `quick`:** the lead skips it (see Settings); its `quick` cell is the route one still gets if it is dispatched, and what `/agt-info route plan-reviewer depth=quick` prints.
- **Haiku never writes:** it only classifies a task the level table cannot place and runs read-only scouts.
- **The executor never leaves Sonnet;** only its effort moves (and on fix rounds: attempt 2 → high, attempt 3 and later → max).
- **Escalation:** a plan REVISE puts the next planner on opus · max. Fable (about twice the cost of Opus) runs only when you type `--fable`, or with `routing.autoFable: true` after two REVISEs, or for the diagnose planner after two failed fixes, within `maxFablePerRun` and `fableWeeklyCeiling`.
- **Check a route:** `/agt-info route <role> [size=…] [risk=…] [depth=…]` prints what a role would get, escalation rungs included.

## Contributing

How to verify a change and land it: [CONTRIBUTING.md](./CONTRIBUTING.md).

## Acknowledgments

The executor's debugging, test-first and verification discipline is informed by [Jesse Vincent's superpowers](https://github.com/obra/superpowers) (MIT), internalized, not bundled.

MIT, see [LICENSE](./LICENSE). By [Systown AI Lab](https://systown.ai).
