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

## Pre-flight check (team mode only)

Before dispatching team mode:

1. Verify `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set. If not, tell the user:
   > *"Team mode is gated by `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. Add it to `~/.claude/settings.json` (in the `env` block) or pass `--mode subagent`."*
   …and degrade to subagent mode.

2. Check `claude --version >= 2.1.32`. If older, degrade with: *"Agent Teams requires Claude Code 2.1.32+. Degraded to subagent mode."*

3. Check daily soft cap (see below). If exceeded, prompt once per session.

## Display mode (the split-pane "wow")

Whether teammates appear in separate panes is the **user's** setting, not agentille's — never try to set it from the skill:

- `teammateMode: "in-process"` (and the `"auto"` default outside tmux) → all teammates live in the lead's terminal; cycle with Shift+Down. Works in any terminal.
- `teammateMode: "tmux"` (or `"auto"` while already inside a tmux session) → each teammate gets its own pane. Requires tmux **or** iTerm2 (`it2` CLI) installed.

If the user asks "why no panes?", point them at `~/.claude/settings.json` → `teammateMode` plus installing tmux/iTerm2. Split panes are unsupported in VS Code's integrated terminal, Windows Terminal, and Ghostty.

## Terminal ergonomics (tmux)

For readability when the lead is talking to you, make the lead the dominant pane: `tmux select-layout main-vertical` (lead = large left pane, teammates = small stacked right), or zoom the focused pane with prefix + `z`. In Warp the tmux prefix (Ctrl+b) is frequently intercepted — add `set -g mouse on` to `~/.tmux.conf` to click-focus and drag-resize panes, or use iTerm2 + `tmux -CC` for native panes. Teammate panes do not auto-minimize when idle; `main-vertical` keeps them small from the start.

## Team dispatch

The `.claude-plugin/teams/<name>.yaml` files are **agentille's own role manifests** — they tell the orchestrator which roles/counts make up a template. They are NOT Claude Code team config: Claude Code auto-generates and owns `~/.claude/teams/<name>/config.json` (session IDs, pane IDs) and overwrites any hand-authored version, so never pre-author that file.

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

Do NOT prompt the user for confirmation per spawn — friction with no signal. The daily soft cap is the only friction by design.
