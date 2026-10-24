# Settings: every profile.json key

Everything lives in `~/.agentille/profile.json`. Every key is optional, a missing one takes its default, and no profile file is needed at all. This page covers every key: `integration`, `thinkingDepth`, `projects[]`, `routing.*`, the `display` block, the voice keys and `viewports`, and the commands that used to set the `display` keys. The README's Settings section is the short version.

## What is checked

- **What is checked:** an invalid `display.*` value is ignored and falls back to the value a settings command (`/agt-deck`, `/agt-focus`, `/agt-highlight`) left in the mod's store, then to the default; `band`, `statusLine` and `mascot` have no command, so they go straight to the default ([Display switches](#display-switches)). An invalid `integration` value is ignored too, and the next rule in [`integration`](#integration) decides.
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

## `integration`

What a finished slice becomes.

- **Values:**
  - `pr` (default) pushes a branch and opens a PR per slice.
  - `auto` merges each PR on green with a merge commit, deletes the branch and pushes a version tag.
  - `push` pushes each slice branch, no PR, no merge.
  - `local` merges locally and pushes nothing.
  - Without `gh`, `pr` behaves as `push`.
- **Your profile decides:** that repo's `projects[].integration` entry (matched by `url`, the `origin` remote, or `path`; `/agentille-project` writes both), then the top-level `integration`, then `pr`.
  - An entry with only an `id` matches a repo with no remote and can only lower the integration mode, so a clone of someone else's repo with the same folder name never inherits `auto`.
- **A repo can only lower it** (auto → pr → push → local): its `.agentille/config.json` `{"integration": …}` (`/agentille-project` writes it), a CLAUDE.md or AGENTS.md saying `no-mistakes` (at most `pr`) or `local-only` (`local`).
- **Guards:** below `auto` the mod refuses merges, tags, releases and API merges from a run, and lets through only a push of the run's own branch. Under `local` it refuses pushes and PRs too. How it reads a command: [guards.md](./guards.md).
- **Risky diffs stop at the PR** under every setting: a diff that touches auth, payments, deploy, migrations, dependencies or a business assumption, and the card says `⚑ escalated`.

## `projects[]`

One entry per repo, written by `/agentille-project` (it appends, or replaces the entry with the same `url` or `path`, else the same `id`): `id`, `url` (the `origin` remote, left out when there is none), `path` (the repo root), `name`, `description`, `techStack`, `goals`, `claudeUse`, `constraints` and `integration`. The mod reads `url`, `path`, `id` and `integration` to find a repo's integration mode ([`integration`](#integration)); the rest feeds the repo's CLAUDE.md.

## `thinkingDepth`

Default `complex-only`; set it by hand. `complex-only` and `always` route by the table in the README's [Routing](../README.md#routing) section, and `always` also asks the planner for a reasoning note per step.

`quick` trades depth for cost: the planner, ui-prototyper, code- and perf-reviewer and the adversary run sonnet · medium, the security, payments and design reviewers sonnet · high, the SEO reviewer sonnet · low, the plan-reviewer and formations are skipped and the plan stays at 5 steps or fewer.

The design-reviewer keeps opus · high under `complex-only` and `always`, and the executor stays on Sonnet either way.

## `routing`

| key | default | what it does |
|---|---|---|
| `autoFable` | `false` | `true` lets the escalation ladder reach Fable (about twice the cost of Opus) after two plan REVISEs, or for the diagnose planner after two failed fixes, at most `maxFablePerRun` times and only under `fableWeeklyCeiling` percent of your weekly plan. `false`: Fable only when you type `--fable`. |
| `maxFablePerRun` | `1` | How many Fable spawns the ladder may make in one run. |
| `fableWeeklyCeiling` | `60` | The ladder reaches Fable only while your weekly plan usage is below this percent. |
| `advisorOnOpus` | `true` | `false` starts Opus and Fable pane workers without Claude Code's advisor tool; Sonnet workers keep it. |
| `maxRunUsd` | `15` | A per-run cost ceiling in US dollars (`null` turns it off), estimated from the agents' tokens, the lead's own tokens on the run and pane minutes. Past it, every later role but the executor that would run Opus runs Sonnet, with one toast and a band flag; a typed `--fable` passes it, and the toast says so. It is an API-list-price estimate, not your plan's quota. How the estimate works and what it demotes: [routing-cost.md](./routing-cost.md) and the README's [Routing](../README.md#routing) section. |
| `stopAtCeiling` | `false` | `true` refuses every dispatch, subagent, pane or workflow agent and whatever the role, once the run's estimate reaches `maxRunUsd`, instead of moving later roles to Sonnet. The deny line names the estimate and the ceiling. |
| `stopAtWeeklyPct` | `0` (off) | A number from 1 to 100 refuses every later dispatch once your subscription's seven-day usage percent is at or above it. This is the quota gate; `maxRunUsd` is a price estimate. Details: [routing-cost.md](./routing-cost.md). |

The mod holds the model to `autoFable`: a dispatch header claiming `fable=forced` in a session where you did not type `--fable` is rewritten to `fable=auto`, with a toast.

## Display switches

Each surface the mod draws has its own key in the `display` block. An invalid value is ignored, and the key falls back to the value a settings command left in the mod's own store (`/agt-deck` for `deck`, `/agt-focus` for `focus`, `/agt-highlight` for `highlight`), then to its default; an invalid stored value counts as not set. `band`, `statusLine` and `mascot` never had a command, so an invalid value there goes straight to the default. `/agt-info` prints the value in effect and where it came from. Turning a surface off changes nothing about `/agt` itself, it only stops drawing: runs are routed, counted and reported the same, and `/agt-info` still shows them.

| key | values | default | `off` (or the other value) does |
|---|---|---|---|
| `band` | `on`, `off` | `on` | Draws nothing above the prompt: the run's tree, the wire line, the `⚑` flags and a worker pane's own band all live there and go with it. |
| `statusLine` | `on`, `off` | `on` | Pins no status line under the prompt, and clears one an earlier reload left pinned. |
| `mascot` | `on`, `off` | `on` | Drops the figure from a worker pane's band and from the deck's cast. A worker keeps its one-line caption (role, model, effort, elapsed); the deck keeps each agent's role and model. |
| `rows` | `on`, `off` | `on` | Leaves every `Agent` call in the transcript as Claude Code's own row, and a `Workflow` call without the agents listed under it. This covers a plain subagent you never ran through `/agt` and an `/agt` run's own agents alike. |
| `spinner` | `on`, `off` | `on` | Adds nothing to the main spinner: no `◇2 working` count while plain subagents work, and no phase names during an `/agt` run. |
| `deck` | `auto`, `off` | `off` | `auto` opens the deck on every typed `/agt`; `off` opens it only when you type `/agt-deck`. |
| `focus` | `true`, `false` | `true` | `false` hides the `⚑` agent flags in the band (a REVISE, a FAIL, a blocked pane). |
| `highlight` | `on`, `all`, `off` | `off` | See below. |
| `sessions` (top level, not in `display`) | `on`, `off` | `on` | A plain prompt never unlocks `open_sessions`: "open three sessions" opens nothing. A typed `/storm` still opens its one hand-off session. `/agt-info` prints it under the `display` keys. Set it as `{ "sessions": "off" }`. |

```json
{ "display": { "band": "off", "statusLine": "on", "mascot": "off" } }
```

The daily version check is not a display key: set `AGENTILLE_UPDATE_CHECK=0` in your environment to turn it off.

## `display.highlight`

Default `off`. `on` lights `/agt` replies, `all` every reply, `off` none. The mod adds text to a prompt only in the two cases below (under `all`, and text to paste).

- **The frame:** the answer that ends a lit turn draws between two rules (`╭─ ◆ agentille · time ─╮` above, `╰─╯` below) with nothing beside the text, so a selection copies no border or indent.
- **Inside it:** the first line is the headline, bullets become • rows with paths, versions and refs lit, and your steps are numbered under an amber **── your move ──** divider (or "✓ nothing needed from you").
- **Under `all`:** each question you type also gets the answer-shape note, which asks Claude for that shape: a one-line answer, at most 6 short bullets, and numbered steps only when you have something to do.
- **Text to paste:** ask for "no formatting", "plain text" or "copy-paste", or start with `raw:` (in a short prompt, or in the short first or last sentence of a long one), and under `on` or `all` the prompt gets a one-line "answer in plain text" note, the answer skips the frame, comes back as plain text and lands on your clipboard.
- **`off`** adds nothing to any prompt and copies nothing.

## Voice keys

`/agentille-init` asks up to 5 skippable questions and merges the answers into the profile (it never replaces the file); you can also set these keys by hand. `/agt` reads them on every run and hands them to each agent, so the planner, executors and reviewers write in your voice and respect your hard limits. Missing keys take the defaults below, and `/agt` works the same with none of them. With no voice key set, the first `/agt` prints `tip: /agentille-init makes agents sound like you` once.

| key | values | default | what it does |
|---|---|---|---|
| `name`, `role` | free text | unset | who the agents work for |
| `deliveryStyle` | `direct`, `detailed`, `step-by-step`, `short-paragraphs` | `direct` | how answers and reports are written |
| `tone` | `peer-to-peer`, `mentor`, `formal`, `blunt`, `casual` | `peer-to-peer` | the register agents write in |
| `preTaskQuestioning` | `never`, `ambiguous-only`, `always` | `ambiguous-only` | when `/agt` asks before it starts: never, only when the task is genuinely ambiguous (at most 3 questions, each with a recommended default), or up front |
| `neverDo` | a list of strings | `[]` | hard prohibitions, passed verbatim to every agent |

```json
{ "name": "<your name>", "role": "solo developer", "deliveryStyle": "direct", "tone": "blunt", "preTaskQuestioning": "ambiguous-only", "neverDo": ["edit generated files"] }
```

## `viewports`

The viewports the design reviewer screenshots when your task names none: any of `desktop`, `tablet`, `mobile`. Default: desktop and mobile. Set it by hand.

## Older commands

`/agt-routing`, `/agt-ledger` and `/agt-squads` were removed in v3.14.0: use `/agt-info routing|ledger|squads`.

Two commands still work and write the `display` block, but both are deprecated and go away in v4:

| You type | You get | Instead |
|---|---|---|
| `/agt-focus [on\|off]` | Agent flags in the band on or off, saved as `display.focus` | set `display.focus` in your profile |
| `/agt-highlight [on\|all\|off]` | Which replies get lit, saved as `display.highlight` | set `display.highlight` in your profile |

When the profile cannot be written, both fall back to the mod's own store on this machine and say so. A value in `profile.json` wins over the store from the next session on.
