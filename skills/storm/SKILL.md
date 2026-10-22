---
name: storm
description: Feature storm for an existing project. One command, `/storm`, fans out ~11 research agents (codebase scouts + 8 market/user/revenue lenses), merges their output into 10–15 scored feature candidates, red-teams the top ones, auto-picks the best 2–5, writes the spec to docs/storm/<date>.md and hands the build to `/agt heavy` in a fresh Claude session. Activates ONLY when the user types `/storm`; model invocation is disabled.
argument-hint: [quick] [N] ["focus"] [--ask] [--no-build] [--next]
disable-model-invocation: true
---

# storm — /storm

Research wide, pick narrow, build heavy. Typing `/storm` is the approval for the whole fan-out: no "shall I" questions, no pause unless `--ask`.

## Arguments

| Token | Effect |
|---|---|
| `quick` | 4 lenses instead of 8, no adversary, hand-off at `/agt medium` |
| `N` (1–5) | force the number of picks; otherwise the auto rule in `scoring.md` |
| `"focus"` | a theme every lens must bias toward (`"monetization"`, `"onboarding"`, `"mobile"`) |
| `--ask` | pause once after the shortlist card; "go" continues, a list of numbers overrides the picks |
| `--no-build` | stop after the storm doc; no hand-off |
| `--next` | queue the picks in `.agentille/backlog.md` for `/agt next` instead of one heavy run |

Project = the current directory. If it holds no manifest, README, `.git` or source tree, it is a parent folder: ask ONE question ("which project?") and stop until answered.

Print the recon line before anything else: `storm: <project> · <8|4> lenses · picks <auto|N> · <heavy|medium|next|doc-only>`.

## Phases

Run dir: `~/.agentille/state/storm-<id>/` (`<id>` = 6 lowercase alphanumerics). Every intermediate goes there, never in the repo. Seed TodoWrite with one todo per phase (recon · scouts · lenses · judge · adversary · pick · doc · hand-off) and move it as you go.

### 0. Recon (main session, Bash only, ≤2 min)

Read what exists, nothing more: `README*`, `CLAUDE.md`, `docs/{STATUS,ROADMAP,HANDOFF,MASTER_PROMPT}*`, the manifest (`package.json`, `Package.swift`, `*.xcodeproj`, `CMakeLists.txt`, `pyproject.toml`…), `git log --oneline -30`, a depth-2 tree, and every past `docs/storm/*.md`. From past storms collect **shipped** (picks of past storms that `git log` shows merged) and **dropped** (their "Dropped" sections): both go on the exclusion list.

Write `brief.md` (≤60 lines): what the product is, who uses it, how it makes or saves money (`valueAxis`: `revenue` for a product, `retention` for a game, `time-saved` for a tool), stack, size, what shipped recently, exclusion list, focus. Read `~/.agentille/profile.json` → `neverDo`; it goes verbatim into every dispatch.

### 1. Scouts (2 × Haiku `Explore`, one message, background)

- `scout-inventory`: the feature inventory as it is today, plus half-built things: TODO/FIXME, feature flags off, unused data models, dead routes. ≤25 lines of paths and facts.
- `scout-surface`: integration surface: APIs, data models, auth, payments, exports, platform hooks. ≤25 lines.

Haiku reads only. Wait for both, append them to `brief.md` under `SCOUTS:`.

### 2. Lenses (8 × Sonnet `general-purpose`, ONE message, background)

One agent per lens in `lenses.md` (`quick` → the first 4). Each dispatch = the dispatch header below + `brief.md` + its lens block + the output schema in `lenses.md` → "Schema". Each returns exactly 3–5 candidates, every one with evidence (a URL for market lenses, a `file:line` for code lenses). Research agents never edit files and stop after ≤12 tool calls. One wait for all eight; a lens that returns nothing usable is noted on the card, never retried more than once.

### 3. Judge (main session)

Merge the lens outputs: fold near-duplicates into the strongest version and keep every evidence link; drop anything on the exclusion list; score each with `scoring.md`; rank; keep the top 10–15. Write `candidates.md` in the run dir.

### 4. Adversary (1 × Sonnet `general-purpose`, foreground; skipped by `quick`)

Send the top 8 with the brief. For each it returns `KEEP | SHRINK <new scope> | DROP <one-line reason>`: nobody asked for it, the code already does it, too big for one slice, needs money or an approval Edwin does not have. Apply the verdicts, re-rank.

### 5. Pick

`N` given → the top N. Otherwise the auto rule in `scoring.md` → "Auto-pick" (2–5 picks, bounded by total effort). Print the shortlist card (`handoff.md` → "Shortlist card"). `--ask` → stop here until "go" or a list of numbers.

### 6. Doc

Write `docs/storm/<YYYY-MM-DD>.md` from `handoff.md` → "Storm doc": picks with scope, acceptance criteria and touched files; runner-ups; dropped; evidence. Commit it on the current branch as `docs: storm <date> — <k> picks` and push when a remote exists. No issue, no tag (docs change).

### 7. Hand-off

Never build in this session. The build belongs to `/agt`, which only runs when typed, so start a fresh session that types it:

1. Compose the task (`handoff.md` → "agt task line"): one heavy run, one slice per pick, acceptance criteria by reference to the doc.
2. `--next` → append `- [ ] <pick title> (spec: docs/storm/<date>.md §<n>)` per pick to `.agentille/backlog.md` (gitignore it on first creation) and print `/agt next`.
3. Otherwise call `mcp__agentille__open_sessions` with `kind: "claude"`, `count: 1`, `cwd: <project root>`, `tasks: ["/agt heavy \"<task>\""]` (`quick` → `medium`). It opens beside this pane, unfocused, and owns its own `/agt` run.
4. If the tool errors or is missing (no Herdr, no tmux), print the exact line to paste. Print it anyway under the card as the fallback: a prompt sent to a pane still drawing its startup screen can be swallowed.

Then the final card (`handoff.md` → "Final card"). That card is the only end-of-run output.

## Dispatch header

Every research dispatch starts with one line, then the profile prefix when `neverDo` is set:

`[storm run=<id> role=<scout|lens|adversary> lens=<slug> valueAxis=<revenue|retention|time-saved> focus=<text|none>]`

```
User: Edwin (senior frontend dev, solo, goal: micro-SaaS income). Avoid: <neverDo, verbatim>.
```

## Hard rules

- **Research only here.** No agent of this run writes code; the storm session never builds. Haiku scouts, Sonnet researches and judges, Fable only if Edwin typed `--fable` on the `/agt` line later.
- **Evidence or it does not exist.** A candidate with no URL or `file:line` is dropped at the judge.
- **Never re-propose** what a past storm shipped or dropped, or what the inventory scout found already built.
- **One message per fan-out, one wait.** Scouts in one message; all lenses in one message; the adversary alone in the foreground.
- **No popups, no dashboards.** Progress is the TodoWrite spine and the two cards; detail lives in the run dir and the storm doc.
- **Honor `neverDo`** verbatim in every dispatch.
- **Nothing idle survives.** Stop every background subagent once its output is merged. The hand-off session is Edwin's, not yours: never close it.
