```
 █████╗  ██████╗ ███████╗███╗   ██╗████████╗██╗██╗     ██╗     ███████╗
██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██║██║     ██║     ██╔════╝
███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██║██║     ██║     █████╗
██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██║██║     ██║     ██╔══╝
██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ██║███████╗███████╗███████╗
╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝╚══════╝╚══════╝╚══════╝
```

> A personal AI coding orchestrator for Claude Code. Type **`/agt "task"`** and it classifies the work, **smart-picks subagents or a full agent team**, routes the right Claude model to each, and applies *your* voice to every prompt.

One command instead of manually chaining skills. Planning and review run on Opus, execution on Sonnet, and UI prototyping + code + design review are built in. `/agt` decides on its own whether the work needs a real Claude Code **agent team** (independent sessions that talk to each other) or cheaper in-session **subagents** — and tells you which it picked and why.

---

## Quickstart

```bash
# 1. Install (inside Claude Code)
/plugin marketplace add hasuwini77/agentille
/plugin install agentille

# 2. One-time setup — teaches agentille your voice (writes ~/.agentille/profile.json)
/agentille-init

# 3. Dispatch work
cd ~/your/repo
/agentille-project          # optional but recommended — seeds ./CLAUDE.md with project context
                            # /agt works from the global profile alone without it
/agt "refactor the dashboard sidebar to be collapsible"

# Optional: slim a bloated CLAUDE.md (global, or pass a path)
/agentille-claude-md
```

That's it. `/agt` does the rest: classify → plan (if needed) → implement → review → summarize.

> **Team mode (split panes) requires two things:** Claude Code **2.1.32+**, and `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` set in `~/.claude/settings.json` under the `env` key (see [Team mode](#team-mode-optional) below). Subagent mode — the default — works on any recent version with no extra config.

---

## What you get

- **One-command orchestration.** `/agt "task"` routes work through the right agents automatically — no manual skill-chaining.
- **Right model per role.** Opus plans and runs the standard reviews, Sonnet writes the code and clears routine reviews, Haiku runs the cheap edges (classify + summary). The heaviest escalations — large cross-cutting plans, large diffs, and security reviews — automatically escalate to Opus. Tokens go where they earn the most.
- **Parallel-safe by default.** Each chunk runs in its own git worktree (branched off your *current* branch, never assumed `main`), atomic commits, then integrates adaptively — PR, push, or local branch.
- **Context-disciplined agents.** Chunks are planned to fit ~30% of an executor's window; at runtime executors checkpoint at every commit and, if their context fills, rotate out to a fresh successor seeded from the checkpoint — lossless, because the state lives in git + a checkpoint file, never the conversation.
- **Voice-aware.** Your profile shapes every prompt. Ask for brutal feedback once, and every agent is brutal.
- **Design as a contract.** On UI work the ui-prototyper frames the components up front (tokens, states, a11y), the executor builds against that, and a design review screenshots the result + runs a WCAG 2.2 accessibility audit — alongside code review on every change.

## How it works

When you run `/agt "task"`, the orchestrator:

1. **Reads your profile** (`~/.agentille/profile.json`) for communication style, tone, and rules.
2. **Classifies the task** — feature, bugfix, refactor, design, review, debug, research, or planning.
3. **Smart-picks the execution mode** — in-session **subagents** (default) or a real **agent team**, based on whether the work has ≥2 independent slices that can build at once. It shows you the pick and a one-line reason every run.
4. **Builds the roster** — only the agents the task needs (no design reviewer on a backend change), routes a model per role, and applies your voice to every prompt.
5. **Runs in dependency order**, parallelizing independent work (max 3 executors). The repo is explored **once** and each executor gets only its slice — so splitting work saves tokens instead of paying an N× rediscovery tax. Executors checkpoint as they go and rotate to a fresh successor if their window fills, so no half-full agent limps through the trickiest code.

## What's inside

**Skills** — you invoke these:

| Skill | Role |
|---|---|
| `/agt` | Master orchestrator — reads profile, classifies the task, picks and dispatches the roster |
| `/agentille-init` | One-time global setup; captures your voice into `~/.agentille/profile.json` |
| `/agentille-project` | Per-repo registration; writes a `./CLAUDE.md` that inherits your global voice |
| `/agentille-claude-md` | Tune up an existing CLAUDE.md — applies a "less is more" rubric, shows a per-line cut-list, backs up and rewrites only on approval. Global by default; pass a path for a project file |

**Agents** — the orchestrator dispatches these (as `agentille:agentille-*`); they also work as agent-team teammates:

| Agent | Role | Model |
|---|---|---|
| `agentille-planner` | Goal-backward plan with parallelizable steps marked | Opus · Sonnet for quick depth |
| `agentille-plan-reviewer` | Critiques the plan before execution — goal, coverage, parallel-safety, real verification | Sonnet · Opus for large/cross-cutting plans |
| `agentille-ui-prototyper` | Frames the UI design *before* the build — tokens, component anatomy, states, a11y, anti-generic guardrails — as a Prototype Blueprint the executor builds against. Uses `impeccable` / `ui-ux-pro-max` / `frontend-design` when installed; own taste when not | Opus |
| `agentille-executor` | Headless implementation — atomic commits, integrates adaptively (PR / push / local branch). Builds against the prototyper's Blueprint on UI work | Sonnet |
| `agentille-code-reviewer` | Read-only review for bugs, security, quality | Sonnet · Opus for large/cross-cutting diffs |
| `agentille-design-reviewer` | Visual review (scored design pillars), axe-core scan + WCAG 2.2 a11y audit (`accessibility` + `web-design-guidelines` skills), AI-design-tell scan, at the viewports that matter | Opus |
| `agentille-security-reviewer` | Severity-classified security review | Opus |

> **Where Haiku runs:** two steps happen *inline* in the orchestrator, not as dispatched agents — **task classification** (picks which roster to run) and the **final summary**. Both are cheap, so they go to Haiku.

### Skills it uses (if you have them)

agentille **bundles none of these** — it *reaches for* skills you've already installed and falls back to its own judgment when they're absent (never a hard dependency, never an error on a missing skill). On UI work the **ui-prototyper** and **executor** both pull from these layers, and the design-reviewer adds an accessibility pass at the gate:

| Layer | Skills | Used by |
|---|---|---|
| **Design** | `impeccable`, `ui-ux-pro-max`, `frontend-design` | ui-prototyper + executor |
| **Framework** | `vercel-react-best-practices` + `next-best-practices` (React/Next), `vercel-react-native-skills` (RN) — gated on the *detected stack* | executor |
| **Accessibility** | `accessibility` (WCAG 2.2 audit) + `web-design-guidelines` (static WIG) | design-reviewer, at the gate |

The two build layers don't overlap (aesthetics vs correctness), and a framework skill is never loaded for a stack it doesn't match. In **team mode** the lead hands each teammate a **skill budget** so capability lands where it helps without inflating the ~4× cost. The design micro-skills (`polish`, `delight`, `typeset`, …) stay yours to invoke — agentille doesn't auto-load them.

## Subagents vs teams — `/agt` smart-picks

**Auto-detection is the default.** You don't pick a mode — `/agt` picks for you, prints the decision and a one-line reason every run, and defaults to the cheaper option when there's no clear reason to pay more.

### What to type for each outcome

| What you type | What you get |
|---|---|
| `/agt "task"` (no flags) | Auto: solo if trivial; subagent if sequential/single-slice; review-team if verb is "review"; incident-team if verb is "debug"; Haiku classify for everything else |
| `/agt "review …"` | Auto → `review-team` (verb fast-path) |
| `/agt "debug …"` | Auto → `incident-team` (verb fast-path) |
| `/agt --team feature-team "task"` | Force the build team (ui-prototyper + executors + code/design review) |
| `/agt --team review-team "task"` | Force the audit team (code + design + security review) |
| `/agt --team incident-team "task"` | Force the debug team (3 executors race competing theories) |
| `/agt --mode subagent "task"` | Force subagent mode for one run |
| `/agt --fable "task"` | Deprecated alias — forces Opus as the ceiling for all judgment-heavy roles this run (composes with `--team` and `--plan`); use auto-escalation instead |

Any `--team` overrides the auto-pick; if the work has no ≥2 disjoint slices, `/agt` flags it as overkill and asks whether to downgrade (see below).

Stage 2 (a lightweight inline Haiku classify) only fires when Stage 1 fast-paths all miss. It promotes to `team` only when ≥2 genuinely disjoint slices can build in parallel — it won't pay ~4× tokens for sequential work.

Claude Code gives you two ways to parallelize, and they're genuinely different:

| | **Subagents** (default) | **Agent team** (`--team`) |
|---|---|---|
| Workers | Dispatched helpers that report results **back to the lead** | Independent Claude sessions that **message each other** |
| Coordination | The lead manages all work | Shared task list + scoped peer handoffs |
| Best for | Sequential work, a single slice, focused tasks | ≥2 independent slices, multi-pillar review, competing-hypothesis debugging |
| Token cost | **Lower** — each worker's context returns to the lead | **~4×** — every teammate is a full, separate session |

**Forcing a team.** `--team <template>` overrides the pick. If a team would be **overkill** (sequential, single slice), `/agt` doesn't obey blindly — it says so and asks before spending ~4×:

> *"`--team feature-team` here looks like overkill — no ≥2 independent slices, so subagent mode does the same work for ~¼ the tokens. Downgrade (recommended), or force the team?"*

You decide. (`preTaskQuestioning: never` skips the ask, honors the force, and notes the trade in one line.)

## Team mode (optional)

When `/agt` picks a team — or you force one with `--team` — each role becomes an independent Claude session with its own context window that messages peers and shares a task list. Best when parallel perspectives genuinely help — multi-pillar review, cross-layer features, or competing-hypothesis debugging.

### The teams

| Team | When to use | Teammates spawned |
|---|---|---|
| `feature-team` | Build a feature across UI + API — designed up front, reviewed as it ships | ui-prototyper *(when UI)* + 2 × executor + code-reviewer + design-reviewer (5) |
| `review-team` | Get a change fully checked before you merge | code-reviewer + design-reviewer + security-reviewer (3) |
| `incident-team` | Crack a bug that has several possible causes | 3 × executor testing competing hypotheses (3) |

> **Each agent has a pinned color** (set in its `agents/agentille-*.md` frontmatter) — Claude Code tints that teammate's pane with it, and the run rail uses the same hue, so panes and progress speak one language: 🔵 planner · plan-reviewer · 🟠 ui-prototyper · 🟢 executor · 🟡 code-reviewer · 🟣 design-reviewer · 🔴 security-reviewer. You (the orchestrator) are always the lead — the planner is not a spawned teammate.

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
/agt --plan "refactor the auth module into smaller files"                                  # preview plan + cost, then stop for your "go"
/agt --fable "redesign the entire auth layer + migrate 12 services"                       # deprecated: forces Opus ceiling for all judgment-heavy roles
```

**`--plan` (dry-run).** Stops after the plan + plan-review — before any executor or teammate spawns — so you approve the *shape and cost* first; a plain "go" then runs that exact plan. Pairs with any mode (`/agt --plan --team feature-team "…"` previews the team roster + ~4× cost without spawning). The cheapest guard against building the wrong thing.

**`--fable` (deprecated — Opus ceiling alias).** Retained for backward compatibility. Forces **Opus** as the ceiling for all judgment-heavy roles this run — planner, security-reviewer, design-reviewer, ui-prototyper, and any size-triggered code-reviewer or plan-reviewer. Executor stays Sonnet; classifier and final-summary stay Haiku. Composes with `--plan` and `--team`. New work should rely on the automatic size/risk escalation instead — large/cross-cutting diffs and plans already escalate to Opus.

`--team` also overrides your profile's `team.defaultMode` for that run. (Overkill handling — the downgrade ask — is covered in [Subagents vs teams](#subagents-vs-teams--agt-smart-picks).)

**Cost.** A typical subagent feature run is tens of thousands of tokens (Opus plans, Sonnet builds). Team mode multiplies that ~4× and adds ~2–4 min of fixed overhead (plan + spawn + teardown) — only worth it when the parallel slices are each long enough that building them at once beats the sequential total. For a small single-slice task, subagent mode is faster and cheaper every time. agentille warns once per session past the daily soft cap (default 10, in your profile).

## Shipped log

Every completed `/agt` run appends one line to `./docs/agentille-log.md` in the target project — a lightweight, reverse-chronological record:

```
## 2026-05-23
- **feat:** user profile wizard — `feature-team (4 teammates · 12m)`
  - PR: #42
```

It's written to your repo's working tree — commit it as a lightweight history, or add `docs/agentille-log.md` to that project's `.gitignore` to keep it local.

## What a run looks like

Here's what you see in the terminal when you run `/agt "add a search filter to the dashboard"`:

```yaml
# agentille v1.23.0 ▸ subagent · feature ▸ ~3m
task:    add a search filter to the dashboard
mode:    subagent    # sequential spine · 1 slice, no disjoint work
recon:   ◉ done      # classified: feature · hasUI
plan:    ◉ done      # opus · 4 steps, 1 parallel
review:  ◉ done      # plan-reviewer · approved · sonnet
design:  ◉ done      # ui-prototyper · blueprint · opus
build:   ◐ active    # 1 executor · sonnet · builds the blueprint
gate:    ○ pending   # code-reviewer · design-reviewer
ship:    ○ pending   # branch + debrief
```

Then live pings stream below it — **each LED is the agent working that phase** (the same color as its team pane):

```
🟢 recon    subagent · feature · 1 slice, hasUI         0:03
🔵 plan     4 steps · 1 parallel · opus                 0:17
🔵 review   plan APPROVED · sonnet                       0:29
🟠 design   ui-prototyper ✓ tokens · states · a11y       0:55
🟢 build    exec-1 ▸ search-filter spawned               0/1
🟢 build    exec-1 ✓  3 files · agt/search-filter        1:58
🟡 gate     code-review ✓ clean                          2:20
🟣 gate     design-review ✓ 3 viewports · a11y clean     3:05
```

```diff
+ code-review     clean — no issues
+ design-review   PASS — hierarchy / type / contrast all ≥8, 0 AI-tells
```

```yaml
# DEBRIEF ▸ /agt · add a search filter to the dashboard
design:   ✓ ui-prototyper blueprint · tokens + states + a11y
build:    ✓ SearchFilter component · 3 files · agt/search-filter
gate:     ✓ code-review clean · design-review PASS (3 viewports)
cost:     ✓ subagent · ui-prototyper + 1 exec + 2 reviews
result:   ✓ 3 files · branch agt/search-filter · 3m 12s
```

The recon line always shows the mode pick and reason. The `cost:` row states the dispatch shape — never a fabricated token count. If team mode runs, a `team:` teardown row confirms all panes closed.

---

## Companion viewer: agentille-cockpit

[agentille-cockpit](https://github.com/hasuwini77/agentille-cockpit) is a separate, opt-in live viewer for `/agt` runs — a local web UI that streams planner/executor/reviewer progress in real time as the run unfolds.

**Producer / consumer split.** agentille emits structured events via its hook scripts; the cockpit app consumes them over a local SSE stream.  The two are coupled only by the `schema:1` wire contract — no direct dependency, and the cockpit has no effect on the run itself.

### Enable emission

Cockpit event emission is **off by default**.  Turn it on one of two ways:

```bash
# Per-run (env var)
AGENTILLE_COCKPIT=1 /agt "your task"

# Always on (profile flag)
# In ~/.agentille/profile.json:  "cockpit": { "enabled": true }
```

### Launch the viewer

```bash
# Quick start — point at an existing local clone (sibling dir or $AGENTILLE_COCKPIT_DIR)
scripts/cockpit-launch.sh

# First-time setup — clone the public repo to ~/.agentille/cockpit-app
scripts/cockpit-launch.sh --clone

# Custom port (default 7878)
scripts/cockpit-launch.sh --port 7900

# Force a full SPA rebuild (deps or config changed)
scripts/cockpit-launch.sh --build
```

The server prints a `http://127.0.0.1:PORT/#t=…` URL on startup — open it in a browser, then run `/agt` in another terminal.

### How the launcher resolves the cockpit directory

First hit wins:

1. `$AGENTILLE_COCKPIT_DIR` (explicit override)
2. `<plugin-root>/../agentille-cockpit` (sibling of the agentille repo)
3. `~/.agentille/cockpit-app` (the default `--clone` target)

If none is found the launcher prints the clone command and stops.

### Security (verified in source)

The following properties are confirmed in the cockpit server source (`src/server.ts`, `src/api.ts`):

- **Loopback-only bind.** The server binds to `127.0.0.1` — it is not reachable from the network.
- **Per-launch bearer token.** A fresh 24-byte random token is generated at startup; every data route requires it (`Authorization: Bearer <token>`).  The token lives in the URL fragment and never reaches the server.
- **Read-only API.** The server exposes only GET routes: run listing, per-run diff (stat + patch text), and an SSE stream.  There are no write routes into the runs directory.

**Trust boundary.** `cockpit-launch.sh` builds and runs JavaScript from the resolved cockpit directory.  Point it only at code you trust.  `$AGENTILLE_COCKPIT_DIR` and the sibling-directory probe are user-controlled — this is opt-in trust, not a sandboxed environment.  `--clone` fetches and runs the public repository (the resolved commit SHA is shown before install; social trust, not signature-verified).

---

## Requirements

- Claude Code (any recent version for subagent mode; **2.1.32+** for team mode).
- A `~/.agentille/profile.json` — created by `/agentille-init`.

## Philosophy

- **Opinionated, not generic.** The agents encode a way of working — and because every prompt runs through your voice profile, that way of working becomes *yours*.
- **Right model for the right task.** Tokens go where they earn the most.
- **Parallel by default.** Worktrees keep features isolated, history clean, and reviews focused.

## Acknowledgments

The executor's debugging, test-first, and verification discipline is informed by [Jesse Vincent's superpowers](https://github.com/obra/superpowers) (MIT) — internalized in agentille's own voice, not bundled as a dependency.

## License

MIT — see [LICENSE](./LICENSE). Audit it, fork it, ship it.

## Author

[@hasuwini77](https://github.com/hasuwini77) — solo dev shipping opinionated tools.
