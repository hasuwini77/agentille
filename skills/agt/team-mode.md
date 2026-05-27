# Team mode — when to use it and how to dispatch

> **Authority:** the dispatch decision table in `skills/agt/SKILL.md` is the tie-breaker. This doc is the detail/rationale — if it ever conflicts with that table, the table wins.

The orchestrator picks one of three execution modes per task:

- **subagent** (default, always available) — dispatches roles via the `Agent` tool, results return to the orchestrator. The v1.0 path.
- **team** (opt-in, experimental) — uses Claude Code's Agent Teams primitive: each role is an independent Claude session, peers can message each other, shared task list. Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` and Claude Code 2.1.32+.
- **solo** — execute inline in this session, no spawn. For trivial tasks (one file mentioned, no architectural verbs).

## Auto-detection (Stage 1)

Before dispatching, check in order. First match wins:

1. User passed `--team <name>` → team mode, named template, skip Stage 2.
2. User passed `--mode <mode>` → respect, skip Stage 2.
3. `profile.team.enabled === false` → subagent, authoritative. Blocks all auto-promotion below. (Sits below the explicit-flag rules so a per-run `--team`/`--mode` can still override the profile default intentionally.)
4. `profile.team.defaultMode === 'subagent'` → subagent (authoritative, even if verb matches).
5. `profile.team.defaultMode === 'solo'` → solo (authoritative).
6. Trivial: task mentions exactly one file (e.g. `utils.ts`) AND no architectural verb (`refactor`, `design`, `architect`, `migrate`, `redesign`, `restructure`) → solo.
7. Task verb = `review` → team, `review-team` template.
8. Task verb = `debug` → team, `incident-team` template.
9. Else → fall through to Stage 2 (planner-classify).

## Honesty on a forced team (`--team` / `--mode team`)

A `--team`/`--mode team` flag is a **force** — the user explicitly asked for a team, and that intent is respected. But forcing skips the judgment that would have told them whether a team is actually *warranted*. So before spawning a forced team, run the **disjoint-parallelism heuristic inline** (no LLM, no Stage 2 spawn): does the task decompose into **≥ 2 vertical slices with disjoint file sets that can build at once**? (Same criterion as `classifier.md` → "Team vs subagent honesty"; a competing-hypothesis debug or a multi-pillar review also count as warranted.)

- **Heuristic passes** (real parallelism, or an adversarial debug / multi-pillar review) → the force matched the work. Spawn the team, say nothing extra.
- **Heuristic fails** (sequential work, or a single slice — a team would be *overkill*) → don't obey blindly, but don't override silently either. What happens next is governed by `preTaskQuestioning`:

  - **`always` / `ambiguous-only`** → **ask once** (the question tool). Recommend the downgrade, give the reason, and make forcing the team a one-tap choice. The user decides:

    > *"`--team <template>` here looks like overkill — I don't see ≥2 disjoint slices to build in parallel, so subagent mode would do the same work for ~¼ the tokens. **Downgrade to subagent** (recommended), or **force the team anyway**?"*

    Downgrade → run subagent mode. Force → spawn the team as asked. One question, honor the answer, never loop.

  - **`never`** → the user opted out of questions; honor the force, spawn the team, and emit ONE `honestyLevel`-gated heads-up line instead of asking (never blocks):

    > `team (forced) · <template> — no ≥2 disjoint slices here; subagent mode would've matched this for ~¼ the tokens. Running the team as you asked.`

    `honestyLevel` gating: emit on candid / blunt / high honesty (the default); suppress only when the profile sets the most hands-off honesty level (the user has opted out of advisories too).

This is the deliberate counterpart to auto-mode honesty: in **auto** mode `/agt` *won't* pay the ~4× team tax for parallelism that isn't there; in **forced** mode it surfaces the trade — *asking* when questions are on, *flagging* when they're off — then does exactly what the user chooses. The downgrade prompt is the **one** sanctioned friction on a forced team because it carries real signal (detected overkill); never add per-spawn confirmation beyond it. Surface the resolved outcome on the recon ping (`display.md`).

## Stage 2 — planner-classify (Opus)

When Stage 1 returns null, dispatch the planner in classify mode by prepending `CLASSIFY:` to the user's task:

```
Agent({
  subagent_type: "agentille:agentille-planner",
  prompt: "CLASSIFY: <user task>",
  description: "Classify task for orchestrator"
})
```

The planner returns a single JSON object:

```json
{
  "mode": "subagent | team | solo",
  "team_template": "feature-team | review-team | incident-team | null",
  "roster": ["agentille:agentille-executor", "agentille:agentille-code-reviewer"],
  "reasoning": "one-sentence why"
}
```

Parse the JSON. If parsing fails, fall back to `mode: "subagent"` and log a one-line note. Never crash on a malformed classifier response.

**When the mode hinges on a question, ask it.** Team vs subagent turns on one thing: are there ≥2 independent slices that can build at once? If that's genuinely unknowable from the prompt and the profile's `preTaskQuestioning` permits, don't guess — the lead resolves it in the clarify round (see SKILL.md → "Clarify before planning"), and the answer re-resolves the mode. Default the provisional `mode` to `subagent` until clarified; promote to `team` only once the parallelism is confirmed. A borderline team guess that turns out sequential is the exact ~4× waste this orchestrator exists to avoid.

## Pre-flight check (team mode only)

Before dispatching team mode:

1. Verify `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set. If not, tell the user:
   > *"Team mode is gated by `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. Add it to `~/.claude/settings.json` (in the `env` block) or pass `--mode subagent`."*
   …and degrade to subagent mode.

2. Check `claude --version >= 2.1.32`. If older, degrade with: *"Agent Teams requires Claude Code 2.1.32+. Degraded to subagent mode."*

3. Check daily soft cap (see below). If exceeded, prompt once per session.

4. **Display-readiness (non-blocking — hint only, never degrades team mode).** Split panes are driven by Claude Code's own `teammateMode` setting — NOT by anything agentille sets, and NOT by the agentille profile's `team.displayMode` (which is informational only; see below). Detect a mismatch, guide the user **once per session**, then continue regardless:

   - Read four signals: `$TMUX` (inside a tmux session?), `uname -s` (`Darwin` = macOS), whether `tmux` / `it2` are installed, and `teammateMode` from `~/.claude/settings.json`. Panes are *possible* when inside tmux, **or** on macOS with iTerm2's `it2` CLI.

   | Panes possible? | `teammateMode` | Action |
   |---|---|---|
   | yes | `tmux`, or `auto` while inside tmux | **Ready** — say nothing. |
   | yes | unset / `in-process` / `auto` outside tmux | **Hint:** *"Teammates will run in-process (no split panes). To get one pane per teammate, add `\"teammateMode\": \"tmux\"` to `~/.claude/settings.json` — or launch `claude --teammate-mode tmux`."* |
   | no (tmux session absent) | `tmux` | **Hint:** *"`teammateMode: tmux` is set but there's no tmux session — start `tmux` (or use iTerm2 on macOS) before launching Claude so panes can attach."* |
   | no (Windows Terminal / VS Code terminal / Ghostty) | any | **No nag** — panes are unsupported there; teammates run in the lead's terminal (Shift+Down to cycle). |

   Guidance only: never write to `settings.json` yourself, never block, and skip silently if the file can't be read. This is the one pre-flight check that does **not** degrade team mode on failure — pane display is cosmetic, the team still runs.

## Display mode (the split-pane "wow")

Whether teammates appear in separate panes is the **user's** setting, not agentille's — never try to set it from the skill:

- `teammateMode: "in-process"` (and the `"auto"` default outside tmux) → all teammates live in the lead's terminal; cycle with Shift+Down. Works in any terminal.
- `teammateMode: "tmux"` (or `"auto"` while already inside a tmux session) → each teammate gets its own pane. Requires tmux **or** iTerm2 (`it2` CLI) installed.

> **Two settings, don't confuse them.** Claude Code's top-level **`teammateMode`** (in `~/.claude/settings.json`) is the *only* thing that drives panes. The agentille profile's **`team.displayMode`** is informational metadata — it does **not** control Claude Code's display. A user who sets `team.displayMode: "tmux"` and expects panes will be disappointed; always point them at `teammateMode`.

**The recipe that actually opens panes** (macOS or Linux/WSL2):
1. Be **inside a tmux session** (`tmux`, then launch `claude` within it) — or on macOS, use iTerm2 with the `it2` CLI.
2. Set `"teammateMode": "tmux"` in `~/.claude/settings.json`, or launch `claude --teammate-mode tmux`.
3. Spawn the team normally — each teammate opens in its own split pane.

The pre-flight display-readiness check (step 4 above) detects when steps 1–2 are missing and hints automatically, so the user is told at dispatch time rather than left wondering. If they still ask "why no panes?", walk them through the recipe. Split panes are unsupported in VS Code's integrated terminal, standalone Windows Terminal, and Ghostty — there teammates run in-process, which is fully functional, just single-pane.

## Terminal ergonomics (tmux)

For readability when the lead is talking to you, make the lead the dominant pane: `tmux select-layout main-vertical` (lead = large left pane, teammates = small stacked right), or zoom the focused pane with prefix + `z`. In Warp the tmux prefix (Ctrl+b) is frequently intercepted — add `set -g mouse on` to `~/.tmux.conf` to click-focus and drag-resize panes, or use iTerm2 + `tmux -CC` for native panes. Teammate panes do not auto-minimize when idle; `main-vertical` keeps them small from the start.

## Team dispatch

The `.claude-plugin/teams/<name>.yaml` files are **agentille's own role manifests** — they tell the orchestrator which roles/counts make up a template. They are NOT Claude Code team config: Claude Code auto-generates and owns `~/.claude/teams/<name>/config.json` (session IDs, pane IDs) and overwrites any hand-authored version, so never pre-author that file.

> **`--plan` halts here.** If `--plan` is set, preview the resolved template's roster + the `~4×` cost in the Mission Brief and **STOP** — do not run `TeamCreate` or spawn anyone. The user approves the shape first. See `SKILL.md` → "Run modifier: `--plan`".

You (the orchestrator) are the **team lead**. Given a resolved template:

1. **Record the run start** (mode, team name, teammate count, verb, start timestamp) so you can write the shipped-log line at the end. Keep it in your own context — there is no log hook.

2. **Create the team** with `TeamCreate` (use the template name).

3. **Spawn each teammate** with the `Agent` tool, into that team:
   - `subagent_type` = the **namespaced** agent def, e.g. `agentille:agentille-executor` (NOT bare `agentille-executor` — that resolves to nothing).
   - `team_name` = the team you just created; `run_in_background: true` so teammates run concurrently.
   - Spawn `count` instances per role. Give each a distinct `name` you can reference (e.g. `exec-1`, `exec-2`).
   - Prompt = the user's task + the profile context block + which slice of the work this teammate owns. **Assign disjoint file sets** — two teammates editing the same file overwrite each other. Implementation teammates should each take their own git worktree (the executor does this when `isolated: true`, branching off the current branch) so they can't collide even by accident.
   - If the template marks `require-plan-approval: true`, tell the teammate to plan first in read-only mode and wait for your approval before implementing; you approve/reject as lead.

4. **Coordinate.** Teammates message you automatically when they go idle. Use the shared task list (`TaskCreate` / `TaskList`) for dependencies. Don't do the work yourself — wait for teammates unless one is genuinely stuck, then steer or respawn it. For build→review overlap, wire the scoped peer channel below (**Pipelined review**) rather than routing every finished piece through yourself.

5. **Synthesize + clean up.** When all teammates finish, synthesize the final response, append the shipped-log line (see SKILL.md "Shipped log"), then shut teammates down and ask the lead to clean up the team. A teammate must never run cleanup — its team context may not resolve.

### Skill budget — capability without token blowup

A teammate loads skills from the user's/project's settings exactly like a normal session — its agent-def `skills` frontmatter is ignored when it runs as a teammate (Anthropic's agent-teams doc). So a teammate executor **can** invoke installed UI-build skills (`impeccable`, `ui-ux-pro-max`, `frontend-design`) on its slice — but if every teammate auto-reaches for heavy skills, the `~4×` team tax balloons further. So the lead **scopes each teammate's skill use in its spawn prompt**:

- **UI-slice executor** → *"You may use `ui-ux-pro-max` and `impeccable` for this frontend slice; do not load other skills."*
- **Backend / non-UI executor** → *"Do not load UI-build skills."*
- **Reviewers** → no build skills; they review.

This is the team-mode counterpart to the executor's "Graceful UI enhancement" rule (`agents/agentille-executor.md`): capability lands on the slice that needs it, silence everywhere else. The budget is guidance in the prompt, never a hard gate — a teammate with no UI work simply never reaches for a UI skill, and a teammate whose context carries no skills list builds with its own design judgment.

### Pipelined review (overlap phases)

Don't gate review behind "all executors done" — review each finished piece while the rest are still being built. It's the biggest wall-clock win in team mode and costs nothing extra in tokens: each piece is reviewed exactly once either way.

Wire it with a **scoped peer channel** — the sanctioned peer channel for build→review overlap (the incident-team adversarial debate is the other permitted case). Open chatter is banned: every message is context paid by both sender and receiver, so peers exchange exactly one structured handoff, nothing more.

1. When you spawn the executors, tell each the **name of the code-reviewer** and the handoff format. On integrating its piece, an executor sends the reviewer ONE message:
   ```
   READY <piece> | branch agt/<slug> | base <BASE> | files <list> | verified <cmd>:<result>
   ```
2. Tell the reviewer to expect incoming `READY` pings and review each diff (`git diff <base>..agt/<slug>`) the moment it arrives — NOT to wait for all pieces. It replies to BOTH the executor (so fixes start immediately) and you (the lead):
   ```
   REVIEW <piece> | PASS        — or —        REVIEW <piece> | ISSUES: <numbered>
   ```
3. You (lead) synthesize only once every piece has a `PASS`. A late piece never stalls review of an early one.

Scope guard: ONE `READY` per piece, ONE `REVIEW` back (plus one rev if `ISSUES`). Anything beyond the handoff routes through you — peers do not free-form chat.

### Consolidation — merge back to the current branch, never `main`

Worktrees fork from `$BASE = $(git symbolic-ref --short HEAD)` — the user's *current* branch, which may be `main` or a feature branch. The lead consolidates finished work back onto `$BASE`; it NEVER assumes `main`.

1. Once a teammate's piece has a `PASS`, merge its branch into `$BASE` **locally and sequentially** (one at a time — disjoint file sets make these clean, and serializing avoids index races):
   ```bash
   git checkout "$BASE" && git merge --no-ff "agt/<slug>" -m "merge: <piece>"
   git branch -D "agt/<slug>"        # delete scaffolding; never push agt/* branches
   ```
2. Resolve the **integration target** for `$BASE` (precedence: `--integration` flag → repo `.agentille/config.json` `{"integration": …}` → profile `projects[].integration` → `auto`):
   - `pr` — open a PR from `$BASE` (only when `$BASE` is meant for `main`). Never `--base main` unless explicitly chosen.
   - `push` — push `$BASE` to its own remote tracking branch and stop. **Default when `$BASE` ≠ `main`.**
   - `local` — leave consolidated work on `$BASE`; no remote.
   - `auto` — `$BASE` is `main`/`master` → today's behavior (PR if `gh`+GitHub, else push). `$BASE` is any other branch → **push `$BASE` only**, never scaffolding, never `main`.

This keeps the parallel split-pane build on any branch while respecting "work on my own branch, don't merge to main yet."

### Incident-team special case

For `incident-team`, override the executor prompts with adversarial framing. Generate 3 distinct hypotheses by reading the failing symptom, then assign one per executor:
- Teammate 1: "Investigate hypothesis A: [hypothesis]. Adversarially challenge teammates B and C."
- Teammate 2: "Investigate hypothesis B: [hypothesis]. Adversarially challenge teammates A and C."
- Teammate 3: "Investigate hypothesis C: [hypothesis]. Adversarially challenge teammates A and B."

The lead picks the surviving hypothesis after the debate.

## Failure → degrade

If team spawn fails for any reason (env var unset mid-flight, agent-type not found, max teammates exceeded, etc.), fall through to subagent dispatch and log one line after: *"team unavailable — ran N subagents instead"*.

## Daily soft cap

Track team-mode invocations per 24h in `~/.agentille/state/runs.jsonl` (append one JSON line per run). Before executing team mode, count runs in the last 24h. If count >= `profile.team.dailySoftCap` (default 10) AND the user has not been warned this session, show:

> *"You've run N team-mode tasks today (cap: M, set in profile). Continue? [Y/n]"*

Suppressible with `--yes` or by setting `dailySoftCap: 0`. After execution, append the run record.

**Hardening note:** the orchestrator must write the shipped-log line and the `runs.jsonl` record using the **Write tool**, NEVER a shell command containing arithmetic expansion (e.g. `$(( ... ))`) or other constructs that can trigger a Bash safety prompt — that would stall the lead and violate the "logging never blocks the user" contract. If a log write would prompt or fail, skip it silently.

## Cost transparency

Team mode uses ~4× the tokens of subagent mode (each teammate is a separate Claude session with its own context). Surface this in the **Mission Brief header** (see `display.md`) rather than as a standalone line — the header carries the squad and the cost together:

> `agentille ▸ team · <template> ▸ ~<est>m · ~4× tokens`

Do NOT prompt the user for confirmation per spawn — friction with no signal. Only two frictions are sanctioned, both because they carry real signal: the **daily soft cap**, and the **forced-overkill downgrade prompt** (see "Honesty on a forced team"). Nothing else.
