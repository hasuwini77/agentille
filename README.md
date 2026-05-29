```
 █████╗  ██████╗ ███████╗███╗   ██╗████████╗██╗██╗     ██╗     ███████╗
██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██║██║     ██║     ██╔════╝
███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██║██║     ██║     █████╗
██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██║██║     ██║     ██╔══╝
██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ██║███████╗███████╗███████╗
╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝╚══════╝╚══════╝╚══════╝
```

> A personal AI coding orchestrator for Claude Code. Type **`/agt "task"`** and it classifies the work, **smart-picks subagents or a full agent team**, routes the right Claude model to each, and applies *your* voice to every prompt.

One command instead of manually chaining skills. Planning and review run on Opus, execution on Sonnet, and code + design review are built in. `/agt` decides on its own whether the work needs a real Claude Code **agent team** (independent sessions that talk to each other) or cheaper in-session **subagents** — and tells you which it picked and why.

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

- **One-command orchestration.** `/agt "task"` routes work through planner, executor, and reviewers automatically — no manual skill-chaining.
- **Right model for the job.** Opus sets direction (planning) and handles the heavy reviews; Sonnet writes the code and clears the routine reviews (plan-review, and code-review on small diffs); Opus steps in only for large or cross-cutting reviews. Haiku runs the cheap edges (task classification + the final summary). Tokens go where they earn the most.
- **Parallel-safe by default.** Each chunk of work runs in its own git worktree (branched off your *current* branch — never assumed `main`) with atomic commits, then integrates adaptively: a PR where the repo supports it, otherwise a pushed or handed-off branch. Works whether you're solo on main or stuck on a locked-down team branch.
- **Voice-aware.** Your profile shapes every prompt. Ask for brutal feedback once, and every agent is brutal.
- **Review built in.** Code review (bugs/security/quality) on every change, plus a design review (it asks which viewports actually matter, then screenshots only those, runs axe-core, and scans for the generic AI-design tells that make most AI UIs feel cheap) whenever UI is touched.

## How it works

When you run `/agt "task"`, the orchestrator:

1. **Reads your profile** (`~/.agentille/profile.json`) for communication style, tone, and rules.
2. **Classifies the task** — feature, bugfix, refactor, design, review, debug, research, or planning.
3. **Smart-picks the execution mode** — in-session **subagents** (default) or a real **agent team**, based on whether the work has ≥2 independent slices that can build at once. It shows you the pick and a one-line reason every run.
4. **Picks a roster** — only the agents that task needs (e.g. no design reviewer on a backend change).
5. **Routes a model per role** and **applies your voice** to every dispatched prompt.
6. **Runs in dependency order**, parallelizing independent work (max 3 executors at once), then returns one summary. When a plan is involved, the repo is explored **once** and each executor gets only its slice — so splitting work saves tokens instead of paying an N× rediscovery tax.

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
| `agentille-planner` | Goal-backward plan with parallelizable steps marked | Opus |
| `agentille-plan-reviewer` | Critiques the plan before execution — goal, coverage, parallel-safety, real verification | Sonnet · Opus for large plans |
| `agentille-executor` | Headless implementation — atomic commits, integrates adaptively (PR / push / local branch) | Sonnet |
| `agentille-code-reviewer` | Read-only review for bugs, security, quality | Sonnet · Opus for large/cross-cutting diffs |
| `agentille-design-reviewer` | Visual review (scored design pillars), axe-core (+ Web Interface Guidelines), AI-design-tell scan, at the viewports that matter | Opus |
| `agentille-security-reviewer` | Severity-classified security review | Opus |

> **Where Haiku runs:** two steps happen *inline* in the orchestrator, not as dispatched agents — **task classification** (picks which roster to run) and the **final summary**. Both are cheap, so they go to Haiku.

### Skills it uses (if you have them)

agentille **bundles none of these** — it *reaches for* skills you've already installed and falls back to its own judgment when they're absent (never a hard dependency, never an error on a missing skill). When a slice is UI work, the executor pulls from two complementary layers, and the design-reviewer adds a static accessibility pass at the gate:

| Layer | Skills | Used by |
|---|---|---|
| **Design** — how it looks | `impeccable`, `ui-ux-pro-max`, `frontend-design` | executor, build-time |
| **Framework** — how it's built | `vercel-react-best-practices` + `next-best-practices` (React/Next), `vercel-react-native-skills` (RN) — gated on the *detected stack* | executor, build-time |
| **Accessibility** | `axe-core` (runtime scan) + `web-design-guidelines` (static Web Interface Guidelines review) | design-reviewer, at the gate |

The two build layers don't overlap — design is *aesthetics*, framework is *correctness + performance* — and a framework skill is never loaded for a stack it doesn't match. In **team mode** the lead hands each teammate a **skill budget** (which of these it may use for its slice), so capability lands where it helps without every teammate loading heavy skills and inflating the ~4× token cost. The design micro-skills (`polish`, `delight`, `colorize`, `typeset`, …) stay yours to invoke on demand — agentille doesn't auto-load them.

## Subagents vs teams — `/agt` smart-picks

**Auto-detection is the default.** You don't pick a mode — `/agt` picks for you, prints the decision and a one-line reason every run, and defaults to the cheaper option when there's no clear reason to pay more.

### What to type for each outcome

| What you type | What you get |
|---|---|
| `/agt "task"` (no flags) | Auto: solo if trivial; subagent if sequential/single-slice; review-team if verb is "review"; incident-team if verb is "debug"; Opus classify for everything else |
| `/agt "review …"` | Auto → `review-team` (verb fast-path) |
| `/agt "debug …"` | Auto → `incident-team` (verb fast-path) |
| `/agt --team <template> "task"` | Force a named team — overrides auto; `/agt` flags overkill if there are no ≥2 disjoint slices |
| `/agt --mode subagent "task"` | Force subagent mode for one run |

Stage 2 (Opus classify) only fires when Stage 1 fast-paths all miss. It promotes to `team` only when ≥2 genuinely disjoint slices can build in parallel — it won't pay ~4× tokens for sequential work.

Claude Code gives you two ways to parallelize, and they're genuinely different:

| | **Subagents** (default) | **Agent team** (`--team`) |
|---|---|---|
| Workers | Dispatched helpers that report results **back to the lead** | Independent Claude sessions that **message each other** |
| Coordination | The lead manages all work | Shared task list + scoped peer handoffs |
| Best for | Sequential work, a single slice, focused tasks | ≥2 independent slices, multi-pillar review, competing-hypothesis debugging |
| Token cost | **Lower** — each worker's context returns to the lead | **~4×** — every teammate is a full, separate session |

**Forcing a team.** Pass `--team <template>` to override the pick for one run. If the work genuinely has parallel slices, `/agt` spawns the team. If a team would be **overkill** (sequential, single slice), `/agt` doesn't obey blindly — it explains why subagent mode fits better and **asks** whether to downgrade or force the team anyway:

> *"`--team feature-team` here looks like overkill — no ≥2 independent slices to build in parallel, so subagent mode does the same work for ~¼ the tokens. Downgrade to subagent (recommended), or force the team?"*

You always get the final say — downgrade and save the tokens, or force the team and `/agt` runs it without another word. (If you've set `preTaskQuestioning` to `never`, it skips the question, honors the force, and notes the trade in one line instead.)

## Team mode (optional)

When `/agt` picks a team — or you force one with `--team` — each role becomes an independent Claude session with its own context window that messages peers and shares a task list. Best when parallel perspectives genuinely help — multi-pillar review, cross-layer features, or competing-hypothesis debugging.

### The teams

| Team | When to use | Teammates spawned |
|---|---|---|
| 🟩 `feature-team` | Build a feature across UI + API — reviewed as it ships | 2 × executor + code-reviewer + design-reviewer (4) |
| 🟦 `review-team` | Get a change fully checked before you merge | code-reviewer + design-reviewer + security-reviewer (3) |
| 🟥 `incident-team` | Crack a bug that has several possible causes | 3 × executor testing competing hypotheses (3) |

> Colors are auto-assigned by Claude Code — each teammate spawns in its own color (you'll see e.g. one green, one blue) and it can differ run to run. The badges above are just README labels; agentille doesn't pin a color per team. You (the orchestrator) are always the lead — the planner is not a spawned teammate.

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
```

**`--plan` (dry-run).** Stops after the plan + plan-review — before any executor or teammate spawns — so you approve the *shape and cost* first; a plain "go" then runs that exact plan. Pairs with any mode (`/agt --plan --team feature-team "…"` previews the team roster + ~4× cost without spawning). The cheapest guard against building the wrong thing.

`--team` overrides both the auto-pick and your profile's `team.defaultMode` for that one run. If the task has no real parallel work, `/agt` asks whether to downgrade to subagent (~¼ the tokens) or force the team anyway — you decide — see [Subagents vs teams](#subagents-vs-teams--agt-smart-picks).

**Cost:** team mode uses ~4× the tokens of subagent mode (each teammate is a full session). agentille warns once per session if you pass the daily soft cap (default 10, set in your profile).

**What to expect in practice.** A typical subagent feature run costs roughly tens of thousands of tokens total — Opus plans, Sonnet builds. Team mode multiplies that ~4× and adds ~2–4 min of fixed overhead (plan + spawn + teardown) before the actual build starts. That overhead only pays off when the parallel slices are each long enough that building them simultaneously beats the sequential total. For a small single-slice task, subagent mode gets you there faster and cheaper every time.

## Shipped log

Every completed `/agt` run appends one line to `./docs/agentille-log.md` in the target project — a lightweight, reverse-chronological record:

```
## 2026-05-23
- **feat:** user profile wizard — `feature-team (4 teammates · 12m)`
  - PR: #42
```

It's documentation, so it's committed by default. To opt out, add `docs/agentille-log.md` to that project's `.gitignore`.

## What a run looks like

Here's what you see in the terminal when you run `/agt "add a search filter to the dashboard"`:

```yaml
# agentille v1.20.0 ▸ subagent · feature ▸ ~8m
task:    add a search filter to the dashboard
mode:    subagent    # sequential spine · 1 slice, no disjoint work
recon:   ◉ done      # classified: feature
plan:    ◉ done      # opus · 4 steps, 1 parallel
review:  ◉ done      # plan-reviewer · approved · sonnet
build:   ◐ active    # 1 executor · sonnet
gate:    ○ pending   # code-reviewer
ship:    ○ pending   # branch + debrief
```

```
🟢 recon    subagent · sequential, 1 slice              0:03
🟢 plan     4 steps · opus                              0:17
🟢 review   plan APPROVED · sonnet                      0:29
🔵 build    exec-1 ▸ search-filter spawned              0/1
🟢 build    exec-1 ✓  3 files · branch agt/search-filter  1:42
```

```diff
+ code-review    clean — no issues
```

```yaml
# DEBRIEF ▸ /agt · add a search filter to the dashboard
build:    ✓ SearchFilter component · 3 files · agt/search-filter
gate:     ✓ code-review clean
cost:     ✓ subagent · 1 exec + 1 code-review
result:   ✓ 3 files · branch agt/search-filter · 2m 11s
```

The recon line always shows the mode pick and reason. The `cost:` row states the dispatch shape — never a fabricated token count. If team mode runs, a `team:` teardown row confirms all panes closed.

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
