# agentille

One command. Type `/agt "task"` in Claude Code and that one prompt becomes a planned, built and reviewed change, each step on the model that fits it and, if you want, in your own voice (`/agentille-init`, optional, 1 minute). Small tasks stay cheap: a one-sentence task with no risk words (the typo, the rename) runs solo, with no agents and no card. A plain prompt never starts `/agt`: the skill runs only when you type it. Powered by [Systown AI Lab](https://systown.ai).

1. **Install** (about 30 seconds, no profile or config needed):
   ```
   /plugin marketplace add hasuwini77/agentille
   /plugin install agentille@hasuwini77-agentille
   ```

2. **Type a task** in any repo:
   ```
   /agt "add a dark mode toggle to settings, persisted per user, with tests"
   ```

   It reads your repo and picks a level: low (it just does it, or one builder), medium (2–3 builders in parallel) or heavy (one Herdr or tmux pane per part). It hardens risky changes (auth, payments, data) with a red-team pass, leaves one reviewed PR per part for you to merge (merging on green is opt-in, see "What it touches") and closes every pane it opened.

   **Verify it works:** a one-sentence task with no risk words (`/agt "fix the typo in the footer"`) prints one line, `recon: low · solo · <one-clause reason>` (plus `[agentille v<version>]` when the mod is not drawing), then Claude does it: no agents, no card.

3. **Read the card** it ends on. Everything else (plan, findings, each agent's full report) is in that `report.md`:
   ```
   ✓ dark mode toggle on /settings  ·  low  ·  4 files  ·  PR #12 ready  ·  6m
   verify: npm test → 48 passed
   review: PASS — code-reviewer design-reviewer
   Open: ~/.agentille/state/run-a1b2/report.md
   Next: gh pr merge 12 --merge
   ```

Also in the box, each covered below: `/storm` researches what to build next and hands the picks to `/agt heavy`; "open two sessions" opens real Claude, Codex or shell panes beside yours; `/agentille-project` and `/agentille-claude-md` set up a repo's CLAUDE.md. The band, the deck and the wire belong to the mod (see Glossary).

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

## Glossary

- **Level:** how big the crew is. low (solo or one builder), medium (parallel subagents), heavy (panes).
- **Slice:** one file-disjoint part of the task, built by one executor on its own branch. The dispatch header carries its slug as `slice=` (`piece=` is still read for one release).
- **Executor, planner, reviewers, adversary:** the agent roles in `agents/`. Reviewers read and run tests; they never edit. The adversary writes tests that try to break a slice.
- **Pane / worker:** a real Claude (or Codex) session in a Herdr or tmux pane, named `agt-<run>-<role>`, doing one slice. **Session:** a pane that is yours, opened with "open two sessions".
- **The mod:** the JavaScript in `hooks/` that Claude Code loads beside the skill. It draws the band, routes models, carries the wire, opens and closes panes. The skill works without it.
- **The band / switchboard:** the live dispatch tree above your prompt. **Deck:** the fuller side pane (`/agt-deck`). **Focus flags:** the `⚑` lines above the prompt (a REVISE, a FAIL, a blocked pane); they clear when the run's card prints.
- **The wire:** how pane workers report back to your session when they finish.
- **Run card:** the ≤8-line summary that ends every non-solo run. **Run dir:** `~/.agentille/state/run-<id>/`.
- **Squad:** extra reviewers (payments, SEO, perf) a repo type adds. **Formation:** a run shape (duel, gauntlet, relay) that reshapes the workers.
- **Mode:** `mode=` in the dispatch header is the work type (`build`, `fix`, `diagnose`, `review`, `research`), `--mode` is a deprecated flag for the level, and the merge policy is `integration`, never called a mode. `panes-mode.md` and `workflow-mode.md` are the docs for those two transports.
- **Recon line:** the first line of a run, `recon: <level> · <transport> · <reason>`.

## Options

| You type | You get |
|---|---|
| `/agt "task"` | The level is detected: low (solo or one builder), medium (2–3 builders in parallel as subagents) or heavy (one Herdr/tmux pane per part) |
| `/agt low\|medium\|heavy "task"` | Force the level for one run |
| `/agt next ["task"]` | Build the next item in `.agentille/backlog.md` and integrate it (PR by default) or escalate; after a merged item it takes the next one, and stops on the first escalation · with a task: queue it |
| `/agt --fable "task"` | The top model tier on judgment roles for one run |
| `/agt-info [routing\|ledger\|squads\|route <role>]` | Settings in effect, last run's routing and ledger, active squads · or one view: routing decisions, tokens per role, the squad rescan · or a dry-run of what a role would route to, escalation rungs included |
| `/agt-spawn "task" [--model …]` | One extra routed Claude pane (Herdr or tmux); it closes itself once its answer is saved |
| `/agt-clean` | Tidy up now: close finished agt panes, remove merged and clean `agt/*` worktrees and branches, drop run folders untouched for 14 days. Anything still working, unmerged or with changes stays. When a run ends the pane and worktree part runs on its own; at session start only finished panes a dead lead left behind are closed |
| `/agt-tell <worker> <message>` | Message a worker pane over the wire |
| `/storm [quick] [N] ["focus"] [--ask\|--no-build\|--next]` | Decide what to build next: 11 research agents on your repo and its market, 10–15 scored candidates, the best 2–5 picked and specced in `docs/storm/<date>.md`, then a fresh session beside you that types `/agt heavy` |
| `/agt-deck [auto\|off]` | A side pane with the run's cast, routing timeline, wire log and token bars · open it on every `/agt` · stop |
| `/agentille-project` · `/agentille-claude-md` | Seed a repo's CLAUDE.md · tune an existing one |

### Settings

Everything lives in `~/.agentille/profile.json`. Every key is optional; a missing or invalid one falls back to the value an older command left behind, then to the default. `/agt-info` shows what is in effect and where each value came from.

```json
{
  "integration": "pr",
  "thinkingDepth": "complex-only",
  "projects": [{ "url": "https://github.com/you/my-app", "integration": "auto" }],
  "routing": { "autoFable": false, "maxFablePerRun": 1, "fableWeeklyCeiling": 60 },
  "display": { "deck": "off", "focus": true, "highlight": "off" }
}
```

- `integration`: what a finished slice becomes.
  - **Values:** `pr` (default) pushes a branch and opens a PR per slice; `auto` merges each PR on green with a merge commit, deletes the branch and pushes a version tag; `push` pushes each slice branch, no PR, no merge; `local` merges locally and pushes nothing. Without `gh`, `pr` behaves as `push`.
  - **Your profile decides:** that repo's `projects[].integration` entry (matched by `url`, the `origin` remote, or `path`; `/agentille-project` writes both), then the top-level `integration`, then `pr`. An entry with only an `id` matches a repo with no remote and can only lower the mode, so a clone of someone else's repo with the same folder name never inherits `auto`.
  - **A repo can only lower it** (auto → pr → push → local): its `.agentille/config.json` `{"integration": …}` (`/agentille-project` writes it), a CLAUDE.md or AGENTS.md saying `no-mistakes` (at most `pr`) or `local-only` (`local`).
  - **Guards:** below `auto` the mod refuses merges, tags, releases and API merges from a run (`gh`, `git`, `gh api`, `curl`, wrapped in `env`, `timeout`, `xargs`, `bash -c` or `eval` alike), judged by what the line does in the repo it targets (`cd`, `git -C`, `gh -R`), and lets through only a push of the run's own branch, never the base branch, a tag, a force push or a ref it cannot read. Under `local` it refuses pushes and PRs too. Under every setting a diff that touches auth, payments, deploy, migrations, dependencies or a business assumption stops at the PR and the card says `⚑ escalated`.
- `thinkingDepth` (default `complex-only`; set it by hand): `complex-only` and `always` route by the table in Routing, and `always` also asks the planner for a reasoning note per step. `quick` trades depth for cost: the planner, ui-prototyper, code- and perf-reviewer and the adversary run sonnet · medium, the security, payments and design reviewers sonnet · high, the SEO reviewer sonnet · low, the plan-reviewer and formations are skipped and the plan stays at 5 steps or fewer. The design-reviewer keeps opus · high under `complex-only` and `always`, and the executor stays on Sonnet either way.
- `routing.autoFable`: `true` lets the escalation ladder reach Fable (about twice the cost of Opus) after two plan REVISEs, or for the diagnose planner after two failed fixes, at most `maxFablePerRun` times and only under `fableWeeklyCeiling` percent of your weekly plan. Default `false`: Fable only when you type `--fable`. The mod holds the model to that: a dispatch header claiming `fable=forced` in a session where you did not type `--fable` is rewritten to `fable=auto`, with a toast.
- `deck`: `auto` opens the deck on every `/agt`, `off` only when you type `/agt-deck`.
- `focus`: agent flags (a REVISE, a FAIL, a blocked pane) above the prompt.
- `highlight` (default `off`): `on` lights `/agt` replies, `all` every reply, `off` none. The mod adds text to a prompt only under `all` and for text to paste; the answer frame, the answer-shape note, plain-text answers and the older commands that write this block: [docs/settings.md](./docs/settings.md).

## Storm

`/agt` builds what you tell it. `/storm` tells it what to build.

```
/storm
```

Two Haiku scouts map the code (what exists, what is half-built). Eight Sonnet lenses research in parallel: user complaints, competitors, what people pay for, cheap wins in the code, activation loops, distribution hooks, new platform capability, quality users notice. A judge merges and scores them (`2·user + 2·value + fit − effort − risk`), an adversary red-teams the top 8, and the auto-pick keeps 2–5 that fit one heavy run. The spec lands in `docs/storm/<date>.md` with acceptance criteria per pick, committed. Then a fresh Claude session opens beside you and types `/agt heavy "Build the picks in docs/storm/<date>.md …"`. Without Herdr or tmux it prints that line to paste. Without agentille at all ([storm-skill](https://github.com/hasuwini77/storm-skill), a mirror of `skills/storm/`), the build still runs: a tmux window when one is live, else built-in Sonnet subagents in worktrees, one PR per pick, never merged for you.

Past storm docs are the exclusion list: a feature shipped or dropped once is never proposed again. `/storm 3` forces three picks, `/storm "onboarding"` biases every lens, `--ask` pauses once at the shortlist, `--no-build` stops at the doc, `--next` queues the picks for `/agt next` instead, `quick` runs four lenses and hands off at medium.

## Sessions

Ask in a plain prompt: "open three sessions", "open a codex session", "open two shells in ../api". The mod opens real Herdr or tmux panes beside yours, unfocused, up to 8 at once. Each one is yours, like a pane opened by hand: no worker role or worker environment, no reports, and no `/agt` run unless one is typed into it. `/storm`'s hand-off is the one case that types for you: it opens one session and sends `/agt heavy "…"` as its first prompt, which runs as a typed `/agt` in that session.

- **Kinds**: Claude (default, on your default model unless you name one), Codex (Herdr only) or a plain shell. Give each one a first prompt in the same sentence if you like.
- **Follow-ups**: on Herdr, your session can prompt one (`herdr agent prompt <name> "…"`) or read its screen (`herdr agent read <name>`). "Close both sessions" closes them.
- **Auto-close**: a Herdr Claude or Codex session closes after 10 minutes idle and unfocused, and at session end when idle. One with an answer you have not looked at yet stays open.
- **Never auto-closed**: shells, a session whose agent has exited, and every tmux session. They close when you ask or when you close the pane.
- **Got one closed too early?** `claude --resume` in that directory brings the conversation back.

## How it decides

- **Solo** (low) for a small, one-sentence task with no risk words. **Subagents** for one slice or sequential work (low), and for 2–3 small file-disjoint slices built in parallel (medium). **Panes** (heavy, Herdr or tmux) for 2+ file-disjoint slices that are big enough to pay for a pane: any slice of about 30 minutes or more, one that needs its own dev server, simulator or browser, or more than 3 slices; without a pane transport heavy runs as a workflow or subagent waves. Each worker pane shows a small mascot that says hi, walks while it works and waves bye. The pick is always printed with a one-line reason.
- **The switchboard**: a framed dispatch tree above your prompt, rooted at your session, under one swarm line that holds every agent of the run by phase (`plan ✓ · build ◆◇ · review ◆◆◆ · 2/6 done`), however many there are. Each subagent (`◇`) and pane session (`▣`) gets a row with its model pill, the tool it is running, elapsed time and tokens; `↑` marks an escalated route. Reviewers nest under the agent that spawned them, the agent you are viewing is highlighted, and a waiting or failed agent says so. Drawn by the mod, zero model tokens.
- **In the transcript and under the prompt**: each `Agent` call in the conversation becomes a live row (role, model · effort, current tool, elapsed, tokens), and a pinned status line under the prompt keeps `◇ working · done · tokens · $ session` in view when the band is collapsed. Dollar figures are the measured session cost only; per-agent numbers are tokens.
- **Never loses a worker's answer**: a pane is closed only once its answer is saved or read, the session-end sweep included (it skips a pane with no saved answer and never touches one another session opened), a pane that finishes silently is flagged to you, and `/agt` refuses to open panes when the session runs an older agentille than the one installed (restart first).
- **Type less**: `/agt --` completes its flags and their values.
- **The wire**: pane workers report to your session when they finish, so it wakes on its own; their live status reaches your band through a shared store.
- **Best with Herdr**: workers are labeled in Herdr's sidebar and a row's `↗` jumps to its pane. A run with 3+ pane workers gets its own tab, so your tab stays whole. Ask for Codex in the task ("codex builds the API slice") and that slice runs as a Codex pane on your own Codex config. tmux works with the same band; without a multiplexer you get the subagent tree.
- **Fewer stuck runs**: shared files (lockfiles, schema, shared types, registries) land first in one contract step before slices split; a builder that stops early is resumed once; cheap Haiku scouts map unfamiliar code before the planner.
- **Review is a gate**: P0/P1 findings get fixed before the card says ✓.
- **Squads**: in a saas, ecommerce, content or immersive repo, payments, SEO and performance specialists join the review when the diff touches their area.

## Routing

Each role gets a model and an effort. The mod picks them from the dispatch header's `size` and `risk` and the profile's `thinkingDepth` (`hooks/routing.js`); without the mod the lead passes the same models as a fallback. The first column that applies wins, in this order: `thinkingDepth=quick`, then `risk` auth or money, then `size=large`, then the default. A `—` means that column changes nothing for the role, and `risk=data` changes no route. This table is a copy of `skills/agt/routing.md` → "Default routing":

| role | default | size=large | risk auth/money | thinkingDepth=quick |
|---|---|---|---|---|
| planner | opus · high | opus · xhigh | — | sonnet · medium |
| plan-reviewer | sonnet · medium | opus · high | — | skipped |
| ui-prototyper | opus · high | opus · high | — | sonnet · medium |
| executor | sonnet · medium | sonnet · high | sonnet · high | sonnet · medium |
| code-reviewer | sonnet · medium | opus · high | opus · high | sonnet · medium |
| design-reviewer | opus · high | opus · high | opus · high | sonnet · high |
| security-reviewer | opus · high | opus · high | opus · max | sonnet · high |
| payments-reviewer | opus · high | opus · high | opus · max | sonnet · high |
| seo-reviewer | sonnet · medium | sonnet · high | — | sonnet · low |
| perf-reviewer | sonnet · high | opus · high | — | sonnet · medium |
| adversary | sonnet · high | sonnet · high | opus · high | sonnet · medium |

- **Haiku never writes:** it only classifies a task the level table cannot place and runs read-only scouts.
- **The executor never leaves Sonnet;** only its effort moves (and on fix rounds: attempt 2 → high, attempt 3 and later → max).
- **Escalation:** a plan REVISE puts the next planner on opus · max. Fable (about twice the cost of Opus) runs only when you type `--fable`, or with `routing.autoFable: true` after two REVISEs, or for the diagnose planner after two failed fixes, within `maxFablePerRun` and `fableWeeklyCeiling`.
- **Check a route:** `/agt-info route <role> [size=…] [risk=…] [depth=…]` prints what a role would get, escalation rungs included.

## When something goes wrong

- **See what is in effect:** `/agt-info` prints the settings in effect and where each value came from, the last run's routing and ledger, and the active squads. `/agt-info route <role>` dry-runs one route.
- **Read the run:** every non-solo run writes `~/.agentille/state/run-<id>/report.md` (plan, findings, each agent's full report); the card's `Open:` line names it. A real failure starts the card with `✗ <what failed + where>`, and its `Next:` line is the fix.
- **A version toast is not a failed run:** `agt ⚑ agentille vX is installed but this session runs vY — restart Claude Code before opening panes` means the plugin updated under a running session, and `/agt` refuses to open panes until you restart. `agt ⚑ Claude Code vX is older than the vY agentille needs` means pane tools stay off until you update Claude Code. `AGENTILLE_UPDATE_CHECK=0` turns the version check off (see Network).
- **No panes is not a failed run either:** without Herdr or tmux, heavy runs as a workflow or subagent waves, and the recon line (`recon: <level> · <transport> · <reason>`) says `workflow` or `subagent` instead of `panes`.

## Requirements

| Need | For | Without it |
|---|---|---|
| Claude Code 2.1.294+ | the mod: switchboard, routing, the wire, pane tools, deck | the skill still runs, with explicit models |
| `git` | every level | nothing works |
| `gh` (GitHub CLI, logged in) | PRs, issues, `auto` merges | `integration` falls back to `push` or `local` |
| [Herdr](https://github.com/hasuwini77/herdr) (install from its repo) or tmux (`brew install tmux`, `apt install tmux`) | the heavy level (one pane per slice), `/agt-spawn`, sessions | heavy runs as a workflow or subagent waves |
| Herdr | Codex worker panes, auto-closing idle sessions | tmux panes stay open until you close them |
| Codex CLI, logged in | "codex builds the API slice" | the slice runs on Claude |
| Playwright MCP plugin (`mcp__plugin_playwright_playwright__*`) and a running dev server | the design reviewer's screenshots and axe scan | the design reviewer reads code only and says so |
| `jq` or `node` | the session-end pane sweep | the sweep does nothing |

No profile file is needed. macOS and Linux; the shell hooks are bash.

## Releases

One tag a day at most and fixes batched into the next minor. From v3.23.0 (2026-10-23) on, nothing is removed outside a major that deprecated it first; before that, v3.14.0 removed `/agt-routing`, `/agt-ledger` and `/agt-squads` in a minor. What each version number promises and how to pin one: `docs/releasing.md`.

## What it touches

Before you type anything the mod does four small things: it draws its band above the prompt and, under `display.highlight: on` or `all`, lights replies; once a day at session start it checks this repo for a newer version (see Network); at session start it closes finished `agt-*` panes a dead lead left behind; and it registers its pane tools only on a turn where you typed for them (see Panes). Everything else waits for a typed `/agt`, `/storm` or a session ask. When you do:

- **Your repo:** a branch per slice (`feat/<slug>`, `fix/<slug>`, or `agt/<slug>` off a feature branch), atomic commits, one PR per slice, and with `auto` a merge commit plus a version tag. `/agt next` and `/storm --next` keep `.agentille/backlog.md` (gitignored on first use). `/storm` commits `docs/storm/<date>.md`.
- **On GitHub:** with `gh`, one issue per slice and one PR per slice; with `auto`, merged PRs and pushed tags.
- **Beside your repo:** each parallel executor works in a sibling worktree `../<project>-<slug>` with your `.env*` files copied in and `node_modules` copied (never linked). The worktree stays until the slice is merged or escalated, then the lead removes it (the branch stays); the run-end tidy and `/agt-clean` remove only merged, clean `agt/*` worktrees this session's runs made, and never one made under 10 minutes ago or with no commits of its own. Copied `.env*` files are deleted from those worktrees when the run ends.
- **In your home:** `~/.agentille/state/run-<id>/` (plan, checkpoints, every agent's report, `report.md`), `~/.agentille/profile.json` when you save a setting, and `~/.agentille/.update-check.json`.
- **Network:** once a day at session start the hook fetches this repo's `plugin.json` from GitHub to compare versions (3 s timeout, nothing sent). `AGENTILLE_UPDATE_CHECK=0` turns it off. Research agents (`/storm`) read the web. An executor whose worktree has no `node_modules` to copy runs the project's own install, and the security reviewer runs `npm audit`; both reach the package registry. Nothing else goes out.
- **Panes:** a plain session has no pane tools.
  - **Unlocked by what you type:** the mod registers `spawn_pane` and `close_pane` on a turn where you typed `/agt`, and `open_sessions` (with `close_pane`) on a turn whose typed prompt asked for sessions, panes or terminals. Each tool still checks that proof when called, so a task notification, plugin or peer message never opens a pane.
  - **Lapses after the run:** `spawn_pane` stays unlocked while that run is in flight (a worker pane or subagent still working, or fewer than three later typed prompts), then lapses. It opens panes only for the run the typed `/agt` started, never for a second run id; a pane parked at a permission prompt for 15 minutes stops counting, and 60 minutes after the typed `/agt` the run is over whatever is still listed.
  - **Shells and trust:** a shell session's first command must be one you quoted right after the ask, in the same sentence ("open a shell and run `npm test`"); a command quoted after "why" or "explain" is not a task. A worker pane opened in your own checkout, or in an `agt/` worktree this session's runs recorded whose `.mcp.json`, `.claude` settings, agents and commands match your checkout's, answers Claude's "trust this folder?" prompt for you; any other folder must be opened by hand once.
  - **Closing:** worker panes close when harvested. When your session ends (never on `/clear`), the sweep closes only the worker panes this session opened (listed in `~/.agentille/state/lead-<pane>.panes`), and of those only the idle or done ones whose answer is saved; a session that opened none closes nothing. Your own sessions close only when idle (Herdr) or when you close them (tmux).
- **Models and cost:** every non-solo run costs more than a plain prompt. By default Opus runs the planner, the ui-prototyper and the design, security and payments reviewers; Sonnet runs the executor, the adversary and the plan-, code-, SEO- and perf-reviewers. A large slice moves the plan-, code- and perf-reviewers to Opus; auth or money risk moves the code-reviewer and the adversary to Opus. The executor never leaves Sonnet and the design-reviewer never leaves Opus; `thinkingDepth: quick` moves the other roles to Sonnet and skips the plan-reviewer. Haiku only classifies and scouts. Fable never, unless `--fable` or `routing.autoFable: true`. Every cell: Routing.

## Contributing

How to verify a change and land it: [CONTRIBUTING.md](./CONTRIBUTING.md).

## Acknowledgments

The executor's debugging, test-first and verification discipline is informed by [Jesse Vincent's superpowers](https://github.com/obra/superpowers) (MIT), internalized, not bundled.

MIT, see [LICENSE](./LICENSE). By [Systown AI Lab](https://systown.ai).
